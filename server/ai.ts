import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import {
  AskInput,
  DayDebriefInput,
  ExtractTradesInput,
  MarketBriefInput,
  ParseRulesInput,
  PeriodInput,
  PlaybookInput,
  SessionReplayInput,
  type AiTask,
} from "../shared/ai/inputs";
import {
  askSystemContext,
  COACH_SYSTEM,
  dayDebriefPrompt,
  extractTradesPrompt,
  marketBriefPrompt,
  marketResearchPrompt,
  parseRulesPrompt,
  periodDebriefPrompt,
  playbookPrompt,
  replayPrompt,
  replayResearchPrompt,
} from "../shared/ai/prompts";
import {
  DayDebriefSchema,
  ExtractedTradesSchema,
  MarketBriefSchema,
  ParsedRulesSchema,
  PeriodDebriefSchema,
  PlaybookSchema,
  SessionReplaySchema,
} from "../shared/ai/schemas";
import { apiKey, loadConfig } from "./config";

// The AI coach runs here, on your computer, so your Anthropic key never reaches
// the browser. Model: Claude Opus 5.5 by default (change with DEBRIEF_AI_MODEL).
// Every request opts into Anthropic's server-side fallback: if a request is ever
// declined by a safety check, Anthropic retries it on its recommended fallback
// model instead of failing.

const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

export class AiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface AiResult<T> {
  result: T;
  model: string;
}

/** Stand-in for tests: anything with the two methods Debrief calls. */
export interface MessagesClient {
  beta: {
    messages: {
      parse: Anthropic["beta"]["messages"]["parse"];
      create: Anthropic["beta"]["messages"]["create"];
    };
  };
}

let clientOverride: MessagesClient | null = null;
export function setClientForTests(c: MessagesClient | null): void {
  clientOverride = c;
}

function client(): MessagesClient {
  if (clientOverride) return clientOverride;
  const { key } = apiKey();
  if (!key) throw new AiError("The AI coach is off. Add your Anthropic API key in Settings to turn it on.", 503);
  return new Anthropic({ apiKey: key, timeout: 180_000, maxRetries: 2 });
}

export function friendlyError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError("Anthropic rejected your API key. Check it in Settings.", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError("Your Anthropic account can't use this model. Check your plan or billing in the Anthropic Console.", 403);
  if (err instanceof Anthropic.RateLimitError) return new AiError("Too many AI requests right now. Wait a minute and try again.", 429);
  if (err instanceof Anthropic.BadRequestError) return new AiError(`The AI request was rejected: ${err.message}`, 400);
  if (err instanceof Anthropic.APIConnectionError) return new AiError("Can't reach Anthropic. Check your internet connection.", 503);
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 502;
    if (status === 402) return new AiError("Your Anthropic account is out of credit. Add credit in the Anthropic Console.", 402);
    if (status === 529 || status >= 500) return new AiError("Anthropic is busy right now. Try again in a moment.", 503);
    return new AiError(err.message, status);
  }
  return new AiError(err instanceof Error ? err.message : "Something went wrong with the AI request.", 500);
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function structured<S extends z.ZodType>(
  schema: S,
  content: string | Anthropic.Beta.BetaContentBlockParam[],
  opts: { system?: string; maxTokens?: number } = {},
): Promise<AiResult<z.infer<S>>> {
  const cfg = loadConfig();
  const res = await client().beta.messages.parse({
    model: cfg.aiModel,
    max_tokens: opts.maxTokens ?? 16_000,
    betas: BETAS,
    fallbacks: "default",
    system: opts.system ?? COACH_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { effort: cfg.aiEffort, format: betaZodOutputFormat(schema) },
  });
  if (res.stop_reason === "refusal") throw new AiError("The AI coach declined this request.", 422);
  if (res.stop_reason === "max_tokens") throw new AiError("The AI answer was too long and got cut off. Try a shorter period.", 502);
  if (!res.parsed_output) throw new AiError("The AI answer didn't come back in the expected shape. Try again.", 502);
  return { result: res.parsed_output as z.infer<S>, model: res.model };
}

