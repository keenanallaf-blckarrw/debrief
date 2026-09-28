// Display formatting. Every time is shown in the timezone from Settings.

export function money(n: number | null | undefined, opts: { sign?: boolean; cents?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const cents = opts.cents ?? abs < 100;
  const body = abs.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  if (n < 0) return `-$${body}`;
  return `${opts.sign && n > 0 ? "+" : ""}$${body}`;
}

/** $12.9K style for axis ticks and tight spots. */
export function moneyCompact(n: number): string {
  const abs = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${s}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${s}$${(abs / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${s}$${Math.round(abs)}`;
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function ratio(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return "—";
  if (!Number.isFinite(x)) return "∞";
  return x.toFixed(digits);
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function price(n: number): string {
  const decimals = Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 2 : 5;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  return s;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export function timeOf(ms: number, tz: string, seconds = false): string {
  return fmt(tz, { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }).format(ms);
}

export function dateTimeOf(ms: number, tz: string): string {
  return fmt(tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
}

function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Tue, Aug 18" */
export function dayShort(day: string): string {
  return fmt("UTC", { weekday: "short", month: "short", day: "numeric" }).format(dayToDate(day));
}

/** "Tuesday, August 18" (+ year when it isn't this year) */
export function dayLong(day: string): string {
  const d = dayToDate(day);
  const thisYear = new Date().getUTCFullYear() === d.getUTCFullYear();
  return fmt("UTC", { weekday: "long", month: "long", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }).format(d);
}

export function monthLabel(y: number, m: number): string {
  return fmt("UTC", { month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function tzShort(tz: string): string {
  try {
    const parts = fmt(tz, { timeZoneName: "short" }).formatToParts(Date.now());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function toneOf(n: number): "gain" | "loss" | "flat" {
  if (n > 0.005) return "gain";
  if (n < -0.005) return "loss";
  return "flat";
}
