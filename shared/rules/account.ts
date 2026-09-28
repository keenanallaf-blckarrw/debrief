import type { AccountGuard, Trade } from "../types";

// Prop-firm style account limits. Most evaluations are failed by a risk limit,
// not a bad strategy, so the Account Guard shows how close you are to each one.
// Everything is computed from closed trades (realized P&L); open-trade swings
// that firms also count are not in your exports.

export interface GuardBreach {
  kind: "dailyLoss" | "drawdown" | "maxContracts" | "consistency";
  day: string;
  message: string;
  tradeKey?: string;
}

export interface GuardDay {
  day: string;
  net: number;
  balance: number;
  threshold: number | null;
}

export interface GuardStatus {
  guard: AccountGuard;
  trades: number;
  balance: number;
  peakBalance: number;
  /** Balance at which the account fails the drawdown rule (null if no drawdown rule). */
  threshold: number | null;
  /** Dollars left before the drawdown threshold. */
  drawdownRoom: number | null;
  profit: number;
  targetProgress: number | null;
  today: { day: string; net: number; lossRoom: number | null } | null;
  bestDay: { day: string; net: number } | null;
  consistency: { bestDayShare: number; ok: boolean } | null;
  breaches: GuardBreach[];
  days: GuardDay[];
  status: "ok" | "warning" | "breached" | "passed";
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

export function guardTrades(guard: AccountGuard, trades: Trade[]): Trade[] {
  return trades
    .filter((t) => (!guard.account || t.account === guard.account) && (!guard.startDay || t.day >= guard.startDay))
    .sort((a, b) => a.exitTime - b.exitTime);
}

export function evaluateGuard(guard: AccountGuard, allTrades: Trade[], today?: string): GuardStatus {
  const trades = guardTrades(guard, allTrades);
  const start = guard.startBalance;
  const dd = guard.maxDrawdown && guard.maxDrawdown > 0 ? guard.maxDrawdown : null;
  const breaches: GuardBreach[] = [];

  let balance = start;
  let peak = start;
  let eodPeak = start;
  let threshold: number | null = dd === null ? null : start - dd;
  const lock = (th: number) => (guard.lockAtStart ? Math.min(th, start) : th);

  const dayNet = new Map<string, number>();
  const days: GuardDay[] = [];
  let currentDay = "";
  let drawdownBreached = false;

  const closeDay = () => {
    if (!currentDay) return;
    if (guard.drawdownMode === "trailingEod" && dd !== null) {
      eodPeak = Math.max(eodPeak, balance);
      threshold = lock(eodPeak - dd);
    }
    days.push({ day: currentDay, net: dayNet.get(currentDay) ?? 0, balance, threshold });
  };

  for (const t of trades) {
    if (t.day !== currentDay) {
      closeDay();
      currentDay = t.day;
    }
    const before = dayNet.get(t.day) ?? 0;
    const after = before + t.net;
    dayNet.set(t.day, after);
    balance += t.net;
    peak = Math.max(peak, balance);
    if (guard.drawdownMode === "trailingIntraday" && dd !== null) threshold = lock(peak - dd);

    if (guard.dailyLossLimit && before > -guard.dailyLossLimit && after <= -guard.dailyLossLimit) {
      breaches.push({
        kind: "dailyLoss",
        day: t.day,
        tradeKey: t.key,
        message: `Daily loss limit hit: the day reached -${money(after)} (limit ${money(guard.dailyLossLimit)}).`,
      });
    }
    if (threshold !== null && !drawdownBreached && balance <= threshold) {
      drawdownBreached = true;
      breaches.push({
        kind: "drawdown",
        day: t.day,
        tradeKey: t.key,
        message: `Drawdown limit hit: balance ${money(balance)} fell to the ${money(threshold)} threshold.`,
      });
    }
    if (guard.maxContracts && t.peakQty > guard.maxContracts) {
      breaches.push({
        kind: "maxContracts",
        day: t.day,
        tradeKey: t.key,
        message: `${t.peakQty} contracts is over the account's ${guard.maxContracts}-contract limit.`,
      });
    }
  }
  closeDay();

  const profit = balance - start;
  let bestDay: GuardStatus["bestDay"] = null;
  for (const [day, net] of dayNet) if (!bestDay || net > bestDay.net) bestDay = { day, net };

  let consistency: GuardStatus["consistency"] = null;
  if (guard.consistencyPct && profit > 0 && bestDay && bestDay.net > 0) {
    const share = (bestDay.net / profit) * 100;
    const ok = share <= guard.consistencyPct;
    consistency = { bestDayShare: Math.round(share), ok };
    if (!ok) {
      breaches.push({
        kind: "consistency",
        day: bestDay.day,
        message: `Consistency rule: your best day is ${Math.round(share)}% of total profit (max ${guard.consistencyPct}%).`,
      });
    }
  }

  const todayKey = today ?? [...dayNet.keys()].sort().pop();
  const todayNet = todayKey ? dayNet.get(todayKey) ?? 0 : 0;
  const drawdownRoom = threshold === null ? null : balance - threshold;
  const targetProgress = guard.profitTarget ? Math.max(0, profit / guard.profitTarget) : null;

  let status: GuardStatus["status"] = "ok";
  const nearDaily = guard.dailyLossLimit ? todayNet <= -guard.dailyLossLimit * 0.7 : false;
  const nearDrawdown = dd !== null && drawdownRoom !== null ? drawdownRoom <= dd * 0.3 : false;
  if (nearDaily || nearDrawdown) status = "warning";
  if (breaches.some((b) => b.kind === "drawdown" || b.kind === "dailyLoss")) status = "breached";
  if (status !== "breached" && targetProgress !== null && targetProgress >= 1 && (!consistency || consistency.ok)) status = "passed";

  return {
    guard,
    trades: trades.length,
    balance,
    peakBalance: peak,
    threshold,
    drawdownRoom,
    profit,
    targetProgress,
    today: todayKey
      ? { day: todayKey, net: todayNet, lossRoom: guard.dailyLossLimit ? guard.dailyLossLimit + todayNet : null }
      : null,
    bestDay,
    consistency,
    breaches,
    days,
    status,
  };
}

/** Starting balance from Cash History: the first deposit for the account. */
export function detectStartBalance(
  cash: { account?: string; kind: string; amount: number; time: number }[],
  account: string,
): number | null {
  const deposits = cash
    .filter((c) => c.kind === "deposit" && c.amount > 0 && (!account || c.account === account))
    .sort((a, b) => a.time - b.time);
  return deposits.length ? deposits[0].amount : null;
}
