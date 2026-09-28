import { describe, expect, it } from "vitest";
import { analyzeFile } from "../shared/import/index";
import { mergeNews, newsCoverage, normalizeForexFactory } from "../shared/news";
import { generateSampleCsv, sampleNews } from "../shared/sample";
import { applyImport, hasSample, removeSample } from "../shared/store/applyImport";
import { fixture, freshData, tradesOf, TZ } from "./helpers";

describe("sample journal", () => {
  const csv = generateSampleCsv({ endDay: "2026-09-25", tz: TZ });

  it("is a valid Tradovate Performance export with no warnings", () => {
    const a = analyzeFile(csv, "sample.csv", { tz: TZ });
    expect(a.detection.format).toBe("tradovate-performance");
    expect(a.parsed!.warnings).toEqual([]);
    expect(a.parsed!.executions.length).toBeGreaterThan(50);
  });

  it("is deterministic and follows the viewer's timezone", () => {
    expect(generateSampleCsv({ endDay: "2026-09-25", tz: TZ })).toBe(csv);
    const la = generateSampleCsv({ endDay: "2026-09-25", tz: "America/Los_Angeles" });
    const tradesNy = analyzeFile(csv, "s.csv", { tz: TZ }).parsed!.executions;
    const tradesLa = analyzeFile(la, "s.csv", { tz: "America/Los_Angeles" }).parsed!.executions;
    expect(tradesLa.map((e) => e.entryTime)).toEqual(tradesNy.map((e) => e.entryTime));
  });

  it("covers three weeks and gets replaced by the first real import", () => {
    const a = analyzeFile(csv, "sample.csv", { tz: TZ });
    const parsed = { ...a.parsed!, detection: { ...a.parsed!.detection, format: "sample" as const } };
    let data = applyImport(freshData(), parsed, { fileName: "sample.csv", via: "sample" }).data;
    data = { ...data, news: sampleNews("2026-09-25") };
    const days = new Set(tradesOf(data).map((t) => t.day));
    expect(days.size).toBeGreaterThanOrEqual(15);
    expect(hasSample(data)).toBe(true);

    const real = analyzeFile(fixture("tradovate-position-history.csv"), "real.csv", { tz: TZ });
    const out = applyImport(data, real.parsed!, { fileName: "real.csv", via: "file" });
    expect(out.removedSample).toBe(true);
    expect(out.data.executions).toHaveLength(7);
    expect(removeSample(data).news).toEqual([]);
  });
});

describe("economic calendar", () => {
  const rows = [
    { title: "CPI m/m", country: "USD", date: "2026-09-10T08:30:00-04:00", impact: "High", forecast: "0.3%", previous: "0.2%" },
    { title: "ECB President Lagarde Speaks", country: "EUR", date: "2026-09-10T09:30:00-04:00", impact: "Medium" },
    { title: "Bank Holiday", country: "JPY", date: "2026-09-11T00:00:00-04:00", impact: "Holiday" },
    { nonsense: true },
  ];

  it("normalizes the Forex Factory feed", () => {
    const events = normalizeForexFactory(rows);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ title: "CPI m/m", currency: "USD", impact: "high", time: Date.UTC(2026, 8, 10, 12, 30) });
    expect(events[2].impact).toBe("holiday");
  });

  it("merges without duplicates and knows which days it covers", () => {
    const events = normalizeForexFactory(rows);
    expect(mergeNews(events, normalizeForexFactory(rows))).toHaveLength(3);
    const days = newsCoverage(events, TZ, "cme");
    expect(days.has("2026-09-08")).toBe(true);
    expect(days.has("2026-09-11")).toBe(true);
    expect(days.has("2026-09-15")).toBe(false);
  });
});
