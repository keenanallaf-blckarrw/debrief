import { ColorType, CrosshairMode, LineStyle, TickMarkType, type DeepPartial, type ChartOptions, type Time } from "lightweight-charts";

// Shared look for every TradingView Lightweight Chart in Debrief: Debrief's dark
// surface, recessive hairline grid, and times shown in your Settings timezone
// (the library itself only knows UTC).

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

function secondsOf(time: Time): number {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Date.parse(`${time}T12:00:00Z`) / 1000;
  return Date.UTC(time.year, time.month - 1, time.day, 12) / 1000;
}

export function chartOptions(tz: string, height: number, withSeconds = false): DeepPartial<ChartOptions> {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const month = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" });
  const year = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" });
  const full = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fullDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });

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
