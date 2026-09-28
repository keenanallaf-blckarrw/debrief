import type { CashEvent, Execution, Settings, Trade } from "../types";
import { round2 } from "../util/numbers";
import { tradingDay } from "../util/time";

// Executions → round-trip trades. A trade runs from flat to flat: every fill
// pair that overlaps in time, or shares the same entry fill or exit fill, belongs
// to the same trade (scaling in and out). Size is the peak position.

export interface BuildOptions {
  timezone: string;
  dayGrouping: Settings["dayGrouping"];
  commissionPerSide: number;
  cash?: CashEvent[];
}

/** Spread each day's commissions and fees over that day's fills, by contracts. */
function allocateCosts(executions: Execution[], opts: BuildOptions, dayOf: (ms: number) => string): Map<string, number> {
  const out = new Map<string, number>();
  const costEvents = (opts.cash ?? []).filter((c) => c.kind === "commission" || c.kind === "fee");
  const withAcct = new Map<string, number>();
  const anyAcct = new Map<string, number>();
  for (const c of costEvents) {
    const day = dayOf(c.time);
    const root = c.root ?? "";
    const cost = -c.amount; // ledger lines are negative
    withAcct.set(`${c.account ?? ""}|${root}|${day}`, (withAcct.get(`${c.account ?? ""}|${root}|${day}`) ?? 0) + cost);
    anyAcct.set(`${root}|${day}`, (anyAcct.get(`${root}|${day}`) ?? 0) + cost);
  }
  if (costEvents.length) {
    const groups = new Map<string, Execution[]>();
    for (const e of executions) {
      const day = dayOf(e.entryTime);
      const key = e.account && withAcct.has(`${e.account}|${e.root}|${day}`) ? `A|${e.account}|${e.root}|${day}` : `R|${e.root}|${day}`;
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    for (const [key, list] of groups) {
      const [, a, b, c] = key.split("|");
      const total = key.startsWith("A|") ? withAcct.get(`${a}|${b}|${c}`) ?? 0 : anyAcct.get(`${a}|${b}`) ?? 0;
      if (!total) continue;
      const qty = list.reduce((s, e) => s + e.qty, 0);
      for (const e of list) out.set(e.id, (total * e.qty) / qty);
    }
  }
  return out;
}

export function buildTrades(executions: Execution[], opts: BuildOptions): Trade[] {
  const dayOf = (ms: number) => tradingDay(ms, opts.timezone, opts.dayGrouping);
  const ledger = allocateCosts(executions, opts, dayOf);
  const ledgerHasRows = ledger.size > 0;

  const groups = new Map<string, Execution[]>();
  for (const e of executions) {
    const key = `${e.account ?? ""}|${e.symbol}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const trades: Trade[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.entryTime - b.entryTime || a.exitTime - b.exitTime || a.id.localeCompare(b.id));
    let current: Execution[] = [];
    let maxExit = -Infinity;
    const flush = () => {
      if (current.length) trades.push(toTrade(current, opts, ledger, ledgerHasRows, dayOf));
      current = [];
      maxExit = -Infinity;
    };
    for (const e of list) {
      if (current.length) {
        const sameSide = current[0].side === e.side;
        const overlaps = e.entryTime < maxExit;
        const sharesEntry = current.some((x) => x.entryTime === e.entryTime && x.entryPrice === e.entryPrice);
        const sharesExit = current.some((x) => x.exitTime === e.exitTime && x.exitPrice === e.exitPrice);
        if (!sameSide || !(overlaps || sharesEntry || sharesExit)) flush();
      }
      current.push(e);
      maxExit = Math.max(maxExit, e.exitTime);
    }
    flush();
  }

  trades.sort((a, b) => a.entryTime - b.entryTime || a.key.localeCompare(b.key));
  const counters = new Map<string, number>();
  for (const t of trades) {
    const k = `${t.account ?? ""}|${t.day}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    t.seq = n;
  }
  return trades;
}

function toTrade(
  list: Execution[],
  opts: BuildOptions,
  ledger: Map<string, number>,
  ledgerHasRows: boolean,
  dayOf: (ms: number) => string,
): Trade {
  const first = list[0];
  const qty = list.reduce((s, e) => s + e.qty, 0);
  const entryTime = Math.min(...list.map((e) => e.entryTime));
  const exitTime = Math.max(...list.map((e) => e.exitTime));
  const avgEntry = list.reduce((s, e) => s + e.entryPrice * e.qty, 0) / qty;
  const avgExit = list.reduce((s, e) => s + e.exitPrice * e.qty, 0) / qty;
  const pnl = list.reduce((s, e) => s + e.pnl, 0);

  // Peak position: +qty at each entry, -qty at each exit; exits first on ties.
  const events = list.flatMap((e) => [
    { t: e.entryTime, d: e.qty },
    { t: e.exitTime, d: -e.qty },
  ]);
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let open = 0;
  let peakQty = 0;
  for (const ev of events) {
    open += ev.d;
    peakQty = Math.max(peakQty, open);
  }
  if (peakQty <= 0) peakQty = Math.max(...list.map((e) => e.qty));

  let commission = 0;
  let commissionSource: Trade["commissionSource"] = "none";
  const fromLedger = list.map((e) => ledger.get(e.id)).filter((v): v is number => v !== undefined);
  if (ledgerHasRows && fromLedger.length) {
    commission = fromLedger.reduce((s, v) => s + v, 0);
    commissionSource = "cash-history";
  } else if (opts.commissionPerSide > 0) {
    commission = qty * 2 * opts.commissionPerSide;
    commissionSource = "estimate";
  }
  commission = round2(commission);

  return {
    key: first.id,
    account: first.account,
    symbol: first.symbol,
    root: first.root,
    side: first.side,
    entryTime,
    exitTime,
    holdMs: Math.max(0, exitTime - entryTime),
    qty,
    peakQty,
    avgEntry,
    avgExit,
    pnl: round2(pnl),
    commission,
    commissionSource,
    net: round2(pnl - commission),
    day: dayOf(entryTime),
    seq: 0,
    executions: list,
    sideUncertain: list.some((e) => e.sideUncertain),
    precision: list.some((e) => e.precision === "minute") ? "minute" : "second",
  };
}

export function accountsOf(executions: Execution[]): string[] {
  return [...new Set(executions.map((e) => e.account).filter((a): a is string => Boolean(a)))].sort();
}

/** Mask an account id for display: "DEMO000012345678" → "…5678". */
export function maskAccount(account?: string): string {
  if (!account) return "Unknown account";
  return account.length > 6 ? `…${account.slice(-4)}` : account;
}
