import { describe, expect, it } from "vitest";
import { tradingViewSymbol, tradingViewUrl } from "../shared/instruments";
import { buildTrades } from "../shared/trades/roundtrips";
import type { Candle, Execution, Trade } from "../shared/types";
import { candleAt, fillGap, fillMarks } from "../src/charts/tradeMarks";
import { ny, TZ } from "./helpers";

let n = 0;
function exec(p: Pick<Execution, "side" | "qty" | "entryPrice" | "exitPrice" | "entryTime" | "exitTime">): Execution {
  const dir = p.side === "Long" ? 1 : -1;
  return {
    id: `mark${++n}`,
    symbol: "MNQU6",
    root: "MNQ",
    pnl: (p.exitPrice - p.entryPrice) * dir * 2 * p.qty,
    precision: "second",
    importId: "test",
    format: "tradovate-position-history",
    ...p,
  };
}

function oneTrade(execs: Execution[]): Trade {
  const trades = buildTrades(execs, { timezone: TZ, dayGrouping: "cme", commissionPerSide: 0, cash: [] });
  expect(trades).toHaveLength(1);
  return trades[0];
}

/** One-minute candles from 10:00 ET, each [low, high]. */
function minuteBars(ranges: [number, number][]): Candle[] {
  const start = ny(2026, 8, 13, 10, 0) / 1000;
  return ranges.map(([low, high], i) => ({ time: start + i * 60, open: low, high, low, close: high }));
}

describe("trade chart fill marks", () => {
  // Short 1 at 20,000 at 10:01:08, bought back at 20,015 at 10:03:58.
  const short = () =>
    oneTrade([exec({ side: "Short", qty: 1, entryPrice: 20000, exitPrice: 20015, entryTime: ny(2026, 8, 13, 10, 1, 8), exitTime: ny(2026, 8, 13, 10, 3, 58) })]);
  const bars = minuteBars([
    [19990, 20004],
    [19995, 20006],
    [20001, 20010],
    [20004, 20018],
    [20010, 20020],
  ]);

  it("puts each arrow on the exact fill price, in the candle it happened in", () => {
    const [entry, exit] = fillMarks(short(), bars);
    expect(entry).toMatchObject({ time: bars[1].time, entry: true, buy: false, qty: 1, price: 20000, averaged: false });
    expect(exit).toMatchObject({ time: bars[3].time, entry: false, buy: true, qty: 1, price: 20015, averaged: false });
  });

  it("merges fills that share a candle into one arrow at their average price", () => {
    const t = oneTrade([
      exec({ side: "Long", qty: 1, entryPrice: 20000, exitPrice: 20001, entryTime: ny(2026, 8, 13, 10, 0, 10), exitTime: ny(2026, 8, 13, 10, 0, 40) }),
      exec({ side: "Long", qty: 1, entryPrice: 20000, exitPrice: 20003, entryTime: ny(2026, 8, 13, 10, 0, 10), exitTime: ny(2026, 8, 13, 10, 0, 50) }),
    ]);
    const marks = fillMarks(t, bars);
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({ entry: true, buy: true, qty: 2, price: 20000, averaged: false });
    expect(marks[1]).toMatchObject({ entry: false, buy: false, qty: 2, price: 20002, averaged: true });
  });

  it("finds no gap when fills sit inside their candles", () => {
    expect(fillGap(bars, 60, short())).toBeNull();
  });

  it("measures the shift when the candles are from another contract month", () => {
    const shifted = bars.map((b) => ({ ...b, open: b.open - 250, high: b.high - 250, low: b.low - 250, close: b.close - 250 }));
    // Entry sits 244 points above its candle, the exit 247.
    const gap = fillGap(shifted, 60, short());
    expect(gap).toBeGreaterThanOrEqual(244);
    expect(gap).toBeLessThanOrEqual(247);
  });

  it("treats a gap in the data as no candle", () => {
    expect(candleAt(bars, bars[4].time + 30, 60)).toBe(bars[4]);
    expect(candleAt(bars, bars[4].time + 90, 60)).toBeNull();
    expect(candleAt(bars, bars[0].time - 1, 60)).toBeNull();
  });
});

describe("TradingView links", () => {
  const sept2026 = Date.UTC(2026, 8, 1);
  it.each([
    ["MNQU6", "CME_MINI:MNQU2026"],
    ["MGCZ6", "COMEX_MINI:MGCZ2026"],
    ["GCZ6", "COMEX:GCZ2026"],
    ["ESZ25", "CME_MINI:ESZ2025"],
    ["MYMZ2026", "CBOT_MINI:MYMZ2026"],
    ["6EZ6", "CME:6EZ2026"],
    ["MCLX6", "NYMEX:MCLX2026"],
    ["MNQH0", "CME_MINI:MNQH2030"],
    ["MNQ", "CME_MINI:MNQ1!"],
    ["MNQ=F", "CME_MINI:MNQ1!"],
    ["CME_MINI:MNQ1!", "CME_MINI:MNQ1!"],
    ["EURUSD", "FX:EURUSD"],
    ["XAUUSD", "OANDA:XAUUSD"],
    ["BTCUSDT", "COINBASE:BTCUSD"],
    ["AAPL", "AAPL"],
  ])("%s → %s", (raw, tv) => {
    expect(tradingViewSymbol(raw, sept2026)).toBe(tv);
  });

  it("builds a 1-minute chart link", () => {
    expect(tradingViewUrl("MNQU6", sept2026)).toBe("https://www.tradingview.com/chart/?symbol=CME_MINI%3AMNQU2026&interval=1");
  });
});
