import type { Trade } from "../types";
import type { Behavior } from "./behavior";
import type { Bucket, Summary } from "./stats";
import { byHour, bySequence, bySide, byWeekday } from "./stats";

// Plain-language findings computed without AI, ranked by how much money they
// explain. These show even when the AI coach is off.

export interface Insight {
  id: string;
  tone: "good" | "bad" | "info";
  title: string;
  detail: string;
  /** Dollars this finding explains, for ranking. */
  weight: number;
}

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const PLURAL_DAYS: Record<string, string> = {
  Sun: "Sundays", Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays",
};
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

function dur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export interface RuleSplit {
  clean: { trades: number; net: number; winRate: number | null };
  broken: { trades: number; net: number; winRate: number | null };
}

export function splitByRules(trades: Trade[], brokenKeys: Set<string>): RuleSplit {
  const part = (list: Trade[]) => {
    const w = list.filter((t) => t.net > 0.005).length;
    const l = list.filter((t) => t.net < -0.005).length;
    return { trades: list.length, net: list.reduce((s, t) => s + t.net, 0), winRate: w + l ? w / (w + l) : null };
  };
  return { clean: part(trades.filter((t) => !brokenKeys.has(t.key))), broken: part(trades.filter((t) => brokenKeys.has(t.key))) };
}

function extreme(buckets: Bucket[], min: number, dir: "worst" | "best"): Bucket | null {
  const ok = buckets.filter((b) => b.trades >= min);
  if (!ok.length) return null;
  return ok.reduce((a, b) => (dir === "worst" ? (b.net < a.net ? b : a) : b.net > a.net ? b : a));
}

