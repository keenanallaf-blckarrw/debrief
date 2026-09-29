import type { NewsEvent } from "./types";
import { addDays, NEW_YORK, wallToMs, weekdayOf, zonedParts } from "./util/time";

// A synthetic three-week journal for the guided tour: MNQ in the morning, micro
// gold some evenings, and the classic leaks (overtrading after early losses,
// revenge re-entries, sizing up after a loss, a trade into CPI). It is written
// as a Tradovate "Performance" export so it flows through the real importer.
// Nothing here is real trading data.
//
// The tour has to make Debrief's point: this trader's rules work. Trades that
// follow them have a real edge (more winners, small losses); trades that break
// them give it back. tests/sample-and-news.test.ts pins that story down.

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

/** How a trade turns out, in points: a disciplined trade vs. one taken on tilt. */
const CLEAN = { win: 0.63, winPts: [18, 38], lossPts: [6, 14] } as const;
const TILT = { win: 0.3, winPts: [6, 16], lossPts: [8, 16] } as const;

export function generateSampleCsv(opts: SampleOptions): string {
  const seed = opts.seed ?? 20260818;
  const walk = mulberry32(seed);
  const days = sampleDays(opts.endDay);
  const rows: Row[] = [];
  let mnq = 29850;
  let mgc = 4390;
  const snap = (x: number, tick: number) => Math.round(x / tick) * tick;
  // The evening gold trade before a session counts toward it (CME trading day).
  let goldBefore: { lost: boolean } | null = null;

  days.forEach((day, i) => {
    // Each day draws from its own random stream, so the story stays the same
    // whichever weekdays the sample lands on.
    const rand = mulberry32(seed + (i + 1) * 7919);
    const between = (range: readonly [number, number]) => range[0] + rand() * (range[1] - range[0]);
    const [y, m, d] = day.split("-").map(Number);
    const at = (h: number, mi: number, s = 0) => wallToMs(NEW_YORK, y, m, d, h, mi, s);
    mnq += (walk() - 0.48) * 180;
    mgc += (walk() - 0.5) * 30;
    const last = i === days.length - 1;
    const tiltDay = i % 5 === 3;
    const cpiDay = i === days.length - 6;
    const bigLossDay = i === days.length - 4;

    let px = mnq;
    let t = at(9, 36 + Math.floor(rand() * 10), Math.floor(rand() * 60));
    /** One MNQ trade from time t, `pts` in the trader's favour (negative = a loss). Returns true if it lost. */
    const trade = (qty: number, pts: number, holdMs: number): boolean => {
      const long = rand() > 0.45;
      const entry = snap(px + (rand() - 0.5) * 20, MNQ.tick);
      const exit = snap(entry + (long ? pts : -pts), MNQ.tick);
      rows.push({ spec: MNQ, qty, long, entry, exit, t0: t, t1: t + holdMs });
      px = exit;
      t += holdMs;
      return pts < 0;
    };

    if (last) {
      // The first session a new user sees: two clean winners and a small loss,
      // then the spiral every one of the default rules is there to stop.
      const script: [qty: number, pts: number, holdSec: number, gapSec: number][] = [
        [5, 25, 240, 420],
        [5, 18, 180, 540],
        [5, -12, 300, 40],
        [10, -21, 200, 35],
        [10, -25, 260, 50],
        [10, 7, 120, 300],
        [10, -18, 220, 0],
      ];
      for (const [qty, pts, hold, gap] of script) {
        trade(qty, pts, hold * 1000);
        t += gap * 1000;
      }
    } else if (bigLossDay) {
      // A small loss, a revenge re-entry at double size that runs 45 points
      // against him, then one more trade to "make it back".
      trade(5, -10, 200_000);
      t += 40_000;
      trade(10, -45, 540_000);
      t += 60_000;
      trade(10, 8, 150_000);
    } else {
      if (cpiDay) {
        // A breakout chase one minute after the 8:30 CPI release.
        const t0 = at(8, 31, 12);
        const e = snap(px + 12, MNQ.tick);
        rows.push({ spec: MNQ, qty: 5, long: true, entry: e, exit: snap(e - 31.5, MNQ.tick), t0, t1: t0 + 94_000 });
      }
      // Rough days trade on and on; normal days stay within the three-trade
      // rule, counting an evening gold trade or the CPI trade.
      const planned = tiltDay ? 6 + Math.floor(rand() * 2) : goldBefore || cpiDay ? 2 : 2 + Math.floor(rand() * 2);
      let size = 5;
      let lossStreak = goldBefore?.lost || cpiDay ? 1 : 0;
      let tilted = false;
      let tiltNet = 0;
      for (let k = 0; k < planned; k++) {
        const odds = tilted ? TILT : CLEAN;
        // On a rough day, the second trade is the loss that sets it off.
        const won = tiltDay && k === 1 ? false : rand() < odds.win;
        const pts = won ? between(odds.winPts) : -between(odds.lossPts);
        if (tilted) tiltNet += pts * size * MNQ.point;
        const lost = trade(size, pts, (won ? 60 + rand() * 360 : 90 + rand() * 630) * 1000);
        lossStreak = lost ? lossStreak + 1 : 0;
        if (tiltDay) {
          // Tilt: straight back in after a loss, at double size.
          if (lost) tilted = true;
          size = lost ? 10 : 5;
          t += (lost ? 25 + rand() * 50 : 120 + rand() * 240) * 1000;
        } else {
          // Discipline: two losses in a row and he's done for the day.
          if (lossStreak >= 2) break;
          t += (6 + rand() * 18) * 60_000;
        }
      }
      if (tiltDay && tiltNet > -200) {
        // However the tilt went, a rough day ends the way they do: one more
        // revenge trade at double size that gives back more than it made.
        trade(10, -Math.max(8, Math.ceil((tiltNet + 200) / (10 * MNQ.point)) + rand() * 4), (150 + rand() * 300) * 1000);
      }
    }

    // Micro gold in the evening session on some days. It counts toward the next
    // trading day, and there's no evening session on Fridays.
    goldBefore = null;
    const goldWin = rand() < 0.58;
    const goldPts = goldWin ? 1.5 + rand() * 3.5 : -(1 + rand() * 1.5);
    const goldLong = rand() > 0.5;
    const g0 = at(19, 5 + Math.floor(rand() * 20), Math.floor(rand() * 60));
    const goldHold = 150_000 + rand() * 300_000;
    if (i % 3 === 1 && i < days.length - 2 && weekdayOf(day) !== 5) {
      const entry = snap(mgc + (rand() - 0.5) * 4, MGC.tick);
      const exit = snap(entry + (goldLong ? goldPts : -goldPts), MGC.tick);
      rows.push({ spec: MGC, qty: 3, long: goldLong, entry, exit, t0: g0, t1: g0 + goldHold });
      goldBefore = { lost: !goldWin };
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

// Bump the version when the sample's story changes: a sample loaded from an
// older version is swapped for the new one the next time Debrief opens.
export const SAMPLE_FILE_NAME = "Sample journal (Debrief tour v2).csv";
