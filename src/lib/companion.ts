import { create } from "zustand";
import type { AiTask } from "../../shared/ai/inputs";
import type { Candle, NewsEvent } from "../../shared/types";

// Talks to the Debrief companion (server/), the small program that runs on your
// computer. When it isn't running (for example on the GitHub Pages demo),
// Debrief still works; auto-import, the AI coach, price charts and the news
// calendar simply switch off and say how to turn them on.

const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export interface CompanionStatus {
  app: "debrief-companion";
  version: string;
  dataDir: string;
  ai: { ready: boolean; source: "environment" | "saved" | null; model: string; effort: string };
  watch: { enabled: boolean; dir: string; watching: boolean; error: string | null; pending: number };
  calendar: { weeks: number; lastFetch: number | null; error: string | null };
  backups: { count: number; latest: number | null };
  prefetching: number;
  time: number;
}

export interface InboxItem {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  detection: { format: string | null; label: string; kind: string; needsMapping: boolean; note?: string };
}

interface CompanionState {
  checked: boolean;
  available: boolean;
  status: CompanionStatus | null;
}

export const useCompanion = create<CompanionState>(() => ({ checked: false, available: false, status: null }));

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    if (body === undefined) body = "{}";
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { ...init, method, headers, body });
  } catch {
    throw new ApiError("The Debrief companion isn't running.", 0);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const msg = type.includes("json") ? ((await res.json().catch(() => ({}))) as { error?: string; message?: string }) : null;
    throw new ApiError(msg?.error ?? msg?.message ?? `Request failed (${res.status}).`, res.status);
  }
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export async function refreshStatus(): Promise<CompanionStatus | null> {
  try {
    const status = await call<CompanionStatus>("/status");
    const ok = status && status.app === "debrief-companion";
    useCompanion.setState({ checked: true, available: Boolean(ok), status: ok ? status : null });
    return ok ? status : null;
  } catch {
    useCompanion.setState({ checked: true, available: false, status: null });
    return null;
  }
}

export const companion = {
  inbox: () => call<{ items: InboxItem[] }>("/inbox"),
  inboxContent: (id: string) => call<string>(`/inbox/${encodeURIComponent(id)}/content`),
  inboxDone: (id: string) => call<{ ok: true }>(`/inbox/${encodeURIComponent(id)}/done`, { method: "POST" }),
  scan: (days = 365) => call<{ dir: string; found: number; items: InboxItem[] }>("/inbox/scan", { method: "POST", body: JSON.stringify({ days }) }),
  saveKey: (key: string) => call<{ ok: boolean; message: string }>("/config/ai-key", { method: "POST", body: JSON.stringify({ key }) }),
  deleteKey: () => call<{ ok: boolean; environmentKeyStillSet: boolean }>("/config/ai-key", { method: "DELETE" }),
  setWatch: (patch: { dir?: string; enabled?: boolean }) =>
    call<{ ok: boolean; watch: { enabled: boolean; dir: string; error: string | null } }>("/config/watch", { method: "POST", body: JSON.stringify(patch) }),
  candles: (symbol: string, entry: number, exit: number) =>
    call<{ provider: string; yahooSymbol: string; interval: string; bars: Candle[]; from: number; to: number }>(
      `/candles?symbol=${encodeURIComponent(symbol)}&entry=${entry}&exit=${exit}`,
    ),
  prefetch: (trades: { symbol: string; entry: number; exit: number }[]) =>
    call<{ queued: number }>("/candles/prefetch", { method: "POST", body: JSON.stringify({ trades }) }),
  calendar: (refresh = false) => call<{ events: NewsEvent[] }>(`/calendar${refresh ? "?refresh=1" : ""}`),
  backup: (data: unknown) => call<{ savedAt: number }>("/backup", { method: "POST", body: JSON.stringify({ data }) }),
  latestBackup: () => call<{ savedAt: number; data: unknown }>("/backup/latest"),
};

export async function ai<T>(task: AiTask, input: unknown): Promise<{ result: T; model: string }> {
  return call<{ result: T; model: string }>(`/ai/${task}`, { method: "POST", body: JSON.stringify(input) });
}

type InboxHandler = (item: InboxItem) => void;

let source: EventSource | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

/**
 * Keep an eye on the companion: status every 20 seconds, plus live file events
 * while connected. Files can never get stuck waiting: whenever the live
 * connection (re)opens, or a status check shows files waiting, the app asks
 * for the whole inbox. (That covers a companion restart while Debrief is open.)
 */
export function watchCompanion(onInbox: InboxHandler, onPending: () => void): () => void {
  const connect = () => {
    if (source || typeof EventSource === "undefined") return;
    const es = new EventSource(`${BASE}/api/events`);
    source = es;
    es.addEventListener("inbox", (e) => {
      try {
        onInbox(JSON.parse((e as MessageEvent).data) as InboxItem);
      } catch {
        // ignore malformed event
      }
    });
    es.addEventListener("hello", (e) => {
      try {
        if ((JSON.parse((e as MessageEvent).data) as { pending?: number }).pending) onPending();
      } catch {
        // ignore
      }
    });
    es.onerror = () => {
      es.close();
      if (source === es) source = null;
    };
  };
  const tick = async () => {
    const status = await refreshStatus();
    if (!status) return;
    connect();
    if (status.watch.pending > 0) onPending();
  };
  void tick();
  poll = setInterval(tick, 20_000);
  const onFocus = () => void tick();
  window.addEventListener("focus", onFocus);
  return () => {
    if (poll) clearInterval(poll);
    window.removeEventListener("focus", onFocus);
    source?.close();
    source = null;
  };
}
