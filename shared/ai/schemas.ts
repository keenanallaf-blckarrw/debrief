import { z } from "zod";

// The exact JSON shape every AI feature answers in. The companion passes these to
// Claude as structured outputs, so replies always parse; the app renders them.
// Keep schemas free of length limits: the prompt asks for brevity and the app
// trims lists, because unsupported limits would make a valid answer fail.

export const DayDebriefSchema = z.object({
  headline: z.string().describe("One sentence, at most 14 words, the single most important truth about this session."),
  summary: z.string().describe("3 to 5 sentences on process, not profit. Cite the exact numbers provided."),
  wentWell: z.array(z.string()).describe("1 to 3 specific things the trader did right."),
  toFix: z.array(z.string()).describe("1 to 4 specific leaks, each tied to a trade, a rule or a number."),
  tradeNotes: z
    .array(z.object({ tradeKey: z.string(), note: z.string() }))
    .describe("Short notes for the 2 to 6 most instructive trades, keyed by the trade key given."),
  question: z.string().describe("One honest reflective question for the trader."),
  focus: z.string().describe("One concrete, checkable focus for the next session."),
});
export type DayDebrief = z.infer<typeof DayDebriefSchema>;

export const PeriodDebriefSchema = z.object({
  headline: z.string(),
  summary: z.string().describe("4 to 6 sentences on how this trader actually traded over the period."),
  patterns: z.array(z.string()).describe("Up to 6 behavioral patterns, each grounded in a number."),
  strengths: z.array(z.string()).describe("Up to 3 things that are working."),
  dayNotes: z
    .array(z.object({ day: z.string(), note: z.string() }))
    .describe("Up to 6 notable trading days (YYYY-MM-DD) with an 8 to 14 word note."),
  focus: z.array(z.string()).describe("1 to 3 focuses for the next period, each checkable."),
  question: z.string(),
});
export type PeriodDebrief = z.infer<typeof PeriodDebriefSchema>;

export const PlaybookSchema = z.object({
  styleName: z.string().describe("A name for how they actually trade, at most 6 words."),
  tagline: z.string().describe("One honest sentence, at most 20 words."),
  sections: z
    .array(z.object({ title: z.string(), body: z.string() }))
    .describe("Exactly these titles in order: Entries, Exits, Risk habits, Where the edge lives."),
  gaps: z
    .array(z.object({ say: z.string(), fills: z.string() }))
    .describe("Up to 3 gaps between what they say they do and what their fills show."),
  rules: z.array(z.string()).describe("Exactly 3 rules worth formalizing, at most 14 words each."),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const MarketBriefSchema = z.object({
  headline: z.string(),
  read: z.string().describe("2 to 3 plain sentences: what kind of day this sets up to be, zero jargon."),
  events: z.array(
    z.object({
      time: z.string(),
      name: z.string(),
      impact: z.enum(["high", "medium", "low"]),
      plain: z.string().describe("What this event is, in plain words."),
      usually: z.string().describe("What days like this have historically tended to do. Never a prediction."),
    }),
  ),
  strategyNote: z.string().describe("How days like this tend to interact with the trader's named strategies."),
  windows: z.array(z.object({ span: z.string(), why: z.string() })).describe("Up to 3 times to size down or stand aside."),
});
export type MarketBrief = z.infer<typeof MarketBriefSchema>;

export const SessionReplaySchema = z.object({
  headline: z.string(),
  happened: z.array(z.object({ time: z.string(), what: z.string(), plain: z.string() })),
  yourEntries: z.string().describe("Whether their specific entry times sat inside a news window or unusual volatility."),
  backdrop: z.string(),
});
export type SessionReplay = z.infer<typeof SessionReplaySchema>;

export const RULE_KINDS_FOR_AI = [
  "maxTradesPerDay",
  "maxContracts",
  "dailyLossLimit",
  "dailyProfitTarget",
  "maxConsecutiveLosses",
  "tradingWindow",
  "newsBuffer",
  "revengeCooldown",
  "noSizeUpAfterLoss",
  "maxLossPerTrade",
  "allowedInstruments",
  "stopRequired",
  "noStopWidening",
  "manual",
] as const;

export const ParsedRulesSchema = z.object({
  rules: z.array(
    z.object({
      kind: z.enum(RULE_KINDS_FOR_AI),
      label: z.string().describe("The rule in the trader's words, short."),
      number: z.number().nullable().describe("The count, contracts, dollars or minutes the rule uses, if any."),
      windows: z
        .array(z.object({ start: z.string(), end: z.string() }))
        .nullable()
        .describe("For tradingWindow: HH:MM 24-hour times in New York time."),
      instruments: z.array(z.string()).nullable().describe("For allowedInstruments: product roots like MNQ or MGC."),
    }),
  ),
  notes: z.string().describe("Anything that could not be turned into a rule, or an empty string."),
});
export type ParsedRules = z.infer<typeof ParsedRulesSchema>;

export const ExtractedTradesSchema = z.object({
  trades: z.array(
    z.object({
      symbol: z.string(),
      side: z.enum(["Long", "Short"]),
      qty: z.number(),
      entryPrice: z.number().nullable(),
      exitPrice: z.number().nullable(),
      entryTime: z.string().describe("As written in the document, including the date."),
      exitTime: z.string().nullable(),
      pnl: z.number().nullable(),
    }),
  ),
  note: z.string().describe("What the document was, or what's wrong with it if nothing could be read."),
});
export type ExtractedTrades = z.infer<typeof ExtractedTradesSchema>;

/** A saved AI debrief, keyed like "day:2026-08-18|…0006" or "period:2026-08-01..2026-08-31|all". */
export interface StoredDebrief {
  key: string;
  kind: "day" | "period";
  label: string;
  createdAt: number;
  model?: string;
  tier: "free" | "pro";
  sample?: boolean;
  day?: DayDebrief;
  period?: PeriodDebrief;
}

export interface StoredPlaybook {
  createdAt: number;
  model?: string;
  tradeCount: number;
  result: Playbook;
}
