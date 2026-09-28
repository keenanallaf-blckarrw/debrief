import { BaselineSeries, createChart, LineStyle, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "../../shared/types";
import { addDays } from "../../shared/util/time";
import { dayShort, money, timeOf } from "../lib/format";
import { C, chartOptions } from "./chartTheme";

// Running net P&L. Above breakeven the line and wash are green, below it red:
// profit and loss are exactly the good/bad the colors mean. The tooltip gives
// the exact value at the crosshair; the stat tiles above carry the totals.

interface Point {
  time: Time;
  value: number;
  label: string;
}

function toPoints(trades: Trade[], mode: "trades" | "days", tz: string): Point[] {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  if (mode === "days") {
    const byDay = new Map<string, number>();
    for (const t of sorted) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.net);
    let run = 0;
    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const pts: Point[] = days.map(([day, net]) => {
      run += net;
      return { time: day as Time, value: Math.round(run * 100) / 100, label: dayShort(day) };
    });
    if (days.length) pts.unshift({ time: addDays(days[0][0], -1) as Time, value: 0, label: "Start" });
    return pts;
  }
  let run = 0;
  let lastSec = 0;
  const pts: Point[] = [];
  for (const t of sorted) {
    run += t.net;
    // The chart needs strictly increasing times; nudge same-second exits apart.
    let sec = Math.floor(t.exitTime / 1000);
    if (sec <= lastSec) sec = lastSec + 1;
    lastSec = sec;
    pts.push({ time: sec as UTCTimestamp, value: Math.round(run * 100) / 100, label: `${timeOf(t.exitTime, tz)} · ${t.root} ${t.side}` });
  }
  if (pts.length) {
    const first = pts[0].time as number;
    pts.unshift({ time: (first - 60) as UTCTimestamp, value: 0, label: "Start" });
  }
  return pts;
}

export function EquityChart({
  trades,
  tz,
  mode,
  height = 260,
  label = "Running net P&L",
}: {
  trades: Trade[];
  tz: string;
  mode: "trades" | "days";
  height?: number;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Baseline"> | null>(null);
  const points = useMemo(() => toPoints(trades, mode, tz), [trades, mode, tz]);
  const [hover, setHover] = useState<Point | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, chartOptions(tz, height));
    c.applyOptions({ timeScale: { timeVisible: mode === "trades" }, rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } } });
    const s = c.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: 0 },
      topLineColor: C.gain,
      topFillColor1: "rgba(48, 209, 88, 0.14)",
      topFillColor2: "rgba(48, 209, 88, 0.02)",
      bottomLineColor: C.loss,
      bottomFillColor1: "rgba(255, 69, 58, 0.02)",
      bottomFillColor2: "rgba(255, 69, 58, 0.14)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (v: number) => money(v, { cents: false }), minMove: 1 },
    });
    s.createPriceLine({ price: 0, color: "#3a3a3c", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" });
    chart.current = c;
    series.current = s;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [tz, height, mode]);

  useEffect(() => {
    if (!series.current || !chart.current) return;
    series.current.setData(points.map((p) => ({ time: p.time, value: p.value })));
    chart.current.timeScale().fitContent();
    const byTime = new Map(points.map((p) => [String(p.time), p]));
    const handler = (param: { time?: Time }) => setHover(param.time !== undefined ? byTime.get(String(param.time)) ?? null : null);
    chart.current.subscribeCrosshairMove(handler);
    return () => chart.current?.unsubscribeCrosshairMove(handler);
  }, [points]);

  const last = points.length ? points[points.length - 1] : null;
  const shown = hover ?? last;
  return (
    <figure className="relative m-0" aria-label={label}>
      <div className="pointer-events-none absolute left-3 top-2 z-10 rounded-lg bg-card/80 px-2 py-1 backdrop-blur">
        {shown && (
          <>
            <div className={`text-[15px] font-semibold ${shown.value >= 0 ? "text-gain" : "text-loss"}`}>{money(shown.value, { sign: true })}</div>
            <div className="text-[11px] text-muted">{hover ? shown.label : "Now"}</div>
          </>
        )}
      </div>
      <div ref={box} style={{ height }} />
      <figcaption className="sr-only">
        {label}: {points.length} points, ending at {last ? money(last.value, { sign: true }) : "no data"}.
      </figcaption>
    </figure>
  );
}
