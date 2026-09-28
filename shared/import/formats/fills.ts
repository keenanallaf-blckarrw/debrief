import { parseSymbol } from "../../instruments";
import type { BuySell, OrderType } from "../../types";
import { clean, exactId, looksLikeMangledId, parseNumber } from "../../util/numbers";
import { inferDateOrder, parseStamp } from "../../util/time";
import { pick, type CsvTable } from "../csv";
import { pairFills, type Fill } from "../fifo";
import type { Detection, FillMapping, ImportContext, NewOrder, ParsedFile } from "../types";
import { emptyParsed } from "../types";

// Exports with one order or fill per row: Tradovate "Orders", TradingView's
// order history (paper trading and connected brokers), and unknown fill lists.
// Filled rows become fills (paired FIFO into trades); stop and limit orders are
// kept as order events so Debrief can see where your stop sat.

interface FillColumns {
  symbol?: string;
  product?: string;
  account?: string;
  side?: string;
  qty?: string;
  price?: string;
  time?: string;
  status?: string;
  type?: string;
  orderId?: string;
  placedTime?: string;
  stopPrice?: string;
  limitPrice?: string;
  orderQty?: string;
  commission?: string;
  fillId?: string;
}

export function toBuySell(value: unknown): BuySell | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(b|buy|bot|bought|long|buy to open|buy to cover|bto|btc|cover)\b/.test(s) || s.startsWith("buy")) return "Buy";
  if (/^(s|sell|sld|sold|short|sell short|ss|sto|stc)\b/.test(s) || s.startsWith("sell") || s.startsWith("short")) return "Sell";
  return null;
}

export function toOrderType(value: unknown): OrderType {
  const s = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("stoplimit")) return "StopLimit";
  if (s.startsWith("stop") || s.includes("trailing")) return "Stop";
  if (s.startsWith("limit") || s.includes("takeprofit")) return "Limit";
  if (s.startsWith("market")) return "Market";
  return "Other";
}

function isFilledStatus(value: unknown): boolean | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/cancel|reject|expired|working|pending|inactive/.test(s)) return false;
  return /fill|execut|complete/.test(s);
}

function tradovateColumns(h: string[]): FillColumns {
  return {
    symbol: pick(h, "Contract"),
    product: pick(h, "Product"),
    account: pick(h, "Account"),
    side: pick(h, "B/S"),
    qty: pick(h, "Filled Qty", "filledQty"),
    price: pick(h, "Avg Fill Price", "avgPrice", "decimalFillAvg"),
    time: pick(h, "Fill Time"),
    status: pick(h, "Status"),
    type: pick(h, "Type"),
    orderId: pick(h, "Order ID", "orderId"),
    placedTime: pick(h, "Timestamp"),
    stopPrice: pick(h, "Stop Price", "decimalStop"),
    limitPrice: pick(h, "Limit Price", "decimalLimit"),
    orderQty: pick(h, "Quantity"),
  };
}

function tradingViewColumns(h: string[]): FillColumns {
  return {
    symbol: pick(h, "Symbol"),
    account: pick(h, "Account"),
    side: pick(h, "Side"),
    qty: pick(h, "Filled Qty", "Qty", "Quantity"),
    price: pick(h, "Fill Price", "Avg Fill Price", "Avg Price", "Price"),
    time: pick(h, "Closing Time", "Fill Time", "Time", "Placing Time"),
    status: pick(h, "Status"),
    type: pick(h, "Type"),
    orderId: pick(h, "Order ID", "Order Id"),
    placedTime: pick(h, "Placing Time"),
    stopPrice: pick(h, "Stop Price"),
    limitPrice: pick(h, "Limit Price"),
    orderQty: pick(h, "Qty", "Quantity"),
    commission: pick(h, "Commission", "Fee"),
  };
}

function mappedColumns(m: FillMapping): FillColumns {
  return {
    symbol: m.symbol,
    account: m.account,
    side: m.side,
    qty: m.qty,
    price: m.price,
    time: m.time,
    status: m.status,
    commission: m.commission,
  };
}

