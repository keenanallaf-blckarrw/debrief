import { parseSymbol } from "../../shared/instruments";
import type { Candle, Trade } from "../../shared/types";

// Where a trade's fills go on its candle chart. Kept apart from the chart
// component so the maths can be tested without a browser.

/** The candle a moment (in seconds) falls in, or null when the data has a gap there. */
export function candleAt(bars: Candle[], sec: number, step: number): Candle | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].time <= sec) return sec < bars[i].time + step ? bars[i] : null;
  }
  return null;
}

/** The start of the candle a moment (in ms) belongs to: the last candle at or before it. */
export function snapToCandle(bars: Candle[], ms: number): number {
  const sec = Math.floor(ms / 1000);
  let best = bars[0]?.time ?? sec;
  for (const b of bars) {
    if (b.time <= sec) best = b.time;
    else break;
  }
  return best;
}

export interface FillMark {
  /** Candle start, in seconds. */
  time: number;
  entry: boolean;
  buy: boolean;
  qty: number;
  /** Your fill price, or the quantity-weighted average when several fills share the candle. */
  price: number;
  averaged: boolean;
}

/** One mark per candle for the trade's entries and one for its exits. */
export function fillMarks(trade: Trade, bars: Candle[]): FillMark[] {
  const isLong = trade.side === "Long";
  const groups = new Map<string, { time: number; entry: boolean; qty: number; cost: number; lo: number; hi: number }>();
  const add = (ms: number, px: number, qty: number, entry: boolean) => {
    const time = snapToCandle(bars, ms);
    const k = `${time}|${entry}`;
    const g = groups.get(k) ?? { time, entry, qty: 0, cost: 0, lo: px, hi: px };
    g.qty += qty;
    g.cost += px * qty;
    g.lo = Math.min(g.lo, px);
    g.hi = Math.max(g.hi, px);
    groups.set(k, g);
  };
  for (const e of trade.executions) {
    add(e.entryTime, e.entryPrice, e.qty, true);
    add(e.exitTime, e.exitPrice, e.qty, false);
  }
  return [...groups.values()]
    .sort((a, b) => a.time - b.time || Number(b.entry) - Number(a.entry))
    .map((g) => ({ time: g.time, entry: g.entry, buy: g.entry === isLong, qty: g.qty, price: g.cost / g.qty, averaged: g.hi > g.lo }));
}

/**
 * How far your fills sit from the candles they happened in, in points
 * (positive = fills above the candles), or null when they line up. Free data
 * misses the odd tick, so small gaps are normal; when most fills are well
 * outside their candles, the candles are from a different contract month.
 */
export function fillGap(bars: Candle[], step: number, trade: Trade): number | null {
  const gaps: number[] = [];
  for (const e of trade.executions) {
    for (const [ms, px] of [
      [e.entryTime, e.entryPrice],
      [e.exitTime, e.exitPrice],
    ]) {
      const b = candleAt(bars, Math.floor(ms / 1000), step);
      if (b) gaps.push(px > b.high ? px - b.high : px < b.low ? px - b.low : 0);
    }
  }
  const limit = Math.max(4 * (parseSymbol(trade.symbol).spec?.tick ?? 0), trade.avgEntry * 0.0005);
  const off = gaps.filter((g) => Math.abs(g) > limit).sort((a, b) => a - b);
  if (!gaps.length || off.length * 2 < gaps.length) return null;
  return off[Math.floor(off.length / 2)];
}
