import { parseSymbol, pointValue } from "../../instruments";
import type { Side } from "../../types";
import { clean, parseNumber } from "../../util/numbers";
import { inferDateOrder, parseStamp } from "../../util/time";
import { norm, type CsvTable } from "../csv";
import type { Detection, FillMapping, ImportContext, ParsedFile, RoundTripMapping } from "../types";
import { emptyParsed } from "../types";

// Any broker's trade list (NinjaTrader, MT4/MT5, IBKR, thinkorswim, prop firm
// dashboards...). Debrief guesses which column is which; the trader confirms in
// the mapping screen before anything is imported.

function find(headers: string[], fragments: string[], exclude: string[] = []): string | undefined {
  const cands = headers.filter((h) => !exclude.some((e) => norm(h).includes(e)));
  for (const f of fragments) {
    const exact = cands.find((h) => norm(h) === f);
    if (exact) return exact;
  }
  for (const f of fragments) {
    const hit = cands.find((h) => norm(h).includes(f));
    if (hit) return hit;
  }
  return undefined;
}

export function suggestRoundTripMapping(headers: string[]): RoundTripMapping {
  return {
    layout: "roundtrip",
    symbol: find(headers, ["symbol", "instrument", "contract", "ticker", "market", "product"]) ?? "",
    side: find(headers, ["side", "direction", "marketpos", "position", "buysell", "action", "type"], ["pricetype", "formattype", "ordertype"]),
    qty: find(headers, ["qty", "quantity", "contracts", "size", "volume", "lots", "shares", "amount"]),
    entryPrice: find(headers, ["avgentryprice", "entryprice", "openprice", "avgopen", "pricein", "buyprice", "avgprice", "entry"]),
    exitPrice: find(headers, ["avgexitprice", "exitprice", "closeprice", "avgclose", "priceout", "sellprice", "exit"]),
    pnl: find(headers, ["netpnl", "netpl", "realizedpnl", "realizedpl", "netprofit", "profitloss", "pnl", "pl", "profit"]),
    entryTime: find(headers, ["entrytime", "opentime", "entrydate", "opendate", "timein", "opened", "entered", "time", "date"]),
    exitTime: find(headers, ["exittime", "closetime", "exitdate", "closedate", "timeout", "closed", "exited"]),
    account: find(headers, ["account"]),
  };
}

export function suggestFillMapping(headers: string[]): FillMapping {
  return {
    layout: "fills",
    symbol: find(headers, ["symbol", "instrument", "contract", "ticker", "market", "product"]) ?? "",
    side: find(headers, ["side", "bs", "buysell", "action", "direction", "type"], ["ordertype", "pricetype"]) ?? "",
    qty: find(headers, ["filledqty", "fillqty", "qty", "quantity", "shares", "contracts", "size", "volume"]) ?? "",
    price: find(headers, ["avgfillprice", "fillprice", "avgprice", "executionprice", "price"], ["limit", "stop"]) ?? "",
    time: find(headers, ["filltime", "executiontime", "closingtime", "time", "timestamp", "date"]) ?? "",
    account: find(headers, ["account"]),
    status: find(headers, ["status"]),
    commission: find(headers, ["commission", "fee"]),
  };
}

function directionFrom(value: unknown): Side | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/\b(sell|short|sld|ss|sellshort)\b/.test(s) || s === "s" || s === "-1") return "Short";
  if (/\b(buy|long|bot|b)\b/.test(s) || s === "1") return "Long";
  return null;
}

export function parseRoundTrips(
  table: CsvTable,
  ctx: ImportContext,
  detection: Detection,
  m: RoundTripMapping,
): ParsedFile {
  const out = emptyParsed(detection, table.rows.length);
  if (!m.symbol) {
    out.warnings.push("Pick which column holds the instrument before importing.");
    return out;
  }
  const order = inferDateOrder(table.rows.flatMap((r) => [m.entryTime ? r[m.entryTime] : "", m.exitTime ? r[m.exitTime] : ""]));
  for (const r of table.rows) {
    const symbol = r[m.symbol] ?? "";
    const info = parseSymbol(symbol);
    const qtyRaw = m.qty ? parseNumber(r[m.qty]) : 1;
    const qty = qtyRaw === null ? null : Math.abs(qtyRaw);
    const entry = m.entryPrice ? parseNumber(r[m.entryPrice]) : null;
    const exit = m.exitPrice ? parseNumber(r[m.exitPrice]) : null;
    const pnlReported = m.pnl ? parseNumber(r[m.pnl]) : null;
    const t0 = m.entryTime ? parseStamp(r[m.entryTime], ctx.tz, order) : null;
    const t1 = m.exitTime ? parseStamp(r[m.exitTime], ctx.tz, order) : null;
    const entryTime = t0 ?? t1;
    const exitTime = t1 ?? t0;
    if (!symbol || !qty || !entryTime || !exitTime || (entry === null && pnlReported === null)) {
      out.skippedRows++;
      continue;
    }

    let side = m.side ? directionFrom(r[m.side]) : null;
    if (!side && m.qty && qtyRaw !== null && qtyRaw < 0) side = "Short";
    // No side column: the P&L sign tells us. Price up + loss means it was short.
    if (!side && entry !== null && exit !== null && pnlReported !== null && exit !== entry) {
      side = (exit - entry) * pnlReported < 0 ? "Short" : "Long";
    }
    if (!side) side = "Long";
    if (m.flip) side = side === "Long" ? "Short" : "Long";

    const entryPrice = entry ?? 0;
    const exitPrice = exit ?? entryPrice;
    const pnl =
      pnlReported ?? (side === "Long" ? exitPrice - entryPrice : entryPrice - exitPrice) * qty * pointValue(info);
    out.executions.push({
      account: m.account ? r[m.account] || undefined : undefined,
      symbol,
      root: info.root,
      side,
      qty,
      entryPrice: clean(entryPrice),
      exitPrice: clean(exitPrice),
      entryTime: Math.min(entryTime.ms, exitTime.ms),
      exitTime: Math.max(entryTime.ms, exitTime.ms),
      pnl: clean(pnl, 2),
      precision: entryTime.precision === "second" && exitTime.precision === "second" ? "second" : "minute",
    });
  }
  if (out.skippedRows) {
    out.warnings.push(`${out.skippedRows} rows were skipped (no instrument, size, time or price/P&L).`);
  }
  return out;
}
