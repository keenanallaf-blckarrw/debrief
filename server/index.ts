import "./env";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { refreshCalendar } from "./calendar";
import { DATA_DIR, ensureDirs, loadConfig, paths, PORT, VERSION } from "./config";
import { Prefetcher } from "./marketData";
import { Inbox } from "./watcher";

// The Debrief companion: a small local server that
//   1. serves the Debrief app at http://localhost:4317,
//   2. watches your Downloads folder and hands new trade exports to the app,
//   3. holds your Anthropic key and runs the AI coach,
//   4. fetches price candles (Yahoo Finance) and the economic calendar (Forex Factory),
//   5. keeps daily backups of your journal in its data folder.
// It only listens on 127.0.0.1, so nothing outside your computer can reach it.

ensureDirs();

const url = `http://localhost:${PORT}`;
const shouldOpen = process.argv.includes("--open");

function openBrowser(target: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // If the browser can't be opened automatically, the URL is printed below.
  }
}

async function alreadyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) });
    const json = (await res.json()) as { app?: string };
    return json.app === "debrief-companion";
  } catch {
    return false;
  }
}

async function main() {
  if (await alreadyRunning()) {
    console.log(`\n  Debrief is already running at ${url}\n`);
    if (shouldOpen) openBrowser(url);
    return;
  }

  const inbox = new Inbox();
  const prefetcher = new Prefetcher();
  const app = createApp({ inbox, prefetcher });
  const cfg = loadConfig();

  const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
    const built = existsSync(paths.dist);
    console.log(`\n  Debrief companion ${VERSION}`);
    console.log(`  App:            ${built ? url : "(run `npm run build` first, or use `npm run dev`)"}`);
    console.log(`  Watching:       ${cfg.watchEnabled ? cfg.watchDir : "off"}`);
    console.log(`  Your data:      ${DATA_DIR}`);
    console.log(`  Stop it with:   Control + C\n`);
    if (shouldOpen && built) openBrowser(url);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  Port ${PORT} is busy. Another program is using it.`);
      console.error(`  Close it, or start Debrief on another port:  DEBRIEF_PORT=4318 npm start\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  if (cfg.watchEnabled) {
    await inbox.start(cfg.watchDir);
    // Exports that landed while the companion wasn't running (the watcher only
    // sees new files). Already-imported files are remembered and skipped.
    inbox.scan(cfg.watchDir, 14);
  }
  void refreshCalendar();
  setInterval(() => void refreshCalendar(), 60 * 60_000).unref();

  const shutdown = async () => {
    await inbox.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
