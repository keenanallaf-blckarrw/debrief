import { readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeForexFactory } from "../shared/news";
import type { NewsEvent } from "../shared/types";
import { paths, readJson, writeFileAtomic } from "./config";

// The economic calendar from Forex Factory's free weekly feed. The feed only
// ever shows the current week, so the companion saves every week it sees to
// the data folder's calendar/. Over time that builds your own news history, which the
// "stand aside around news" rule and the session replay use.

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const REFRESH_MS = 60 * 60_000;

let lastFetch = 0;
let lastError: string | null = null;

function weekKey(ms: number): string {
  // Sunday that starts the week (UTC), as YYYY-MM-DD.
  const d = new Date(ms);
  const sunday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()));
  return sunday.toISOString().slice(0, 10);
}

export function savedEvents(): NewsEvent[] {
  let files: string[] = [];
  try {
    files = readdirSync(paths.calendar).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const byId = new Map<string, NewsEvent>();
  for (const f of files) for (const e of readJson<NewsEvent[]>(join(paths.calendar, f), [])) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.time - b.time);
}

export function saveEvents(events: NewsEvent[]): void {
  const byWeek = new Map<string, NewsEvent[]>();
  for (const e of events) {
    // Key on the event's New York date so Sunday-evening events stay in their week.
    const k = weekKey(e.time - 4 * 3_600_000);
    const list = byWeek.get(k) ?? [];
    list.push(e);
    byWeek.set(k, list);
  }
  for (const [k, list] of byWeek) {
    const file = join(paths.calendar, `${k}.json`);
    const merged = new Map(readJson<NewsEvent[]>(file, []).map((e) => [e.id, e]));
    for (const e of list) merged.set(e.id, e);
    writeFileAtomic(file, JSON.stringify([...merged.values()].sort((a, b) => a.time - b.time)));
  }
}

export async function refreshCalendar(fetchImpl: typeof fetch = fetch, force = false): Promise<void> {
  if (!force && Date.now() - lastFetch < REFRESH_MS) return;
  lastFetch = Date.now();
  try {
    const res = await fetchImpl(FEED, { headers: { "User-Agent": "Mozilla/5.0 (Debrief trading journal)" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = normalizeForexFactory(await res.json());
    if (events.length) saveEvents(events);
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

export function calendarStatus() {
  let weeks = 0;
  try {
    weeks = readdirSync(paths.calendar).filter((f) => f.endsWith(".json")).length;
  } catch {
    weeks = 0;
  }
  return { weeks, lastFetch: lastFetch || null, error: lastError };
}
