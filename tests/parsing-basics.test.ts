import { describe, expect, it } from "vitest";
import { parseSymbol, yahooSymbol } from "../shared/instruments";
import { exactId, looksLikeMangledId, parseNumber } from "../shared/util/numbers";
import { inferDateOrder, parseStamp, tradingDay, wallToMs } from "../shared/util/time";

const TZ = "America/New_York";

describe("parseNumber", () => {
  it.each([
    ["$22.50", 22.5],
    ["$(70.00)", -70],
    ["($1,234.56)", -1234.56],
    ["(70.00)", -70],
    ["-$320.00", -320],
    ["2,327.50", 2327.5],
    ["30 100.25", 30100.25],
    ["30 100.25", 30100.25],
    ["1.234,56", 1234.56],
    ["12,5", 12.5],
    ["70.00-", -70],
    ["−45", -45],
    ["4410.900000000001", 4410.900000000001],
    ["+15", 15],
    ["USD 1,000", 1000],
    [" 5 ", 5],
  ])("%s → %d", (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected, 8);
  });

  it.each(["", "-", "abc", "7.00000E+11", null, undefined])("rejects %s", (input) => {
    expect(parseNumber(input)).toBeNull();
  });
});

describe("ids", () => {
  it("keeps exact ids and spots spreadsheet-mangled ones", () => {
    expect(exactId("700000000075")).toBe("700000000075");
    expect(exactId("7.00000E+11")).toBeUndefined();
    expect(looksLikeMangledId("7.00000E+11")).toBe(true);
    expect(looksLikeMangledId("700000000075")).toBe(false);
  });
});

describe("parseStamp", () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => wallToMs(TZ, y, mo, d, h, mi, s);

  it("reads Tradovate's MM/DD/YYYY HH:MM:SS in the given timezone", () => {
    expect(parseStamp("08/17/2026 18:39:26", TZ)).toEqual({ ms: at(2026, 8, 17, 18, 39, 26), precision: "second" });
    expect(new Date(parseStamp("08/17/2026 18:39:26", TZ)!.ms).toISOString()).toBe("2026-08-17T22:39:26.000Z");
  });

  it("reads Excel's 2-digit years and flags minute precision", () => {
    expect(parseStamp("8/13/26 9:54", TZ)).toEqual({ ms: at(2026, 8, 13, 9, 54), precision: "minute" });
  });

  it("reads ISO, TradingView and MT5 styles", () => {
    expect(parseStamp("2026-08-17 20:34:40", TZ)!.ms).toBe(at(2026, 8, 17, 20, 34, 40));
    expect(parseStamp("2026.08.17 20:34", TZ)!.ms).toBe(at(2026, 8, 17, 20, 34));
    expect(parseStamp("2026-09-28T08:15:00-04:00", "Asia/Tokyo")!.ms).toBe(Date.UTC(2026, 8, 28, 12, 15));
    expect(parseStamp("2026-09-28T12:15:00Z", TZ)!.ms).toBe(Date.UTC(2026, 8, 28, 12, 15));
  });

  it("handles AM/PM and month names", () => {
    expect(parseStamp("8/13/2026 3:01:08 PM", TZ)!.ms).toBe(at(2026, 8, 13, 15, 1, 8));
    expect(parseStamp("8/13/2026 12:05:00 AM", TZ)!.ms).toBe(at(2026, 8, 13, 0, 5));
    expect(parseStamp("Aug 13, 2026 9:54:06", TZ)!.ms).toBe(at(2026, 8, 13, 9, 54, 6));
    expect(parseStamp("13 Aug 2026 09:54", TZ)!.ms).toBe(at(2026, 8, 13, 9, 54));
  });

  it("reads day-first dates when told to", () => {
    expect(parseStamp("17/08/2026 10:00", TZ, "DMY")!.ms).toBe(at(2026, 8, 17, 10, 0));
    expect(inferDateOrder(["01/08/2026", "17/08/2026"])).toBe("DMY");
    expect(inferDateOrder(["08/01/2026", "08/17/2026"])).toBe("MDY");
  });

  it("reads epoch seconds and milliseconds", () => {
    expect(parseStamp("1787006366", TZ)!.ms).toBe(1787006366000);
    expect(parseStamp(1787006366000, TZ)!.ms).toBe(1787006366000);
  });

  it("rejects garbage", () => {
    expect(parseStamp("not a date", TZ)).toBeNull();
    expect(parseStamp("13/45/2026", TZ)).toBeNull();
    expect(parseStamp("", TZ)).toBeNull();
  });
});

