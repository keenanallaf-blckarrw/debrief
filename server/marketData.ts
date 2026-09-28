import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSymbol, yahooSymbol } from "../shared/instruments";
import type { Candle } from "../shared/types";
import { hash } from "../shared/util/hash";
import { paths, writeFileAtomic } from "./config";

// Price candles for the chart around each trade, from Yahoo Finance's free
// chart endpoint (the same data behind finance.yahoo.com). Yahoo keeps 1-minute
// candles for 30 days and 5-minute candles for 60, so Debrief saves each trade's
// candles to disk the first time it fetches them; they stay available forever.
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

export async function getCandles(req: CandleRequest, fetchImpl: Fetch = fetch, now = Date.now()): Promise<CandleResult> {
  const info = parseSymbol(req.symbol);
  const ySymbol = yahooSymbol(info.root, info.assetClass);
  if (!ySymbol) throw new CandleError(`No free price data source for ${req.symbol}.`, 404);
  const interval = req.interval ?? pickInterval(req.entry, now);
  const { from, to } = windowFor(req.entry, req.exit, interval);
  const key = `${ySymbol}|${interval}|${from}|${to}`;
  const cacheFile = join(paths.candles, `${hash(key)}.json`);
  // A window that ended a few minutes ago won't change again, so it's saved to
  // disk for good. Windows still running (today's session, the live chart) are
  // only kept in memory for a minute.
  const settled = to <= now - 5 * 60_000;

  if (settled && existsSync(cacheFile)) {
    try {
      const saved = JSON.parse(readFileSync(cacheFile, "utf8")) as { fetchedAt: number; bars: Candle[] };
      return { provider: "yahoo", yahooSymbol: ySymbol, interval, from, to, bars: saved.bars, cached: true };
    } catch {
      // unreadable cache file: fetch again
    }
  }
  const recent = memory.get(key);
  if (recent && now - recent.fetchedAt < 60_000) {
    return { provider: "yahoo", yahooSymbol: ySymbol, interval, from, to, bars: recent.bars, cached: true };
  }

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
  const bars = parseYahoo(json);
  if (bars.length && settled) writeFileAtomic(cacheFile, JSON.stringify({ fetchedAt: now, bars }));
  else if (bars.length) {
    memory.set(key, { fetchedAt: now, bars });
    if (memory.size > 200) memory.delete(memory.keys().next().value!);
  }
  return { provider: "yahoo", yahooSymbol: ySymbol, interval, from, to, bars, cached: false };
}

const memory = new Map<string, { fetchedAt: number; bars: Candle[] }>();

/** Save candles for recent trades in the background, gently, one at a time. */
export class Prefetcher {
  private queue: CandleRequest[] = [];
  private running = false;
  private done = new Set<string>();

  constructor(private readonly fetchImpl: Fetch = fetch, private readonly gapMs = 1200) {}

  add(reqs: CandleRequest[]): number {
    let added = 0;
    for (const r of reqs) {
      const key = `${r.symbol}|${r.entry}|${r.exit}`;
      if (this.done.has(key) || pickInterval(r.entry) !== "1m") continue;
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
        await getCandles(next, this.fetchImpl);
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
