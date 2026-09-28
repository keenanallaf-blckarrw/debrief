import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Candle } from "../../shared/types";
import { companion } from "../lib/companion";
import { price as fmtPrice, timeOf } from "../lib/format";
import { Spinner } from "../components/ui/Bits";
import { C, chartCandles, chartOptions } from "./chartTheme";

// Today's 1-minute futures candles for your main market, refreshed every
// minute through the companion. (TradingView's free embed can't show CME
// futures, so Debrief draws this one itself.)

export function LiveChart({ symbol, tz, height = 420 }: { symbol: string; tz: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null; last: Candle | null; source: string }>({ loading: true, error: null, last: null, source: "" });

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, chartOptions(height));
    const s = c.addSeries(CandlestickSeries, {
      upColor: C.upCandle,
      downColor: C.downCandle,
      borderVisible: false,
      wickUpColor: C.upCandle,
      wickDownColor: C.downCandle,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    chart.current = c;
    series.current = s;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [tz, height]);

  useEffect(() => {
    let cancelled = false;
    let first = true;
    const load = async () => {
      const now = Date.now();
      try {
        const r = await companion.candles(symbol, now - 4 * 3_600_000, now);
        if (cancelled || !series.current) return;
        const candles = chartCandles(r.bars, tz);
        series.current.setData(candles.map(({ time, bar: b }) => ({ time, open: b.open, high: b.high, low: b.low, close: b.close })));
        if (first && candles.length) {
          const lastT = candles[candles.length - 1].time;
          chart.current?.timeScale().setVisibleRange({ from: (lastT - 3 * 3600) as UTCTimestamp, to: (lastT + 60 * 5) as UTCTimestamp });
          first = false;
        }
        setState({ loading: false, error: null, last: r.bars[r.bars.length - 1] ?? null, source: r.yahooSymbol });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol, tz]);

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2 text-[12px] text-muted">
        <span>
          {state.last ? (
            <>
              <span className="font-mono text-[14px] font-semibold tnum text-ink">{fmtPrice(state.last.close)}</span>
              <span className="ml-2">last candle {timeOf(state.last.time * 1000, tz)}</span>
            </>
          ) : (
            "1-minute candles"
          )}
        </span>
        {state.source && <span className="text-faint">{state.source} · Yahoo Finance · refreshes every minute</span>}
      </div>
      <div className="relative">
        <div ref={box} style={{ height }} />
        {state.loading && <Spinner label="Loading today's candles…" className="absolute inset-0 justify-center" />}
        {!state.loading && (state.error || !state.last) && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-muted">
            {state.error ?? "No candles right now. The market may be closed (CME futures pause 5–6 PM ET and on weekends)."}
          </div>
        )}
      </div>
    </div>
  );
}
