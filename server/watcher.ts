import { watch, type FSWatcher } from "chokidar";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { readCsv } from "../shared/import/csv";
import { detectFormat } from "../shared/import/detect";
import { isSpreadsheetName } from "../shared/import/index";
import type { Detection } from "../shared/import/types";
import { hash } from "../shared/util/hash";
import { paths, readJson, writeFileAtomic } from "./config";

// Auto-import: the companion watches a folder (your Downloads by default). When
// a TradingView or Tradovate export lands there, it recognizes the file from its
// columns and tells the Debrief app, which imports it. No API keys, works with
// prop firm accounts, and works with any broker that exports CSV.

export interface InboxItem {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  detectedAt: number;
  detection: Pick<Detection, "format" | "label" | "kind" | "needsMapping" | "note">;
}

type Listener = (item: InboxItem) => void;

const MAX_BYTES = 8 * 1024 * 1024;

function signature(path: string, size: number, mtime: number): string {
  return `f${hash(`${path}|${size}|${Math.round(mtime)}`)}`;
}

/** Read just the start of a file: enough for the header row and a few rows. */
function head(path: string, bytes = 64 * 1024): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function classifyFile(path: string): InboxItem["detection"] | null {
  if (!isSpreadsheetName(path)) return null;
  const st = statSync(path);
  if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) return null;
  let text = head(path);
  // Keep only complete lines so the header parse isn't thrown by a cut-off row.
  const lastBreak = text.lastIndexOf("\n");
  if (st.size > text.length && lastBreak > 0) text = text.slice(0, lastBreak);
  const table = readCsv(text);
  if (!table.headers.length) return null;
  const d = detectFormat(table.headers);
  if (d.kind === "unknown" || d.kind === "ignore") return null;
  return { format: d.format, label: d.label, kind: d.kind, needsMapping: d.needsMapping, note: d.note };
}

export class Inbox {
  private items = new Map<string, InboxItem>();
  private processed: Record<string, number>;
  private listeners = new Set<Listener>();
  private watcher: FSWatcher | null = null;
  watchingDir: string | null = null;
  error: string | null = null;

  constructor() {
    this.processed = readJson<Record<string, number>>(paths.inbox, {});
  }

  onItem(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  pending(): InboxItem[] {
    return [...this.items.values()].sort((a, b) => a.modifiedAt - b.modifiedAt);
  }

  get(id: string): InboxItem | undefined {
    return this.items.get(id);
  }

  read(id: string): string | null {
    const item = this.items.get(id);
    if (!item || !existsSync(item.path)) return null;
    return readFileSync(item.path, "utf8");
  }

  markDone(id: string): void {
    this.items.delete(id);
    this.processed[id] = Date.now();
    // Keep the processed list from growing forever.
    const entries = Object.entries(this.processed).sort((a, b) => b[1] - a[1]).slice(0, 5000);
    this.processed = Object.fromEntries(entries);
    writeFileAtomic(paths.inbox, JSON.stringify(this.processed));
  }

  /** Consider one file; returns the inbox item if it's a new trade export. */
  consider(path: string): InboxItem | null {
    try {
      const st = statSync(path);
      const id = signature(path, st.size, st.mtimeMs);
      if (this.processed[id] || this.items.has(id)) return this.items.get(id) ?? null;
      const detection = classifyFile(path);
      if (!detection) return null;
      const item: InboxItem = {
        id,
        name: basename(path),
        path,
        size: st.size,
        modifiedAt: st.mtimeMs,
        detectedAt: Date.now(),
        detection,
      };
      this.items.set(id, item);
      for (const fn of this.listeners) fn(item);
      return item;
    } catch {
      return null;
    }
  }

  /** Look through the folder for exports from the last `days` days. */
  scan(dir: string, days = 365): InboxItem[] {
    const cutoff = Date.now() - days * 86_400_000;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      this.error = `Can't read ${dir}.`;
      return [];
    }
    const found: InboxItem[] = [];
    for (const name of names) {
      if (!isSpreadsheetName(name)) continue;
      const full = join(dir, name);
      try {
        if (statSync(full).mtimeMs < cutoff) continue;
      } catch {
        continue;
      }
      const item = this.consider(full);
      if (item) found.push(item);
    }
    return found.sort((a, b) => a.modifiedAt - b.modifiedAt);
  }

  async start(dir: string): Promise<void> {
    await this.stop();
    if (!existsSync(dir)) {
      this.error = `The folder ${dir} doesn't exist.`;
      return;
    }
    this.error = null;
    this.watchingDir = dir;
    this.watcher = watch(dir, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 },
      ignored: (p, stats) => Boolean(stats?.isFile() && !isSpreadsheetName(p)),
    });
    const handle = (p: string) => void this.consider(p);
    this.watcher.on("add", handle).on("change", handle).on("error", (err) => {
      this.error = err instanceof Error ? err.message : String(err);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) await this.watcher.close();
    this.watcher = null;
    this.watchingDir = null;
  }
}