describe("tradingDay", () => {
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => wallToMs(TZ, y, mo, d, h, mi);

  it("rolls evening futures sessions into the next CME day, like Tradovate's Trade Date", () => {
    expect(tradingDay(at(2026, 8, 17, 18, 39), TZ, "cme")).toBe("2026-08-18");
    expect(tradingDay(at(2026, 8, 17, 17, 59), TZ, "cme")).toBe("2026-08-17");
    expect(tradingDay(at(2026, 8, 12, 18, 22), TZ, "cme")).toBe("2026-08-13");
  });

  it("sends Sunday evening to Monday and Friday evening to Monday", () => {
    expect(tradingDay(at(2026, 8, 16, 19, 0), TZ, "cme")).toBe("2026-08-17");
    expect(tradingDay(at(2026, 8, 14, 18, 30), TZ, "cme")).toBe("2026-08-17");
  });

  it("uses the New York clock even for a Chicago trader", () => {
    const fivePmChicago = wallToMs("America/Chicago", 2026, 8, 17, 17, 5); // 6:05 PM New York
    expect(tradingDay(fivePmChicago, "America/Chicago", "cme")).toBe("2026-08-18");
    expect(tradingDay(fivePmChicago, "America/Chicago", "midnight")).toBe("2026-08-17");
  });
});

describe("parseSymbol", () => {
  it.each([
    ["MNQU6", "MNQ", "future"],
    ["MGCZ6", "MGC", "future"],
    ["6EU6", "6E", "future"],
    ["M6EZ26", "M6E", "future"],
    ["ESZ2026", "ES", "future"],
    ["CME_MINI:MNQ1!", "MNQ", "future"],
    ["COMEX:MGCZ2026", "MGC", "future"],
    ["NYMEX:CL1!", "CL", "future"],
    ["MNQ=F", "MNQ", "future"],
    ["MNQ SEP26", "MNQ", "future"],
    ["MNQ 09-26", "MNQ", "future"],
    ["SILZ6", "SIL", "future"],
    ["M2KZ6", "M2K", "future"],
    ["EURUSD", "EURUSD", "forex"],
    ["FX:EUR/USD", "EURUSD", "forex"],
    ["OANDA:XAUUSD", "XAUUSD", "forex"],
    ["BINANCE:BTCUSDT", "BTCUSDT", "crypto"],
    ["NASDAQ:AAPL", "AAPL", "stock"],
    ["AMZN", "AMZN", "stock"],
  ])("%s → %s (%s)", (raw, root, cls) => {
    const info = parseSymbol(raw);
    expect(info.root).toBe(root);
    expect(info.assetClass).toBe(cls);
  });

  it("prefers the product column when the export has one", () => {
    expect(parseSymbol("WEIRD123", "MNQ").root).toBe("MNQ");
  });

  it("maps to Yahoo symbols for chart candles", () => {
    expect(yahooSymbol("MNQ", "future")).toBe("MNQ=F");
    expect(yahooSymbol("M6E", "future")).toBe("6E=F");
    expect(yahooSymbol("EURUSD", "forex")).toBe("EURUSD=X");
    expect(yahooSymbol("XAUUSD", "forex")).toBe("GC=F");
    expect(yahooSymbol("BTCUSDT", "crypto")).toBe("BTC-USD");
    expect(yahooSymbol("AAPL", "stock")).toBe("AAPL");
  });
});
