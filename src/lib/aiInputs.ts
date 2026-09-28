import type { AskInput, DayDebriefInput, MarketBriefInput, PeriodInput, PlaybookInput, SessionReplayInput } from "../../shared/ai/inputs";
import { analyzeBehavior } from "../../shared/analytics/behavior";
import { buildInsights, splitByRules } from "../../shared/analytics/insights";
import { byHold, byHour, byInstrument, bySequence, bySide, byWeekday, summarize, type Bucket, type Summary } from "../../shared/analytics/stats";
import { eventsOnDay } from "../../shared/news";
import { evaluateGuard } from "../../shared/rules/account";
import type { DayEvaluation } from "../../shared/rules/evaluate";
import type { AppData } from "../../shared/store/data";
import { maskAccount } from "../../shared/trades/roundtrips";
import type { NewsEvent, Trade } from "../../shared/types";
import type { Derived } from "./derived";
import { duration, money, timeOf } from "./format";

// Turns your journal into the compact, exact numbers the AI coach reads.
// Account ids are masked (…0006) before anything leaves the browser.

const round = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

function profileOf(d: AppData) {
  return {
    name: d.profile.name.slice(0, 80),
    markets: d.profile.markets.slice(0, 12),
    strategies: d.profile.strategies.slice(0, 16),
    rulesText: d.profile.rulesText.slice(0, 4000),
  };
}

export function statsOf(s: Summary): Record<string, number | string | null> {
  return {
    trades: s.trades,
    wins: s.wins,
    losses: s.losses,
    winRate: round(s.winRate, 3),
    net: round(s.net),
    gross: round(s.gross),
    commission: round(s.commission),
    profitFactor: s.profitFactor === Infinity ? "no losses" : round(s.profitFactor),
    expectancyPerTrade: round(s.expectancy),
    avgWin: round(s.avgWin),
    avgLoss: round(s.avgLoss),
    largestWin: round(s.largestWin),
    largestLoss: round(s.largestLoss),
    maxDrawdown: round(s.maxDrawdown),
    avgHoldWinners: s.avgHoldWinMs === null ? null : duration(s.avgHoldWinMs),
    avgHoldLosers: s.avgHoldLossMs === null ? null : duration(s.avgHoldLossMs),
    greenDays: s.greenDays,
    redDays: s.redDays,
    tradingDays: s.days,
  };
}

function tradeOf(t: Trade, tz: string, violations: string[], d: AppData) {
  const note = d.tradeNotes[t.key];
  return {
    key: t.key,
    time: `${timeOf(t.entryTime, tz, true)} → ${timeOf(t.exitTime, tz, true)}`,
    symbol: t.symbol,
    side: t.side,
    size: t.peakQty,
    entry: round(t.avgEntry, 4) ?? 0,
    exit: round(t.avgExit, 4) ?? 0,
    hold: duration(t.holdMs),
    net: round(t.net) ?? 0,
    violations: violations.slice(0, 20),
    ...(note?.notes ? { note: note.notes.slice(0, 600) } : {}),
    ...(note?.emotion ? { emotion: note.emotion } : {}),
    ...(note?.tags?.length ? { tags: note.tags.slice(0, 12) } : {}),
  };
}

function newsOf(events: NewsEvent[], tz: string) {
  return events
    .filter((e) => e.impact === "high" || e.impact === "medium")
    .slice(0, 40)
    .map((e) => ({ time: timeOf(e.time, tz), title: e.title, currency: e.currency, impact: e.impact }));
}

function guardText(d: AppData, trades: Trade[], account: string, day?: string): string | undefined {
  const g = d.guards.find((x) => !x.account || x.account === account);
  if (!g) return undefined;
  const s = evaluateGuard(g, trades, day);
  const parts = [`${g.name}: balance ${money(s.balance)}`];
  if (s.today && s.today.lossRoom !== null) parts.push(`daily loss room left ${money(s.today.lossRoom)}`);
  if (s.drawdownRoom !== null) parts.push(`drawdown room ${money(s.drawdownRoom)}`);
  if (s.targetProgress !== null) parts.push(`${Math.round(s.targetProgress * 100)}% of profit target`);
  if (s.breaches.length) parts.push(`breaches: ${s.breaches.map((b) => b.message).join(" ")}`);
  return parts.join("; ").slice(0, 600);
}

export function dayDebriefInput(d: AppData, derived: Derived, ev: DayEvaluation, tier: "free" | "pro"): DayDebriefInput {
  const tz = d.settings.timezone;
  const violationsFor = (key: string) => (derived.evaluation.byTrade.get(key) ?? []).map((v) => v.message);
  const s = summarize(ev.trades);
  const recentFrom = ev.day;
  const recent = derived.trades.filter((t) => t.day < recentFrom && (!ev.account || t.account === ev.account)).slice(-200);
  return {
    tier,
    profile: profileOf(d),
    day: ev.day,
    account: ev.account ? maskAccount(ev.account) : undefined,
    timezone: tz,
    grade: ev.grade,
    score: ev.score,
    stats: statsOf(s),
    rules: ev.checks.map((c) => ({
      label: c.label,
      status: c.status,
      detail: c.detail.slice(0, 300),
      violations: c.violations.map((v) => v.message).slice(0, 40),
    })),
    trades: ev.trades.slice(0, 150).map((t) => tradeOf(t, tz, violationsFor(t.key), d)),
    news: newsOf(eventsOnDay(d.news, ev.day, tz, d.settings.dayGrouping), tz),
    journal: {
      plan: d.journal[ev.day]?.plan?.slice(0, 3000),
      reflection: d.journal[ev.day]?.reflection?.slice(0, 3000),
      mood: d.journal[ev.day]?.mood,
    },
    guard: guardText(d, derived.allTrades, ev.account, ev.day),
    recent: tier === "pro" && recent.length ? statsOf(summarize(recent)) : undefined,
  };
}

