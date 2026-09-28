// Contract specs for the futures most retail and prop traders use, plus the
// logic that turns any exported symbol into a product root.
//
//   "MNQU6"            → MNQ  (Tradovate: root + month code + year)
//   "CME_MINI:MNQ1!"   → MNQ  (TradingView continuous contract)
//   "COMEX:MGCZ2026"   → MGC
//   "MNQ=F"            → MNQ  (Yahoo)
//   "NASDAQ:AAPL"      → AAPL (stock)

export type AssetClass = "future" | "stock" | "forex" | "crypto";

export interface InstrumentSpec {
  root: string;
  name: string;
  /** Dollars per 1.0 move in price for one contract. */
  pointValue: number;
  tick: number;
  /** Continuous-contract symbol on Yahoo Finance, used for chart candles. */
  yahoo?: string;
  /** Currencies whose economic news moves this market. */
  newsCurrencies: string[];
}

const F = (
  root: string, name: string, pointValue: number, tick: number,
  newsCurrencies: string[] = ["USD"], yahoo: string | undefined = `${root}=F`,
): InstrumentSpec => ({ root, name, pointValue, tick, yahoo, newsCurrencies });

export const FUTURES: Record<string, InstrumentSpec> = Object.fromEntries(
  [
    F("MNQ", "Micro Nasdaq-100", 2, 0.25),
    F("NQ", "E-mini Nasdaq-100", 20, 0.25),
    F("MES", "Micro S&P 500", 5, 0.25),
    F("ES", "E-mini S&P 500", 50, 0.25),
    F("M2K", "Micro Russell 2000", 5, 0.1),
    F("RTY", "E-mini Russell 2000", 50, 0.1),
    F("MYM", "Micro Dow", 0.5, 1),
    F("YM", "E-mini Dow", 5, 1),
    F("MGC", "Micro Gold", 10, 0.1),
    F("GC", "Gold", 100, 0.1),
    F("SIL", "Micro Silver", 1000, 0.005),
    F("SI", "Silver", 5000, 0.005),
    F("MCL", "Micro Crude Oil", 100, 0.01),
    F("CL", "Crude Oil", 1000, 0.01),
    F("QM", "E-mini Crude Oil", 500, 0.025),
    F("NG", "Natural Gas", 10000, 0.001),
    F("MNG", "Micro Natural Gas", 1000, 0.001, ["USD"], "NG=F"),
    F("HG", "Copper", 25000, 0.0005),
    F("MHG", "Micro Copper", 2500, 0.0005),
    F("PL", "Platinum", 50, 0.1),
    F("ZN", "10-Year T-Note", 1000, 0.015625),
    F("ZB", "30-Year T-Bond", 1000, 0.03125),
    F("ZF", "5-Year T-Note", 1000, 0.0078125),
    F("ZT", "2-Year T-Note", 2000, 0.00390625),
    F("6E", "Euro FX", 125000, 0.00005, ["EUR", "USD"]),
    F("M6E", "Micro EUR/USD", 12500, 0.0001, ["EUR", "USD"], "6E=F"),
    F("6B", "British Pound", 62500, 0.0001, ["GBP", "USD"]),
    F("M6B", "Micro GBP/USD", 6250, 0.0001, ["GBP", "USD"], "6B=F"),
    F("6J", "Japanese Yen", 12500000, 0.0000005, ["JPY", "USD"]),
    F("6A", "Australian Dollar", 100000, 0.00005, ["AUD", "USD"]),
    F("M6A", "Micro AUD/USD", 10000, 0.0001, ["AUD", "USD"], "6A=F"),
    F("6C", "Canadian Dollar", 100000, 0.00005, ["CAD", "USD"]),
    F("6S", "Swiss Franc", 125000, 0.00005, ["CHF", "USD"]),
    F("BTC", "Bitcoin", 5, 5),
    F("MBT", "Micro Bitcoin", 0.1, 5, ["USD"], "BTC=F"),
    F("ETH", "Ether", 50, 0.5, ["USD"], "ETH=F"),
    F("MET", "Micro Ether", 0.1, 0.5, ["USD"], "ETH=F"),
    F("ZC", "Corn", 50, 0.25),
    F("ZS", "Soybeans", 50, 0.25),
    F("ZW", "Wheat", 50, 0.25),
    F("LE", "Live Cattle", 400, 0.025),
    F("HE", "Lean Hogs", 400, 0.025),
  ].map((s) => [s.root, s]),
);

