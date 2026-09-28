import type { Execution, FormatId } from "../types";
import { tradingDay } from "../util/time";

// Traders download the same report many times ("Position History (5).csv"), and
// several reports cover the same fills. Two things keep the journal clean:
//
// 1. Fingerprints. Two executions are the same when the product, size, buy and
//    sell prices, and buy and sell minutes match. Minutes (not seconds) because a
//    spreadsheet re-save strips seconds, and direction is left out because it is
//    only a guess in those files. Exact fill ids break ties when both have them.
//    Matching is one-to-one, so a file with two identical rows keeps both.
//
// 2. Source priority. Tradovate's own pairs (Position History / Performance) beat
//    pairs Debrief rebuilt from an Orders export (whose average fill prices can
//    differ slightly), and both beat AI-extracted trades. For each product and
//    trading day, only the best source is kept.

export const SOURCE_PRIORITY: Record<FormatId, number> = {
  "tradovate-position-history": 3,
  "tradovate-performance": 3,
  "generic-roundtrip": 3,
  "tradovate-orders": 2,
  "tradingview-orders": 2,
  "generic-fills": 2,
  "ai-extracted": 1,
  "tradovate-cash-history": 0,
  "tradingview-notifications": 0,
  sample: 0,
};

type Comparable = Pick<
  Execution,
  "root" | "side" | "qty" | "entryPrice" | "exitPrice" | "entryTime" | "exitTime" | "account" | "fillIds" | "precision" | "sideUncertain"
>;

const minute = (ms: number) => Math.floor(ms / 60_000);
const px = (n: number) => Math.round(n * 1e6) / 1e6;

export function fingerprint(e: Comparable): string {
  const long = e.side === "Long";
  const buyPrice = long ? e.entryPrice : e.exitPrice;
  const sellPrice = long ? e.exitPrice : e.entryPrice;
  const buyTime = long ? e.entryTime : e.exitTime;
  const sellTime = long ? e.exitTime : e.entryTime;
  return [e.root, px(e.qty), px(buyPrice), px(sellPrice), minute(buyTime), minute(sellTime)].join("|");
}

function accountsCompatible(a?: string, b?: string): boolean {
  return !a || !b || a === b;
}

function idsConflict(a: Comparable, b: Comparable): boolean {
  const ab = a.fillIds?.buy, bb = b.fillIds?.buy, as = a.fillIds?.sell, bs = b.fillIds?.sell;
  return Boolean((ab && bb && ab !== bb) || (as && bs && as !== bs));
}

/** Fields worth copying from a duplicate that is more precise than what we hold. */
export function upgradeFrom(existing: Execution, incoming: Comparable): Partial<Execution> | null {
  const patch: Partial<Execution> = {};
  if (existing.precision === "minute" && incoming.precision === "second") {
    patch.entryTime = incoming.entryTime;
    patch.exitTime = incoming.exitTime;
    patch.precision = "second";
    patch.side = incoming.side;
    patch.entryPrice = incoming.entryPrice;
    patch.exitPrice = incoming.exitPrice;
    if (existing.sideUncertain && !incoming.sideUncertain) patch.sideUncertain = false;
  } else if (existing.sideUncertain && !incoming.sideUncertain) {
    patch.side = incoming.side;
    patch.entryPrice = incoming.entryPrice;
    patch.exitPrice = incoming.exitPrice;
    patch.entryTime = incoming.entryTime;
    patch.exitTime = incoming.exitTime;
    patch.sideUncertain = false;
  }
  if (!existing.account && incoming.account) patch.account = incoming.account;
  if (!existing.fillIds && incoming.fillIds) patch.fillIds = incoming.fillIds;
  return Object.keys(patch).length ? patch : null;
}

export interface MergePlan<T extends Comparable> {
  add: T[];
  duplicates: number;
  /** existing id → fields to update */
  upgrades: Map<string, Partial<Execution>>;
  /** existing ids replaced by a better source */
  remove: Set<string>;
  /** incoming rows dropped because a better source already covers that day */
  shadowed: number;
}

export function planMerge<T extends Comparable>(
  existing: Execution[],
  incoming: T[],
  incomingFormat: FormatId,
  dayOf: (ms: number) => string,
): MergePlan<T> {
  const plan: MergePlan<T> = { add: [], duplicates: 0, upgrades: new Map(), remove: new Set(), shadowed: 0 };
  const incomingPriority = SOURCE_PRIORITY[incomingFormat] ?? 1;

  // Source priority per product + trading day.
  const groupKey = (e: Comparable) => `${e.root}|${dayOf(e.entryTime)}`;
  const bestExisting = new Map<string, number>();
  for (const e of existing) {
    const k = groupKey(e);
    bestExisting.set(k, Math.max(bestExisting.get(k) ?? 0, SOURCE_PRIORITY[e.format] ?? 1));
  }
  const incomingGroups = new Set(incoming.map(groupKey));
  const candidates: T[] = [];
  for (const e of incoming) {
    const best = bestExisting.get(groupKey(e)) ?? 0;
    if (best > incomingPriority) plan.shadowed++;
    else candidates.push(e);
  }
  const pool: Execution[] = [];
  for (const e of existing) {
    const k = groupKey(e);
    const p = SOURCE_PRIORITY[e.format] ?? 1;
    if (incomingGroups.has(k) && p < incomingPriority && p > 0) plan.remove.add(e.id);
    else pool.push(e);
  }

  // One-to-one fingerprint matching against what's already stored.
  const index = new Map<string, Execution[]>();
  for (const e of pool) {
    const k = fingerprint(e);
    const list = index.get(k);
    if (list) list.push(e);
    else index.set(k, [e]);
  }
  const used = new Set<string>();
  for (const e of candidates) {
    const list = index.get(fingerprint(e)) ?? [];
    const match = list.find((x) => !used.has(x.id) && accountsCompatible(x.account, e.account) && !idsConflict(x, e));
    if (match) {
      used.add(match.id);
      plan.duplicates++;
      const patch = upgradeFrom(match, e);
      if (patch) plan.upgrades.set(match.id, patch);
    } else {
      plan.add.push(e);
    }
  }
  return plan;
}

/** Convenience for callers that only know the grouping settings. */
export function dayGrouper(tz: string, grouping: "cme" | "midnight") {
  return (ms: number) => tradingDay(ms, tz, grouping);
}
