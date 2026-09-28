import type {
  AskInput,
  DayDebriefInput,
  ExtractTradesInput,
  MarketBriefInput,
  ParseRulesInput,
  PeriodInput,
  PlaybookInput,
  SessionReplayInput,
} from "./inputs";

// Every prompt Debrief sends. The system prompt is identical for every task so
// the API can cache it; task instructions and the trader's data follow it.

export const COACH_SYSTEM = `You are Debrief, an AI performance coach for traders. Debrief's rule engine grades each trading session against the trader's own written rules; you read those results and talk to the trader about them.

Who you are:
- A sharp, honest mentor who has seen every way traders sabotage themselves. Warm but never soft. Specific, never generic.
- You coach process and behavior: following rules, risk, sizing, timing, patience, emotional state, overtrading.

What you never do:
- Never give buy or sell advice, price predictions, trade signals, or views on where a market will go. Never suggest a specific trade, entry or level.
- Never invent a number. Every statistic, count, time and dollar amount you mention must come from the data you are given. If the data doesn't show something, say you can't tell.
- Never grade outcome as process. A losing trade that followed the rules was a good trade; a winner that broke them was not.

How you write:
- Plain English a newer trader understands. If you use a term like "profit factor", say what it means in a few words.
- Short sentences. No filler, hype, emojis, or markdown formatting.
- Talk to the trader as "you".
- Write money like $1,234 or -$320, and use times exactly as the data gives them.`;

const json = (x: unknown) => JSON.stringify(x);

export function dayDebriefPrompt(input: DayDebriefInput): string {
  const considered = input.rules.filter((r) => r.status === "followed" || r.status === "broken").length;
  const broken = input.rules.filter((r) => r.status === "broken").length;
  const gradeLine =
    input.grade === null
      ? "The trader hasn't set any checkable rules yet, so there is no process grade. Coach from their own words (rulesText) and the behavior in the data, and suggest one rule worth adding."
      : `Debrief's rule engine already graded this session ${input.grade} (${input.score}/100: ${broken} of ${considered} rules broken). The grade is final. Do not change it or argue with it; explain what earned it.`;
  const size =
    input.tier === "free"
      ? "This is the free debrief, so keep it tight: summary 2 to 3 sentences, exactly 1 wentWell, at most 2 toFix, at most 2 tradeNotes."
      : "summary 3 to 5 sentences, 1 to 3 wentWell, 1 to 4 toFix, 2 to 6 tradeNotes on the most instructive trades.";
  return `Write the debrief for the trading day ${input.day}${input.account ? ` (account ${input.account})` : ""}.

${gradeLine}

${size}
- headline: at most 14 words, the one truth that matters most about today. When broken rules explain the result, say so plainly.
- tradeNotes: use each trade's "key" exactly as given; at most 16 words per note.
- toFix: each item names the rule, trade or number behind it.
- focus: one concrete, checkable action for the next session that targets the biggest leak.
- question: one honest question that makes the trader think about why, not what.
Times in the data are ${input.timezone} time. "violations" lists what the rule engine flagged on each trade.

DATA:
${json(input)}`;
}

export function periodDebriefPrompt(input: PeriodInput): string {
  return `Write the debrief for ${input.label}: how this trader actually traded over the whole period.

Ground every pattern in the numbers: breakdowns by hour, weekday, trade number of the day and direction; the behavior metrics (quick re-entries after losses, size after losses, hold times); rule adherence; and the day list. The insights list holds findings Debrief already computed; build on them rather than repeating them word for word.
- summary: 4 to 6 sentences.
- patterns: up to 6, each at most 22 words and tied to a number.
- strengths: up to 3.
- dayNotes: up to 6 of the most instructive days (use the exact YYYY-MM-DD), 8 to 14 words each.
- focus: 1 to 3 checkable focuses for the next period.
Times are ${input.timezone} time.

DATA:
${json(input)}`;
}

export function playbookPrompt(input: PlaybookInput): string {
  return `Decode this trader's real playbook from what their fills show, not what they say.

Compare their stated strategies and rules (profile.rulesText, profile.strategies) with their actual behavior: when they trade, how they size, how long they hold winners versus losers, what they do after a loss, which rules they break most. Where the sample is small, say so inside the relevant section.
- styleName: at most 6 words. tagline: one honest sentence, at most 20 words.
- sections: exactly four, titled "Entries", "Exits", "Risk habits", "Where the edge lives", each 40 to 70 words, each citing numbers from the data.
- gaps: up to 3 differences between what they say ("say", at most 12 words) and what the fills show ("fills", at most 16 words).
- rules: exactly 3 rules worth writing down, each at most 14 words, each fixing a leak the data shows.
Times are ${input.timezone} time.

DATA:
${json(input)}`;
}

export function askSystemContext(input: AskInput): string {
  return `The trader is asking about their own trading. Answer from this data only, in at most 150 words, conversational, no lists unless they ask. Cite their actual numbers. If they ask for trade ideas, predictions or where a market is going, decline briefly and bring it back to their process.

DATA:
${json({ ...input.context, recentTrades: input.recentTrades })}`;
}

