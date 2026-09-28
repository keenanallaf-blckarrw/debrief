import type { CashEvent, Execution, FormatId, OrderEvent } from "../types";

export interface ImportContext {
  /** Timezone the export's naive timestamps are written in. */
  tz: string;
}

export type NewExecution = Omit<Execution, "id" | "importId" | "format">;
export type NewCash = Omit<CashEvent, "id" | "importId">;
export type NewOrder = Omit<OrderEvent, "id" | "importId">;

export type FileKind = "trades" | "cash" | "orders" | "ignore" | "unknown";

export interface Detection {
  format: FormatId | null;
  label: string;
  kind: FileKind;
  /** True when Debrief needs the trader to confirm which column is which. */
  needsMapping: boolean;
  note?: string;
}

export interface ParsedFile {
  detection: Detection;
  executions: NewExecution[];
  cash: NewCash[];
  orders: NewOrder[];
  warnings: string[];
  skippedRows: number;
  /** Positions still open at the end of a fills export (not imported). */
  openPositions: number;
  /** The file was re-saved by a spreadsheet app (seconds and ids lost). */
  mangled: boolean;
  rowCount: number;
}

/** Which CSV column holds which field, for exports Debrief doesn't know. */
export interface RoundTripMapping {
  layout: "roundtrip";
  symbol: string;
  side?: string;
  qty?: string;
  entryPrice?: string;
  exitPrice?: string;
  pnl?: string;
  entryTime?: string;
  exitTime?: string;
  account?: string;
  /** Swap long/short for every row. */
  flip?: boolean;
}

export interface FillMapping {
  layout: "fills";
  symbol: string;
  side: string;
  qty: string;
  price: string;
  time: string;
  account?: string;
  status?: string;
  commission?: string;
}

export type ColumnMapping = RoundTripMapping | FillMapping;

export function emptyParsed(detection: Detection, rowCount = 0): ParsedFile {
  return {
    detection,
    executions: [],
    cash: [],
    orders: [],
    warnings: [],
    skippedRows: 0,
    openPositions: 0,
    mangled: false,
    rowCount,
  };
}
