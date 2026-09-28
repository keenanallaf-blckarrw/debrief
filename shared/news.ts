import type { NewsEvent, NewsImpact } from "./types";
import { hash } from "./util/hash";
import { tradingDay } from "./util/time";

// Economic calendar events come from the free Forex Factory weekly feed, which
// the companion downloads and saves every week. Saved weeks stay available, so
// past sessions keep their news even after the feed moves on.

export interface ForexFactoryRow {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

function impactOf(v: string | undefined): NewsImpact {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("high")) return "high";
  if (s.startsWith("med")) return "medium";
  if (s.startsWith("hol")) return "holiday";
  return "low";
}

export function normalizeForexFactory(rows: unknown): NewsEvent[] {
  if (!Array.isArray(rows)) return [];
  const out: NewsEvent[] = [];
  for (const r of rows as ForexFactoryRow[]) {
    if (!r || typeof r !== "object" || !r.title || !r.date) continue;
    const time = Date.parse(r.date);
    if (!Number.isFinite(time)) continue;
    const currency = String(r.country ?? "").toUpperCase();
    out.push({
      id: `n${hash(`${r.title}|${currency}|${time}`)}`,
      title: String(r.title),
      currency,
      time,
      impact: impactOf(r.impact),
      forecast: r.forecast || undefined,
      previous: r.previous || undefined,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Merge newly fetched events into the saved list (same id = same event). */
export function mergeNews(existing: NewsEvent[], incoming: NewsEvent[]): NewsEvent[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.time - b.time);
}

/**
 * Trading days the saved calendar covers. Forex Factory publishes Sunday–Saturday
 * weeks, so any week with events counts as covered for its weekdays.
 */
export function newsCoverage(events: NewsEvent[], tz: string, grouping: "cme" | "midnight"): Set<string> {
  const days = new Set<string>();
  const weeks = new Set<number>();
  for (const e of events) weeks.add(Math.floor((e.time - 3 * 86_400_000) / (7 * 86_400_000)));
  for (const w of weeks) {
    const weekStart = w * 7 * 86_400_000 + 3 * 86_400_000; // Thursday epoch offset → Sunday 00:00 UTC
    for (let i = 0; i < 7; i++) days.add(tradingDay(weekStart + i * 86_400_000 + 12 * 3_600_000, tz, grouping));
  }
  return days;
}

export function eventsOnDay(events: NewsEvent[], day: string, tz: string, grouping: "cme" | "midnight"): NewsEvent[] {
  return events.filter((e) => tradingDay(e.time, tz, grouping) === day);
}
