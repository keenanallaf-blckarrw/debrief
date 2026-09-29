import { describe, expect, it } from "vitest";
import { splitByRules } from "../shared/analytics/insights";
import { analyzeFile } from "../shared/import/index";
import { mergeNews, newsCoverage, normalizeForexFactory } from "../shared/news";
import { starterRules } from "../shared/rules/catalog";
import { evaluateAll } from "../shared/rules/evaluate";
import { generateSampleCsv, SAMPLE_FILE_NAME, sampleNews } from "../shared/sample";
import { applyImport, hasSample, removeSample, sampleOutdated } from "../shared/store/applyImport";
import type { Rule } from "../shared/types";
import { fixture, freshData, tradesOf, TZ } from "./helpers";

/** The sample journal graded against a rule set, as the Insights page does it. */
function gradeSample(endDay: string, rules: Rule[]) {
  const a = analyzeFile(generateSampleCsv({ endDay, tz: TZ }), "sample.csv", { tz: TZ });
  const news = sampleNews(endDay);
  const data = { ...applyImport(freshData(), a.parsed!, { fileName: "sample.csv", via: "sample" }).data, news, rules };
  const trades = tradesOf(data);
  const ev = evaluateAll(trades, rules, { news, newsDays: newsCoverage(news, TZ, "cme"), orders: [], journal: {}, tradeNotes: {} });
  const broken = new Set(trades.filter((t) => ev.byTrade.has(t.key)).map((t) => t.key));
  return { trades, ev, split: splitByRules(trades, broken) };
}

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

  // The tour exists to make one point: following your rules pays, breaking them
  // costs. Whatever weekdays the sample lands on, and with the starter rules or
  // every rule switched on, it has to say so.
  const starters = starterRules();
  const ruleSets = { "the starter rules": starters.filter((s) => s.on).map((s) => s.rule), "every rule": starters.map((s) => s.rule) };
  for (const [name, rules] of Object.entries(ruleSets)) {
    for (const endDay of ["2026-09-25", "2026-09-28", "2026-10-07", "2027-01-15"]) {
      it(`shows rule-breaking costing money (${name}, ending ${endDay})`, () => {
        const { split, trades } = gradeSample(endDay, rules);
        expect(split.clean.net).toBeGreaterThan(2500);
        expect(split.broken.net).toBeLessThan(-2500);
        expect(split.clean.winRate!).toBeGreaterThan(split.broken.winRate! + 0.15);
        // He still ends up ahead: the rules work, the leaks eat most of it.
        expect(trades.reduce((s, t) => s + t.net, 0)).toBeGreaterThan(0);
      });
    }
  }

  it("grades clean days above rough ones, and the rough ones lose money", () => {
    const { ev } = gradeSample("2026-09-28", ruleSets["the starter rules"]);
    const net = (days: typeof ev.days) => days.reduce((s, d) => s + d.trades.reduce((x, t) => x + t.net, 0), 0) / days.length;
    const clean = ev.days.filter((d) => d.broken === 0);
    const rough = ev.days.filter((d) => d.grade === "F");
    expect(clean.length).toBeGreaterThanOrEqual(8);
    expect(rough.length).toBeGreaterThanOrEqual(4);
    expect(net(clean)).toBeGreaterThan(200);
    expect(net(rough)).toBeLessThan(-300);
  });

  it("knows when a loaded sample is from an older version of the tour", () => {
    const a = analyzeFile(csv, "sample.csv", { tz: TZ });
    const parsed = { ...a.parsed!, detection: { ...a.parsed!.detection, format: "sample" as const } };
    const old = applyImport(freshData(), parsed, { fileName: "Sample journal (Debrief tour).csv", via: "sample" }).data;
    const current = applyImport(freshData(), parsed, { fileName: SAMPLE_FILE_NAME, via: "sample" }).data;
    expect(sampleOutdated(old, SAMPLE_FILE_NAME)).toBe(true);
    expect(sampleOutdated(current, SAMPLE_FILE_NAME)).toBe(false);
    expect(sampleOutdated(freshData(), SAMPLE_FILE_NAME)).toBe(false);
  });

  it("opens on a session that was green until the rules were broken", () => {
    const { ev } = gradeSample("2026-09-28", ruleSets["the starter rules"]);
    const latest = ev.days[ev.days.length - 1];
    let run = 0;
    const path = latest.trades.map((t) => (run += t.net));
    expect(Math.max(...path.slice(0, 3))).toBeGreaterThan(300);
    expect(run).toBeLessThan(-500);
    expect(latest.grade).toBe("F");
    expect(latest.trades.slice(0, 3).every((t) => !ev.byTrade.has(t.key))).toBe(true);
    expect(latest.trades.slice(3).every((t) => ev.byTrade.has(t.key))).toBe(true);
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
