import { describe, expect, it } from "vitest";
import { analyzeFile, detectFormat } from "../shared/import/index";
import type { RoundTripMapping } from "../shared/import/types";
import { fixture, TZ } from "./helpers";

const ctx = { tz: TZ };
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe("format detection", () => {
  it.each([
    ["tradovate-position-history.csv", "tradovate-position-history"],
    ["tradovate-performance.csv", "tradovate-performance"],
    ["tradovate-orders.csv", "tradovate-orders"],
    ["tradovate-cash-history.csv", "tradovate-cash-history"],
    ["tradingview-notifications.csv", "tradingview-notifications"],
    ["tradingview-orders.csv", "tradingview-orders"],
    ["generic-ninjatrader.csv", "generic-roundtrip"],
  ])("%s is %s", (name, format) => {
    expect(analyzeFile(fixture(name), name, ctx).detection.format).toBe(format);
  });

  it("ignores balance snapshots and treats empty exports as empty", () => {
    expect(detectFormat(["Total P/L", "Open P/L", "Net Liq", "Total Margin Used", "Available Margin"]).kind).toBe("ignore");
    expect(analyzeFile("", "tradovate-positions.csv", ctx).detection.label).toBe("Empty file");
  });
});

describe("Tradovate Position History", () => {
  const a = analyzeFile(fixture("tradovate-position-history.csv"), "ph.csv", ctx);
  const ex = a.parsed!.executions;

  it("reads every pair with the account and exact fill ids", () => {
    expect(ex).toHaveLength(7);
    expect(ex.every((e) => e.account === "DEMO000001")).toBe(true);
    expect(ex[0].fillIds).toEqual({ buy: "600000000101", sell: "600000000102" });
    expect(a.parsed!.mangled).toBe(false);
    expect(a.parsed!.warnings).toEqual([]);
  });

  it("derives direction from fill order", () => {
    const short = ex.find((e) => e.qty === 1)!;
    expect(short.side).toBe("Short");
    expect(short.entryPrice).toBe(30095);
    expect(short.exitPrice).toBe(30110);
    expect(short.pnl).toBe(-30);
    expect(ex.filter((e) => e.side === "Long")).toHaveLength(5);
  });

  it("keeps broker P&L and gold's $10 point value", () => {
    expect(sum(ex.map((e) => e.pnl))).toBe(7.5);
    const gold = ex.find((e) => e.root === "MGC")!;
    expect(gold.pnl).toBe(-360);
  });
});

describe("Tradovate Performance", () => {
  it("turns $(70.00) into a loss (the old importer counted it as a win)", () => {
    const ex = analyzeFile(fixture("tradovate-performance.csv"), "perf.csv", ctx).parsed!.executions;
    expect(ex).toHaveLength(7);
    expect(ex.map((e) => e.pnl)).toEqual([22.5, -70, -50, 490, 5, -30, -360]);
    expect(ex.every((e) => e.account === undefined)).toBe(true);
    expect(ex.filter((e) => e.side === "Short")).toHaveLength(2);
  });
});

describe("spreadsheet-damaged exports", () => {
  const p = analyzeFile(fixture("tradovate-position-history-excel.csv"), "excel.csv", ctx).parsed!;

  it("still imports, warns, and marks same-minute pairs as uncertain", () => {
    expect(p.executions).toHaveLength(7);
    expect(p.mangled).toBe(true);
    expect(p.warnings.some((w) => w.includes("Excel or Numbers"))).toBe(true);
    const uncertain = p.executions.filter((e) => e.sideUncertain);
    expect(uncertain.length).toBe(3);
    expect(p.executions.every((e) => e.precision === "minute")).toBe(true);
    expect(p.executions.every((e) => e.fillIds === undefined)).toBe(true);
  });

  it("still gets direction right when the minutes differ", () => {
    const short = p.executions.find((e) => e.qty === 1)!;
    expect(short.side).toBe("Short");
  });
});

