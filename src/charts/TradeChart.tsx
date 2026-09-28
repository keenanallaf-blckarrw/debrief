import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type SeriesMarkerPrice,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "../../shared/types";
import { companion, useCompanion } from "../lib/companion";
import { price as fmtPrice, timeOf } from "../lib/format";
import { Spinner } from "../components/ui/Bits";
import { C, chartCandles, chartOptions, chartTime } from "./chartTheme";
import { TradingViewLink } from "./TradingViewLink";
import { fillGap, fillMarks } from "./tradeMarks";

// The trade replayed on a TradingView chart: real candles around the trade, an
// arrow at your fills (blue = entry, amber = exit) whose tip sits on the exact
// price you filled at, and lines at your average entry and exit. Candles come
// from Yahoo Finance through the companion, and are saved so the chart still
// works after Yahoo stops serving that data.

const INTERVAL_SEC: Record<string, number> = { "1m": 60, "5m": 300, "60m": 3600, "1d": 86400 };

interface Loaded {
  bars: Candle[];
  interval: string;
  source: string;
}

export function TradeChart({ trade, tz, height = 360 }: { trade: Trade; tz: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const available = useCompanion((s) => s.available);
  const [state, setState] = useState<{ loading: boolean; error: string | null; data: Loaded | null }>({ loading: true, error: null, data: null });
  const [legend, setLegend] = useState<{ bar: Candle; fills: { text: string; entry: boolean }[] } | null>(null);

  useEffect(() => {
    if (!available) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    companion
      .candles(trade.symbol, trade.entryTime, trade.exitTime)
      .then((r) => !cancelled && setState({ loading: false, error: null, data: { bars: r.bars, interval: r.interval, source: r.yahooSymbol } }))
      .catch((e: Error) => !cancelled && setState({ loading: false, error: e.message, data: null }));
    return () => {
      cancelled = true;
    };
  }, [trade.key, trade.symbol, trade.entryTime, trade.exitTime, available]);

  useEffect(() => {
    const data = state.data;
    if (!box.current || !data || !data.bars.length) return;
    const step = INTERVAL_SEC[data.interval] ?? 60;
    const c = createChart(box.current, chartOptions(height, step < 60));
    const s = c.addSeries(CandlestickSeries, {
      upColor: C.upCandle,
      downColor: C.downCandle,
      borderVisible: false,
      wickUpColor: C.upCandle,
      wickDownColor: C.downCandle,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const candles = chartCandles(data.bars, tz);
    s.setData(candles.map(({ time, bar: b }) => ({ time, open: b.open, high: b.high, low: b.low, close: b.close })));

    // One arrow per candle for your entries and one for your exits, its tip on
    // the price you filled at (the average when several fills share a candle):
    // buys point up from below the price, sells point down from above it. The
    // details show in the legend on hover; labels on the chart would collide
    // whenever entry and exit are close together.
    const marks = fillMarks(trade, data.bars);
    createSeriesMarkers(
      s,
      marks.map(
        (m): SeriesMarkerPrice<Time> => ({
          time: chartTime(m.time * 1000, tz),
          position: m.buy ? "atPriceBottom" : "atPriceTop",
          price: m.price,
          shape: m.buy ? "arrowUp" : "arrowDown",
          color: m.entry ? C.blue : C.amber,
          size: 1.4,
        }),
      ),
    );
    const fillsAt = new Map<number, { text: string; entry: boolean }[]>();
    for (const m of marks) {
      const list = fillsAt.get(m.time) ?? [];
      list.push({ text: `${m.buy ? "Bought" : "Sold"} ${m.qty} @ ${fmtPrice(m.price)}${m.averaged ? " avg" : ""}`, entry: m.entry });
      fillsAt.set(m.time, list);
    }
    s.createPriceLine({ price: trade.avgEntry, color: C.blue, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Entry" });
    s.createPriceLine({ price: trade.avgExit, color: C.amber, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Exit" });

    const byTime = new Map(candles.map(({ time, bar }) => [time as number, bar]));
    c.subscribeCrosshairMove((p) => {
      const bar = typeof p.time === "number" ? byTime.get(p.time) : undefined;
      setLegend(bar ? { bar, fills: fillsAt.get(bar.time) ?? [] } : null);
    });

    // Frame the trade with some context on each side.
    const from = chartTime(trade.entryTime, tz) - step * 25;
    const to = chartTime(trade.exitTime, tz) + step * 25;
    c.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
    chartRef.current = c;
    return () => {
      c.remove();
      chartRef.current = null;
    };
  }, [state.data, trade, tz, height]);

  const gap = state.data && state.data.bars.length ? fillGap(state.data.bars, INTERVAL_SEC[state.data.interval] ?? 60, trade) : null;

  return (
    <div className="rounded-2xl border border-line-2 bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 text-[12px] text-muted">
        <div className="flex items-center gap-3">
          <span className="font-mono text-ink-2">{trade.root}</span>
          {state.data && <span>{state.data.interval} candles</span>}
          <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-3 bg-blue" /> Entry</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-3 bg-amber" /> Exit</span>
        </div>
        {legend ? (
          <span className="flex flex-wrap items-center justify-end gap-x-3 font-mono tnum text-ink-2">
            {legend.fills.map((f, i) => (
              <span key={i} className={f.entry ? "text-blue" : "text-amber"}>
                {f.text}
              </span>
            ))}
            <span>
              O {fmtPrice(legend.bar.open)} H {fmtPrice(legend.bar.high)} L {fmtPrice(legend.bar.low)} C {fmtPrice(legend.bar.close)}
            </span>
          </span>
        ) : (
          <span>
            {timeOf(trade.entryTime, tz, true)} → {timeOf(trade.exitTime, tz, true)}
            {state.data && <span className="text-faint"> · hover an arrow for the fill</span>}
          </span>
        )}
      </div>
      {!available ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-5 pt-4 text-[13px] leading-relaxed text-muted">
          <span className="min-w-0 flex-1 basis-72">
            Price charts come from the Debrief companion running on your computer. Start Debrief with <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px] text-ink-2">npm start</code> to replay this trade on real candles, or look at it on TradingView.
          </span>
          <TradingViewLink symbol={trade.symbol} at={trade.entryTime} tz={tz} />
        </div>
      ) : state.loading ? (
        <Spinner label="Loading candles around this trade…" className="px-4 py-10" />
      ) : state.error ? (
        <div className="px-4 pb-5 pt-4 text-[13px] text-muted">{state.error}</div>
      ) : !state.data?.bars.length ? (
        <div className="px-4 pb-5 pt-4 text-[13px] text-muted">No candles were available for this window (the market may have been closed).</div>
      ) : (
        <>
          <div ref={box} style={{ height }} className="px-1" />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3">
            <p className={`min-w-0 flex-1 basis-72 text-[11.5px] leading-relaxed ${gap === null ? "text-faint" : "text-warn"}`}>
              {gap === null
                ? `Arrows point at your exact fill prices. Candles: ${state.data.source} from Yahoo Finance (free continuous-contract data).`
                : `Your fills sit about ${fmtPrice(Math.abs(gap))} points ${gap > 0 ? "above" : "below"} these candles. Yahoo's free ${state.data.source} candles here come from a different contract month than your ${trade.symbol}, so the whole chart is shifted. Your P&L comes from your export and is correct. Open the exact contract in TradingView to see it.`}
            </p>
            <TradingViewLink symbol={trade.symbol} at={trade.entryTime} tz={tz} />
          </div>
        </>
      )}
    </div>
  );
}
