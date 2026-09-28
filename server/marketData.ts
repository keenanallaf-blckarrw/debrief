import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSymbol, yahooSymbol } from "../shared/instruments";
import type { Candle } from "../shared/types";
import { hash } from "../shared/util/hash";
import { paths, writeFileAtomic } from "./config";

// Price candles for the chart around each trade, from Yahoo Finance's free
// chart endpoint (the same data behind finance.yahoo.com). Yahoo keeps 1-minute
// candles for 30 days and 5-minute candles for 60, so Debrief saves whole days
// of them to disk for the days you traded; they stay available forever.
// Free data is for personal use; a commercial launch needs a licensed feed.

export type Interval = "1m" | "5m" | "60m" | "1d";

export interface CandleRequest {
  symbol: string;
  entry: number;
  exit: number;
  interval?: Interval;
}

export interface CandleResult {
  provider: "yahoo";
  yahooSymbol: string;
  interval: Interval;
  from: number;
  to: number;
  bars: Candle[];
  cached: boolean;
  /** Served from whole saved days, which stay on disk for good. */
  saved: boolean;
}

export class CandleError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

const DAY = 86_400_000;

/** Finest candle size Yahoo still serves for a trade this old. */
export function pickInterval(entry: number, now = Date.now()): Interval {
  const age = now - entry;
  if (age < 29 * DAY) return "1m";
  if (age < 59 * DAY) return "5m";
  if (age < 720 * DAY) return "60m";
  return "1d";
}

/** Window to show around a trade: enough context before and after. */
export function windowFor(entry: number, exit: number, interval: Interval): { from: number; to: number } {
  const hold = Math.max(0, exit - entry);
  const pad =
    interval === "1m" ? Math.min(3 * 3_600_000, Math.max(45 * 60_000, hold * 1.5))
    : interval === "5m" ? Math.min(8 * 3_600_000, Math.max(3 * 3_600_000, hold * 2))
    : interval === "60m" ? 3 * DAY
    : 45 * DAY;
  const minute = 60_000;
  return { from: Math.floor((entry - pad) / minute) * minute, to: Math.ceil((exit + pad) / minute) * minute };
}

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export function parseYahoo(json: YahooChart): Candle[] {
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const bars: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    bars.push({ time: ts[i], open, high, low, close, volume: q.volume?.[i] ?? undefined });
  }
  // Lightweight Charts needs strictly increasing times.
  return bars.filter((b, i) => i === 0 || b.time > bars[i - 1].time);
}

type Fetch = typeof fetch;

// Candles for 1-minute and 5-minute charts are saved one UTC day at a time,
// while Yahoo still has them. A trade's chart then uses the finest size saved
// for its days, even after Yahoo has dropped that size.
const SAVED: Interval[] = ["1m", "5m"];
/** Most days of candles to ask Yahoo for at once (it caps 1-minute requests at about a week). */
const MAX_SPAN: Partial<Record<Interval, number>> = { "1m": 7 * DAY, "5m": 30 * DAY };
/** A window or day this long past won't change again. */
const SETTLE_MS = 5 * 60_000;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The UTC days a window touches. */
export function daysCovering(from: number, to: number): string[] {
  const days: string[] = [];
  for (let t = dayStart(utcDay(from)); t < to; t += DAY) days.push(utcDay(t));
  return days;
}

function dayFile(ySymbol: string, interval: Interval, day: string): string {
  return join(paths.candles, `${ySymbol.replace(/[^A-Za-z0-9]/g, "_")}-${interval}-${day}.json`);
}

function readDay(ySymbol: string, interval: Interval, day: string): Candle[] | null {
  const file = dayFile(ySymbol, interval, day);
  if (!existsSync(file)) return null;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { bars: Candle[] }).bars;
  } catch {
    return null;
  }
}

/** Saved candles for a window, or null unless every day it touches is saved at this size. */
function savedWindow(ySymbol: string, interval: Interval, from: number, to: number): Candle[] | null {
  const bars: Candle[] = [];
  for (const day of daysCovering(from, to)) {
    const saved = readDay(ySymbol, interval, day);
    if (!saved) return null;
    bars.push(...saved);
  }
  return bars.filter((b) => b.time * 1000 >= from && b.time * 1000 < to);
}

