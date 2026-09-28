import { describe, expect, it } from "vitest";
import { summarize, byHour, bySequence, equityCurve } from "../shared/analytics/stats";
import { analyzeBehavior } from "../shared/analytics/behavior";
import { buildInsights, splitByRules } from "../shared/analytics/insights";
import { importFixtures, trade, tradesOf, TZ } from "./helpers";

describe("round trips", () => {
  const data = importFixtures(["tradovate-position-history.csv"]);
  const trades = tradesOf(data);

  it("merges a scale-in into one trade and sizes it by the peak position", () => {
    expect(trades).toHaveLength(6);
    const scaled = trades.find((t) => t.executions.length === 2)!;
    expect(scaled.qty).toBe(20);
    expect(scaled.peakQty).toBe(20);
    expect(scaled.pnl).toBe(-120);
    expect(scaled.avgEntry).toBeCloseTo(30180, 6);
    expect(scaled.avgExit).toBe(30177);
  });

  it("puts the 6:22 PM gold trade on the next CME trading day", () => {
    const gold = trades.find((t) => t.root === "MGC")!;
    expect(gold.day).toBe("2026-08-14");
    expect(gold.seq).toBe(1);
    expect(trades.filter((t) => t.day === "2026-08-13")).toHaveLength(5);
  });

  it("numbers trades within each day in entry order", () => {
    const day = trades.filter((t) => t.day === "2026-08-13");
    expect(day.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(day.map((t) => t.side)).toEqual(["Long", "Long", "Long", "Short", "Short"]);
  });

  it("does not merge a trade that starts after the last one closed", () => {
    const back = trades.filter((t) => t.day === "2026-08-13").slice(1, 3);
    expect(back[0].exitTime).toBeLessThanOrEqual(back[1].entryTime);
  });
});

describe("commissions", () => {
  it("spreads real Cash History commissions over the day's fills by contracts", () => {
    const data = importFixtures(["tradovate-position-history.csv", "tradovate-cash-history.csv"]);
    const trades = tradesOf(data);
    const mnq = trades.filter((t) => t.root === "MNQ");
    const total = mnq.reduce((s, t) => s + t.commission, 0);
    expect(total).toBeCloseTo(46, 1);
    expect(mnq.every((t) => t.commissionSource === "cash-history")).toBe(true);
    const gold = trades.find((t) => t.root === "MGC")!;
    expect(gold.commission).toBe(10);
    expect(gold.net).toBe(-370);
  });

  it("estimates from your per-side rate when there's no Cash History", () => {
    const data = importFixtures(["tradovate-position-history.csv"]);
    data.settings.commissionPerSide = 0.5;
    const t = tradesOf(data).find((x) => x.root === "MGC")!;
    expect(t.commission).toBe(10);
    expect(t.commissionSource).toBe("estimate");
  });
});

describe("stats", () => {
  const trades = [
    trade({ at: 0, net: 100 }),
    trade({ at: 10, net: -50 }),
    trade({ at: 20, net: -25 }),
    trade({ at: 30, net: 75 }),
    trade({ at: 40, net: 0 }),
  ];
  const s = summarize(trades);

  it("computes win rate over decided trades only", () => {
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.breakeven).toBe(1);
    expect(s.winRate).toBe(0.5);
  });

  it("computes profit factor, expectancy, payoff and drawdown", () => {
    expect(s.net).toBe(100);
    expect(s.profitFactor).toBeCloseTo(175 / 75, 6);
    expect(s.expectancy).toBe(20);
    expect(s.payoff).toBeCloseTo(87.5 / 37.5, 6);
    expect(s.maxDrawdown).toBe(75);
    expect(s.longestLossStreak).toBe(2);
  });

  it("buckets by hour in your timezone and by trade number", () => {
    const hours = byHour(trades, TZ);
    expect(hours.map((h) => h.label)).toEqual(["9 AM", "10 AM"]);
    const seq = bySequence(trades.map((t, i) => ({ ...t, seq: i + 1 })));
    expect(seq.map((b) => b.label)).toEqual(["1st", "2nd", "3rd", "4th", "5th+"]);
  });

  it("builds a running equity curve", () => {
    expect(equityCurve(trades).map((p) => p.value)).toEqual([100, 50, 25, 100, 100]);
  });
});

describe("behavior", () => {
  it("catches quick re-entries after losses and bigger size after losses", () => {
    const trades = [
      trade({ at: 0, mins: 2, net: -100, peakQty: 5 }),
      trade({ at: 2.5, mins: 2, net: -80, peakQty: 10 }), // 30s after a loss, doubled
      trade({ at: 30, mins: 2, net: 50, peakQty: 5 }),
      trade({ at: 40, mins: 2, net: 40, peakQty: 5 }),
    ];
    const b = analyzeBehavior(trades, { revengeMinutes: 2 });
    expect(b.revenge.trades).toBe(1);
    expect(b.revenge.net).toBe(-80);
    expect(b.sizeAfterLoss.afterLoss).toBe(7.5);
    expect(b.sizeAfterLoss.afterWin).toBe(5);
  });

  it("ranks the rule-breaking split first in insights", () => {
    const trades = [
      trade({ at: 0, net: 120 }),
      trade({ at: 10, net: -90 }),
      trade({ at: 20, net: -60 }),
      trade({ at: 30, net: 80 }),
    ];
    const split = splitByRules(trades, new Set([trades[1].key, trades[2].key]));
    const insights = buildInsights(trades, summarize(trades), analyzeBehavior(trades), { timezone: TZ, ruleSplit: split });
    expect(insights[0].id).toBe("rules");
    expect(insights[0].title).toBe("Rule-breaking trades: -$150. Clean trades: +$200.");
  });
});
