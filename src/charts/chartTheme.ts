import { ColorType, CrosshairMode, LineStyle, TickMarkType, type DeepPartial, type ChartOptions, type Time, type UTCTimestamp } from "lightweight-charts";
import { zonedParts } from "../../shared/util/time";
import type { Candle } from "../../shared/types";

// Shared look for every TradingView Lightweight Chart in Debrief: Debrief's dark
// surface, recessive hairline grid, and times on your Settings timezone's clock.

export const C = {
  surface: "#0b0b0c",
  text: "#8e8e93",
  grid: "#1f1f22",
  axis: "#2c2c2e",
  crosshair: "#636366",
  gain: "#30d158",
  loss: "#ff453a",
  blue: "#3987e5",
  amber: "#d8a94b",
  upCandle: "rgba(38, 166, 154, 0.75)",
  downCandle: "rgba(239, 83, 80, 0.75)",
};

/**
 * The library only knows UTC, and starts each new day on the axis at UTC
 * midnight (8 PM in New York), which dropped date labels into the middle of
 * evening sessions. So every time goes to the chart as your wall clock read in
 * UTC: 3:01 PM in New York becomes 3:01 PM UTC, and the axis is labelled in UTC.
 */
export function chartTime(ms: number, tz: string): UTCTimestamp {
  const p = zonedParts(ms, tz);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000) as UTCTimestamp;
}

/**
 * Candles on your wall clock, keeping the original with each one. The hour
 * that repeats when daylight saving ends can't be drawn twice, so its second
 * pass is skipped.
 */
export function chartCandles(bars: Candle[], tz: string): { time: UTCTimestamp; bar: Candle }[] {
  const out: { time: UTCTimestamp; bar: Candle }[] = [];
  for (const bar of bars) {
    const time = chartTime(bar.time * 1000, tz);
    if (out.length && time <= out[out.length - 1].time) continue;
    out.push({ time, bar });
  }
  return out;
}

function secondsOf(time: Time): number {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Date.parse(`${time}T12:00:00Z`) / 1000;
  return Date.UTC(time.year, time.month - 1, time.day, 12) / 1000;
}

/** Chart options. Times given to the chart must come from chartTime(), which already puts them on your clock. */
export function chartOptions(height: number, withSeconds = false): DeepPartial<ChartOptions> {
  const timeZone = "UTC";
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  const month = new Intl.DateTimeFormat("en-US", { timeZone, month: "short" });
  const year = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" });
  const full = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fullDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" });

  return {
    height,
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: C.text,
      fontFamily: "Inter, -apple-system, sans-serif",
      fontSize: 11,
      attributionLogo: true,
    },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.axis },
    timeScale: {
      borderColor: C.axis,
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (t: Time, type: TickMarkType) => {
        if (typeof t !== "number") return day.format(secondsOf(t) * 1000);
        const ms = t * 1000;
        if (type === TickMarkType.Year) return year.format(ms);
        if (type === TickMarkType.Month) return month.format(ms);
        if (type === TickMarkType.DayOfMonth) return day.format(ms);
        return time.format(ms);
      },
    },
    localization: {
      timeFormatter: (t: Time) => (typeof t === "number" ? full.format(t * 1000) : fullDay.format(secondsOf(t) * 1000)),
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: C.crosshair, style: LineStyle.Solid, width: 1, labelBackgroundColor: "#242427" },
      horzLine: { color: C.crosshair, style: LineStyle.Solid, width: 1, labelBackgroundColor: "#242427" },
    },
    handleScale: { axisPressedMouseMove: true },
  };
}
