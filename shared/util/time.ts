import { TZDate } from "@date-fns/tz";
import type { TimePrecision } from "../types";

// Broker timestamps rarely carry a timezone. Tradovate and TradingView write the
// wall-clock time of whatever timezone their app is set to (usually the
// computer's). Debrief reads those naive stamps in the timezone from Settings,
// so every trade gets one absolute moment in time.

export type DateOrder = "MDY" | "DMY";

export interface ParsedStamp {
  ms: number;
  precision: TimePrecision | "day";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const TIME = String.raw`(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*([AaPp][Mm])?)?`;
const ZONE = String.raw`\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[-./](\d{1,2})[-./](\d{1,2})${TIME}${ZONE}$`);
const YEAR_LAST = new RegExp(String.raw`^(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})${TIME}${ZONE}$`);
const MONTH_NAME = new RegExp(
  String.raw`^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})${TIME}${ZONE}$`,
);
const DAY_MONTH_NAME = new RegExp(
  String.raw`^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})${TIME}${ZONE}$`,
);

/** Wall-clock components in `tz` → epoch ms. Handles daylight-saving shifts. */
export function wallToMs(
  tz: string,
  y: number, mo: number, d: number,
  h = 0, mi = 0, s = 0, msec = 0,
): number {
  return new TZDate(y, mo - 1, d, h, mi, s, msec, tz).getTime();
}

function offsetMinutes(zone: string): number {
  if (/^(Z|UTC|GMT)$/i.test(zone)) return 0;
  const m = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

function build(
  tz: string,
  y: number, mo: number, d: number,
  hh: string | undefined, mm: string | undefined, ss: string | undefined, frac: string | undefined,
  ampm: string | undefined, zone: string | undefined,
): ParsedStamp | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let h = hh === undefined ? 0 : Number(hh);
  const mi = mm === undefined ? 0 : Number(mm);
  const s = ss === undefined ? 0 : Number(ss);
  const msec = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  if (ampm) {
    const pm = ampm.toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || mi > 59 || s > 60) return null;
  const precision: ParsedStamp["precision"] = hh === undefined ? "day" : ss === undefined ? "minute" : "second";
  let ms: number;
  if (zone) {
    ms = Date.UTC(y, mo - 1, d, h, mi, s, msec) - offsetMinutes(zone) * 60_000;
  } else {
    ms = wallToMs(tz, y, mo, d, h, mi, s, msec);
  }
  return Number.isFinite(ms) ? { ms, precision } : null;
}

function fullYear(y: string): number {
  const n = Number(y);
  if (y.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

/**
 * Parse a timestamp as brokers export it. Naive stamps are read in `tz`.
 * Understands ISO (with or without offset), US and European slashes, 2-digit
 * years (what Excel leaves behind), AM/PM, month names and epoch numbers.
 */
export function parseStamp(input: unknown, tz: string, order: DateOrder = "MDY"): ParsedStamp | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return epoch(input);
  const str = String(input).trim().replace(/\s+/g, " ");
  if (!str) return null;
  if (/^\d{10}(\.\d+)?$/.test(str) || /^\d{13}$/.test(str)) return epoch(Number(str));

  let m = str.match(YEAR_FIRST);
  if (m) return build(tz, Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6], m[7], m[8], m[9]);

  m = str.match(YEAR_LAST);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [mo, d] = order === "DMY" ? [b, a] : [a, b];
    return build(tz, fullYear(m[3]), mo, d, m[4], m[5], m[6], m[7], m[8], m[9]);
  }

  m = str.match(MONTH_NAME);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return build(tz, Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), m[4], m[5], m[6], m[7], m[8], m[9]);
  }
  m = str.match(DAY_MONTH_NAME);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return build(tz, Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), m[4], m[5], m[6], m[7], m[8], m[9]);
  }
  return null;
}

function epoch(n: number): ParsedStamp | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  return { ms, precision: "second" };
}

/**
 * Decide whether slash dates in a column are month-first or day-first by
 * looking for a value that only fits one reading (e.g. 17/08/2026).
 */
export function inferDateOrder(values: unknown[]): DateOrder {
  let mdy = 0;
  let dmy = 0;
  for (const v of values) {
    const m = String(v ?? "").trim().match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  return dmy > mdy ? "DMY" : "MDY";
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar/clock components of an instant as seen in `tz`. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "short",
    });
    partsFormatters.set(tz, fmt);
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(ms)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

export function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Day of week for a YYYY-MM-DD key, 0 = Sunday. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const NEW_YORK = "America/New_York";

/**
 * The trading day an instant belongs to.
 * "cme": the CME Globex day starts at 6:00 PM New York time, so an 8 PM Monday
 * gold trade counts toward Tuesday, exactly like Tradovate's "Trade Date" and
 * the daily loss limits prop firms enforce. Weekend evenings roll to Monday.
 * "midnight": plain calendar day in `tz`.
 */
export function tradingDay(ms: number, tz: string, grouping: "cme" | "midnight"): string {
  if (grouping === "cme") {
    const p = zonedParts(ms, NEW_YORK);
    let day = dayKey(p.year, p.month, p.day);
    if (p.hour >= 18) day = addDays(day, 1);
    const wd = weekdayOf(day);
    if (wd === 6) day = addDays(day, 2);
    else if (wd === 0) day = addDays(day, 1);
    return day;
  }
  const p = zonedParts(ms, tz);
  return dayKey(p.year, p.month, p.day);
}

/** Minutes since midnight in `tz`, for time-of-day rules. */
export function minuteOfDay(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return p.hour * 60 + p.minute;
}

/** "HH:MM" → minutes since midnight, or null. */
export function parseClock(hhmm: string): number | null {
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

/** The browser's or server's own timezone, with a safe fallback. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || NEW_YORK;
  } catch {
    return NEW_YORK;
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
