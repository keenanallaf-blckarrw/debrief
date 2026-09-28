import { z } from "zod";

// What the app sends the companion for each AI task. The companion validates it
// before building a prompt, so only these shapes can reach Claude with your key.

const ProfileInput = z.object({
  name: z.string().max(80),
  markets: z.array(z.string().max(40)).max(12),
  strategies: z.array(z.string().max(60)).max(16),
  rulesText: z.string().max(4000),
});

const RuleResultInput = z.object({
  label: z.string().max(200),
  status: z.enum(["followed", "broken", "unanswered", "na"]),
  detail: z.string().max(300),
  violations: z.array(z.string().max(300)).max(40),
});

const TradeInput = z.object({
  key: z.string().max(40),
  time: z.string().max(40),
  symbol: z.string().max(40),
  side: z.enum(["Long", "Short"]),
  size: z.number(),
  entry: z.number(),
  exit: z.number(),
  hold: z.string().max(20),
  net: z.number(),
  violations: z.array(z.string().max(300)).max(20),
  note: z.string().max(600).optional(),
  emotion: z.string().max(40).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});

const NewsInput = z.object({ time: z.string().max(40), title: z.string().max(120), currency: z.string().max(6), impact: z.string().max(10) });

const StatsInput = z.record(z.string().max(60), z.union([z.number(), z.string().max(120), z.null()]));

export const DayDebriefInput = z.object({
  tier: z.enum(["free", "pro"]),
  profile: ProfileInput,
  day: z.string().max(20),
  account: z.string().max(40).optional(),
  timezone: z.string().max(60),
  grade: z.string().max(2).nullable(),
  score: z.number().nullable(),
  stats: StatsInput,
  rules: z.array(RuleResultInput).max(40),
  trades: z.array(TradeInput).max(150),
  news: z.array(NewsInput).max(40),
  journal: z.object({ plan: z.string().max(3000).optional(), reflection: z.string().max(3000).optional(), mood: z.number().optional() }),
  guard: z.string().max(600).optional(),
  recent: StatsInput.optional(),
});
export type DayDebriefInput = z.infer<typeof DayDebriefInput>;

const BucketInput = z.object({ label: z.string().max(40), trades: z.number(), net: z.number(), winRate: z.number().nullable() });

export const PeriodInput = z.object({
  tier: z.enum(["free", "pro"]),
  profile: ProfileInput,
  label: z.string().max(80),
  timezone: z.string().max(60),
  stats: StatsInput,
  breakdowns: z.record(z.string().max(30), z.array(BucketInput).max(30)),
  behavior: StatsInput,
  rules: z.array(z.object({ label: z.string().max(200), followed: z.number(), broken: z.number() })).max(40),
  days: z.array(z.object({ day: z.string().max(20), net: z.number(), trades: z.number(), grade: z.string().max(2).nullable(), broken: z.array(z.string().max(200)).max(20) })).max(400),
  insights: z.array(z.string().max(400)).max(20),
  guard: z.string().max(600).optional(),
});
export type PeriodInput = z.infer<typeof PeriodInput>;

export const PlaybookInput = PeriodInput.extend({
  trades: z.array(TradeInput.omit({ violations: true }).extend({ day: z.string().max(20), violations: z.array(z.string().max(300)).max(10) })).max(200),
});
export type PlaybookInput = z.infer<typeof PlaybookInput>;

export const AskInput = z.object({
  context: PeriodInput,
  recentTrades: z.array(TradeInput.extend({ day: z.string().max(20) })).max(80),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .min(1)
    .max(30),
});
export type AskInput = z.infer<typeof AskInput>;

export const MarketBriefInput = z.object({
  date: z.string().max(40),
  timezone: z.string().max(60),
  profile: ProfileInput,
  events: z.array(NewsInput).max(60),
});
export type MarketBriefInput = z.infer<typeof MarketBriefInput>;

export const SessionReplayInput = z.object({
  day: z.string().max(20),
  timezone: z.string().max(60),
  profile: ProfileInput,
  entries: z.array(z.object({ time: z.string().max(40), symbol: z.string().max(40), side: z.string().max(10), net: z.number() })).max(60),
  events: z.array(NewsInput).max(40),
});
export type SessionReplayInput = z.infer<typeof SessionReplayInput>;

export const ParseRulesInput = z.object({ text: z.string().min(3).max(4000), markets: z.array(z.string().max(40)).max(12) });
export type ParseRulesInput = z.infer<typeof ParseRulesInput>;

export const ExtractTradesInput = z.object({
  fileName: z.string().max(200),
  mediaType: z.enum(["application/pdf", "text/plain"]),
  /** base64 for PDFs, raw text otherwise */
  data: z.string().max(12_000_000),
  timezone: z.string().max(60),
});
export type ExtractTradesInput = z.infer<typeof ExtractTradesInput>;

export const AI_TASKS = ["day-debrief", "period-debrief", "playbook", "ask", "market-brief", "session-replay", "parse-rules", "extract-trades"] as const;
export type AiTask = (typeof AI_TASKS)[number];
