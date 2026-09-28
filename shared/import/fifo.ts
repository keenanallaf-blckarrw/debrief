import type { SymbolInfo } from "../instruments";
import { pointValue } from "../instruments";
import type { BuySell, TimePrecision } from "../types";
import { clean } from "../util/numbers";
import type { NewExecution } from "./types";

// Order and fill exports list one buy or sell per row. Brokers pair them first
// in, first out: the oldest open contracts are closed first. Tradovate pairs the
// same way, so these pairs match its own "Position History" rows.

export interface Fill {
  account?: string;
  symbol: string;
  info: SymbolInfo;
  side: BuySell;
  qty: number;
  price: number;
  time: number;
  precision: TimePrecision;
  fillId?: string;
  currency?: string;
  /** Original row order, used to break timestamp ties. */
  seq: number;
}

interface Lot {
  side: BuySell;
  qty: number;
  price: number;
  time: number;
  precision: TimePrecision;
  fillId?: string;
}

export interface FifoResult {
  executions: NewExecution[];
  /** Contracts left open when the file ends (the position wasn't closed yet). */
  openLots: number;
}

export function pairFills(fills: Fill[]): FifoResult {
  const sorted = [...fills].sort((a, b) => a.time - b.time || a.seq - b.seq);
  const books = new Map<string, { lots: Lot[]; sample: Fill }>();
  const executions: NewExecution[] = [];

  for (const f of sorted) {
    if (!(f.qty > 0) || !Number.isFinite(f.price)) continue;
    const key = `${f.account ?? ""}|${f.symbol}`;
    let book = books.get(key);
    if (!book) {
      book = { lots: [], sample: f };
      books.set(key, book);
    }
    let remaining = f.qty;
    while (remaining > 1e-9 && book.lots.length && book.lots[0].side !== f.side) {
      const lot = book.lots[0];
      const qty = Math.min(lot.qty, remaining);
      const long = lot.side === "Buy";
      const mult = pointValue(f.info);
      const pnl = (long ? f.price - lot.price : lot.price - f.price) * qty * mult;
      executions.push({
        account: f.account,
        symbol: f.symbol,
        root: f.info.root,
        side: long ? "Long" : "Short",
        qty: clean(qty),
        entryPrice: lot.price,
        exitPrice: f.price,
        entryTime: lot.time,
        exitTime: f.time,
        pnl: clean(pnl, 2),
        currency: f.currency,
        precision: lot.precision === "minute" || f.precision === "minute" ? "minute" : "second",
        fillIds: long ? { buy: lot.fillId, sell: f.fillId } : { buy: f.fillId, sell: lot.fillId },
      });
      lot.qty -= qty;
      remaining -= qty;
      if (lot.qty <= 1e-9) book.lots.shift();
    }
    if (remaining > 1e-9) {
      book.lots.push({ side: f.side, qty: remaining, price: f.price, time: f.time, precision: f.precision, fillId: f.fillId });
    }
  }

  let openLots = 0;
  for (const book of books.values()) openLots += book.lots.reduce((a, l) => a + l.qty, 0);
  return { executions, openLots: clean(openLots) };
}
