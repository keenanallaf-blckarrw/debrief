import { newsCurrenciesFor, parseSymbol } from "../instruments";
import type { DayJournal, NewsEvent, OrderEvent, Rule, Trade, TradeNote } from "../types";
import { minuteOfDay, parseClock } from "../util/time";
import { ruleLabel } from "./catalog";

// Grades process, not outcome. Every enabled rule is checked against a trading
// day's trades and comes back followed, broken, unanswered (a checklist item you
// haven't ticked yet) or n/a (Debrief lacks the data, e.g. no news calendar).
// The day's score is followed ÷ (followed + broken), so "2 of 6 rules broken"
// scores 67 → D.

export type Grade = "A" | "B" | "C" | "D" | "F";
export type CheckStatus = "followed" | "broken" | "unanswered" | "na";

export interface Violation {
  ruleId: string;
  tradeKey?: string;
  message: string;
}

export interface RuleCheck {
  ruleId: string;
  label: string;
  status: CheckStatus;
  detail: string;
  violations: Violation[];
}

export interface DayEvaluation {
  day: string;
  /** Broker account, "" when the export didn't say. */
  account: string;
  trades: Trade[];
  checks: RuleCheck[];
  followed: number;
  broken: number;
  unanswered: number;
  score: number | null;
  grade: Grade | null;
  net: number;
}

export interface EvaluationContext {
  news?: NewsEvent[];
  /** Trading days the saved economic calendar covers. */
  newsDays?: Set<string>;
  orders?: OrderEvent[];
  journal?: Record<string, DayJournal>;
  tradeNotes?: Record<string, TradeNote>;
}

