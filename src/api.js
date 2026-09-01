// ---------------------------------------------------------------------------
// AI transport
//
// These calls previously went straight to https://api.anthropic.com/v1/messages
// from the browser with no credentials. That works *only* inside the Claude
// artifact sandbox, which injects authentication on the way out. On any normal
// host (GitHub Pages included) the same request is CORS-blocked and then 401s.
//
// The fix is a small server that holds the API key and forwards the request.
// Set VITE_API_BASE to its origin at build time and everything below works
// unchanged; leave it unset and the AI features report themselves as disabled
// instead of failing with an opaque network error.
//
// Never put the key in this file. Anything shipped to the browser is public,
// and a leaked Anthropic key is billable to whoever finds it.
// ---------------------------------------------------------------------------

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

/** True when a proxy is configured, so the UI can hide or label AI features. */
export const aiEnabled = Boolean(API_BASE);

export class AIUnavailableError extends Error {
  constructor() {
    super(
      "AI review is off in this demo — it needs a small backend to hold the API key. " +
        "Your trades were parsed locally and nothing left your browser."
    );
    this.name = "AIUnavailableError";
  }
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

async function postMessages(body) {
  if (!API_BASE) throw new AIUnavailableError();

  const res = await fetch(`${API_BASE}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}). ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");

  return (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

export async function callClaude(prompt, useSearch = false) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  };
  if (useSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  return postMessages(body);
}

export async function callClaudeBlocks(contentBlocks) {
  return postMessages({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: contentBlocks }],
  });
}

/** Conversational endpoint for "ask your debrief" — takes a full message history. */
export async function callClaudeHistory(messages) {
  return postMessages({ model: MODEL, max_tokens: MAX_TOKENS, messages });
}
