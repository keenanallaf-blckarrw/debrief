import { existsSync, statSync } from "node:fs";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { AI_TASKS, type AiTask } from "../shared/ai/inputs";
import { AiError, runTask, verifyKey } from "./ai";
import { backupInfo, latestBackup, saveBackup } from "./backup";
import { calendarStatus, refreshCalendar, savedEvents } from "./calendar";
import { apiKey, DATA_DIR, deleteApiKey, loadConfig, paths, saveApiKey, saveConfig, VERSION } from "./config";
import { CandleError, getCandles, type Prefetcher } from "./marketData";
import { localOnly } from "./security";
import type { Inbox, InboxItem } from "./watcher";

export interface Services {
  inbox: Inbox;
  prefetcher: Prefetcher;
  fetchImpl?: typeof fetch;
  serveApp?: boolean;
}

export function createApp(s: Services) {
  const app = new Hono();
  app.use("/api/*", localOnly());

  app.get("/api/status", (c) => {
    const cfg = loadConfig();
    const key = apiKey();
    return c.json({
      app: "debrief-companion",
      version: VERSION,
      dataDir: DATA_DIR,
      ai: { ready: Boolean(key.key), source: key.source, model: cfg.aiModel, effort: cfg.aiEffort },
      watch: { enabled: cfg.watchEnabled, dir: cfg.watchDir, watching: s.inbox.watchingDir !== null, error: s.inbox.error, pending: s.inbox.pending().length },
      calendar: calendarStatus(),
      backups: backupInfo(),
      prefetching: s.prefetcher.pending,
      time: Date.now(),
    });
  });

  // ---- Live updates: new files in the watched folder ----
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (item: InboxItem) => void stream.writeSSE({ event: "inbox", data: JSON.stringify(item) });
      const off = s.inbox.onItem(send);
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ pending: s.inbox.pending().length }) });
      let open = true;
      stream.onAbort(() => {
        open = false;
        off();
      });
      while (open) {
        await stream.sleep(25_000);
        if (open) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    }),
  );

  app.get("/api/inbox", (c) => c.json({ items: s.inbox.pending() }));

  app.get("/api/inbox/:id/content", (c) => {
    const text = s.inbox.read(c.req.param("id"));
    if (text === null) return c.json({ error: "That file is gone or was already imported." }, 404);
    return c.text(text);
  });

  app.post("/api/inbox/:id/done", (c) => {
    s.inbox.markDone(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/inbox/scan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { days?: number };
    const days = Math.min(365, Math.max(1, Number(body.days) || 60));
    const cfg = loadConfig();
    const found = s.inbox.scan(cfg.watchDir, days);
    return c.json({ dir: cfg.watchDir, found: found.length, items: s.inbox.pending() });
  });

  // ---- Settings the companion owns ----
  app.post("/api/config/ai-key", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { key?: string };
    const key = String(body.key ?? "").trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
      return c.json({ ok: false, message: "That doesn't look like an Anthropic API key. It should start with sk-ant-." }, 400);
    }
    const check = await verifyKey(key);
    if (!check.ok) return c.json(check, 400);
    saveApiKey(key);
    return c.json(check);
  });

  app.delete("/api/config/ai-key", (c) => {
    deleteApiKey();
    return c.json({ ok: true, environmentKeyStillSet: apiKey().source === "environment" });
  });

  app.post("/api/config/watch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dir?: string; enabled?: boolean };
    const patch: { watchDir?: string; watchEnabled?: boolean } = {};
    if (typeof body.dir === "string" && body.dir.trim()) {
      const dir = body.dir.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return c.json({ error: `The folder ${dir} doesn't exist.` }, 400);
      patch.watchDir = dir;
    }
    if (typeof body.enabled === "boolean") patch.watchEnabled = body.enabled;
    const cfg = saveConfig(patch);
    if (cfg.watchEnabled) await s.inbox.start(cfg.watchDir);
    else await s.inbox.stop();
    return c.json({ ok: true, watch: { enabled: cfg.watchEnabled, dir: cfg.watchDir, error: s.inbox.error } });
  });

  // ---- AI coach ----
  app.post("/api/ai/:task", async (c) => {
    const task = c.req.param("task") as AiTask;
    if (!AI_TASKS.includes(task)) return c.json({ error: "Unknown AI task." }, 404);
    const body = await c.req.json().catch(() => null);
    try {
      const out = await runTask(task, body);
      return c.json(out);
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("Something went wrong with the AI request.", 500);
      return c.json({ error: e.message }, e.status as 400);
    }
  });

  // ---- Market data ----
  app.get("/api/candles", async (c) => {
    const symbol = c.req.query("symbol") ?? "";
    const entry = Number(c.req.query("entry"));
    const exit = Number(c.req.query("exit"));
    const interval = c.req.query("interval") as "1m" | "5m" | "60m" | "1d" | undefined;
    if (!symbol || !Number.isFinite(entry) || !Number.isFinite(exit)) return c.json({ error: "Missing symbol, entry or exit." }, 400);
    try {
      return c.json(await getCandles({ symbol, entry, exit, interval }, s.fetchImpl));
    } catch (err) {
      const e = err instanceof CandleError ? err : new CandleError("Couldn't load price data.");
      return c.json({ error: e.message }, e.status as 400);
    }
  });

  app.post("/api/candles/prefetch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { trades?: { symbol: string; entry: number; exit: number }[] };
    const trades = Array.isArray(body.trades) ? body.trades.slice(0, 500) : [];
    const valid = trades.filter((t) => t && typeof t.symbol === "string" && Number.isFinite(t.entry) && Number.isFinite(t.exit));
    return c.json({ queued: s.prefetcher.add(valid), pending: s.prefetcher.pending });
  });

  app.get("/api/calendar", async (c) => {
    await refreshCalendar(s.fetchImpl, c.req.query("refresh") === "1");
    return c.json({ events: savedEvents(), status: calendarStatus() });
  });

  // ---- Backups ----
  app.post("/api/backup", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { data?: unknown } | null;
    if (!body || typeof body.data !== "object" || body.data === null) return c.json({ error: "Nothing to back up." }, 400);
    return c.json(saveBackup(body.data));
  });

  app.get("/api/backup/latest", (c) => {
    const b = latestBackup();
    return b ? c.json(b) : c.json({ error: "No backups yet." }, 404);
  });

  app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

  // ---- The Debrief app itself (built by `npm run build`) ----
  // During `npm run dev`, Vite serves the app instead and there's no dist/ yet.
  if (s.serveApp !== false && existsSync(paths.dist)) {
    app.use("/*", serveStatic({ root: paths.dist }));
    app.get("*", serveStatic({ root: paths.dist, path: "index.html" }));
  }
  return app;
}
