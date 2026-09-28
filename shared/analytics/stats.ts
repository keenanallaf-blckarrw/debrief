import type { Trade } from "../types";
import { round2 } from "../util/numbers";
import { weekdayOf, zonedParts } from "../util/time";

// Every number in Debrief is computed here, in code. The AI coach receives these
// as ground truth and interprets them; it never estimates a statistic itself.

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins ÷ (wins + losses), 0–1; null with no decided trades. */
  winRate: number | null;
  gross: number;
  commission: number;
  net: number;
  grossWins: number;
  grossLosses: number;
  /** Total won ÷ total lost. Above 1 means the winners paid for the losers. */
  profitFactor: number | null;
  /** Average net result per trade. */
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Average win ÷ average loss. */
  payoff: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  /** Deepest peak-to-trough dip of the running P&L, as a positive number. */
  maxDrawdown: number;
  avgHoldWinMs: number | null;
  avgHoldLossMs: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  days: number;
  greenDays: number;
  redDays: number;
  bestDay: { day: string; net: number } | null;
  worstDay: { day: string; net: number } | null;
  avgTradesPerDay: number | null;
  contracts: number;
}

const EPS = 0.005;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(trades: Trade[]): Summary {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const wins = sorted.filter((t) => t.net > EPS);
  const losses = sorted.filter((t) => t.net < -EPS);
  const net = sorted.reduce((s, t) => s + t.net, 0);
  const gross = sorted.reduce((s, t) => s + t.pnl, 0);
  const commission = sorted.reduce((s, t) => s + t.commission, 0);
  const grossWins = wins.reduce((s, t) => s + t.net, 0);
  const grossLosses = losses.reduce((s, t) => s + t.net, 0);

  let peak = 0;
  let run = 0;
  let maxDrawdown = 0;
  let winStreak = 0, lossStreak = 0, longestWin = 0, longestLoss = 0;
  for (const t of sorted) {
    run += t.net;
    peak = Math.max(peak, run);
    maxDrawdown = Math.max(maxDrawdown, peak - run);
    if (t.net > EPS) {
      winStreak++;
      lossStreak = 0;
    } else if (t.net < -EPS) {
      lossStreak++;
      winStreak = 0;
    }
    longestWin = Math.max(longestWin, winStreak);
    longestLoss = Math.max(longestLoss, lossStreak);
  }

  const byDay = dailyNet(sorted);
  const dayList = [...byDay.entries()].map(([day, v]) => ({ day, net: v.net }));
  const green = dayList.filter((d) => d.net > EPS).length;
  const red = dayList.filter((d) => d.net < -EPS).length;
  const best = dayList.reduce<Summary["bestDay"]>((b, d) => (!b || d.net > b.net ? d : b), null);
  const worst = dayList.reduce<Summary["worstDay"]>((b, d) => (!b || d.net < b.net ? d : b), null);
  const avgWin = avg(wins.map((t) => t.net));
  const avgLoss = avg(losses.map((t) => t.net));

  return {
    trades: sorted.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: sorted.length - wins.length - losses.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
    gross: round2(gross),
    commission: round2(commission),
    net: round2(net),
    grossWins: round2(grossWins),
    grossLosses: round2(grossLosses),
    profitFactor: losses.length ? grossWins / Math.abs(grossLosses) : wins.length ? Infinity : null,
    expectancy: sorted.length ? net / sorted.length : null,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss !== null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.net)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.net)) : null,
    maxDrawdown: round2(maxDrawdown),
    avgHoldWinMs: avg(wins.map((t) => t.holdMs)),
    avgHoldLossMs: avg(losses.map((t) => t.holdMs)),
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    days: dayList.length,
    greenDays: green,
    redDays: red,
    bestDay: best ? { day: best.day, net: round2(best.net) } : null,
    worstDay: worst ? { day: worst.day, net: round2(worst.net) } : null,
    avgTradesPerDay: dayList.length ? sorted.length / dayList.length : null,
    contracts: sorted.reduce((s, t) => s + t.qty, 0),
  };
}

export interface DayTotal {
  net: number;
  trades: number;
  wins: number;
  losses: number;
}

export function dailyNet(trades: Trade[]): Map<string, DayTotal> {
  const m = new Map<string, DayTotal>();
  for (const t of trades) {
    const d = m.get(t.day) ?? { net: 0, trades: 0, wins: 0, losses: 0 };
    d.net += t.net;
    d.trades++;
    if (t.net > EPS) d.wins++;
    else if (t.net < -EPS) d.losses++;
    m.set(t.day, d);
  }
  return m;
}

