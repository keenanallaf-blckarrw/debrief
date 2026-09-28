import { parseSymbol, pointValue } from "../../instruments";
import { clean, exactId, looksLikeMangledId, parseNumber } from "../../util/numbers";
import { inferDateOrder, parseStamp } from "../../util/time";
import { pick, type CsvTable } from "../csv";
import type { Detection, ImportContext, NewExecution, ParsedFile } from "../types";
import { emptyParsed } from "../types";

// Tradovate "Position History" and "Performance" reports. Each row is one
// matched pair of fills, but neither report says long or short. Direction comes
// from fill order: bought first = long, sold first = short.

export function parsePairs(table: CsvTable, ctx: ImportContext, detection: Detection): ParsedFile {
  const h = table.headers;
  const col = {
    symbol: pick(h, "Contract", "symbol"),
    product: pick(h, "Product"),
    account: pick(h, "Account"),
    qty: pick(h, "Paired Qty", "qty"),
    buyPrice: pick(h, "Buy Price", "buyPrice"),
    sellPrice: pick(h, "Sell Price", "sellPrice"),
    pnl: pick(h, "P/L", "pnl"),
    bought: pick(h, "Bought Timestamp", "boughtTimestamp"),
    sold: pick(h, "Sold Timestamp", "soldTimestamp"),
    buyFill: pick(h, "Buy Fill ID", "buyFillId"),
    sellFill: pick(h, "Sell Fill ID", "sellFillId"),
    positionId: pick(h, "Position ID"),
    currency: pick(h, "Currency"),
  };
  const out = emptyParsed(detection, table.rows.length);
  if (!col.symbol || !col.qty || !col.buyPrice || !col.sellPrice || !col.bought || !col.sold) {
    out.warnings.push("This file is missing columns Debrief needs (contract, quantity, prices or timestamps).");
    return out;
  }
  const order = inferDateOrder(table.rows.flatMap((r) => [r[col.bought!], r[col.sold!]]));
  let uncertain = 0;

  for (const r of table.rows) {
    const symbol = r[col.symbol] ?? "";
    const qty = parseNumber(r[col.qty]);
    const buy = parseNumber(r[col.buyPrice]);
    const sell = parseNumber(r[col.sellPrice]);
    const bought = parseStamp(r[col.bought], ctx.tz, order);
    const sold = parseStamp(r[col.sold], ctx.tz, order);
    if (!symbol || !qty || qty <= 0 || buy === null || sell === null || !bought || !sold) {
      out.skippedRows++;
      continue;
    }
    if (
      looksLikeMangledId(r[col.buyFill ?? ""]) ||
      looksLikeMangledId(r[col.positionId ?? ""]) ||
      bought.precision !== "second"
    ) {
      out.mangled = true;
    }
    const buyId = col.buyFill ? exactId(r[col.buyFill]) : undefined;
    const sellId = col.sellFill ? exactId(r[col.sellFill]) : undefined;

    let long: boolean;
    let sideUncertain = false;
    if (bought.ms !== sold.ms) {
      long = bought.ms < sold.ms;
    } else if (buyId && sellId && buyId.length === sellId.length) {
      // Same timestamp: Tradovate fill ids increase over time, so the lower id filled first.
      long = buyId < sellId;
    } else {
      long = true;
      sideUncertain = true;
      uncertain++;
    }

    const info = parseSymbol(symbol, col.product ? r[col.product] : undefined);
    const reported = col.pnl ? parseNumber(r[col.pnl]) : null;
    const pnl = reported ?? (sell - buy) * qty * pointValue(info);
    const exec: NewExecution = {
      account: col.account ? r[col.account] || undefined : undefined,
      symbol,
      root: info.root,
      side: long ? "Long" : "Short",
      qty,
      entryPrice: clean(long ? buy : sell),
      exitPrice: clean(long ? sell : buy),
      entryTime: long ? bought.ms : sold.ms,
      exitTime: long ? sold.ms : bought.ms,
      pnl: clean(pnl, 2),
      currency: col.currency ? r[col.currency] || undefined : undefined,
      precision: bought.precision === "second" && sold.precision === "second" ? "second" : "minute",
      fillIds: buyId || sellId ? { buy: buyId, sell: sellId } : undefined,
    };
    if (sideUncertain) exec.sideUncertain = true;
    out.executions.push(exec);
  }

  if (out.mangled) {
    out.warnings.push(
      "This file looks like it was opened and re-saved in Excel or Numbers, which strips the seconds from every time. It still imports, but for exact entry times, download the original export again from Tradovate.",
    );
  }
  if (uncertain) {
    out.warnings.push(
      `${uncertain} ${uncertain === 1 ? "fill pair opened and closed" : "fill pairs opened and closed"} within the same minute and this file has no seconds, so long/short is a best guess. Importing the original export later fixes them automatically.`,
    );
  }
  if (out.skippedRows) {
    out.warnings.push(`${out.skippedRows} ${out.skippedRows === 1 ? "row was" : "rows were"} skipped because a price, size or time was missing.`);
  }
  return out;
}
