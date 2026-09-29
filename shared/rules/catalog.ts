import type { Rule, RuleKind, RuleOf, RuleParamsMap } from "../types";
import { uid } from "../util/hash";
import { NEW_YORK } from "../util/time";

// The rules Debrief can check straight from your fills, plus "manual" checklist
// rules only you can answer ("Set my daily bias first"). Each definition knows
// how to describe itself in plain words.

export interface RuleDef<K extends RuleKind = RuleKind> {
  kind: K;
  name: string;
  help: string;
  defaults: RuleParamsMap[K];
  /** Data the rule needs beyond your trades. */
  needs?: "news" | "orders";
  auto: boolean;
  describe: (params: RuleParamsMap[K]) => string;
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 && h < 24 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

function tzShort(tz: string): string {
  if (tz === NEW_YORK) return "ET";
  if (tz === "America/Chicago") return "CT";
  if (tz === "America/Los_Angeles") return "PT";
  if (tz === "Europe/London") return "UK";
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

export const RULES: { [K in RuleKind]: RuleDef<K> } = {
  maxTradesPerDay: {
    kind: "maxTradesPerDay",
    name: "Max trades per day",
    help: "Overtrading is the most common leak. Every trade past your limit is flagged.",
    defaults: { max: 3 },
    auto: true,
    describe: (p) => `No more than ${plural(p.max, "trade")} a day`,
  },
  maxContracts: {
    kind: "maxContracts",
    name: "Max position size",
    help: "The most contracts you allow yourself to hold at once, across all your entries in a trade.",
    defaults: { max: 5 },
    auto: true,
    describe: (p) => `Never hold more than ${plural(p.max, "contract")}`,
  },
  dailyLossLimit: {
    kind: "dailyLossLimit",
    name: "Daily loss limit",
    help: "Broken if the day's loss goes past the limit, or if you open a trade after hitting it. This is how most prop firm evaluations are failed.",
    defaults: { amount: 500 },
    auto: true,
    describe: (p) => `Stop for the day at -${money(p.amount)}`,
  },
  dailyProfitTarget: {
    kind: "dailyProfitTarget",
    name: "Walk away when green",
    help: "Broken if you keep opening trades after the day is up this much. Protects good days from turning into bad ones.",
    defaults: { amount: 500 },
    auto: true,
    describe: (p) => `Walk away once up ${money(p.amount)} on the day`,
  },
  maxConsecutiveLosses: {
    kind: "maxConsecutiveLosses",
    name: "Stop after losses in a row",
    help: "Broken if you take another trade after this many losers in a row on the same day.",
    defaults: { max: 2 },
    auto: true,
    describe: (p) => `Stop after ${plural(p.max, "loss", "losses")} in a row`,
  },
  tradingWindow: {
    kind: "tradingWindow",
    name: "Trading hours",
    help: "Only enter trades inside these windows. Useful for 'no trades in the first 5 minutes' or 'done by 11:30'.",
    defaults: { windows: [{ start: "09:35", end: "11:30" }], timezone: NEW_YORK },
    auto: true,
    describe: (p) =>
      `Only enter ${p.windows.map((w) => `${clock(w.start)}–${clock(w.end)}`).join(" or ")} ${tzShort(p.timezone)}`,
  },
  newsBuffer: {
    kind: "newsBuffer",
    name: "Stand aside around news",
    help: "No entries within this many minutes of a high-impact economic release (CPI, jobs report, Fed). Needs the economic calendar, which the Debrief companion downloads.",
    defaults: { minutes: 5, minImpact: "high" },
    needs: "news",
    auto: true,
    describe: (p) => `No entries within ${p.minutes} min of ${p.minImpact === "high" ? "high-impact" : "medium or high-impact"} news`,
  },
  revengeCooldown: {
    kind: "revengeCooldown",
    name: "Cool down after a loss",
    help: "Re-entering right after a losing trade is the classic revenge trade. Every entry inside the cooldown is flagged.",
    defaults: { minutes: 5 },
    auto: true,
    describe: (p) => `Wait ${p.minutes} min after a losing trade`,
  },
  noSizeUpAfterLoss: {
    kind: "noSizeUpAfterLoss",
    name: "No sizing up after a loss",
    help: "Flags a trade that is bigger than the losing trade right before it.",
    defaults: {},
    auto: true,
    describe: () => "Never size up right after a loss",
  },
  maxLossPerTrade: {
    kind: "maxLossPerTrade",
    name: "Max loss per trade",
    help: "The most you let a single trade lose, after commissions.",
    defaults: { amount: 250 },
    auto: true,
    describe: (p) => `Never lose more than ${money(p.amount)} on one trade`,
  },
  allowedInstruments: {
    kind: "allowedInstruments",
    name: "Only my markets",
    help: "Only trade the products in your plan. Anything else is flagged.",
    defaults: { roots: ["MNQ"] },
    auto: true,
    describe: (p) => `Only trade ${p.roots.join(", ") || "my listed markets"}`,
  },
  stopRequired: {
    kind: "stopRequired",
    name: "Always use a stop",
    help: "A stop order has to be working within moments of every entry. Needs an order export (Tradovate Orders or TradingView notifications log).",
    defaults: { withinSeconds: 60 },
    needs: "orders",
    auto: true,
    describe: (p) => `Stop loss in place within ${p.withinSeconds}s of every entry`,
  },
  noStopWidening: {
    kind: "noStopWidening",
    name: "Never widen a stop",
    help: "Moving a stop further from your entry turns a planned loss into a bigger one. Needs the TradingView notifications log, which records every stop move.",
    defaults: {},
    needs: "orders",
    auto: true,
    describe: () => "Never move a stop further away",
  },
  manual: {
    kind: "manual",
    name: "Checklist item",
    help: "Something only you can answer, like 'Set my daily bias before the open' or 'Waited for the sweep'. You tick it in each debrief.",
    defaults: { scope: "day" },
    auto: false,
    describe: () => "Checklist item",
  },
};

export function ruleLabel(rule: Rule): string {
  if (rule.label && rule.label.trim()) return rule.label.trim();
  const def = RULES[rule.kind] as RuleDef;
  return def.describe(rule.params as never);
}

export function makeRule<K extends RuleKind>(kind: K, params?: Partial<RuleParamsMap[K]>, label?: string): RuleOf<K> {
  const def = RULES[kind] as RuleDef<K>;
  return {
    id: uid("r_"),
    kind,
    enabled: true,
    label,
    params: { ...def.defaults, ...(params ?? {}) },
  } as RuleOf<K>;
}

/**
 * The rules onboarding offers (ones most futures traders recognize) and which
 * of them start ticked. The sample journal's story is tested against them.
 */
export function starterRules(): { rule: Rule; on: boolean }[] {
  return [
    { rule: makeRule("maxTradesPerDay", { max: 3 }), on: true },
    { rule: makeRule("dailyLossLimit", { amount: 500 }), on: true },
    { rule: makeRule("maxConsecutiveLosses", { max: 2 }), on: true },
    { rule: makeRule("revengeCooldown", { minutes: 5 }), on: true },
    { rule: makeRule("maxContracts", { max: 5 }), on: false },
    { rule: makeRule("tradingWindow"), on: false },
    { rule: makeRule("newsBuffer", { minutes: 5, minImpact: "high" }), on: false },
    { rule: makeRule("noSizeUpAfterLoss"), on: false },
  ];
}

export const AUTO_KINDS = (Object.keys(RULES) as RuleKind[]).filter((k) => RULES[k].auto);
