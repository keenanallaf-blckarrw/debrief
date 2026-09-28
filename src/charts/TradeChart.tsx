import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "../../shared/types";
import { companion, useCompanion } from "../lib/companion";
import { price as fmtPrice, timeOf } from "../lib/format";
import { Spinner } from "../components/ui/Bits";
import { C, chartOptions } from "./chartTheme";

// The trade replayed on a TradingView chart: real candles around the trade, an
// arrow at every fill (blue = entry, amber = exit) and lines at your average
// entry and exit. Candles come from Yahoo Finance through the companion, and
// are saved so the chart still works after Yahoo stops serving that data.

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
  const [legend, setLegend] = useState<Candle | null>(null);

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
    const c = createChart(box.current, chartOptions(tz, height, step < 60));
    const s = c.addSeries(CandlestickSeries, {
      upColor: C.upCandle,
      downColor: C.downCandle,
      borderVisible: false,
      wickUpColor: C.upCandle,
      wickDownColor: C.downCandle,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    s.setData(data.bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));

    // Snap each fill to the candle it happened in.
    const times = data.bars.map((b) => b.time);
    const snap = (ms: number): UTCTimestamp => {
      const sec = Math.floor(ms / 1000);
      let best = times[0];
      for (const t of times) {
        if (t <= sec) best = t;
        else break;
      }
      return best as UTCTimestamp;
    };
    const markers: SeriesMarker<Time>[] = [];
    const isLong = trade.side === "Long";
    for (const e of trade.executions) {
      markers.push({
        time: snap(e.entryTime),
        position: isLong ? "belowBar" : "aboveBar",
        shape: isLong ? "arrowUp" : "arrowDown",
        color: C.blue,
        text: `${isLong ? "Buy" : "Sell"} ${e.qty} @ ${fmtPrice(e.entryPrice)}`,
      });
      markers.push({
        time: snap(e.exitTime),
        position: isLong ? "aboveBar" : "belowBar",
        shape: isLong ? "arrowDown" : "arrowUp",
        color: C.amber,
        text: `${isLong ? "Sell" : "Buy"} ${e.qty} @ ${fmtPrice(e.exitPrice)}`,
      });
    }
    // Several fills in one candle: keep one label per side so text doesn't pile up.
    const seen = new Set<string>();
    const deduped = markers
      .sort((a, b) => (a.time as number) - (b.time as number))
      .map((m) => {
        const k = `${m.time}|${m.color}`;
        if (seen.has(k)) return { ...m, text: undefined };
        seen.add(k);
        return m;
      });
    createSeriesMarkers(s, deduped);
    s.createPriceLine({ price: trade.avgEntry, color: C.blue, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Entry" });
    s.createPriceLine({ price: trade.avgExit, color: C.amber, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Exit" });

    const byTime = new Map(data.bars.map((b) => [b.time, b]));
    c.subscribeCrosshairMove((p) => setLegend(typeof p.time === "number" ? byTime.get(p.time) ?? null : null));

    // Frame the trade with some context on each side.
    const from = Math.floor(trade.entryTime / 1000) - step * 25;
    const to = Math.floor(trade.exitTime / 1000) + step * 25;
    c.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
    chartRef.current = c;
    return () => {
      c.remove();
      chartRef.current = null;
    };
  }, [state.data, trade, tz, height]);

  const outside =
    state.data && state.data.bars.length
      ? (() => {
          const lo = Math.min(...state.data.bars.map((b) => b.low));
          const hi = Math.max(...state.data.bars.map((b) => b.high));
          const pad = (hi - lo) * 0.05;
          return trade.avgEntry < lo - pad || trade.avgEntry > hi + pad;
        })()
      : false;

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
          <span className="font-mono tnum text-ink-2">
            O {fmtPrice(legend.open)} H {fmtPrice(legend.high)} L {fmtPrice(legend.low)} C {fmtPrice(legend.close)}
          </span>
        ) : (
          <span>
            {timeOf(trade.entryTime, tz, true)} → {timeOf(trade.exitTime, tz, true)}
          </span>
        )}
      </div>
      {!available ? (
        <div className="px-4 pb-5 pt-4 text-[13px] leading-relaxed text-muted">
          Price charts come from the Debrief companion running on your computer. Start Debrief with <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px] text-ink-2">npm start</code> to replay this trade on real candles.
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
          <div className="px-4 pb-3 text-[11.5px] text-faint">
            Candles: {state.data.source} from Yahoo Finance (continuous contract, free data). {outside ? "Your fills sit outside this price range, which usually means the continuous contract had rolled to a new month. Your P&L is unaffected." : "Small gaps versus your fills are normal."}
          </div>
        </>
      )}
    </div>
  );
}
