import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Where the companion keeps things on your computer (the "data folder"):
//   config.json          your companion settings (watch folder…)
//   .anthropic-key       your AI key, readable only by you
//   backups/             a daily copy of your journal
//   calendar/            economic calendar, saved week by week
//   cache/candles/       price candles around your trades
// It lives in your system's app-data folder, never inside the project folder
// (on a Mac, ~/Debrief and ~/debrief are the same folder, so a home-folder
// default would have put your key next to the code). Override with DEBRIEF_DATA_DIR.

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = "2.0.0";

export const PORT = Number(process.env.DEBRIEF_PORT || 4317);
function appDataDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Debrief");
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Debrief");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "debrief");
}

export const DATA_DIR = resolve(process.env.DEBRIEF_DATA_DIR || appDataDir());
export const DEFAULT_MODEL = "claude-opus-5-5";

export const paths = {
  config: join(DATA_DIR, "config.json"),
  key: join(DATA_DIR, ".anthropic-key"),
  backups: join(DATA_DIR, "backups"),
  calendar: join(DATA_DIR, "calendar"),
  candles: join(DATA_DIR, "cache", "candles"),
  inbox: join(DATA_DIR, "inbox-state.json"),
  dist: join(PROJECT_ROOT, "dist"),
};

export interface CompanionConfig {
  watchDir: string;
  watchEnabled: boolean;
  aiModel: string;
  aiEffort: "low" | "medium" | "high" | "xhigh" | "max";
}

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function defaults(): CompanionConfig {
  return {
    watchDir: process.env.DEBRIEF_WATCH_DIR || join(homedir(), "Downloads"),
    watchEnabled: true,
    aiModel: process.env.DEBRIEF_AI_MODEL || DEFAULT_MODEL,
    aiEffort: (EFFORTS.has(process.env.DEBRIEF_AI_EFFORT ?? "") ? process.env.DEBRIEF_AI_EFFORT : "medium") as CompanionConfig["aiEffort"],
  };
}

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, paths.backups, paths.calendar, paths.candles]) mkdirSync(dir, { recursive: true });
}

/** Write through a temp file so a crash mid-write never leaves half a file. */
export function writeFileAtomic(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, mode === undefined ? undefined : { mode });
  renameSync(tmp, path);
  if (mode !== undefined) chmodSync(path, mode);
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

let cached: CompanionConfig | null = null;

export function loadConfig(): CompanionConfig {
  if (cached) return cached;
  const saved = readJson<Partial<CompanionConfig>>(paths.config, {});
  const base = defaults();
  cached = {
    watchDir: typeof saved.watchDir === "string" && saved.watchDir ? saved.watchDir : base.watchDir,
    watchEnabled: typeof saved.watchEnabled === "boolean" ? saved.watchEnabled : base.watchEnabled,
    aiModel: process.env.DEBRIEF_AI_MODEL || (typeof saved.aiModel === "string" && saved.aiModel ? saved.aiModel : base.aiModel),
    aiEffort: EFFORTS.has(String(saved.aiEffort)) ? (saved.aiEffort as CompanionConfig["aiEffort"]) : base.aiEffort,
  };
  return cached;
}

export function saveConfig(patch: Partial<CompanionConfig>): CompanionConfig {
  const next = { ...loadConfig(), ...patch };
  writeFileAtomic(paths.config, JSON.stringify(next, null, 2));
  cached = next;
  return next;
}

export type KeySource = "environment" | "saved" | null;

export function apiKey(): { key: string | null; source: KeySource } {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "environment" };
  try {
    const key = readFileSync(paths.key, "utf8").trim();
    if (key) return { key, source: "saved" };
  } catch {
    // no saved key
  }
  return { key: null, source: null };
}

export function saveApiKey(key: string): void {
  writeFileAtomic(paths.key, key.trim() + "\n", 0o600);
}

export function deleteApiKey(): void {
  try {
    writeFileAtomic(paths.key, "", 0o600);
  } catch {
    // nothing to delete
  }
}
