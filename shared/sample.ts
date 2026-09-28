import type { NewsEvent } from "./types";
import { addDays, NEW_YORK, wallToMs, weekdayOf, zonedParts } from "./util/time";

// A synthetic three-week journal for the guided tour: MNQ in the morning, micro
// gold some evenings, and the classic leaks (overtrading after early losses,
// revenge re-entries, sizing up after a loss, a trade into CPI). It is written
// as a Tradovate "Performance" export so it flows through the real importer.
// Nothing here is real trading data.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spec {
  symbol: string;
  tick: number;
  point: number;
  fmt: number;
}
const MNQ: Spec = { symbol: "MNQZ6", tick: 0.25, point: 2, fmt: -2 };
const MGC: Spec = { symbol: "MGCZ6", tick: 0.1, point: 10, fmt: -1 };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Wall-clock stamp as Tradovate writes it, in the viewer's timezone. */
function stamp(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${pad(p.month)}/${pad(p.day)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

function money(n: number): string {
  const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `$(${s})` : `$${s}`;
}

function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}min ${s % 60}sec` : `${s}sec`;
}

/** The last `count` weekdays up to and including `endDay`. */
export function recentWeekdays(endDay: string, count: number): string[] {
  const out: string[] = [];
  let d = endDay;
  while (out.length < count) {
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6) out.unshift(d);
    d = addDays(d, -1);
  }
  return out;
}

export interface SampleOptions {
  endDay: string;
  tz: string;
  seed?: number;
}

interface Row {
  spec: Spec;
  qty: number;
  long: boolean;
  entry: number;
  exit: number;
  t0: number;
  t1: number;
}

export function sampleDays(endDay: string): string[] {
  return recentWeekdays(endDay, 15);
}

export function generateSampleCsv(opts: SampleOptions): string {
  const rand = mulberry32(opts.seed ?? 20260818);
  const days = sampleDays(opts.endDay);
  const rows: Row[] = [];
  let mnq = 29850;
  let mgc = 4390;
  const snap = (x: number, tick: number) => Math.round(x / tick) * tick;

  days.forEach((day, i) => {
    const [y, m, d] = day.split("-").map(Number);
    const at = (h: number, mi: number, s = 0) => wallToMs(NEW_YORK, y, m, d, h, mi, s);
    mnq += (rand() - 0.48) * 180;
    mgc += (rand() - 0.5) * 30;
    // One rough day a week, and the latest session is one too: it's the first
    // debrief a new user sees, so it should show what Debrief catches.
    const tiltDay = i % 5 === 3 || i === days.length - 1;
    const cpiDay = i === days.length - 6;
    const bigLossDay = i === days.length - 4;

    let t = at(9, 36 + Math.floor(rand() * 10), Math.floor(rand() * 60));
    let px = mnq;
    let size = 5;
    let lossStreak = 0;
    const planned = i === days.length - 1 ? 6 : tiltDay ? 7 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 2);

    if (cpiDay) {
      // A breakout chase one minute after the 8:30 CPI release.
      const t0 = at(8, 31, 12);
      const e = snap(px + 12, MNQ.tick);
      rows.push({ spec: MNQ, qty: 5, long: true, entry: e, exit: snap(e - 31.5, MNQ.tick), t0, t1: t0 + 94_000 });
    }

    for (let k = 0; k < planned; k++) {
      const long = rand() > 0.45;
      // Early trades are the better ones; tilt makes later ones worse.
      const edge = k < 2 ? 0.6 : tiltDay ? 0.3 : 0.48;
      const win = rand() < edge;
      const hold = win ? 60_000 + rand() * 360_000 : 90_000 + rand() * 720_000;
      const move = win ? 8 + rand() * 30 : -(6 + rand() * 22);
      let qty = size;
      if (bigLossDay && k === 1) qty = 10;
      const entry = snap(px + (rand() - 0.5) * 20, MNQ.tick);
      const exit = snap(entry + (long ? move : -move), MNQ.tick);
      rows.push({ spec: MNQ, qty, long, entry, exit, t0: t, t1: t + hold });
      px = exit;
      if (bigLossDay && k === 1) {
        rows[rows.length - 1].exit = snap(entry + (long ? -62 : 62), MNQ.tick);
      }
      const lost = (rows[rows.length - 1].exit - entry) * (long ? 1 : -1) < 0;
      lossStreak = lost ? lossStreak + 1 : 0;
      // Revenge: after a loss on a rough day, jump back in within a minute, bigger.
      const gap = tiltDay && lost ? 25_000 + rand() * 50_000 : 4 * 60_000 + rand() * 18 * 60_000;
      if (tiltDay && lost) size = Math.min(10, size + 5);
      else if (!lost) size = 5;
      t = t + hold + gap;
    }

    // Micro gold in the evening session on some days (counts toward the next trading day).
    if (i % 3 === 1 && i < days.length - 2) {
      const e0 = at(19, 5 + Math.floor(rand() * 20), Math.floor(rand() * 60));
      for (let k = 0; k < 2; k++) {
        const long = rand() > 0.5;
        const win = rand() < 0.55;
        const move = win ? 1.5 + rand() * 4 : -(1 + rand() * 3);
        const entry = snap(mgc + (rand() - 0.5) * 4, MGC.tick);
        const exit = snap(entry + (long ? move : -move), MGC.tick);
        const s0 = e0 + k * (11 * 60_000);
        rows.push({ spec: MGC, qty: 3, long, entry, exit, t0: s0, t1: s0 + 150_000 + rand() * 300_000 });
      }
    }
  });

  const header =
    "symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration";
  let fill = 700000000000;
  const lines = rows
    .sort((a, b) => a.t0 - b.t0)
    .map((r) => {
      const buyPrice = r.long ? r.entry : r.exit;
      const sellPrice = r.long ? r.exit : r.entry;
      const bought = r.long ? r.t0 : r.t1;
      const sold = r.long ? r.t1 : r.t0;
      const pnl = (sellPrice - buyPrice) * r.qty * r.spec.point;
      // Fill ids increase over time, so the opening fill gets the lower one.
      const first = ++fill;
      const second = ++fill;
      const buyId = r.long ? first : second;
      const sellId = r.long ? second : first;
      const decimals = r.spec.fmt === -2 ? 2 : 1;
      return [
        r.spec.symbol,
        r.spec.fmt,
        0,
        r.spec.tick,
        buyId,
        sellId,
        r.qty,
        buyPrice.toFixed(decimals),
        sellPrice.toFixed(decimals),
        `"${money(pnl)}"`,
        stamp(bought, opts.tz),
        stamp(sold, opts.tz),
        durationText(r.t1 - r.t0),
      ].join(",");
    });
  return [header, ...lines].join("\n");
}

/** Matching calendar events for the sample weeks, flagged so they're removed with it. */
export function sampleNews(endDay: string): NewsEvent[] {
  const days = sampleDays(endDay);
  const cpiDay = days[days.length - 6];
  const [y, m, d] = cpiDay.split("-").map(Number);
  const events: NewsEvent[] = [
    { id: "sample:cpi", title: "CPI m/m", currency: "USD", time: wallToMs(NEW_YORK, y, m, d, 8, 30), impact: "high", forecast: "0.3%", previous: "0.2%" },
  ];
  for (const day of days) {
    if (weekdayOf(day) !== 4) continue;
    const [yy, mm, dd] = day.split("-").map(Number);
    events.push({ id: `sample:claims:${day}`, title: "Unemployment Claims", currency: "USD", time: wallToMs(NEW_YORK, yy, mm, dd, 8, 30), impact: "medium" });
  }
  return events;
}

export const SAMPLE_FILE_NAME = "Sample journal (Debrief tour).csv";