/** A web-search call that returns plain research notes. */
async function research(prompt: string): Promise<string> {
  const cfg = loadConfig();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 4; turn++) {
    const res = await client().beta.messages.create({
      model: cfg.aiModel,
      max_tokens: 8_000,
      betas: BETAS,
      fallbacks: "default",
      system: COACH_SYSTEM,
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      output_config: { effort: "low" },
    });
    if (res.stop_reason === "refusal") throw new AiError("The AI coach declined this request.", 422);
    if (res.stop_reason === "pause_turn") {
      // The search is still running on Anthropic's side; hand the turn back so it can finish.
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    const notes = textOf(res.content);
    if (notes) return notes;
    break;
  }
  return "No research notes were returned.";
}

async function chat(system: string, messages: Anthropic.Beta.BetaMessageParam[]): Promise<AiResult<string>> {
  const cfg = loadConfig();
  const res = await client().beta.messages.create({
    model: cfg.aiModel,
    max_tokens: 4_000,
    betas: BETAS,
    fallbacks: "default",
    system,
    messages,
    output_config: { effort: cfg.aiEffort === "medium" ? "low" : cfg.aiEffort },
  });
  if (res.stop_reason === "refusal") throw new AiError("The AI coach declined this question.", 422);
  return { result: textOf(res.content), model: res.model };
}

function parseInput<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AiError(`Bad request for the AI coach: ${first?.path.join(".") || "input"} ${first?.message ?? "is invalid"}.`, 400);
  }
  return parsed.data;
}

export async function runTask(task: AiTask, body: unknown): Promise<AiResult<unknown>> {
  try {
    switch (task) {
      case "day-debrief": {
        const input = parseInput(DayDebriefInput, body);
        return await structured(DayDebriefSchema, dayDebriefPrompt(input));
      }
      case "period-debrief": {
        const input = parseInput(PeriodInput, body);
        return await structured(PeriodDebriefSchema, periodDebriefPrompt(input));
      }
      case "playbook": {
        const input = parseInput(PlaybookInput, body);
        return await structured(PlaybookSchema, playbookPrompt(input));
      }
      case "ask": {
        const input = parseInput(AskInput, body);
        if (input.messages[0].role !== "user") throw new AiError("A conversation has to start with your question.", 400);
        return await chat(`${COACH_SYSTEM}\n\n${askSystemContext(input)}`, input.messages);
      }
      case "market-brief": {
        const input = parseInput(MarketBriefInput, body);
        const notes = await research(marketResearchPrompt(input));
        return await structured(MarketBriefSchema, marketBriefPrompt(input, notes));
      }
      case "session-replay": {
        const input = parseInput(SessionReplayInput, body);
        const notes = await research(replayResearchPrompt(input));
        return await structured(SessionReplaySchema, replayPrompt(input, notes));
      }
      case "parse-rules": {
        const input = parseInput(ParseRulesInput, body);
        return await structured(ParsedRulesSchema, parseRulesPrompt(input), { maxTokens: 8_000 });
      }
      case "extract-trades": {
        const input = parseInput(ExtractTradesInput, body);
        const doc: Anthropic.Beta.BetaContentBlockParam =
          input.mediaType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.data } }
            : { type: "text", text: `File "${input.fileName}":\n${input.data}` };
        return await structured(ExtractedTradesSchema, [doc, { type: "text", text: extractTradesPrompt(input) }]);
      }
    }
  } catch (err) {
    throw friendlyError(err);
  }
}

/** Cheap check that a pasted key works: list one model, no tokens used. */
export async function verifyKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const c = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1 });
    await c.models.retrieve(loadConfig().aiModel);
    return { ok: true, message: "Key works. The AI coach is on." };
  } catch (err) {
    const e = friendlyError(err);
    return { ok: false, message: e.status === 404 ? "Key works, but this account can't use the default model." : e.message };
  }
}
