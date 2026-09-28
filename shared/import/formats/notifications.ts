import { parseSymbol } from "../../instruments";
import type { OrderAction, OrderType } from "../../types";
import { parseNumber } from "../../util/numbers";
import { parseStamp } from "../../util/time";
import { pick, type CsvTable } from "../csv";
import type { Detection, ImportContext, ParsedFile } from "../types";
import { emptyParsed } from "../types";
import { toBuySell } from "./fills";

// TradingView's trading-panel "Notifications log": every order placed, moved,
// cancelled or filled, e.g.
//   Title: "Stop order modified on MNQU6 (700000000366) 0"   Text: "Sell 10 at 30,068.25"
// Debrief uses it to see whether a stop was set and whether it was moved away.

const TITLE =
  /^(market|limit|stop limit|stop loss|take profit|trailing stop|stop)\s+order\s+(placed|modified|cancell?ed|partially executed|executed|filled|rejected)\s+on\s+(\S+)\s*(?:\((\d+)\))?/i;
const TEXT = /^(buy|sell)\s+([\d.,\s]+?)(?:\s+(?:at|@)\s+([\d.,\s]+))?$/i;

function action(word: string): OrderAction {
  const w = word.toLowerCase();
  if (w.startsWith("partially")) return "partial";
  if (w === "executed" || w === "filled") return "filled";
  if (w.startsWith("cancel")) return "cancelled";
  if (w === "rejected") return "rejected";
  if (w === "modified") return "modified";
  return "placed";
}

function orderType(word: string): { type: OrderType; bracket?: "stopLoss" | "takeProfit" } {
  const w = word.toLowerCase();
  if (w === "stop loss") return { type: "Stop", bracket: "stopLoss" };
  if (w === "take profit") return { type: "Limit", bracket: "takeProfit" };
  if (w === "stop limit") return { type: "StopLimit" };
  if (w === "stop" || w === "trailing stop") return { type: "Stop" };
  if (w === "limit") return { type: "Limit" };
  return { type: "Market" };
}

export function parseNotifications(table: CsvTable, ctx: ImportContext, detection: Detection): ParsedFile {
  const h = table.headers;
  const col = { symbol: pick(h, "Symbol"), time: pick(h, "Time"), title: pick(h, "Title"), text: pick(h, "Text") };
  const out = emptyParsed(detection, table.rows.length);
  if (!col.time || !col.title || !col.text) return out;
  for (const r of table.rows) {
    const t = String(r[col.title] ?? "").match(TITLE);
    const x = String(r[col.text] ?? "").trim().match(TEXT);
    const stamp = parseStamp(r[col.time], ctx.tz);
    if (!t || !x || !stamp) {
      out.skippedRows++;
      continue;
    }
    const side = toBuySell(x[1]);
    if (!side) continue;
    const symbol = t[3] || (col.symbol ? r[col.symbol] : "") || "";
    const { type, bracket } = orderType(t[1]);
    out.orders.push({
      symbol,
      root: parseSymbol(symbol).root,
      orderId: t[4],
      time: stamp.ms,
      action: action(t[2]),
      type,
      bracket,
      side,
      qty: parseNumber(x[2]) ?? undefined,
      price: x[3] ? parseNumber(x[3]) ?? undefined : undefined,
    });
  }
  return out;
}
