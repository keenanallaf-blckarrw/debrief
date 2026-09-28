import { useEffect, useRef } from "react";

// TradingView's free embeddable widgets (economic calendar, and a chart for
// when the companion isn't running). They load TradingView's own script; no
// account or key needed. Free embeds can't show CME futures, so the chart uses
// the closest index or spot symbol.

export function TradingViewWidget({ script, config, height, title }: { script: "advanced-chart" | "events"; config: Record<string, unknown>; height: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(config);

  useEffect(() => {
    const host = box.current;
    if (!host) return;
    host.innerHTML = "";
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    container.style.width = "100%";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);
    const s = document.createElement("script");
    s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${script}.js`;
    s.type = "text/javascript";
    s.async = true;
    s.innerHTML = JSON.stringify({ ...config, width: "100%", height: "100%", autosize: true });
    container.appendChild(s);
    host.appendChild(container);
    return () => {
      host.innerHTML = "";
    };
  }, [script, key]);

  // colorScheme "normal": Debrief's page is dark, TradingView's widget page is
  // light. When the two don't match, Chrome paints a solid white backdrop
  // behind the iframe, which turned the dark-theme calendar into faint grey
  // text on white. Matching schemes keeps the iframe transparent.
  return <div ref={box} className="overflow-hidden rounded-2xl" style={{ height, colorScheme: "normal" }} aria-label={title} role="region" />;
}

/** Free-to-embed stand-ins for futures, for the widget chart. */
const WIDGET_PROXIES: Record<string, { symbol: string; note: string }> = {
  MNQ: { symbol: "OANDA:NAS100USD", note: "Nasdaq-100 index CFD" },
  NQ: { symbol: "OANDA:NAS100USD", note: "Nasdaq-100 index CFD" },
  MES: { symbol: "OANDA:SPX500USD", note: "S&P 500 index CFD" },
  ES: { symbol: "OANDA:SPX500USD", note: "S&P 500 index CFD" },
  MYM: { symbol: "OANDA:US30USD", note: "Dow index CFD" },
  YM: { symbol: "OANDA:US30USD", note: "Dow index CFD" },
  M2K: { symbol: "OANDA:US2000USD", note: "Russell 2000 index CFD" },
  RTY: { symbol: "OANDA:US2000USD", note: "Russell 2000 index CFD" },
  MGC: { symbol: "OANDA:XAUUSD", note: "spot gold" },
  GC: { symbol: "OANDA:XAUUSD", note: "spot gold" },
  SIL: { symbol: "OANDA:XAGUSD", note: "spot silver" },
  SI: { symbol: "OANDA:XAGUSD", note: "spot silver" },
  MCL: { symbol: "OANDA:WTICOUSD", note: "WTI crude CFD" },
  CL: { symbol: "OANDA:WTICOUSD", note: "WTI crude CFD" },
  "6E": { symbol: "FX:EURUSD", note: "EUR/USD" },
  M6E: { symbol: "FX:EURUSD", note: "EUR/USD" },
  "6B": { symbol: "FX:GBPUSD", note: "GBP/USD" },
  "6J": { symbol: "FX:USDJPY", note: "USD/JPY" },
  BTC: { symbol: "BITSTAMP:BTCUSD", note: "spot bitcoin" },
  MBT: { symbol: "BITSTAMP:BTCUSD", note: "spot bitcoin" },
};

export function widgetSymbol(root: string, assetClass: string): { symbol: string; note: string } {
  if (WIDGET_PROXIES[root]) return WIDGET_PROXIES[root];
  if (assetClass === "forex") return { symbol: root === "XAUUSD" ? "OANDA:XAUUSD" : `FX:${root}`, note: root };
  if (assetClass === "crypto") return { symbol: `BINANCE:${root.replace(/USD$/, "USDT")}`, note: root };
  return { symbol: root, note: root };
}
