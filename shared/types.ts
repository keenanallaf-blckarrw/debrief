// Core data shapes shared by the browser app and the companion.
//
// Vocabulary used everywhere in Debrief:
// - A *fill* is one execution at the broker (buy 5 @ 30130.50).
// - An *execution* is a matched entry + exit pair of fills. Tradovate exports
//   these directly ("Position History", "Performance"); order/fill exports are
//   turned into pairs with FIFO matching.
// - A *trade* is a full round trip, flat to flat, built from one or more
//   executions (scale-ins and scale-outs belong to the same trade).

export type Side = "Long" | "Short";
export type BuySell = "Buy" | "Sell";
export type TimePrecision = "second" | "minute";

export type FormatId =
  | "tradovate-position-history"
  | "tradovate-performance"
  | "tradovate-orders"
  | "tradovate-cash-history"
  | "tradingview-orders"
  | "tradingview-notifications"
  | "generic-fills"
  | "generic-roundtrip"
  | "ai-extracted"
  | "sample";

export interface Execution {
  id: string;
  account?: string;
  /** Contract or ticker as exported, e.g. "MNQU6" or "CME_MINI:MNQ1!". */
  symbol: string;
  /** Product root used for specs and matching, e.g. "MNQ". */
  root: string;
  side: Side;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  /** Epoch milliseconds. */
  entryTime: number;
  exitTime: number;
  /** Gross P&L in account currency, before commissions. */
  pnl: number;
  currency?: string;
  /** "minute" when the file lost its seconds (usually re-saved in Excel/Numbers). */
  precision: TimePrecision;
  /** Set when entry and exit share a timestamp, so direction was a best guess. */
  sideUncertain?: boolean;
  fillIds?: { buy?: string; sell?: string };
  importId: string;
  format: FormatId;
}

export type CashKind = "commission" | "fee" | "deposit" | "withdrawal" | "pnl" | "other";

/** A cash ledger line (Tradovate "Cash History"): commissions, fees, deposits. */
export interface CashEvent {
  id: string;
  account?: string;
  time: number;
  kind: CashKind;
  /** Signed as exported: commissions and fees are negative. */
  amount: number;
  symbol?: string;
  root?: string;
  importId: string;
}

export type OrderType = "Market" | "Limit" | "Stop" | "StopLimit" | "Other";
export type OrderAction = "placed" | "modified" | "cancelled" | "filled" | "partial" | "rejected";

/** One step in an order's life. Used to find stop losses and stop moves. */
export interface OrderEvent {
  id: string;
  account?: string;
  symbol: string;
  root: string;
  orderId?: string;
  time: number;
  action: OrderAction;
  type: OrderType;
  /** True for stop-loss / take-profit brackets that TradingView labels as such. */
  bracket?: "stopLoss" | "takeProfit";
  side: BuySell;
  qty?: number;
  price?: number;
  importId: string;
}

export interface ImportRecord {
  id: string;
  fileName: string;
  format: FormatId;
  formatLabel: string;
  importedAt: number;
  via: "file" | "paste" | "auto" | "sample" | "ai";
  added: { executions: number; cash: number; orders: number };
  duplicates: number;
  upgraded: number;
  replaced: number;
  skippedRows: number;
  warnings: string[];
  range?: { from: number; to: number };
  accounts: string[];
}

/** A round trip, derived from executions. Never stored; always recomputed. */
export interface Trade {
  /** Stable id: the id of the trade's first execution. Notes are keyed by it. */
  key: string;
  account?: string;
  symbol: string;
  root: string;
  side: Side;
  entryTime: number;
  exitTime: number;
  holdMs: number;
  /** Total contracts entered across all fills. */
  qty: number;
  /** Most contracts open at one moment. This is the trade's "size". */
  peakQty: number;
  avgEntry: number;
  avgExit: number;
  pnl: number;
  commission: number;
  commissionSource: "cash-history" | "estimate" | "none";
  net: number;
  /** Trading day, YYYY-MM-DD (CME day rolls at 6 PM New York by default). */
  day: string;
  /** 1-based position among this account's trades that day. */
  seq: number;
  executions: Execution[];
  sideUncertain: boolean;
  precision: TimePrecision;
}