export interface Evaluation {
  days: DayEvaluation[];
  byTrade: Map<string, Violation[]>;
  byDay: Map<string, DayEvaluation[]>;
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m} min`;
}

function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const byEntry = (a: Trade, b: Trade) => a.entryTime - b.entryTime || a.key.localeCompare(b.key);

/** Net P&L already realized (trades closed) at a moment during the day. */
function realizedAt(trades: Trade[], ms: number): number {
  let sum = 0;
  for (const t of trades) if (t.exitTime <= ms) sum += t.net;
  return sum;
}

/** Losing streak among trades closed before `ms`, most recent first. */
function lossStreakBefore(trades: Trade[], ms: number): number {
  const closed = trades.filter((t) => t.exitTime <= ms).sort((a, b) => b.exitTime - a.exitTime);
  let n = 0;
  for (const t of closed) {
    if (t.net < 0) n++;
    else break;
  }
  return n;
}

/** The trade closed most recently before `ms`. */
function previousClosed(trades: Trade[], ms: number, self: Trade): Trade | undefined {
  let best: Trade | undefined;
  for (const t of trades) {
    if (t === self || t.exitTime > ms) continue;
    if (!best || t.exitTime > best.exitTime) best = t;
  }
  return best;
}

interface Checked {
  status: CheckStatus;
  detail: string;
  violations: Violation[];
}

const followed = (detail: string): Checked => ({ status: "followed", detail, violations: [] });
const na = (detail: string): Checked => ({ status: "na", detail, violations: [] });

function broken(violations: Violation[], detail: string): Checked {
  return { status: "broken", detail, violations };
}

function v(rule: Rule, t: Trade | undefined, message: string): Violation {
  return { ruleId: rule.id, tradeKey: t?.key, message };
}

function protectiveSide(t: Trade): "Buy" | "Sell" {
  return t.side === "Long" ? "Sell" : "Buy";
}

function accountOk(a?: string, b?: string) {
  return !a || !b || a === b;
}

/** Order events that could be this trade's stop: same product, opposite side, during the trade. */
function stopEventsFor(t: Trade, orders: OrderEvent[]): OrderEvent[] {
  // TradingView's notifications log can record events a couple of minutes late,
  // so the window is generous on the far side.
  const from = t.entryTime - 10_000;
  const to = t.exitTime + 120_000;
  return orders.filter(
    (o) =>
      o.root === t.root &&
      accountOk(o.account, t.account) &&
      o.side === protectiveSide(t) &&
      (o.type === "Stop" || o.type === "StopLimit" || o.bracket === "stopLoss") &&
      o.time >= from &&
      o.time <= to,
  );
}

function hasOrderCoverage(t: Trade, orders: OrderEvent[]): boolean {
  return orders.some((o) => o.root === t.root && Math.abs(o.time - t.entryTime) < 6 * 3_600_000);
}

function checkRule(rule: Rule, trades: Trade[], day: string, ctx: EvaluationContext): Checked {
  switch (rule.kind) {
    case "maxTradesPerDay": {
      const max = Math.max(0, Math.floor(rule.params.max));
      const extra = trades.slice(max);
      return extra.length
        ? broken(extra.map((t, i) => v(rule, t, `Trade #${max + i + 1} of the day. Your limit is ${max}.`)), `${trades.length} trades (limit ${max})`)
        : followed(`${trades.length} of ${max} trades`);
    }
    case "maxContracts": {
      const max = rule.params.max;
      const over = trades.filter((t) => t.peakQty > max);
      const peak = Math.max(0, ...trades.map((t) => t.peakQty));
      return over.length
        ? broken(over.map((t) => v(rule, t, `${t.peakQty} contracts at once. Your max is ${max}.`)), `Peak ${peak} contracts (max ${max})`)
        : followed(`Peak ${peak} contracts`);
    }
    case "dailyLossLimit": {
      const limit = Math.abs(rule.params.amount);
      const out: Violation[] = [];
      const flagged = new Set<string>();
      for (const t of trades) {
        const before = realizedAt(trades, t.entryTime);
        if (before <= -limit) {
          out.push(v(rule, t, `Opened after the day was already down ${money(before)} (limit ${money(limit)}).`));
          flagged.add(t.key);
        }
      }
      let running = 0;
      for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
        const prev = running;
        running += t.net;
        if (prev > -limit && running < -limit && !flagged.has(t.key)) {
          out.push(v(rule, t, `This trade took the day to -${money(running)}, past your ${money(limit)} limit.`));
        }
      }
      const net = trades.reduce((s, t) => s + t.net, 0);
      return out.length
        ? broken(out, `Day closed ${net < 0 ? "-" : "+"}${money(net)} (limit -${money(limit)})`)
        : followed(net < 0 ? `Lowest point stayed inside -${money(limit)}` : "Never near the limit");
    }
    case "dailyProfitTarget": {
      const target = Math.abs(rule.params.amount);
      const out = trades
        .filter((t) => realizedAt(trades, t.entryTime) >= target)
        .map((t) => v(rule, t, `Opened after the day was already up ${money(realizedAt(trades, t.entryTime))}. Your walk-away is ${money(target)}.`));
      return out.length ? broken(out, `Kept trading past +${money(target)}`) : followed("Walked away on time");
    }
    case "maxConsecutiveLosses": {
      const max = Math.max(1, Math.floor(rule.params.max));
      const out: Violation[] = [];
      for (const t of trades) {
        const streak = lossStreakBefore(trades, t.entryTime);
        if (streak >= max) out.push(v(rule, t, `Taken after ${streak} losses in a row. Your rule is to stop after ${max}.`));
      }
      return out.length ? broken(out, `Traded on after ${max} straight losses`) : followed("No tilt streaks");
    }
    case "tradingWindow": {
      const windows = rule.params.windows
        .map((w) => ({ start: parseClock(w.start), end: parseClock(w.end) }))
        .filter((w): w is { start: number; end: number } => w.start !== null && w.end !== null);
      if (!windows.length) return na("Add a time window to check this rule.");
      const tz = rule.params.timezone;
      const inside = (m: number) =>
        windows.some((w) => (w.start <= w.end ? m >= w.start && m < w.end : m >= w.start || m < w.end));
      const out = trades
        .filter((t) => !inside(minuteOfDay(t.entryTime, tz)))
        .map((t) => v(rule, t, `Entered at ${clockLabel(minuteOfDay(t.entryTime, tz))}, outside your trading hours.`));
      return out.length ? broken(out, `${out.length} ${out.length === 1 ? "entry" : "entries"} outside your hours`) : followed("All entries inside your hours");
    }
    case "newsBuffer": {
      if (!ctx.newsDays?.has(day)) return na("No economic calendar saved for this day. The companion saves it every week.");
      const minutes = rule.params.minutes;
      const impacts = rule.params.minImpact === "high" ? new Set(["high"]) : new Set(["high", "medium"]);
      const events = (ctx.news ?? []).filter((e) => impacts.has(e.impact));
      const out: Violation[] = [];
      for (const t of trades) {
        const info = parseSymbol(t.symbol);
        const currencies = new Set(newsCurrenciesFor(info.root, info.assetClass));
        const hit = events.find((e) => currencies.has(e.currency) && Math.abs(t.entryTime - e.time) <= minutes * 60_000);
        if (hit) {
          const diff = t.entryTime - hit.time;
          const when = diff >= 0 ? `${duration(diff)} after` : `${duration(-diff)} before`;
          out.push(v(rule, t, `Entered ${when} ${hit.title} (${hit.currency}).`));
        }
      }
      return out.length ? broken(out, `${out.length} ${out.length === 1 ? "entry" : "entries"} around news`) : followed("Stayed clear of news");
    }
    case "revengeCooldown": {
      const cool = rule.params.minutes * 60_000;
      const out: Violation[] = [];
      for (const t of trades) {
        const prev = previousClosed(trades, t.entryTime, t);
        if (prev && prev.net < 0 && t.entryTime - prev.exitTime < cool) {
          out.push(v(rule, t, `Re-entered ${duration(t.entryTime - prev.exitTime)} after a ${money(prev.net)} loss.`));
        }
      }
      return out.length ? broken(out, `${out.length} quick ${out.length === 1 ? "re-entry" : "re-entries"} after losses`) : followed("Cooled down after every loss");
    }
    case "noSizeUpAfterLoss": {
      const out: Violation[] = [];
      for (const t of trades) {
        const prev = previousClosed(trades, t.entryTime, t);
        if (prev && prev.net < 0 && t.peakQty > prev.peakQty) {
          out.push(v(rule, t, `Sized up from ${prev.peakQty} to ${t.peakQty} contracts right after a loss.`));
        }
      }
      return out.length ? broken(out, "Sized up after a loss") : followed("Size held steady after losses");
    }
    case "maxLossPerTrade": {
      const max = Math.abs(rule.params.amount);
      const out = trades.filter((t) => t.net < -max).map((t) => v(rule, t, `Lost ${money(t.net)}. Your max per trade is ${money(max)}.`));
      const worst = Math.min(0, ...trades.map((t) => t.net));
      return out.length ? broken(out, `Worst trade -${money(worst)}`) : followed(worst < 0 ? `Worst trade -${money(worst)}` : "No losing trades");
    }
    case "allowedInstruments": {
      const allowed = new Set(rule.params.roots.map((r) => r.trim().toUpperCase()).filter(Boolean));
      if (!allowed.size) return na("List the markets you trade to check this rule.");
      const out = trades.filter((t) => !allowed.has(t.root)).map((t) => v(rule, t, `Traded ${t.root}, which isn't on your list.`));
      return out.length ? broken(out, `Off-plan: ${[...new Set(out.map((x) => trades.find((t) => t.key === x.tradeKey)?.root))].join(", ")}`) : followed("Only your markets");
    }
    case "stopRequired": {
      const orders = ctx.orders ?? [];
      const covered = trades.filter((t) => hasOrderCoverage(t, orders));
      if (!covered.length) return na("Import your Tradovate Orders export or TradingView notifications log to check stops.");
      const out = covered
        // Any stop event in the window (placed, moved, cancelled or filled) means one was working.
        .filter((t) => stopEventsFor(t, orders).length === 0)
        .map((t) => v(rule, t, "No stop order found while this trade was open."));
      return out.length ? broken(out, `${out.length} ${out.length === 1 ? "trade" : "trades"} without a stop`) : followed(`Stops on all ${covered.length} checked trades`);
    }
    case "noStopWidening": {
      const orders = ctx.orders ?? [];
      const covered = trades.filter((t) => orders.some((o) => o.action === "modified" && o.root === t.root && Math.abs(o.time - t.entryTime) < 6 * 3_600_000));
      if (!covered.length) return na("Import the TradingView notifications log to see stop moves.");
      const out: Violation[] = [];
      for (const t of covered) {
        const events = stopEventsFor(t, orders).filter((o) => o.price !== undefined && o.orderId);
        const byOrder = new Map<string, OrderEvent[]>();
        for (const o of events) {
          const list = byOrder.get(o.orderId!) ?? [];
          list.push(o);
          byOrder.set(o.orderId!, list);
        }
        for (const list of byOrder.values()) {
          list.sort((a, b) => a.time - b.time);
          for (let i = 1; i < list.length; i++) {
            const before = list[i - 1].price!;
            const after = list[i].price!;
            if (list[i].action !== "modified") continue;
            const widened = t.side === "Long" ? after < before : after > before;
            if (widened) {
              out.push(v(rule, t, `Moved the stop from ${before} to ${after}, further from your entry.`));
              break;
            }
          }
        }
      }
      return out.length ? broken(out, `${out.length} stop ${out.length === 1 ? "move" : "moves"} away from entry`) : followed("Stops only tightened");
    }
    case "manual": {
      if (rule.params.scope === "day") {
        const mark = ctx.journal?.[day]?.manual?.[rule.id];
        if (mark === "followed") return followed("You ticked this");
        if (mark === "broken") return broken([v(rule, undefined, "You marked this as broken.")], "You marked this broken");
        return { status: "unanswered", detail: "Tick followed or broken", violations: [] };
      }
      const marks = trades.map((t) => ctx.tradeNotes?.[t.key]?.manual?.[rule.id]);
      const brokenOnes = trades.filter((_, i) => marks[i] === "broken");
      if (brokenOnes.length) {
        return broken(brokenOnes.map((t) => v(rule, t, "You marked this trade as breaking the rule.")), `${brokenOnes.length} ${brokenOnes.length === 1 ? "trade" : "trades"} marked broken`);
      }
      if (marks.length && marks.every((m) => m === "followed")) return followed("Every trade ticked");
      return { status: "unanswered", detail: `${marks.filter(Boolean).length} of ${trades.length} trades ticked`, violations: [] };
    }
  }
}

