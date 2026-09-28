import { describe, expect, it } from "vitest";
import { makeRule, ruleLabel } from "../shared/rules/catalog";
import { evaluateAll, evaluateDay, gradeFor } from "../shared/rules/evaluate";
import { evaluateGuard } from "../shared/rules/account";
import type { AccountGuard, NewsEvent, OrderEvent } from "../shared/types";
import { importFixtures, sequence, trade, tradesOf } from "./helpers";

const DAY = "2026-08-13";
const at930 = Date.UTC(2026, 7, 13, 13, 30);

describe("grades", () => {
  it("maps scores to letters, so 2 of 6 broken is a D", () => {
    expect(gradeFor(100)).toBe("A");
    expect(gradeFor(83)).toBe("B");
    expect(gradeFor(75)).toBe("C");
    expect(gradeFor(67)).toBe("D");
    expect(gradeFor(50)).toBe("F");
  });

  it("scores followed ÷ (followed + broken) and leaves unanswered items out", () => {
    const rules = [
      makeRule("maxTradesPerDay", { max: 1 }),
      makeRule("maxContracts", { max: 10 }),
      makeRule("manual", { scope: "day" }, "Set my bias"),
    ];
    const ev = evaluateDay(sequence([trade({ at: 0, net: 10 }), trade({ at: 10, net: 10 })]), rules, DAY, "A1", {});
    expect(ev.broken).toBe(1);
    expect(ev.followed).toBe(1);
    expect(ev.unanswered).toBe(1);
    expect(ev.score).toBe(50);
    expect(ev.grade).toBe("F");
  });
});

describe("rule checks", () => {
  const check = (rule: ReturnType<typeof makeRule>, trades: ReturnType<typeof trade>[], ctx = {}) =>
    evaluateDay(sequence(trades), [rule], DAY, "A1", ctx).checks[0];

  it("max trades per day flags every extra trade", () => {
    const c = check(makeRule("maxTradesPerDay", { max: 2 }), [trade({ at: 0, net: 1 }), trade({ at: 5, net: 1 }), trade({ at: 9, net: 1 }), trade({ at: 12, net: 1 })]);
    expect(c.status).toBe("broken");
    expect(c.violations.map((v) => v.message)).toEqual([
      "Trade #3 of the day. Your limit is 2.",
      "Trade #4 of the day. Your limit is 2.",
    ]);
  });

  it("max contracts looks at the peak position", () => {
    const c = check(makeRule("maxContracts", { max: 5 }), [trade({ at: 0, net: 1, peakQty: 10 })]);
    expect(c.status).toBe("broken");
    expect(c.violations[0].message).toBe("10 contracts at once. Your max is 5.");
  });

  it("daily loss limit catches both blowing through it and trading on after it", () => {
    const blowThrough = check(makeRule("dailyLossLimit", { amount: 500 }), [trade({ at: 0, net: -700 })]);
    expect(blowThrough.status).toBe("broken");
    expect(blowThrough.violations[0].message).toContain("past your $500 limit");

    const tradeOn = check(makeRule("dailyLossLimit", { amount: 500 }), [trade({ at: 0, mins: 1, net: -500 }), trade({ at: 5, net: 100 })]);
    expect(tradeOn.status).toBe("broken");
    expect(tradeOn.violations[0].message).toBe("Opened after the day was already down $500 (limit $500).");

    const ok = check(makeRule("dailyLossLimit", { amount: 500 }), [trade({ at: 0, net: -300 }), trade({ at: 5, net: -100 })]);
    expect(ok.status).toBe("followed");
  });

  it("walk-away target flags trades opened after the day was green enough", () => {
    const c = check(makeRule("dailyProfitTarget", { amount: 300 }), [trade({ at: 0, mins: 1, net: 350 }), trade({ at: 5, net: -200 })]);
    expect(c.status).toBe("broken");
  });

  it("stop after N losses in a row", () => {
    const c = check(makeRule("maxConsecutiveLosses", { max: 2 }), [
      trade({ at: 0, mins: 1, net: -10 }),
      trade({ at: 5, mins: 1, net: -10 }),
      trade({ at: 10, mins: 1, net: 20 }),
    ]);
    expect(c.status).toBe("broken");
    expect(c.violations[0].message).toBe("Taken after 2 losses in a row. Your rule is to stop after 2.");
  });

  it("trading window uses the rule's timezone", () => {
    const rule = makeRule("tradingWindow", { windows: [{ start: "09:35", end: "11:30" }], timezone: "America/New_York" });
    expect(check(rule, [trade({ at: 2, net: 1 })]).status).toBe("broken");
    expect(check(rule, [trade({ at: 10, net: 1 })]).status).toBe("followed");
    expect(ruleLabel(rule)).toBe("Only enter 9:35 AM–11:30 AM ET");
  });

  it("news buffer needs a calendar, then flags entries near high-impact releases", () => {
    const rule = makeRule("newsBuffer", { minutes: 5, minImpact: "high" });
    const t = [trade({ at: 2, net: -40 })]; // 9:32
    expect(check(rule, t).status).toBe("na");
    const news: NewsEvent[] = [{ id: "n1", title: "CPI m/m", currency: "USD", time: at930, impact: "high" }];
    const c = check(rule, t, { news, newsDays: new Set([DAY]) });
    expect(c.status).toBe("broken");
    expect(c.violations[0].message).toBe("Entered 2 min after CPI m/m (USD).");
  });

  it("revenge cooldown flags quick re-entries after a loss only", () => {
    const rule = makeRule("revengeCooldown", { minutes: 5 });
    const c = check(rule, [trade({ at: 0, mins: 2, net: -120 }), trade({ at: 3, net: 50 }), trade({ at: 6, mins: 1, net: 30 }), trade({ at: 8, net: 5 })]);
    expect(c.violations).toHaveLength(1);
    expect(c.violations[0].message).toBe("Re-entered 1 min after a $120 loss.");
  });

  it("no sizing up after a loss", () => {
    const c = check(makeRule("noSizeUpAfterLoss"), [trade({ at: 0, net: -10, peakQty: 2 }), trade({ at: 5, net: 10, peakQty: 4 })]);
    expect(c.violations[0].message).toBe("Sized up from 2 to 4 contracts right after a loss.");
  });

  it("max loss per trade and allowed instruments", () => {
    expect(check(makeRule("maxLossPerTrade", { amount: 200 }), [trade({ at: 0, net: -250 })]).status).toBe("broken");
    const inst = check(makeRule("allowedInstruments", { roots: ["mgc"] }), [trade({ at: 0, net: 5 })]);
    expect(inst.violations[0].message).toBe("Traded MNQ, which isn't on your list.");
  });

  it("stop rules need order data, then read stops and stop moves", () => {
    const t = trade({ at: 0, mins: 10, net: 20 });
    expect(check(makeRule("stopRequired"), [t]).status).toBe("na");
    const base = { root: "MNQ", symbol: "MNQU6", importId: "x", type: "Stop" as const, side: "Sell" as const, orderId: "9" };
    const orders: OrderEvent[] = [
      { ...base, id: "a", time: t.entryTime + 5_000, action: "placed", price: 95 },
      { ...base, id: "b", time: t.entryTime + 60_000, action: "modified", price: 90 },
    ];
    expect(check(makeRule("stopRequired"), [t], { orders }).status).toBe("followed");
    const widen = check(makeRule("noStopWidening"), [t], { orders });
    expect(widen.status).toBe("broken");
    expect(widen.violations[0].message).toBe("Moved the stop from 95 to 90, further from your entry.");
  });

  it("manual checklist items read your ticks", () => {
    const rule = makeRule("manual", { scope: "day" }, "Wait for the sweep");
    const t = [trade({ at: 0, net: 5 })];
    expect(check(rule, t).status).toBe("unanswered");
    expect(check(rule, t, { journal: { [DAY]: { manual: { [rule.id]: "broken" } } } }).status).toBe("broken");
    const perTrade = makeRule("manual", { scope: "trade" }, "Entered at a key level");
    expect(check(perTrade, t, { tradeNotes: { [t[0].key]: { manual: { [perTrade.id]: "followed" } } } }).status).toBe("followed");
  });
});

