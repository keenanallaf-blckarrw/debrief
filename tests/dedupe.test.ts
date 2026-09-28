import { describe, expect, it } from "vitest";
import { analyzeFile } from "../shared/import/index";
import { applyImport, removeImport } from "../shared/store/applyImport";
import { fixture, freshData, importFixtures, TZ } from "./helpers";

describe("importing the same trades twice", () => {
  it("adds nothing the second time", () => {
    const once = importFixtures(["tradovate-position-history.csv"]);
    const a = analyzeFile(fixture("tradovate-position-history.csv"), "again.csv", { tz: TZ });
    const out = applyImport(once, a.parsed!, { fileName: "again.csv", via: "file" });
    expect(out.data.executions).toHaveLength(7);
    expect(out.record.added.executions).toBe(0);
    expect(out.record.duplicates).toBe(7);
    expect(out.summary).toContain("Nothing new");
  });

  it("recognizes Performance and Position History as the same fills", () => {
    const data = importFixtures(["tradovate-performance.csv", "tradovate-position-history.csv"]);
    expect(data.executions).toHaveLength(7);
    // Position History adds the account and fill ids the Performance report lacks.
    expect(data.executions.every((e) => e.account === "DEMO000001")).toBe(true);
    expect(data.imports[0].upgraded).toBe(7);
  });

  it("matches a spreadsheet-damaged copy to the original", () => {
    const data = importFixtures(["tradovate-position-history.csv", "tradovate-position-history-excel.csv"]);
    expect(data.executions).toHaveLength(7);
    expect(data.executions.every((e) => e.precision === "second")).toBe(true);
  });

  it("upgrades damaged data when the original arrives later", () => {
    const data = importFixtures(["tradovate-position-history-excel.csv", "tradovate-performance.csv"]);
    expect(data.executions).toHaveLength(7);
    expect(data.executions.every((e) => e.precision === "second" && !e.sideUncertain)).toBe(true);
    expect(data.executions.filter((e) => e.side === "Short")).toHaveLength(2);
  });

  it("keeps copy-traded accounts apart", () => {
    const text = fixture("tradovate-position-history.csv");
    const other = text.replaceAll("DEMO000001", "DEMO000002");
    let data = importFixtures(["tradovate-position-history.csv"]);
    const p = analyzeFile(other, "acct2.csv", { tz: TZ }).parsed!;
    data = applyImport(data, p, { fileName: "acct2.csv", via: "file" }).data;
    expect(data.executions).toHaveLength(14);
  });

  it("keeps genuinely identical rows inside one file", () => {
    const text = fixture("tradovate-performance.csv");
    const lines = text.trim().split("\n");
    const doubled = [...lines, lines[1]].join("\n");
    const p = analyzeFile(doubled, "d.csv", { tz: TZ }).parsed!;
    const data = applyImport(freshData(), p, { fileName: "d.csv", via: "file" }).data;
    expect(data.executions).toHaveLength(8);
    // …and re-importing the same doubled file still adds nothing.
    const again = applyImport(data, p, { fileName: "d.csv", via: "file" });
    expect(again.record.added.executions).toBe(0);
  });
});

describe("source priority", () => {
  it("replaces pairs rebuilt from an Orders export with Tradovate's own pairs", () => {
    const data = importFixtures(["tradovate-orders.csv", "tradovate-performance.csv"]);
    expect(data.executions.every((e) => e.format === "tradovate-performance")).toBe(true);
    expect(data.imports[0].replaced).toBe(3);
  });

  it("skips Orders pairs for days a better export already covers", () => {
    const data = importFixtures(["tradovate-performance.csv", "tradovate-orders.csv"]);
    expect(data.executions.filter((e) => e.format === "tradovate-orders")).toHaveLength(0);
    expect(data.imports[0].warnings.join(" ")).toContain("more precise export");
    expect(data.orders.length).toBeGreaterThan(0);
  });
});

describe("undo", () => {
  it("removes exactly what an import added", () => {
    const data = importFixtures(["tradovate-position-history.csv", "tradovate-cash-history.csv"]);
    const cashImport = data.imports.find((r) => r.format === "tradovate-cash-history")!;
    const undone = removeImport(data, cashImport.id);
    expect(undone.cash).toHaveLength(0);
    expect(undone.executions).toHaveLength(7);
    expect(undone.imports).toHaveLength(1);
  });

  it("gives re-imported rows the same ids, so notes stay attached", () => {
    const first = importFixtures(["tradovate-position-history.csv"]);
    const ids = first.executions.map((e) => e.id).sort();
    const undone = removeImport(first, first.imports[0].id);
    const again = importFixtures(["tradovate-position-history.csv"], undone);
    expect(again.executions.map((e) => e.id).sort()).toEqual(ids);
  });
});