function bucketsOf(b: Bucket[]) {
  return b.slice(0, 30).map((x) => ({ label: x.label, trades: x.trades, net: round(x.net) ?? 0, winRate: round(x.winRate, 3) }));
}

export function periodInput(d: AppData, derived: Derived, trades: Trade[], label: string, tier: "free" | "pro"): PeriodInput {
  const tz = d.settings.timezone;
  const s = summarize(trades);
  const keys = new Set(trades.map((t) => t.key));
  const days = derived.evaluation.days.filter((e) => e.trades.some((t) => keys.has(t.key)));
  const brokenKeys = new Set([...derived.evaluation.byTrade.keys()].filter((k) => keys.has(k)));
  const behavior = analyzeBehavior(trades, { news: d.news, newsDays: derived.newsDays });
  const insights = buildInsights(trades, s, behavior, { timezone: tz, ruleSplit: splitByRules(trades, brokenKeys) });
  const ruleTally = new Map<string, { followed: number; broken: number }>();
  for (const ev of days) {
    for (const c of ev.checks) {
      const t = ruleTally.get(c.label) ?? { followed: 0, broken: 0 };
      if (c.status === "followed") t.followed++;
      if (c.status === "broken") t.broken++;
      ruleTally.set(c.label, t);
    }
  }
  return {
    tier,
    profile: profileOf(d),
    label,
    timezone: tz,
    stats: statsOf(s),
    breakdowns: {
      byHour: bucketsOf(byHour(trades, tz)),
      byWeekday: bucketsOf(byWeekday(trades)),
      byTradeOfDay: bucketsOf(bySequence(trades)),
      byHoldTime: bucketsOf(byHold(trades)),
      byDirection: bucketsOf(bySide(trades)),
      byInstrument: bucketsOf(byInstrument(trades)),
    },
    behavior: {
      quickReentriesAfterLoss: behavior.revenge.trades,
      quickReentriesNet: behavior.revenge.net,
      quickReentriesWinRate: round(behavior.revenge.winRate, 3),
      otherTradesWinRate: round(behavior.revenge.otherWinRate, 3),
      avgSizeAfterLoss: round(behavior.sizeAfterLoss.afterLoss, 2),
      avgSizeAfterWin: round(behavior.sizeAfterLoss.afterWin, 2),
      loserHoldVsWinnerHold: round(behavior.holdRatio, 2),
      tradesAfterTwoLosses: behavior.afterLossStreak.trades,
      tradesAfterTwoLossesNet: behavior.afterLossStreak.net,
      heavyTradingDays: behavior.overtrading.days,
      heavyTradingDaysNet: behavior.overtrading.net,
      newsTrades: behavior.news?.trades ?? null,
      newsTradesNet: behavior.news?.net ?? null,
    },
    rules: [...ruleTally.entries()].slice(0, 40).map(([label, t]) => ({ label, ...t })),
    days: days.slice(-400).map((e) => ({
      day: e.day,
      net: round(e.net) ?? 0,
      trades: e.trades.length,
      grade: e.grade,
      broken: e.checks.filter((c) => c.status === "broken").map((c) => c.label).slice(0, 20),
    })),
    insights: insights.slice(0, 20).map((i) => `${i.title} ${i.detail}`.slice(0, 400)),
    guard: guardText(d, derived.allTrades, d.settings.account),
  };
}

export function playbookInput(d: AppData, derived: Derived, trades: Trade[], tier: "free" | "pro"): PlaybookInput {
  const base = periodInput(d, derived, trades, "all imported trades", tier);
  const tz = d.settings.timezone;
  const pick = trades.length > 200 ? trades.slice(-200) : trades;
  return {
    ...base,
    trades: pick.map((t) => {
      const x = tradeOf(t, tz, (derived.evaluation.byTrade.get(t.key) ?? []).map((v) => v.message), d);
      return { ...x, day: t.day, violations: x.violations.slice(0, 10) };
    }),
  };
}

export function askInput(d: AppData, derived: Derived, trades: Trade[], messages: AskInput["messages"], tier: "free" | "pro"): AskInput {
  const tz = d.settings.timezone;
  return {
    context: periodInput(d, derived, trades, "the trades currently in view", tier),
    recentTrades: trades.slice(-80).map((t) => ({
      ...tradeOf(t, tz, (derived.evaluation.byTrade.get(t.key) ?? []).map((v) => v.message), d),
      day: t.day,
    })),
    messages: messages.slice(-30),
  };
}

export function marketBriefInput(d: AppData, events: NewsEvent[], day: string): MarketBriefInput {
  const tz = d.settings.timezone;
  return {
    date: new Date().toDateString(),
    timezone: tz,
    profile: profileOf(d),
    events: newsOf(eventsOnDay(events, day, tz, "midnight"), tz),
  };
}

export function replayInput(d: AppData, ev: DayEvaluation): SessionReplayInput {
  const tz = d.settings.timezone;
  return {
    day: ev.day,
    timezone: tz,
    profile: profileOf(d),
    entries: ev.trades.slice(0, 60).map((t) => ({ time: timeOf(t.entryTime, tz, true), symbol: t.root, side: t.side, net: round(t.net) ?? 0 })),
    events: newsOf(eventsOnDay(d.news, ev.day, tz, d.settings.dayGrouping), tz),
  };
}