export interface Profile {
  name: string;
  markets: string[];
  strategies: string[];
  /** The trader's rules in their own words. Context for the AI coach. */
  rulesText: string;
}

export interface Settings {
  /** Timezone your platform writes export timestamps in, and the one Debrief displays. */
  timezone: string;
  /** "cme" groups evening futures sessions into the next trading day, like your broker. */
  dayGrouping: "cme" | "midnight";
  /** Dollars per contract per side, used only when no Cash History is imported. */
  commissionPerSide: number;
  /** Run the AI debrief automatically after an auto-import. */
  autoDebrief: boolean;
  /** Save price candles for new trades while they are still available. */
  prefetchCharts: boolean;
  plan: "free" | "pro";
  /** Account filter applied across the app; "" means all accounts. */
  account: string;
}

export type ManualMark = "followed" | "broken";

export type RuleKind =
  | "maxTradesPerDay"
  | "maxContracts"
  | "dailyLossLimit"
  | "dailyProfitTarget"
  | "maxConsecutiveLosses"
  | "tradingWindow"
  | "newsBuffer"
  | "revengeCooldown"
  | "noSizeUpAfterLoss"
  | "maxLossPerTrade"
  | "allowedInstruments"
  | "stopRequired"
  | "noStopWidening"
  | "manual";

export interface TimeWindow {
  /** "HH:MM", 24-hour clock, in the rule's timezone. */
  start: string;
  end: string;
}

export interface RuleParamsMap {
  maxTradesPerDay: { max: number };
  maxContracts: { max: number };
  dailyLossLimit: { amount: number };
  dailyProfitTarget: { amount: number };
  maxConsecutiveLosses: { max: number };
  tradingWindow: { windows: TimeWindow[]; timezone: string };
  newsBuffer: { minutes: number; minImpact: "high" | "medium" };
  revengeCooldown: { minutes: number };
  noSizeUpAfterLoss: Record<string, never>;
  maxLossPerTrade: { amount: number };
  allowedInstruments: { roots: string[] };
  stopRequired: { withinSeconds: number };
  noStopWidening: Record<string, never>;
  manual: { scope: "day" | "trade" };
}

export type Rule = {
  [K in RuleKind]: {
    id: string;
    kind: K;
    enabled: boolean;
    /** Required for manual rules; overrides the generated label for others. */
    label?: string;
    params: RuleParamsMap[K];
  };
}[RuleKind];

export type RuleOf<K extends RuleKind> = Extract<Rule, { kind: K }>;

/** Prop-firm style account limits, tracked by the Account Guard. */
export interface AccountGuard {
  id: string;
  name: string;
  /** Broker account id this applies to; empty means all accounts combined. */
  account: string;
  startBalance: number;
  dailyLossLimit?: number;
  maxDrawdown?: number;
  drawdownMode: "static" | "trailingEod" | "trailingIntraday";
  /** Trailing threshold stops rising once it reaches the starting balance. */
  lockAtStart: boolean;
  profitTarget?: number;
  maxContracts?: number;
  /** Best single day may be at most this % of total profit. */
  consistencyPct?: number;
  /** Ignore trades before this trading day (YYYY-MM-DD). */
  startDay?: string;
}

export interface TradeNote {
  notes?: string;
  emotion?: string;
  setup?: string;
  tags?: string[];
  manual?: Record<string, ManualMark>;
}

export interface DayJournal {
  plan?: string;
  reflection?: string;
  mood?: number;
  manual?: Record<string, ManualMark>;
}

export type NewsImpact = "high" | "medium" | "low" | "holiday";

export interface NewsEvent {
  id: string;
  title: string;
  currency: string;
  time: number;
  impact: NewsImpact;
  forecast?: string;
  previous?: string;
}

export interface Candle {
  /** Epoch seconds (the unit TradingView Lightweight Charts expects). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
