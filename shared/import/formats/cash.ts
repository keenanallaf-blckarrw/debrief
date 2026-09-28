import { parseSymbol } from "../../instruments";
import type { CashKind } from "../../types";
import { parseNumber } from "../../util/numbers";
import { inferDateOrder, parseStamp } from "../../util/time";
import { pick, type CsvTable } from "../csv";
import type { Detection, ImportContext, ParsedFile } from "../types";
import { emptyParsed } from "../types";

// Tradovate "Cash History": the account ledger. Commission and fee lines give
// Debrief your real costs per trade; the first deposit is your starting balance.

export function cashKind(type: string, delta: number): CashKind {
  const t = type.toLowerCase();
  if (t.includes("commission")) return "commission";
  if (/fee|clearing|exchange|nfa|routing|platform/.test(t)) return "fee";
  if (/withdraw/.test(t)) return "withdrawal";
  if (/fund|deposit|transfer|reset/.test(t)) return delta >= 0 ? "deposit" : "withdrawal";
  if (/trade paired|realized|p\/l|pnl|profit/.test(t)) return "pnl";
  return "other";
}

export function parseCash(table: CsvTable, ctx: ImportContext, detection: Detection): ParsedFile {
  const h = table.headers;
  const col = {
    account: pick(h, "Account"),
    time: pick(h, "Timestamp", "Time"),
    date: pick(h, "Date"),
    delta: pick(h, "Delta", "Amount"),
    type: pick(h, "Cash Change Type", "Type"),
    contract: pick(h, "Contract", "Symbol"),
  };
  const out = emptyParsed(detection, table.rows.length);
  if (!col.delta || !col.type || (!col.time && !col.date)) {
    out.warnings.push("This cash history is missing its amount, type or time column.");
    return out;
  }
  const order = inferDateOrder(table.rows.map((r) => r[col.time ?? col.date!]));
  for (const r of table.rows) {
    const delta = parseNumber(r[col.delta]);
    const stamp = parseStamp(r[col.time ?? col.date!], ctx.tz, order) ?? (col.date ? parseStamp(r[col.date], ctx.tz, order) : null);
    if (delta === null || !stamp) {
      out.skippedRows++;
      continue;
    }
    if (stamp.precision === "minute") out.mangled = true;
    const contract = col.contract ? r[col.contract] || undefined : undefined;
    out.cash.push({
      account: col.account ? r[col.account] || undefined : undefined,
      time: stamp.ms,
      kind: cashKind(r[col.type] ?? "", delta),
      amount: delta,
      symbol: contract,
      root: contract ? parseSymbol(contract).root : undefined,
    });
  }
  if (out.skippedRows) out.warnings.push(`${out.skippedRows} ledger lines were skipped (missing amount or time).`);
  return out;
}
