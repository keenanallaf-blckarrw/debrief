import { norm } from "./csv";
import type { Detection } from "./types";

// Every export Debrief reads, recognized by its column names. Detection looks at
// headers only, so it's fast enough for the companion to classify every new
// file that lands in Downloads.

export function detectFormat(headers: string[]): Detection {
  const h = new Set(headers.map(norm));
  const has = (...names: string[]) => names.every((n) => h.has(norm(n)));
  const any = (...names: string[]) => names.some((n) => h.has(norm(n)));

  if (has("boughtTimestamp", "soldTimestamp") && any("buyPrice") && any("sellPrice")) {
    return has("pairedQty")
      ? { format: "tradovate-position-history", label: "Tradovate · Position History", kind: "trades", needsMapping: false }
      : { format: "tradovate-performance", label: "Tradovate · Performance", kind: "trades", needsMapping: false };
  }
  if (has("cashChangeType") && any("delta", "amount")) {
    return {
      format: "tradovate-cash-history",
      label: "Tradovate · Cash History",
      kind: "cash",
      needsMapping: false,
      note: "Adds your real commissions and fees, and your starting balance for the Account Guard.",
    };
  }
  if (has("b/s") && any("filledQty", "avgFillPrice")) {
    return { format: "tradovate-orders", label: "Tradovate · Orders", kind: "trades", needsMapping: false };
  }
  if (h.size === 4 && has("symbol", "time", "title", "text")) {
    return {
      format: "tradingview-notifications",
      label: "TradingView · Notifications log",
      kind: "orders",
      needsMapping: false,
      note: "Shows where your stops were placed and moved. Import it alongside a trade export.",
    };
  }
  if (has("side", "fillPrice") && any("closingTime", "placingTime", "fillTime", "time") && any("symbol")) {
    return { format: "tradingview-orders", label: "TradingView · Order history", kind: "trades", needsMapping: false };
  }
  if (any("netLiq", "netLiquidation") || (has("totalPl") && any("availableMargin", "openPl"))) {
    return {
      format: null,
      label: "Account summary",
      kind: "ignore",
      needsMapping: false,
      note: "This is a balance snapshot, not trade history, so there's nothing to import.",
    };
  }
  if (any("unrealizedPl", "unrealizedPnl", "openPl") && !any("exitPrice", "closePrice", "soldTimestamp")) {
    return {
      format: null,
      label: "Open positions",
      kind: "ignore",
      needsMapping: false,
      note: "This lists positions that are still open. Debrief imports closed trades.",
    };
  }

  const text = [...h];
  const includes = (frag: string) => text.some((x) => x.includes(frag));
  const hasSymbol = includes("symbol") || includes("instrument") || includes("contract") || includes("ticker") || includes("market");
  const hasEntryExit =
    (includes("entryprice") || includes("openprice") || includes("buyprice") || includes("avgentry") || includes("pricein")) &&
    (includes("exitprice") || includes("closeprice") || includes("sellprice") || includes("avgexit") || includes("priceout"));
  const hasPnl = includes("pnl") || includes("profit") || text.some((x) => x === "pl" || x.endsWith("pl"));
  const hasSide = includes("side") || includes("buysell") || text.includes("bs") || includes("action") || includes("direction");
  const hasPrice = includes("price");
  const hasQty = includes("qty") || includes("quantity") || includes("size") || includes("volume") || includes("contracts") || includes("shares");
  const hasTime = includes("time") || includes("date");

  if (hasSymbol && (hasEntryExit || (hasPnl && hasTime))) {
    return {
      format: "generic-roundtrip",
      label: "Trade list",
      kind: "trades",
      needsMapping: true,
      note: "Debrief doesn't know this export yet. Check which column is which once, before importing.",
    };
  }
  if (hasSymbol && hasSide && hasPrice && hasQty && hasTime) {
    return {
      format: "generic-fills",
      label: "Fills / order history",
      kind: "trades",
      needsMapping: true,
      note: "Each row looks like one buy or sell. Debrief will pair them into trades first in, first out.",
    };
  }
  return {
    format: null,
    label: "Unrecognized file",
    kind: "unknown",
    needsMapping: false,
    note: "This doesn't look like trade history. Try the Position History or Performance export.",
  };
}