describe("Tradovate Orders", () => {
  const p = analyzeFile(fixture("tradovate-orders.csv"), "orders.csv", ctx).parsed!;

  it("pairs fills first-in first-out, including partial fills on cancelled orders", () => {
    expect(p.executions).toHaveLength(3);
    const [a, b, c] = p.executions;
    expect([a.qty, a.side, a.pnl]).toEqual([5, "Long", 22.5]);
    expect([b.qty, b.side, b.pnl]).toEqual([20, "Long", -120]);
    expect([c.qty, c.side, c.pnl]).toEqual([3, "Short", -24]);
    expect(p.openPositions).toBe(0);
  });

  it("keeps stop and limit orders as order events", () => {
    const stops = p.orders.filter((o) => o.type === "Stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ action: "placed", side: "Sell", price: 30120 });
  });
});

describe("Tradovate Cash History", () => {
  it("classifies deposits, commissions and paired P&L", () => {
    const cash = analyzeFile(fixture("tradovate-cash-history.csv"), "cash.csv", ctx).parsed!.cash;
    expect(cash).toHaveLength(7);
    expect(cash[0]).toMatchObject({ kind: "deposit", amount: 50000 });
    expect(cash.filter((c) => c.kind === "commission")).toHaveLength(5);
    expect(cash.find((c) => c.kind === "pnl")!.amount).toBe(22.5);
    expect(cash[1].root).toBe("MNQ");
  });
});

describe("TradingView", () => {
  it("reads the notifications log as order events, including stop moves", () => {
    const orders = analyzeFile(fixture("tradingview-notifications.csv"), "notif.csv", ctx).parsed!.orders;
    expect(orders).toHaveLength(8);
    const modified = orders.filter((o) => o.action === "modified");
    expect(modified.map((o) => o.price)).toEqual([30201.75, 30165]);
    expect(orders.find((o) => o.bracket === "stopLoss")).toMatchObject({ type: "Stop", price: 30120, qty: 5 });
    expect(orders.find((o) => o.action === "filled" && o.type === "Stop")).toMatchObject({ price: 30201.75 });
  });

  it("reads paper-trading order history with thousands spaces and commissions", () => {
    const p = analyzeFile(fixture("tradingview-orders.csv"), "tv.csv", ctx).parsed!;
    expect(p.executions).toHaveLength(2);
    expect(p.executions[0]).toMatchObject({ root: "MNQ", side: "Long", qty: 2, entryPrice: 30130.5, exitPrice: 30132.75, pnl: 9 });
    expect(p.executions[1]).toMatchObject({ side: "Short", qty: 1, pnl: 20 });
    expect(sum(p.cash.map((c) => c.amount))).toBe(-1.5);
  });
});

describe("unknown brokers", () => {
  const text = fixture("generic-ninjatrader.csv");

  it("asks for a column mapping and suggests one", () => {
    const a = analyzeFile(text, "nt.csv", ctx);
    expect(a.parsed).toBeUndefined();
    expect(a.suggested).toMatchObject({
      layout: "roundtrip",
      symbol: "Instrument",
      side: "Market pos.",
      qty: "Qty",
      entryPrice: "Entry price",
      exitPrice: "Exit price",
      pnl: "Profit",
      entryTime: "Entry time",
      exitTime: "Exit time",
      account: "Account",
    });
  });

  it("imports once the mapping is confirmed", () => {
    const mapping = analyzeFile(text, "nt.csv", ctx).suggested as RoundTripMapping;
    const p = analyzeFile(text, "nt.csv", ctx, mapping).parsed!;
    expect(p.executions).toHaveLength(3);
    expect(p.executions.map((e) => [e.root, e.side, e.pnl])).toEqual([
      ["MNQ", "Long", 22.5],
      ["MNQ", "Short", 5],
      ["MNQ", "Short", -30],
    ]);
  });

  it("infers direction from the P&L sign when there's no side column", () => {
    const noSide = "Symbol,Qty,Entry Price,Exit Price,Entry Time,Exit Time,PnL\nMNQ,1,100,90,2026-08-13 10:00,2026-08-13 10:05,20\n";
    const a = analyzeFile(noSide, "x.csv", ctx);
    const p = analyzeFile(noSide, "x.csv", ctx, { ...(a.suggested as RoundTripMapping), side: undefined }).parsed!;
    expect(p.executions[0].side).toBe("Short");
  });
});