export function buildInsights(
  trades: Trade[],
  summary: Summary,
  behavior: Behavior,
  opts: { timezone: string; ruleSplit?: RuleSplit | null },
): Insight[] {
  const out: Insight[] = [];
  if (trades.length < 3) return out;

  const rs = opts.ruleSplit;
  if (rs && rs.broken.trades >= 2 && rs.clean.trades >= 1) {
    out.push({
      id: "rules",
      tone: rs.broken.net < rs.clean.net ? "bad" : "info",
      title: `Rule-breaking trades: ${money(rs.broken.net)}. Clean trades: ${money(rs.clean.net)}.`,
      detail: `${rs.broken.trades} trades broke at least one of your rules (win rate ${pct(rs.broken.winRate)}). The ${rs.clean.trades} that followed them won ${pct(rs.clean.winRate)}.`,
      weight: Math.abs(rs.broken.net - rs.clean.net) + 1000,
    });
  }

  const seq = bySequence(trades);
  const early = seq.filter((b) => b.key === "1" || b.key === "2");
  const late = seq.filter((b) => b.key !== "1" && b.key !== "2");
  const earlyNet = early.reduce((s, b) => s + b.net, 0);
  const lateNet = late.reduce((s, b) => s + b.net, 0);
  const lateCount = late.reduce((s, b) => s + b.trades, 0);
  if (lateCount >= 4 && lateNet < 0 && earlyNet > lateNet) {
    out.push({
      id: "sequence",
      tone: "bad",
      title: `Your first two trades of the day: ${money(earlyNet)}. Everything after: ${money(lateNet)}.`,
      detail: `${lateCount} trades came after your second of the day. That's the overtrading tax.`,
      weight: Math.abs(lateNet),
    });
  }

  const hours = byHour(trades, opts.timezone);
  const worstHour = extreme(hours, 4, "worst");
  const bestHour = extreme(hours, 4, "best");
  if (worstHour && worstHour.net < 0) {
    out.push({
      id: "worst-hour",
      tone: "bad",
      title: `${worstHour.label} is your costliest hour: ${money(worstHour.net)}.`,
      detail: `${worstHour.trades} trades entered in that hour, win rate ${pct(worstHour.winRate)}.`,
      weight: Math.abs(worstHour.net),
    });
  }
  if (bestHour && bestHour.net > 0 && bestHour.key !== worstHour?.key) {
    out.push({
      id: "best-hour",
      tone: "good",
      title: `Your edge lives around ${bestHour.label}: ${money(bestHour.net)}.`,
      detail: `${bestHour.trades} trades, win rate ${pct(bestHour.winRate)}.`,
      weight: bestHour.net * 0.8,
    });
  }

  const r = behavior.revenge;
  if (r.trades >= 2) {
    out.push({
      id: "revenge",
      tone: r.net < 0 ? "bad" : "info",
      title: `${r.trades} re-entries within ${r.minutes} min of a loss: ${money(r.net)}.`,
      detail: `Those won ${pct(r.winRate)} of the time, against ${pct(r.otherWinRate)} for your other trades.`,
      weight: Math.abs(r.net) + (r.net < 0 ? 200 : 0),
    });
  }

  const s = behavior.sizeAfterLoss;
  if (s.afterLoss && s.afterWin && s.samples >= 6 && s.afterLoss > s.afterWin * 1.2) {
    out.push({
      id: "size-after-loss",
      tone: "bad",
      title: `You trade ${(s.afterLoss / s.afterWin).toFixed(1)}× bigger right after a loss.`,
      detail: `${s.afterLoss.toFixed(1)} contracts on average after a loser, ${s.afterWin.toFixed(1)} after a winner.`,
      weight: 400,
    });
  }

  if (behavior.holdRatio && behavior.holdRatio >= 1.5 && summary.avgHoldLossMs && summary.avgHoldWinMs && summary.losses >= 3 && summary.wins >= 3) {
    out.push({
      id: "hold",
      tone: "bad",
      title: `You hold losers ${behavior.holdRatio.toFixed(1)}× longer than winners.`,
      detail: `Losers: ${dur(summary.avgHoldLossMs)} on average. Winners: ${dur(summary.avgHoldWinMs)}. Cutting losers sooner is usually the fastest fix.`,
      weight: 350,
    });
  }

  const streak = behavior.afterLossStreak;
  if (streak.trades >= 3 && streak.net < 0) {
    out.push({
      id: "tilt",
      tone: "bad",
      title: `After two losses in a row, the next trades lost ${money(streak.net)}.`,
      detail: `${streak.trades} trades taken on a 2-loss streak, win rate ${pct(streak.winRate)}.`,
      weight: Math.abs(streak.net),
    });
  }

  if (behavior.news && behavior.news.trades >= 2) {
    out.push({
      id: "news",
      tone: behavior.news.net < 0 ? "bad" : "info",
      title: `Trades within ${behavior.news.minutes} min of big news: ${money(behavior.news.net)}.`,
      detail: `${behavior.news.trades} entries near high-impact releases, win rate ${pct(behavior.news.winRate)}.`,
      weight: Math.abs(behavior.news.net),
    });
  }

  const sides = bySide(trades);
  const long = sides.find((b) => b.key === "Long");
  const short = sides.find((b) => b.key === "Short");
  if (long && short && long.trades >= 4 && short.trades >= 4 && Math.sign(long.net) !== Math.sign(short.net)) {
    const good = long.net > short.net ? long : short;
    const bad = good === long ? short : long;
    out.push({
      id: "side",
      tone: "info",
      title: `${good.label}s: ${money(good.net)}. ${bad.label}s: ${money(bad.net)}.`,
      detail: `${good.label} win rate ${pct(good.winRate)} over ${good.trades} trades, ${bad.label.toLowerCase()} ${pct(bad.winRate)} over ${bad.trades}.`,
      weight: Math.abs(bad.net) * 0.6,
    });
  }

  const worstDow = extreme(byWeekday(trades), 3, "worst");
  if (worstDow && worstDow.net < 0 && summary.days >= 5) {
    out.push({
      id: "weekday",
      tone: "info",
      title: `${PLURAL_DAYS[worstDow.key] ?? worstDow.label} cost you ${money(worstDow.net)}.`,
      detail: `${worstDow.trades} trades, win rate ${pct(worstDow.winRate)}.`,
      weight: Math.abs(worstDow.net) * 0.5,
    });
  }

  if (summary.profitFactor !== null && Number.isFinite(summary.profitFactor) && summary.profitFactor < 1 && summary.trades >= 8) {
    out.push({
      id: "pf",
      tone: "bad",
      title: `Winners don't cover losers yet (profit factor ${summary.profitFactor.toFixed(2)}).`,
      detail: `You won ${money(summary.grossWins)} and lost ${money(summary.grossLosses)}. Above 1.0 means the winners pay for the losers.`,
      weight: 150,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
