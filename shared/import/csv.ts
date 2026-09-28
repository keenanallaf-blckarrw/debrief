import Papa from "papaparse";

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

/** Lowercase letters and digits only, so "Bought Timestamp" == "boughtTimestamp". */
export function norm(header: string): string {
  return String(header ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse CSV/TSV text into trimmed rows. Handles a byte-order mark, quoted
 * commas ("2,327.50"), blank lines and duplicate headers (renamed "Price_1").
 */
export function readCsv(text: string): CsvTable {
  const src = String(text ?? "").replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(src, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  const headers = (result.meta.fields ?? []).filter((h) => h !== "");
  const rows = result.data.filter((r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""));
  return { headers, rows };
}

/** Find the first header whose normalized name equals one of `names`. */
export function pick(headers: string[], ...names: string[]): string | undefined {
  const wanted = names.map(norm);
  for (const w of wanted) {
    const hit = headers.find((h) => norm(h) === w);
    if (hit) return hit;
  }
  return undefined;
}

/** Like `pick`, but also accepts headers that contain one of the fragments. */
export function pickLoose(headers: string[], ...fragments: string[]): string | undefined {
  const exact = pick(headers, ...fragments);
  if (exact) return exact;
  for (const f of fragments.map(norm)) {
    const hit = headers.find((h) => norm(h).includes(f));
    if (hit) return hit;
  }
  return undefined;
}