describe("evaluateAll", () => {
  it("evaluates each account-day and indexes violations by trade", () => {
    const data = importFixtures(["tradovate-position-history.csv"]);
    const trades = tradesOf(data);
    const rules = [makeRule("maxTradesPerDay", { max: 3 })];
    const ev = evaluateAll(trades, rules, {});
    expect(ev.days.map((d) => d.day)).toEqual(["2026-08-13", "2026-08-14"]);
    const aug13 = ev.byDay.get("2026-08-13")![0];
    expect(aug13.grade).toBe("F");
    expect(ev.byTrade.size).toBe(2);
  });
});

describe("Account Guard", () => {
  const guard = (g: Partial<AccountGuard>): AccountGuard => ({
    id: "g",
    name: "50K eval",
    account: "",
    startBalance: 50000,
    drawdownMode: "static",
    lockAtStart: false,
    ...g,
  });
  const day = (d: string, net: number, minute = 0) => {
    const t = trade({ at: minute, net });
    return { ...t, day: d, entryTime: t.entryTime + Number(d.slice(-2)) * 86_400_000, exitTime: t.exitTime + Number(d.slice(-2)) * 86_400_000 };
  };

  it("tracks a trailing end-of-day drawdown", () => {
    const trades = [day("2026-08-11", 1500), day("2026-08-12", -2000), day("2026-08-13", -1000)];
    const s = evaluateGuard(guard({ maxDrawdown: 2500, drawdownMode: "trailingEod" }), trades);
    // Peak EOD 51,500 → threshold 49,000. Balance 49,500 after day 2, then 48,500.
    expect(s.breaches.find((b) => b.kind === "drawdown")?.day).toBe("2026-08-13");
    expect(s.status).toBe("breached");
  });

  it("locks the trailing threshold at the starting balance when asked", () => {
    const s = evaluateGuard(guard({ maxDrawdown: 2500, drawdownMode: "trailingIntraday", lockAtStart: true }), [day("2026-08-11", 4000)]);
    expect(s.threshold).toBe(50000);
    expect(s.drawdownRoom).toBe(4000);
  });

  it("flags the daily loss limit and the consistency rule", () => {
    const trades = [day("2026-08-11", 3000), day("2026-08-12", 500), day("2026-08-13", -1200)];
    const s = evaluateGuard(guard({ dailyLossLimit: 1000, consistencyPct: 40, profitTarget: 3000 }), trades);
    expect(s.breaches.map((b) => b.kind).sort()).toEqual(["consistency", "dailyLoss"]);
    expect(s.consistency).toEqual({ bestDayShare: 130, ok: false });
    expect(s.targetProgress).toBeCloseTo(2300 / 3000, 6);
  });

  it("reports a passed evaluation", () => {
    const s = evaluateGuard(guard({ profitTarget: 3000, maxDrawdown: 2500 }), [day("2026-08-11", 1600), day("2026-08-12", 1500)]);
    expect(s.status).toBe("passed");
  });
});
