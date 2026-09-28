import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeFile } from "../shared/import/index";
import { applyImport } from "../shared/store/applyImport";
import { defaultData, type AppData } from "../shared/store/data";
import { buildTrades } from "../shared/trades/roundtrips";
import type { Execution, Trade } from "../shared/types";
import { wallToMs } from "../shared/util/time";

export const TZ = "America/New_York";

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

export function freshData(): AppData {
  const d = defaultData();
  d.settings.timezone = TZ;
  d.settings.dayGrouping = "cme";
  return d;
}

export function importFixtures(names: string[], start = freshData()): AppData {
  let data = start;
  for (const name of names) {
    const a = analyzeFile(fixture(name), name, { tz: data.settings.timezone });
    if (!a.parsed) throw new Error(`${name} needs a column mapping`);
    data = applyImport(data, a.parsed, { fileName: name, via: "file" }).data;
  }
  return data;
}

export function tradesOf(data: AppData): Trade[] {
  return buildTrades(data.executions, {
    timezone: data.settings.timezone,
    dayGrouping: data.settings.dayGrouping,
    commissionPerSide: data.settings.commissionPerSide,
    cash: data.cash,
  });
}

/** New York wall clock → epoch ms, for building test trades. */
export function ny(y: number, mo: number, d: number, h: number, mi: number, s = 0): number {
  return wallToMs(TZ, y, mo, d, h, mi, s);
}

let n = 0;
/** A minimal trade for rule and stats tests. Times are minutes after 9:30 ET on 2026-08-13. */
export function trade(p: Partial<Trade> & { at?: number; mins?: number; net: number }): Trade {
  const base = Date.UTC(2026, 7, 13, 13, 30); // 9:30 New York (EDT = UTC-4)
  const entry = base + (p.at ?? 0) * 60_000;
  const exit = entry + (p.mins ?? 2) * 60_000;
  const exec: Execution = {
    id: `t${++n}`,
    symbol: "MNQU6",
    root: "MNQ",
    side: "Long",
    qty: p.peakQty ?? 1,
    entryPrice: 100,
    exitPrice: 100,
    entryTime: entry,
    exitTime: exit,
    pnl: p.net,
    precision: "second",
    importId: "test",
    format: "tradovate-performance",
  };
  return {
    key: exec.id,
    account: "A1",
    symbol: "MNQU6",
    root: "MNQ",
    side: "Long",
    entryTime: entry,
    exitTime: exit,
    holdMs: exit - entry,
    qty: p.peakQty ?? 1,
    peakQty: p.peakQty ?? 1,
    avgEntry: 100,
    avgExit: 100,
    pnl: p.net,
    commission: 0,
    commissionSource: "none",
    day: "2026-08-13",
    seq: 0,
    executions: [exec],
    sideUncertain: false,
    precision: "second",
    ...p,
  };
}

/** Assign per-day sequence numbers the way buildTrades does. */
export function sequence(trades: Trade[]): Trade[] {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  sorted.forEach((t, i) => (t.seq = i + 1));
  return sorted;
}
