// Numbers as brokers write them: "$(70.00)", "-$1,234.50", "2,327.50",
// "30 100.25" (TradingView's thousands spaces), "1.234,56" (European),
// "70.00-" (trailing minus). The old importer turned "$(70.00)" into +70,
// which counted every Tradovate "Performance" loss as a win.

const STRIP = /[A-Za-z$€£¥₹\s   '`]/g;

export function parseNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s || s === "-" || s === "—") return null;

  let negative = false;
  if (/\([^()]*\d[^()]*\)/.test(s)) {
    negative = true;
    s = s.replace(/[()]/g, "");
  }
  s = s.replace(/[−‒–—]/g, "-");
  if (/\d\s*-\s*$/.test(s)) {
    negative = !negative;
    s = s.replace(/-\s*$/, "");
  }
  // Scientific notation is only ever an ID mangled by Excel, never a price.
  if (/^[+-]?\d(\.\d+)?e[+-]?\d+$/i.test(s)) return null;
  s = s.replace(STRIP, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Round away float noise such as 4410.900000000001. */
export function clean(n: number, decimals = 8): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Fill/order ids survive as exact digits in original exports but turn into
 * "6.20099E+11" once a spreadsheet re-saves the file. Only exact ids are useful.
 */
export function exactId(input: unknown): string | undefined {
  const s = String(input ?? "").trim();
  return /^\d{6,}$/.test(s) ? s : undefined;
}

export function looksLikeMangledId(input: unknown): boolean {
  return /^\d(\.\d+)?E\+\d+$/i.test(String(input ?? "").trim());
}