export interface Bucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  net: number;
  winRate: number | null;
  avg: number | null;
}

function bucketize(trades: Trade[], keyOf: (t: Trade) => { key: string; label: string } | null, order?: string[]): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const t of trades) {
    const k = keyOf(t);
    if (!k) continue;
    const b = m.get(k.key) ?? { key: k.key, label: k.label, trades: 0, wins: 0, losses: 0, net: 0, winRate: null, avg: null };
    b.trades++;
    b.net += t.net;
    if (t.net > EPS) b.wins++;
    else if (t.net < -EPS) b.losses++;
    m.set(k.key, b);
  }
  const out = [...m.values()].map((b) => ({
    ...b,
    net: round2(b.net),
    winRate: b.wins + b.losses ? b.wins / (b.wins + b.losses) : null,
    avg: b.trades ? b.net / b.trades : null,
  }));
  if (order) out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  else out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}

function hourLabel(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

export function byHour(trades: Trade[], tz: string): Bucket[] {
  return bucketize(trades, (t) => {
    const h = zonedParts(t.entryTime, tz).hour;
    return { key: String(h).padStart(2, "0"), label: hourLabel(h) };
  });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function byWeekday(trades: Trade[]): Bucket[] {
  return bucketize(
    trades,
    (t) => {
      const w = weekdayOf(t.day);
      return { key: WEEKDAYS[w], label: WEEKDAYS[w] };
    },
    WEEKDAYS,
  );
}

export function byInstrument(trades: Trade[]): Bucket[] {
  return bucketize(trades, (t) => ({ key: t.root, label: t.root })).sort((a, b) => b.trades - a.trades);
}

export function bySide(trades: Trade[]): Bucket[] {
  return bucketize(trades, (t) => ({ key: t.side, label: t.side }), ["Long", "Short"]);
}

const SEQ_ORDER = ["1", "2", "3", "4", "5+"];
export function bySequence(trades: Trade[]): Bucket[] {
  return bucketize(
    trades,
    (t) => {
      const k = t.seq >= 5 ? "5+" : String(t.seq);
      const label = k === "5+" ? "5th+" : k === "1" ? "1st" : k === "2" ? "2nd" : k === "3" ? "3rd" : "4th";
      return { key: k, label };
    },
    SEQ_ORDER,
  );
}

const HOLD_ORDER = ["a", "b", "c", "d", "e"];
export function byHold(trades: Trade[]): Bucket[] {
  return bucketize(
    trades,
    (t) => {
      const m = t.holdMs / 60_000;
      if (m < 1) return { key: "a", label: "Under 1 min" };
      if (m < 5) return { key: "b", label: "1–5 min" };
      if (m < 15) return { key: "c", label: "5–15 min" };
      if (m < 60) return { key: "d", label: "15–60 min" };
      return { key: "e", label: "Over 1 hour" };
    },
    HOLD_ORDER,
  );
}

export function byTag(trades: Trade[], tagsOf: (t: Trade) => string[]): Bucket[] {
  const expanded: { t: Trade; tag: string }[] = [];
  for (const t of trades) for (const tag of tagsOf(t)) expanded.push({ t, tag });
  const m = new Map<string, Bucket>();
  for (const { t, tag } of expanded) {
    const b = m.get(tag) ?? { key: tag, label: tag, trades: 0, wins: 0, losses: 0, net: 0, winRate: null, avg: null };
    b.trades++;
    b.net += t.net;
    if (t.net > EPS) b.wins++;
    else if (t.net < -EPS) b.losses++;
    m.set(tag, b);
  }
  return [...m.values()]
    .map((b) => ({ ...b, net: round2(b.net), winRate: b.wins + b.losses ? b.wins / (b.wins + b.losses) : null, avg: b.net / b.trades }))
    .sort((a, b) => b.trades - a.trades);
}

export interface EquityPoint {
  time: number;
  value: number;
  tradeKey: string;
}

export function equityCurve(trades: Trade[]): EquityPoint[] {
  let run = 0;
  return [...trades]
    .sort((a, b) => a.exitTime - b.exitTime)
    .map((t) => {
      run += t.net;
      return { time: t.exitTime, value: round2(run), tradeKey: t.key };
    });
}