async function fetchYahoo(ySymbol: string, interval: Interval, from: number, to: number, fetchImpl: Fetch): Promise<Candle[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}` +
    `?period1=${Math.floor(from / 1000)}&period2=${Math.floor(to / 1000)}&interval=${interval}&includePrePost=true`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Debrief trading journal)" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new CandleError("Couldn't reach Yahoo Finance for price data. Check your internet connection.", 503);
  }
  if (res.status === 429) throw new CandleError("Yahoo Finance is rate-limiting requests. Try again in a minute.", 429);
  const json = (await res.json().catch(() => ({}))) as YahooChart;
  if (!res.ok || json.chart?.error) {
    const why = json.chart?.error?.description ?? `HTTP ${res.status}`;
    throw new CandleError(`Yahoo Finance has no ${interval} data for this window (${why}).`, 404);
  }
  return parseYahoo(json);
}

/** Fetch and save whole days (ones that are over and not saved yet) at this size. */
async function saveDays(ySymbol: string, interval: Interval, days: string[], fetchImpl: Fetch, now: number): Promise<void> {
  const missing = days.filter((d) => dayStart(d) + DAY <= now - SETTLE_MS && !readDay(ySymbol, interval, d));
  const span = MAX_SPAN[interval] ?? DAY;
  let i = 0;
  while (i < missing.length) {
    // Neighbouring days go in one request, up to Yahoo's limit.
    let j = i;
    while (j + 1 < missing.length && dayStart(missing[j + 1]) === dayStart(missing[j]) + DAY && dayStart(missing[j + 1]) + DAY - dayStart(missing[i]) <= span) j++;
    const bars = await fetchYahoo(ySymbol, interval, dayStart(missing[i]), dayStart(missing[j]) + DAY, fetchImpl);
    for (let k = i; k <= j; k++) {
      const start = dayStart(missing[k]) / 1000;
      const dayBars = bars.filter((b) => b.time >= start && b.time < start + DAY / 1000);
      writeFileAtomic(dayFile(ySymbol, interval, missing[k]), JSON.stringify({ fetchedAt: now, bars: dayBars }));
    }
    i = j + 1;
  }
}

export async function getCandles(req: CandleRequest, fetchImpl: Fetch = fetch, now = Date.now()): Promise<CandleResult> {
  const info = parseSymbol(req.symbol);
  const ySymbol = yahooSymbol(info.root, info.assetClass);
  if (!ySymbol) throw new CandleError(`No free price data source for ${req.symbol}.`, 404);
  const result = (interval: Interval, from: number, to: number, bars: Candle[], cached: boolean, saved: boolean): CandleResult => ({
    provider: "yahoo",
    yahooSymbol: ySymbol,
    interval,
    from,
    to,
    bars,
    cached,
    saved,
  });

  // 1. The finest candles already saved for this trade's days.
  if (!req.interval) {
    for (const interval of SAVED) {
      const w = windowFor(req.entry, req.exit, interval);
      const bars = savedWindow(ySymbol, interval, w.from, w.to);
      if (bars?.length) return result(interval, w.from, w.to, bars, true, true);
    }
  }

  const interval = req.interval ?? pickInterval(req.entry, now);
  const { from, to } = windowFor(req.entry, req.exit, interval);

  // 2. Days that are over, at a size Yahoo still has: save the whole days, then
  //    serve from them. If that fails (say a day starts just past Yahoo's
  //    30-day limit), fall back to fetching only this window.
  const days = daysCovering(from, to);
  if (SAVED.includes(interval) && days.every((d) => dayStart(d) + DAY <= now - SETTLE_MS)) {
    try {
      await saveDays(ySymbol, interval, days, fetchImpl, now);
      const bars = savedWindow(ySymbol, interval, from, to);
      if (bars?.length) return result(interval, from, to, bars, false, true);
    } catch (err) {
      if (err instanceof CandleError && err.status === 429) throw err;
    }
  }

  // 3. Everything else: today's session and the live chart (kept a minute in
  //    memory), and hourly or daily candles for older trades (saved per window).
  const key = `${ySymbol}|${interval}|${from}|${to}`;
  const cacheFile = join(paths.candles, `${hash(key)}.json`);
  const settled = to <= now - SETTLE_MS;
  if (settled && existsSync(cacheFile)) {
    try {
      const saved = JSON.parse(readFileSync(cacheFile, "utf8")) as { fetchedAt: number; bars: Candle[] };
      return result(interval, from, to, saved.bars, true, false);
    } catch {
      // unreadable cache file: fetch again
    }
  }
  const recent = memory.get(key);
  if (recent && now - recent.fetchedAt < 60_000) return result(interval, from, to, recent.bars, true, false);

  const bars = await fetchYahoo(ySymbol, interval, from, to, fetchImpl);
  if (bars.length && settled) writeFileAtomic(cacheFile, JSON.stringify({ fetchedAt: now, bars }));
  else if (bars.length) {
    memory.set(key, { fetchedAt: now, bars });
    if (memory.size > 200) memory.delete(memory.keys().next().value!);
  }
  return result(interval, from, to, bars, false, false);
}

const memory = new Map<string, { fetchedAt: number; bars: Candle[] }>();

/**
 * Saves candles for recent trades in the background, gently, one request at a
 * time: 1-minute while Yahoo has them (30 days), else 5-minute (60 days).
 */
export class Prefetcher {
  private queue: CandleRequest[] = [];
  private running = false;
  private done = new Set<string>();

  constructor(private readonly fetchImpl: Fetch = fetch, private readonly gapMs = 1200) {}

  add(reqs: CandleRequest[]): number {
    let added = 0;
    for (const r of reqs) {
      const key = `${r.symbol}|${r.entry}|${r.exit}`;
      if (this.done.has(key) || !SAVED.includes(pickInterval(r.entry))) continue;
      this.done.add(key);
      this.queue.push(r);
      added++;
    }
    void this.drain();
    return added;
  }

  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      try {
        // A trade from today can't be saved until its day is over; forget it
        // so the next prefetch (Debrief asks every time it opens) tries again.
        const r = await getCandles(next, this.fetchImpl);
        if (!r.saved) this.done.delete(`${next.symbol}|${next.entry}|${next.exit}`);
      } catch (err) {
        if (err instanceof CandleError && err.status === 429) {
          this.queue.unshift(next);
          await new Promise((r) => setTimeout(r, 60_000));
          continue;
        }
      }
      await new Promise((r) => setTimeout(r, this.gapMs));
    }
    this.running = false;
  }
}
