import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { paths, writeFileAtomic } from "./config";

// Your journal lives in the browser. As a safety net, the app sends the
// companion a copy after changes, and one file per day is kept in
// the data folder's backups/ (the last 30 days). If the browser's storage is ever
// cleared, Debrief offers to restore from the newest backup.

const KEEP = 30;

export function saveBackup(data: unknown, now = new Date()): { file: string; savedAt: number } {
  const day = now.toISOString().slice(0, 10);
  const file = join(paths.backups, `debrief-${day}.json`);
  writeFileAtomic(file, JSON.stringify({ savedAt: now.getTime(), app: "debrief", data }));
  prune();
  return { file, savedAt: now.getTime() };
}

function list(): string[] {
  try {
    return readdirSync(paths.backups)
      .filter((f) => /^debrief-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

function prune(): void {
  const files = list();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    try {
      unlinkSync(join(paths.backups, f));
    } catch {
      // ignore
    }
  }
}

export function latestBackup(): { savedAt: number; data: unknown; file: string } | null {
  const files = list();
  for (const f of files.reverse()) {
    const full = join(paths.backups, f);
    try {
      const parsed = JSON.parse(readFileSync(full, "utf8")) as { savedAt?: number; data?: unknown };
      if (parsed && parsed.data) return { savedAt: parsed.savedAt ?? statSync(full).mtimeMs, data: parsed.data, file: full };
    } catch {
      // skip unreadable backup
    }
  }
  return null;
}

export function backupInfo(): { count: number; latest: number | null } {
  const files = list();
  if (!files.length) return { count: 0, latest: null };
  try {
    return { count: files.length, latest: statSync(join(paths.backups, files[files.length - 1])).mtimeMs };
  } catch {
    return { count: files.length, latest: null };
  }
}