export function parseFills(
  table: CsvTable,
  ctx: ImportContext,
  detection: Detection,
  mapping?: FillMapping,
): ParsedFile {
  const h = table.headers;
  const col =
    mapping ? mappedColumns(mapping)
    : detection.format === "tradovate-orders" ? tradovateColumns(h)
    : tradingViewColumns(h);
  const out = emptyParsed(detection, table.rows.length);
  if (!col.symbol || !col.side || !col.qty || !col.price || !col.time) {
    out.warnings.push("This file is missing columns Debrief needs (symbol, side, quantity, fill price or time).");
    return out;
  }
  const order = inferDateOrder(
    table.rows.flatMap((r) => [r[col.time!], col.placedTime ? r[col.placedTime] : ""]),
  );

  const fills: Fill[] = [];
  const orders: NewOrder[] = [];
  table.rows.forEach((r, seq) => {
    const symbol = r[col.symbol!] ?? "";
    const side = toBuySell(r[col.side!]);
    if (!symbol || !side) {
      out.skippedRows++;
      return;
    }
    const info = parseSymbol(symbol, col.product ? r[col.product] : undefined);
    const account = col.account ? r[col.account] || undefined : undefined;
    const orderId = col.orderId ? exactId(r[col.orderId]) : undefined;
    if (col.orderId && looksLikeMangledId(r[col.orderId])) out.mangled = true;
    const type = col.type ? toOrderType(r[col.type]) : "Other";

    const qty = parseNumber(r[col.qty!]);
    const price = parseNumber(r[col.price!]);
    const time = parseStamp(r[col.time!], ctx.tz, order);
    const statusFilled = col.status ? isFilledStatus(r[col.status]) : null;
    // Tradovate keeps the filled quantity even on orders that were later cancelled.
    const filled = qty !== null && qty > 0 && price !== null && time !== null && statusFilled !== false
      ? true
      : detection.format === "tradovate-orders" && qty !== null && qty > 0 && price !== null && time !== null;

    if (filled && time) {
      if (time.precision !== "second") out.mangled = true;
      fills.push({
        account,
        symbol,
        info,
        side,
        qty: qty!,
        price: clean(price!),
        time: time.ms,
        precision: time.precision === "second" ? "second" : "minute",
        // Order ids live in a different number space than Tradovate's fill ids,
        // so they are kept on order events only, never compared with fill ids.
        seq,
      });
      const fee = col.commission ? parseNumber(r[col.commission]) : null;
      if (fee) {
        out.cash.push({
          account,
          time: time.ms,
          kind: "commission",
          amount: -Math.abs(fee),
          symbol,
          root: info.root,
        });
      }
    }

    // Order events: where stops and targets sat, and when orders filled.
    const placed = col.placedTime ? parseStamp(r[col.placedTime], ctx.tz, order) : null;
    const stop = col.stopPrice ? parseNumber(r[col.stopPrice]) : null;
    const limit = col.limitPrice ? parseNumber(r[col.limitPrice]) : null;
    const orderQty = col.orderQty ? parseNumber(r[col.orderQty]) : qty;
    if (placed && (type === "Stop" || type === "StopLimit" || type === "Limit")) {
      orders.push({
        account,
        symbol,
        root: info.root,
        orderId,
        time: placed.ms,
        action: "placed",
        type,
        side,
        qty: orderQty ?? undefined,
        price: (type === "Limit" ? limit : stop) ?? undefined,
      });
    }
    if (filled && time && col.type) {
      orders.push({
        account,
        symbol,
        root: info.root,
        orderId,
        time: time.ms,
        action: "filled",
        type,
        side,
        qty: qty ?? undefined,
        price: price ?? undefined,
      });
    }
  });

  const { executions, openLots } = pairFills(fills);
  out.executions = executions;
  out.orders = orders;
  out.openPositions = openLots;
  if (out.mangled) {
    out.warnings.push(
      "This file looks like it was re-saved in Excel or Numbers, so times lost their seconds and order ids were rounded. It still imports, but the original download is more precise.",
    );
  }
  if (openLots) {
    out.warnings.push(
      `${openLots} ${openLots === 1 ? "contract was" : "contracts were"} still open at the end of this file, so ${openLots === 1 ? "that position isn't" : "those positions aren't"} imported yet.`,
    );
  }
  if (!fills.length) out.warnings.push("No filled orders were found in this file.");
  return out;
}