export function marketResearchPrompt(input: MarketBriefInput): string {
  return `Today is ${input.date}. Search the web for today's scheduled economic releases and any major market-moving news for these markets: ${input.profile.markets.join(", ") || "US index and gold futures"}.

Debrief already has this economic calendar for today (times in ${input.timezone}):
${json(input.events)}

Write short research notes, at most 250 words, plain text: what is scheduled today with exact times in New York time, what happened overnight or this morning, any Fed or central bank speakers, and the overall risk mood. Facts only. No predictions and no trade ideas.`;
}

export function marketBriefPrompt(input: MarketBriefInput, research: string): string {
  return `Turn these research notes into today's brief for this trader.

Trader: markets ${input.profile.markets.join(", ") || "not given"}; strategies ${input.profile.strategies.join(", ") || "not given"}; rules in their words: "${input.profile.rulesText || "not given"}".

Writing rules. The trader should not need a finance degree to understand a word:
- For each event, say what it actually is in one simple sentence ("plain"), then what days with this kind of event have historically tended to do to their markets ("usually"), phrased as a past tendency like "days like this have tended to...". Never a prediction.
- strategyNote: speak to their named strategies directly. If they trade fib retracements, say what tends to happen to retrace levels around data releases; if they use SMT divergence, say when correlated markets tend to decouple. Keep it about how they enter.
- windows: up to 3 time spans to size down or stand aside, with a plain reason.
- At most 5 events, chronological, times in New York time (for example "8:30 AM ET"). If nothing is scheduled, say so in the headline and return empty lists.

RESEARCH NOTES:
${research}`;
}

export function replayResearchPrompt(input: SessionReplayInput): string {
  return `Search the web for what happened in these markets on ${input.day}: ${input.profile.markets.join(", ") || "US index and gold futures"}. Find scheduled economic releases with times in New York time, Fed or central bank speakers, major headlines, and how these markets broadly behaved that day.

Calendar Debrief has saved for that day (times in ${input.timezone}):
${json(input.events)}

Write research notes, at most 250 words, plain text, facts only.`;
}

export function replayPrompt(input: SessionReplayInput, research: string): string {
  return `Explain what the market was doing during this trader's session on ${input.day}, using the research notes.

The trader's entries that session (times in ${input.timezone}):
${json(input.entries)}

Rules: plain everyday language with zero jargon, like a sharp friend explaining it. Never say what they should have traded.
- headline: one plain sentence, at most 12 words.
- happened: at most 4 items, chronological, each with time (New York time), "what" (at most 8 words) and "plain" (what it meant, at most 16 words).
- yourEntries: 2 to 3 sentences on whether any of their specific entry times sat inside a news window or unusual volatility, and what that meant for the conditions they traded in.
- backdrop: 1 to 2 sentences on the bigger risk mood that day.
If nothing notable happened, say so in the headline and return an empty "happened" list.

RESEARCH NOTES:
${research}`;
}

export function parseRulesPrompt(input: ParseRulesInput): string {
  return `Turn this trader's rules into structured rules Debrief can check. The trader trades: ${input.markets.join(", ") || "not given"}.

Rule kinds Debrief checks automatically from fills:
- maxTradesPerDay (number = max trades), maxContracts (number = max contracts held at once), dailyLossLimit (number = dollars), dailyProfitTarget (number = dollars; "walk away when up $X"), maxConsecutiveLosses (number = losses in a row before stopping), tradingWindow (windows = HH:MM 24-hour start/end in New York time), newsBuffer (number = minutes around high-impact news), revengeCooldown (number = minutes to wait after a loss), noSizeUpAfterLoss, maxLossPerTrade (number = dollars), allowedInstruments (instruments = product roots like MNQ, MGC, ES), stopRequired, noStopWidening.
Anything that can't be seen in fills (bias, setups, confirmations, patience, mindset) becomes kind "manual" with a short label in the trader's words.

Use null for fields a rule doesn't need. One rule per distinct idea. Keep labels short. Put anything you couldn't turn into a rule in "notes", or "" if nothing.

RULES, IN THE TRADER'S WORDS:
${input.text}`;
}

export function extractTradesPrompt(input: ExtractTradesInput): string {
  return `The attached ${input.mediaType === "application/pdf" ? "document" : "text"} ("${input.fileName}") should be a trade history or statement. Find every closed trade: pair entries with exits where the document shows fills, and read the P&L where it's printed.

For each trade give symbol, side (Long if it opened with a buy, Short if it opened with a sell), quantity, entry and exit prices, entry and exit times exactly as written (including the date), and P&L if shown. Use null for anything not shown. Don't invent trades. Times are probably in ${input.timezone}.
In "note", say what the document is. If it isn't trade history or can't be read, return no trades and explain what to export instead (for example Tradovate's Position History CSV).`;
}
