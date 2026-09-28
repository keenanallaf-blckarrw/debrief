import { dayGrouper, fingerprint, planMerge } from "../import/dedupe";
import type { ParsedFile } from "../import/types";
import type { CashEvent, Execution, ImportRecord, OrderEvent } from "../types";
import { hash, uid } from "../util/hash";
import type { AppData } from "./data";

export interface ImportMeta {
  fileName: string;
  via: ImportRecord["via"];
  now?: number;
}

export interface ImportOutcome {
  data: AppData;
  record: ImportRecord;
  /** One plain sentence for a toast, e.g. "Added 12 trades from …". */
  summary: string;
  removedSample: boolean;
}

// Stable ids: the same row always gets the same id, so undoing and re-importing
// a file keeps your notes attached to its trades.
function executionId(e: Omit<Execution, "id" | "importId" | "format">, nth: number): string {
  return `x${hash(`${fingerprint(e)}|${e.account ?? ""}|${nth}`)}`;
}

function cashKey(c: Omit<CashEvent, "id" | "importId">): string {
  return `${c.account ?? ""}|${c.time}|${c.kind}|${c.amount}|${c.symbol ?? ""}`;
}

function orderKey(o: Omit<OrderEvent, "id" | "importId">): string {
  return `${o.account ?? ""}|${o.orderId ?? ""}|${o.symbol}|${o.time}|${o.action}|${o.type}|${o.side}|${o.price ?? ""}|${o.qty ?? ""}`;
}

/** Count-aware "only add what isn't there yet", for ledger lines and order events. */
function addMissing<T>(existing: T[], incoming: T[], key: (t: T) => string): T[] {
  const have = new Map<string, number>();
  for (const e of existing) have.set(key(e), (have.get(key(e)) ?? 0) + 1);
  const out: T[] = [];
  for (const i of incoming) {
    const k = key(i);
    const n = have.get(k) ?? 0;
    if (n > 0) have.set(k, n - 1);
    else out.push(i);
  }
  return out;
}

export function applyImport(data: AppData, parsed: ParsedFile, meta: ImportMeta): ImportOutcome {
  const now = meta.now ?? Date.now();
  const importId = uid("imp_");
  const format = parsed.detection.format ?? "generic-roundtrip";
  const isSample = format === "sample";
  const dayOf = dayGrouper(data.settings.timezone, data.settings.dayGrouping);

  // A real import replaces the sample data used for the tour.
  let base = data;
  let removedSample = false;
  if (!isSample && parsed.executions.length && hasSample(data)) {
    base = removeSample(data);
    removedSample = true;
  }

  const plan = planMerge(base.executions, parsed.executions, format, dayOf);
  const seen = new Map<string, number>();
  const taken = new Set(base.executions.map((e) => e.id));
  const added: Execution[] = plan.add.map((e) => {
    const fp = `${fingerprint(e)}|${e.account ?? ""}`;
    let nth = seen.get(fp) ?? 0;
    let id = executionId(e, nth);
    while (taken.has(id)) id = executionId(e, ++nth);
    seen.set(fp, nth + 1);
    taken.add(id);
    return { ...e, id, importId, format };
  });

  const executions = base.executions
    .filter((e) => !plan.remove.has(e.id))
    .map((e) => (plan.upgrades.has(e.id) ? { ...e, ...plan.upgrades.get(e.id) } : e))
    .concat(added);

  const newCash = addMissing(base.cash, parsed.cash.map((c) => ({ ...c, id: "", importId })), cashKey).map(
    (c, i) => ({ ...c, id: `c${hash(`${importId}|${cashKey(c)}|${i}`)}` }),
  );
  const newOrders = addMissing(base.orders, parsed.orders.map((o) => ({ ...o, id: "", importId })), orderKey).map(
    (o, i) => ({ ...o, id: `o${hash(`${importId}|${orderKey(o)}|${i}`)}` }),
  );

  const times = added.flatMap((e) => [e.entryTime, e.exitTime]).concat(newCash.map((c) => c.time));
  const accounts = [
    ...new Set(
      [...parsed.executions.map((e) => e.account), ...parsed.cash.map((c) => c.account)].filter((a): a is string => Boolean(a)),
    ),
  ];
  const record: ImportRecord = {
    id: importId,
    fileName: meta.fileName,
    format,
    formatLabel: parsed.detection.label,
    importedAt: now,
    via: meta.via,
    added: { executions: added.length, cash: newCash.length, orders: newOrders.length },
    duplicates: plan.duplicates,
    upgraded: plan.upgrades.size,
    replaced: plan.remove.size,
    skippedRows: parsed.skippedRows,
    warnings: [...parsed.warnings],
    range: times.length ? { from: Math.min(...times), to: Math.max(...times) } : undefined,
    accounts,
  };
  if (plan.shadowed) {
    record.warnings.push(
      `${plan.shadowed} fill ${plan.shadowed === 1 ? "pair was" : "pairs were"} already covered by a more precise export for the same days, so Debrief kept those.`,
    );
  }

  const next: AppData = {
    ...base,
    executions,
    cash: base.cash.concat(newCash),
    orders: base.orders.concat(newOrders),
    imports: [record, ...base.imports],
  };
  return { data: next, record, summary: summarize(record), removedSample };
}

export function summarize(r: ImportRecord): string {
  const parts: string[] = [];
  if (r.added.executions) parts.push(`${r.added.executions} new fill ${r.added.executions === 1 ? "pair" : "pairs"}`);
  if (r.added.cash) parts.push(`${r.added.cash} ledger ${r.added.cash === 1 ? "line" : "lines"}`);
  if (r.added.orders) parts.push(`${r.added.orders} order ${r.added.orders === 1 ? "event" : "events"}`);
  const what = parts.length ? `Added ${parts.join(", ")}` : "Nothing new";
  const dup = r.duplicates ? ` · ${r.duplicates} already in your journal` : "";
  const up = r.upgraded ? ` · ${r.upgraded} made more precise` : "";
  return `${what} from ${r.fileName}${dup}${up}.`;
}

/** Undo an import: remove exactly what it added. */
export function removeImport(data: AppData, importId: string): AppData {
  return {
    ...data,
    executions: data.executions.filter((e) => e.importId !== importId),
    cash: data.cash.filter((c) => c.importId !== importId),
    orders: data.orders.filter((o) => o.importId !== importId),
    imports: data.imports.filter((r) => r.id !== importId),
  };
}

export function hasSample(data: AppData): boolean {
  return data.executions.some((e) => e.format === "sample");
}

export function removeSample(data: AppData): AppData {
  const ids = new Set(data.imports.filter((r) => r.format === "sample").map((r) => r.id));
  return {
    ...data,
    executions: data.executions.filter((e) => e.format !== "sample"),
    cash: data.cash.filter((c) => !ids.has(c.importId)),
    orders: data.orders.filter((o) => !ids.has(o.importId)),
    imports: data.imports.filter((r) => r.format !== "sample"),
    debriefs: Object.fromEntries(Object.entries(data.debriefs).filter(([, d]) => !d.sample)),
    news: data.news.filter((n) => !n.id.startsWith("sample:")),
  };
}