export function evaluateDay(trades: Trade[], rules: Rule[], day: string, account: string, ctx: EvaluationContext): DayEvaluation {
  const sorted = [...trades].sort(byEntry);
  const checks: RuleCheck[] = rules
    .filter((r) => r.enabled)
    .map((r) => {
      const c = checkRule(r, sorted, day, ctx);
      return { ruleId: r.id, label: ruleLabel(r), ...c };
    });
  const f = checks.filter((c) => c.status === "followed").length;
  const b = checks.filter((c) => c.status === "broken").length;
  const u = checks.filter((c) => c.status === "unanswered").length;
  const score = f + b ? Math.round((f / (f + b)) * 100) : null;
  return {
    day,
    account,
    trades: sorted,
    checks,
    followed: f,
    broken: b,
    unanswered: u,
    score,
    grade: score === null ? null : gradeFor(score),
    net: sorted.reduce((s, t) => s + t.net, 0),
  };
}

/** Evaluate every account-day in the journal. */
export function evaluateAll(trades: Trade[], rules: Rule[], ctx: EvaluationContext): Evaluation {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = `${t.day}|${t.account ?? ""}`;
    const list = groups.get(k);
    if (list) list.push(t);
    else groups.set(k, [t]);
  }
  const days: DayEvaluation[] = [];
  const byTrade = new Map<string, Violation[]>();
  const byDay = new Map<string, DayEvaluation[]>();
  for (const [k, list] of groups) {
    const [day, account] = k.split("|");
    const ev = evaluateDay(list, rules, day, account, ctx);
    days.push(ev);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(ev);
    else byDay.set(day, [ev]);
    for (const c of ev.checks) {
      for (const viol of c.violations) {
        if (!viol.tradeKey) continue;
        const list = byTrade.get(viol.tradeKey);
        if (list) list.push(viol);
        else byTrade.set(viol.tradeKey, [viol]);
      }
    }
  }
  days.sort((a, b) => a.day.localeCompare(b.day) || a.account.localeCompare(b.account));
  return { days, byTrade, byDay };
}
