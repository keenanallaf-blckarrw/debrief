import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "./helpers";

// Point the companion at a throwaway data folder before loading it.
const dataDir = mkdtempSync(join(tmpdir(), "debrief-test-"));
process.env.DEBRIEF_DATA_DIR = dataDir;
delete process.env.ANTHROPIC_API_KEY;

const { createApp } = await import("../server/app");
const { ensureDirs } = await import("../server/config");
const { Inbox, classifyFile } = await import("../server/watcher");
const { Prefetcher, parseYahoo, pickInterval, windowFor, getCandles, daysCovering } = await import("../server/marketData");
const { setClientForTests } = await import("../server/ai");

ensureDirs();

const yahooJson = {
  chart: {
    result: [
      {
        timestamp: [1790343000, 1790343060, 1790343120],
        indicators: { quote: [{ open: [1, 2, null], high: [2, 3, 4], low: [0.5, 1, 2], close: [1.5, 2.5, 3], volume: [10, 20, 30] }] },
      },
    ],
    error: null,
  },
};
const STEP: Record<string, number> = { "1m": 60, "5m": 300, "60m": 3600, "1d": 86400 };
/** Yahoo's chart API, faked: a candle every interval across the requested range. */
function yahooRange(url: string): Response {
  const q = new URL(url).searchParams;
  const from = Number(q.get("period1"));
  const to = Number(q.get("period2"));
  const step = STEP[q.get("interval") ?? "1m"];
  const timestamp: number[] = [];
  for (let t = Math.ceil(from / step) * step; t < to; t += step) timestamp.push(t);
  const px = timestamp.map((t) => 20000 + (t % 7200) / 60);
  const quote = { open: px, high: px.map((p) => p + 2), low: px.map((p) => p - 2), close: px, volume: px.map(() => 10) };
  return new Response(JSON.stringify({ chart: { result: [{ timestamp, indicators: { quote: [quote] } }], error: null } }), { status: 200 });
}
const yahooCalls: string[] = [];
const fakeFetch = (async (url: string) => {
  if (String(url).includes("yahoo")) {
    yahooCalls.push(String(url));
    return yahooRange(String(url));
  }
  if (String(url).includes("faireconomy"))
    return new Response(JSON.stringify([{ title: "CPI m/m", country: "USD", date: "2026-09-10T08:30:00-04:00", impact: "High" }]), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const inbox = new Inbox();
const app = createApp({ inbox, prefetcher: new Prefetcher(fakeFetch, 0), fetchImpl: fakeFetch, serveApp: false });
const local = { host: "localhost:4317" };
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  app.request(path, { ...init, headers: { ...local, ...(init.headers ?? {}) } });

afterAll(() => {
  setClientForTests(null);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("security", () => {
  it("answers the app on localhost", async () => {
    const res = await req("/api/status");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { app: string; ai: { ready: boolean } };
    expect(json.app).toBe("debrief-companion");
    expect(json.ai.ready).toBe(false);
  });

  it("refuses other hosts (DNS rebinding)", async () => {
    const res = await app.request("/api/status", { headers: { host: "evil.example:4317" } });
    expect(res.status).toBe(403);
  });

  it("refuses cross-site requests and foreign origins", async () => {
    expect((await req("/api/status", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const post = await req("/api/backup", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(post.status).toBe(403);
  });

  it("refuses non-JSON writes, which would skip the browser's preflight check", async () => {
    const res = await req("/api/ai/day-debrief", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(res.status).toBe(415);
  });
});

describe("AI coach", () => {
  it("explains how to turn itself on when there's no key", async () => {
    const res = await req("/api/ai/parse-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Max 3 trades a day", markets: ["Futures"] }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("Add your Anthropic API key");
  });

  it("validates input before anything reaches Claude", async () => {
    const res = await req("/api/ai/day-debrief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: "gold" }) });
    expect(res.status).toBe(400);
  });

  it("returns the parsed, schema-shaped answer and uses fallbacks", async () => {
    let sent: Record<string, unknown> | null = null;
    setClientForTests({
      beta: {
        messages: {
          parse: (async (params: Record<string, unknown>) => {
            sent = params;
            return { stop_reason: "end_turn", model: "claude-opus-5-5", parsed_output: { rules: [], notes: "" }, content: [] };
          }) as never,
          create: (async () => ({ stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "text", text: "hi" }] })) as never,
        },
      },
    });
    const res = await req("/api/ai/parse-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Max 3 trades a day", markets: ["Futures"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { rules: [], notes: "" }, model: "claude-opus-5-5" });
    expect(sent!.model).toBe("claude-opus-5-5");
    expect(sent!.fallbacks).toBe("default");
    expect(sent!.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect((sent!.output_config as { effort: string }).effort).toBe("medium");
  });

  it("turns a refusal into a clear message", async () => {
    setClientForTests({
      beta: {
        messages: {
          parse: (async () => ({ stop_reason: "refusal", model: "x", parsed_output: null, content: [] })) as never,
          create: (async () => ({})) as never,
        },
      },
    });
    const res = await req("/api/ai/parse-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Max 3 trades a day", markets: [] }),
    });
    expect(res.status).toBe(422);
  });
});

describe("price candles", () => {
  it("picks the finest candle size Yahoo still has", () => {
    const now = Date.UTC(2026, 8, 28);
    expect(pickInterval(now - 3 * 86_400_000, now)).toBe("1m");
    expect(pickInterval(now - 45 * 86_400_000, now)).toBe("5m");
    expect(pickInterval(now - 200 * 86_400_000, now)).toBe("60m");
    expect(pickInterval(now - 900 * 86_400_000, now)).toBe("1d");
  });

  it("frames the trade with context on both sides", () => {
    const w = windowFor(1_000_000_000_000, 1_000_000_600_000, "1m");
    expect(1_000_000_000_000 - w.from).toBeGreaterThanOrEqual(45 * 60_000);
    expect(w.to - 1_000_000_600_000).toBeGreaterThanOrEqual(45 * 60_000);
  });

  it("drops empty bars from Yahoo's response", () => {
    expect(parseYahoo(yahooJson)).toHaveLength(2);
  });

  it("serves candles for a trade and saves the whole days it touches", async () => {
    const entry = Date.UTC(2026, 8, 20, 14, 30) + 17; // a Sunday afternoon, UTC
    const now = entry + 3 * 86_400_000;
    const first = await getCandles({ symbol: "MNQU6", entry, exit: entry + 60_000 }, fakeFetch, now);
    expect(first).toMatchObject({ yahooSymbol: "MNQ=F", interval: "1m", cached: false, saved: true });
    // The chart window: 45 minutes either side, every minute.
    expect(first.bars.length).toBeGreaterThanOrEqual(90);
    expect(first.bars.every((b) => b.time * 1000 >= first.from && b.time * 1000 < first.to)).toBe(true);
    const calls = yahooCalls.length;
    const again = await getCandles({ symbol: "MNQU6", entry: entry + 600_000, exit: entry + 900_000 }, fakeFetch, now);
    expect(again).toMatchObject({ cached: true, saved: true });
    expect(yahooCalls.length).toBe(calls);
  });

  it("keeps showing 1-minute candles after Yahoo has dropped them", async () => {
    const entry = Date.UTC(2026, 8, 2, 14, 12, 5);
    await getCandles({ symbol: "MNQU6", entry, exit: entry + 170_000 }, fakeFetch, entry + 27 * 86_400_000);
    // A month later Yahoo only has 5-minute candles for that day.
    const noFetch = (async () => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    const later = await getCandles({ symbol: "MNQU6", entry, exit: entry + 170_000 }, noFetch, entry + 45 * 86_400_000);
    expect(later).toMatchObject({ interval: "1m", saved: true });
  });

  it("fetches neighbouring days in one request", async () => {
    const entry = Date.UTC(2026, 8, 9, 23, 50); // spans midnight UTC
    const before = yahooCalls.length;
    const r = await getCandles({ symbol: "MGCZ6", entry, exit: entry + 20 * 60_000 }, fakeFetch, entry + 5 * 86_400_000);
    expect(daysCovering(r.from, r.to)).toEqual(["2026-09-09", "2026-09-10"]);
    expect(yahooCalls.length - before).toBe(1);
    expect(r.saved).toBe(true);
  });

  it("doesn't save a day that isn't over yet", async () => {
    const now = Date.UTC(2026, 8, 28, 20, 0);
    const r = await getCandles({ symbol: "MESZ6", entry: now - 3_600_000, exit: now - 3_000_000 }, fakeFetch, now);
    expect(r).toMatchObject({ interval: "1m", saved: false });
  });

  it("queues trades for saving while Yahoo still has 1- or 5-minute candles", () => {
    const p = new Prefetcher((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch, 0);
    const now = Date.now();
    expect(p.add([{ symbol: "MNQU6", entry: now - 3 * 86_400_000, exit: now - 3 * 86_400_000 + 60_000 }])).toBe(1);
    expect(p.add([{ symbol: "MNQU6", entry: now - 45 * 86_400_000, exit: now - 45 * 86_400_000 + 60_000 }])).toBe(1);
    expect(p.add([{ symbol: "MNQU6", entry: now - 200 * 86_400_000, exit: now - 200 * 86_400_000 + 60_000 }])).toBe(0);
  });
});

describe("economic calendar and backups", () => {
  it("fetches the week, saves it, and returns saved events", async () => {
    const res = await req("/api/calendar?refresh=1");
    const json = (await res.json()) as { events: { title: string }[] };
    expect(json.events.map((e) => e.title)).toEqual(["CPI m/m"]);
  });

  it("round-trips a backup", async () => {
    const post = await req("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { version: 2, executions: [] } }) });
    expect(post.status).toBe(200);
    const latest = (await (await req("/api/backup/latest")).json()) as { data: { version: number } };
    expect(latest.data.version).toBe(2);
  });
});

describe("watched folder", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "debrief-downloads-"));
    writeFileSync(join(dir, "Position History.csv"), fixture("tradovate-position-history.csv"));
    writeFileSync(join(dir, "account-info.csv"), "Total P/L,Open P/L,Net Liq,Total Margin Used,Available Margin\n0,0,50000,0,50000\n");
    writeFileSync(join(dir, "notes.txt"), "not a trade file");
    writeFileSync(join(dir, "photo.png"), "png");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("recognizes trade exports and ignores everything else", () => {
    expect(classifyFile(join(dir, "Position History.csv"))?.format).toBe("tradovate-position-history");
    expect(classifyFile(join(dir, "account-info.csv"))).toBeNull();
    expect(classifyFile(join(dir, "notes.txt"))).toBeNull();
    expect(classifyFile(join(dir, "photo.png"))).toBeNull();
  });

  it("finds exports on scan, serves their content, and forgets them once imported", async () => {
    const found = inbox.scan(dir, 30);
    expect(found.map((f) => f.name)).toEqual(["Position History.csv"]);
    const id = found[0].id;
    const content = await (await req(`/api/inbox/${id}/content`)).text();
    expect(content).toContain("Bought Timestamp");
    const done = await req(`/api/inbox/${id}/done`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(done.status).toBe(200);
    expect(inbox.scan(dir, 30)).toHaveLength(0);
  });
});