const MONTH_CODES = "FGHJKMNQUVXZ";
const FUTURE_WITH_MONTH = new RegExp(`^([A-Z0-9]{1,4}?)([${MONTH_CODES}])(\\d{1,4})$`);
const CONTINUOUS = /^([A-Z0-9]{1,4}?)\d!$/;

const FOREX_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "SEK", "NOK", "MXN", "ZAR", "SGD", "HKD", "TRY",
  "XAU", "XAG",
]);
const CRYPTO_BASES = new Set(["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "BNB", "AVAX", "DOT", "LINK"]);

export interface SymbolInfo {
  root: string;
  assetClass: AssetClass;
  spec?: InstrumentSpec;
}

/** Turn any exported symbol into a product root and asset class. */
export function parseSymbol(raw: string, productHint?: string): SymbolInfo {
  const hint = String(productHint ?? "").trim().toUpperCase();
  if (hint && FUTURES[hint]) return { root: hint, assetClass: "future", spec: FUTURES[hint] };

  let s = String(raw ?? "").trim().toUpperCase();
  if (s.includes(":")) s = s.slice(s.lastIndexOf(":") + 1);
  // NinjaTrader / Rithmic style: "MNQ SEP26", "MNQ 09-26", "ES DEC25".
  const spaced = s.match(/^([A-Z0-9]{1,4})\s+(?:[A-Z]{3}\s?\d{2,4}|\d{1,2}-\d{2,4})$/);
  if (spaced && FUTURES[spaced[1]]) return { root: spaced[1], assetClass: "future", spec: FUTURES[spaced[1]] };
  s = s.replace(/\s+/g, "");
  if (s.endsWith("=F")) s = s.slice(0, -2);

  const cont = s.match(CONTINUOUS);
  if (cont && FUTURES[cont[1]]) return { root: cont[1], assetClass: "future", spec: FUTURES[cont[1]] };

  const fut = s.match(FUTURE_WITH_MONTH);
  if (fut && FUTURES[fut[1]]) return { root: fut[1], assetClass: "future", spec: FUTURES[fut[1]] };
  if (FUTURES[s]) return { root: s, assetClass: "future", spec: FUTURES[s] };

  const pair = s.replace(/[/._-]/g, "");
  if (/^[A-Z]{6}$/.test(pair) && FOREX_CODES.has(pair.slice(0, 3)) && FOREX_CODES.has(pair.slice(3))) {
    return { root: pair, assetClass: "forex" };
  }
  const crypto = pair.match(/^([A-Z]{2,5})(USDT|USDC|USD|EUR|BTC)(PERP)?$/);
  if (crypto && CRYPTO_BASES.has(crypto[1])) return { root: pair, assetClass: "crypto" };

  // An unknown future still carries a month code and year, e.g. "XYZU6".
  if (fut) return { root: fut[1], assetClass: "future" };
  if (cont) return { root: cont[1], assetClass: "future" };
  return { root: s || "UNKNOWN", assetClass: "stock" };
}

/** Dollars per point for P&L we have to compute ourselves (fills-based exports). */
export function pointValue(info: SymbolInfo): number {
  return info.spec?.pointValue ?? 1;
}

export function displayName(root: string): string {
  return FUTURES[root]?.name ?? root;
}

/** Yahoo Finance symbol for candles, or null when there is no free source. */
export function yahooSymbol(root: string, assetClass: AssetClass): string | null {
  if (assetClass === "future") return FUTURES[root]?.yahoo ?? null;
  if (assetClass === "forex") {
    if (root === "XAUUSD") return "GC=F";
    if (root === "XAGUSD") return "SI=F";
    return `${root}=X`;
  }
  if (assetClass === "crypto") {
    const m = root.match(/^([A-Z]{2,5})(USDT|USDC|USD)/);
    return m ? `${m[1]}-USD` : null;
  }
  return /^[A-Z.]{1,6}$/.test(root) ? root.replace(".", "-") : null;
}

export function newsCurrenciesFor(root: string, assetClass: AssetClass): string[] {
  if (assetClass === "future") return FUTURES[root]?.newsCurrencies ?? ["USD"];
  if (assetClass === "forex") return [root.slice(0, 3), root.slice(3, 6)].map((c) => (c === "XAU" || c === "XAG" ? "USD" : c));
  return ["USD"];
}
