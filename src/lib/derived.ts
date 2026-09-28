import { newsCoverage } from "../../shared/news";
import { evaluateAll, type DayEvaluation, type Evaluation } from "../../shared/rules/evaluate";
import type { AppData } from "../../shared/store/data";
import { accountsOf, buildTrades } from "../../shared/trades/roundtrips";
import type { Trade } from "../../shared/types";
import { useStore } from "./store";

// Everything computed from your saved data: trades, rule grades, days. It is
// recomputed only when an input actually changes, and shared by every screen.

export interface Derived {
  /** All trades across all accounts, oldest first. */
  allTrades: Trade[];
  /** Trades in the account picked in the top bar ("" = all). */
  trades: Trade[];
  accounts: string[];
  evaluation: Evaluation;
  newsDays: Set<string>;
  /** Trading days that have trades (in the current account view), newest first. */
  days: string[];
  tradeByKey: Map<string, Trade>;
  dayEvaluations: (day: string) => DayEvaluation[];
}

let last: { inputs: unknown[]; value: Derived } | null = null;

function inputsOf(d: AppData): unknown[] {
  return [
    d.executions,
    d.cash,
    d.orders,
    d.rules,
    d.news,
    d.journal,
    d.tradeNotes,
    d.settings.timezone,
    d.settings.dayGrouping,
    d.settings.commissionPerSide,
    d.settings.account,
  ];
}

export function derive(d: AppData): Derived {
  const inputs = inputsOf(d);
  if (last && last.inputs.length === inputs.length && last.inputs.every((v, i) => v === inputs[i])) return last.value;

  const allTrades = buildTrades(d.executions, {
    timezone: d.settings.timezone,
    dayGrouping: d.settings.dayGrouping,
    commissionPerSide: d.settings.commissionPerSide,
    cash: d.cash,
  });
  const accounts = accountsOf(d.executions);
  const account = d.settings.account && accounts.includes(d.settings.account) ? d.settings.account : "";
  const trades = account ? allTrades.filter((t) => t.account === account) : allTrades;
  const newsDays = newsCoverage(d.news, d.settings.timezone, d.settings.dayGrouping);
  const evaluation = evaluateAll(allTrades, d.rules, {
    news: d.news,
    newsDays,
    orders: d.orders,
    journal: d.journal,
    tradeNotes: d.tradeNotes,
  });
  const days = [...new Set(trades.map((t) => t.day))].sort().reverse();
  const tradeByKey = new Map(allTrades.map((t) => [t.key, t]));
  const value: Derived = {
    allTrades,
    trades,
    accounts,
    evaluation,
    newsDays,
    days,
    tradeByKey,
    dayEvaluations: (day: string) =>
      (evaluation.byDay.get(day) ?? []).filter((e) => !account || e.account === account),
  };
  last = { inputs, value };
  return value;
}

export function useDerived(): Derived {
  const data = useStore((s) => s.data);
  return derive(data);
}

/** Trades whose entry falls in [fromDay, toDay] (inclusive, YYYY-MM-DD). */
export function inRange(trades: Trade[], fromDay: string | null, toDay: string | null): Trade[] {
  return trades.filter((t) => (!fromDay || t.day >= fromDay) && (!toDay || t.day <= toDay));
}
