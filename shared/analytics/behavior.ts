import type { NewsEvent, Trade } from "../types";
import { newsCurrenciesFor, parseSymbol } from "../instruments";
import { round2 } from "../util/numbers";

// Behavioral leaks traders rarely catch on their own. All measured inside each
// account's trading day, because that's where tilt happens.

export interface Slice {
  trades: number;
  net: number;
  winRate: number | null;
}

export interface Behavior {
  revenge: Slice & { minutes: number; otherWinRate: number | null };
  sizeAfterLoss: { afterLoss: number | null; afterWin: number | null; samples: number };
  /** Average losing hold ÷ average winning hold. Above 1 = losers held longer. */
  holdRatio: number | null;
  afterLossStreak: Slice & { streak: number };
  overtrading: { threshold: number; days: number; net: number };
  news: (Slice & { minutes: number }) | null;
}

const EPS = 0.005;

function slice(trades: Trade[]): Slice {
  const w = trades.filter((t) => t.net > EPS).length;
  const l = trades.filter((t) => t.net < -EPS).length;
  return { trades: trades.length, net: round2(trades.reduce((s, t) => s + t.net, 0)), winRate: w + l ? w / (w + l) : null };
}

function groupByAccountDay(trades: Trade[]): Trade[][] {
  const m = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = `${t.account ?? ""}|${t.day}`;
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  }
  return [...m.values()].map((l) => l.sort((a, b) => a.entryTime - b.entryTime));
}

function prevClosed(list: Trade[], t: Trade): Trade | undefined {
  let best: Trade | undefined;
  for (const x of list) {
    if (x === t || x.exitTime > t.entryTime) continue;
    if (!best || x.exitTime > best.exitTime) best = x;
  }
  return best;
}

export function analyzeBehavior(
  trades: Trade[],
  opts: { revengeMinutes?: number; news?: NewsEvent[]; newsMinutes?: number; newsDays?: Set<string> } = {},
): Behavior {
  const revengeMinutes = opts.revengeMinutes ?? 2;
  const groups = groupByAccountDay(trades);
  const revengeTrades: Trade[] = [];
  const otherTrades: Trade[] = [];
  const afterLoss: number[] = [];
  const afterWin: number[] = [];
  const afterStreak: Trade[] = [];

  for (const list of groups) {
    for (const t of list) {
      const prev = prevClosed(list, t);
      if (prev && prev.net < -EPS && t.entryTime - prev.exitTime < revengeMinutes * 60_000) revengeTrades.push(t);
      else otherTrades.push(t);
      if (prev) (prev.net < -EPS ? afterLoss : afterWin).push(t.peakQty);
      const closed = list.filter((x) => x !== t && x.exitTime <= t.entryTime).sort((a, b) => b.exitTime - a.exitTime);
      let streak = 0;
      for (const x of closed) {
        if (x.net < -EPS) streak++;
        else break;
      }
      if (streak >= 2) afterStreak.push(t);
    }
  }

  const wins = trades.filter((t) => t.net > EPS);
  const losses = trades.filter((t) => t.net < -EPS);
  const avgHold = (xs: Trade[]) => (xs.length ? xs.reduce((s, t) => s + t.holdMs, 0) / xs.length : null);
  const hw = avgHold(wins);
  const hl = avgHold(losses);

  const perDay = groups.map((l) => l.length).sort((a, b) => a - b);
  const median = perDay.length ? perDay[Math.floor(perDay.length / 2)] : 0;
  const threshold = Math.max(median * 2, median + 3);
  const heavy = groups.filter((l) => l.length >= threshold && l.length > 3);

  let news: Behavior["news"] = null;
  if (opts.news && opts.news.length && opts.newsDays) {
    const minutes = opts.newsMinutes ?? 15;
    const high = opts.news.filter((e) => e.impact === "high");
    const covered = trades.filter((t) => opts.newsDays!.has(t.day));
    const near = covered.filter((t) => {
      const info = parseSymbol(t.symbol);
      const cur = new Set(newsCurrenciesFor(info.root, info.assetClass));
      return high.some((e) => cur.has(e.currency) && Math.abs(e.time - t.entryTime) <= minutes * 60_000);
    });
    if (covered.length) news = { minutes, ...slice(near) };
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    revenge: { minutes: revengeMinutes, ...slice(revengeTrades), otherWinRate: slice(otherTrades).winRate },
    sizeAfterLoss: { afterLoss: avg(afterLoss), afterWin: avg(afterWin), samples: afterLoss.length + afterWin.length },
    holdRatio: hw && hl ? hl / hw : null,
    afterLossStreak: { streak: 2, ...slice(afterStreak) },
    overtrading: { threshold, days: heavy.length, net: round2(heavy.flat().reduce((s, t) => s + t.net, 0)) },
    news,
  };
}
