import { readCsv, type CsvTable } from "./csv";
import { detectFormat } from "./detect";
import { parseCash } from "./formats/cash";
import { parseFills } from "./formats/fills";
import { parseRoundTrips, suggestFillMapping, suggestRoundTripMapping } from "./formats/generic";
import { parseNotifications } from "./formats/notifications";
import { parsePairs } from "./formats/pairs";
import type { ColumnMapping, Detection, ImportContext, ParsedFile } from "./types";
import { emptyParsed } from "./types";

export * from "./types";
export { detectFormat } from "./detect";
export { readCsv } from "./csv";

export interface FileAnalysis {
  fileName: string;
  table: CsvTable;
  detection: Detection;
  /** Present once the file could be parsed (known format, or a mapping given). */
  parsed?: ParsedFile;
  /** For unknown layouts: Debrief's best guess at the column mapping. */
  suggested?: ColumnMapping;
}

export function isSpreadsheetName(name: string): boolean {
  return /\.(csv|tsv|txt)$/i.test(name);
}

/** Read an export and turn it into executions, cash lines and order events. */
export function analyzeFile(
  text: string,
  fileName: string,
  ctx: ImportContext,
  mapping?: ColumnMapping,
): FileAnalysis {
  return analyzeTable(readCsv(text), fileName, ctx, mapping);
}

/** Same as analyzeFile, for a table that was already parsed (e.g. after a mapping). */
export function analyzeTable(
  table: CsvTable,
  fileName: string,
  ctx: ImportContext,
  mapping?: ColumnMapping,
): FileAnalysis {
  if (!table.headers.length || !table.rows.length) {
    const detection: Detection = {
      format: null,
      label: "Empty file",
      kind: "unknown",
      needsMapping: false,
      note: "This file has no rows. Exports of empty tabs (no orders yet) look like this.",
    };
    return { fileName, table, detection, parsed: emptyParsed(detection) };
  }
  let detection = detectFormat(table.headers);

  if (mapping) {
    detection = {
      format: mapping.layout === "fills" ? "generic-fills" : "generic-roundtrip",
      label: detection.format && !detection.needsMapping ? detection.label : mapping.layout === "fills" ? "Fills / order history" : "Trade list",
      kind: "trades",
      needsMapping: false,
    };
    const parsed =
      mapping.layout === "fills"
        ? parseFills(table, ctx, detection, mapping)
        : parseRoundTrips(table, ctx, detection, mapping);
    return { fileName, table, detection, parsed };
  }

  if (detection.needsMapping) {
    const suggested =
      detection.format === "generic-fills" ? suggestFillMapping(table.headers) : suggestRoundTripMapping(table.headers);
    return { fileName, table, detection, suggested };
  }

  let parsed: ParsedFile;
  switch (detection.format) {
    case "tradovate-position-history":
    case "tradovate-performance":
      parsed = parsePairs(table, ctx, detection);
      break;
    case "tradovate-orders":
    case "tradingview-orders":
      parsed = parseFills(table, ctx, detection);
      break;
    case "tradovate-cash-history":
      parsed = parseCash(table, ctx, detection);
      break;
    case "tradingview-notifications":
      parsed = parseNotifications(table, ctx, detection);
      break;
    default:
      parsed = emptyParsed(detection, table.rows.length);
  }
  return { fileName, table, detection, parsed };
}

/** True when a parse produced something worth storing. */
export function hasContent(p: ParsedFile | undefined): boolean {
  return Boolean(p && (p.executions.length || p.cash.length || p.orders.length));
}
