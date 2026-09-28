import { createStore, del, get, set } from "idb-keyval";
import { create } from "zustand";
import { isSpreadsheetName } from "../../shared/import";
import { hash } from "../../shared/util/hash";
import { analyzeText, commitAnalysis, type ImportReport } from "./importer";
import { getData, markSeen, queueMapping } from "./store";

// Auto-import without the companion (for the hosted web version): Chrome and
// Edge can be given read access to one folder, such as Downloads. While Debrief
// is open, it checks that folder every few seconds and imports new exports.
// The companion does the same job even when Debrief isn't open.

interface PermissionHandle {
  queryPermission(opts: { mode: "read" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "read" }): Promise<PermissionState>;
}
type DirHandle = FileSystemDirectoryHandle & PermissionHandle;

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: "read"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

interface FolderState {
  name: string | null;
  permission: PermissionState | "none";
  watching: boolean;
  lastScan: number | null;
}

export const useFolder = create<FolderState>(() => ({ name: null, permission: "none", watching: false, lastScan: null }));

const KEY = "debrief:folder";
let idb: ReturnType<typeof createStore> | null = null;
const store = () => (idb ??= createStore("debrief", "handles"));
let handle: DirHandle | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function folderWatchSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function signature(name: string, f: File): string {
  return `b${hash(`${name}|${f.size}|${f.lastModified}`)}`;
}

async function scan(importRecentDays: number | null): Promise<ImportReport[]> {
  if (!handle) return [];
  const seen = getData().seenFiles;
  const reports: ImportReport[] = [];
  const newSeen: string[] = [];
  const cutoff = importRecentDays === null ? Infinity : Date.now() - importRecentDays * 86_400_000;
  const entries: { name: string; file: File }[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !isSpreadsheetName(entry.name)) continue;
    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      entries.push({ name: entry.name, file });
    } catch {
      // unreadable file; skip
    }
  }
  entries.sort((a, b) => a.file.lastModified - b.file.lastModified);
  for (const { name, file } of entries) {
    const sig = signature(name, file);
    if (seen[sig]) continue;
    newSeen.push(sig);
    if (importRecentDays !== null && file.lastModified < cutoff) continue;
    if (file.size > 8 * 1024 * 1024) continue;
    const a = analyzeText(await file.text(), name);
    if (a.detection.kind === "unknown" || a.detection.kind === "ignore") continue;
    if (a.suggested && !a.parsed) {
      queueMapping({ analysis: a, via: "auto" });
      continue;
    }
    reports.push(commitAnalysis(a, "auto"));
  }
  markSeen(newSeen);
  useFolder.setState({ lastScan: Date.now() });
  return reports;
}

function startTimer(onReports: (r: ImportReport[]) => void) {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    const r = await scan(0.25).catch(() => []);
    if (r.length) onReports(r);
  }, 5000);
  useFolder.setState({ watching: true });
}

/** Ask for a folder (needs a click). Imports exports from the last `days` days. */
export async function connectFolder(onReports: (r: ImportReport[]) => void, days = 60): Promise<ImportReport[]> {
  if (!window.showDirectoryPicker) throw new Error("This browser can't watch folders. Use Chrome or Edge, or run the Debrief companion.");
  const picked = (await window.showDirectoryPicker({ id: "debrief-downloads", mode: "read", startIn: "downloads" })) as DirHandle;
  handle = picked;
  await set(KEY, picked, store());
  useFolder.setState({ name: picked.name, permission: "granted" });
  const reports = await scan(days);
  startTimer(onReports);
  return reports;
}

/** On load: find the folder from last time. Access may need one click to resume. */
export async function restoreFolder(onReports: (r: ImportReport[]) => void): Promise<void> {
  if (!folderWatchSupported()) return;
  try {
    const saved = (await get(KEY, store())) as DirHandle | undefined;
    if (!saved) return;
    handle = saved;
    const permission = await saved.queryPermission({ mode: "read" });
    useFolder.setState({ name: saved.name, permission });
    if (permission === "granted") startTimer(onReports);
  } catch {
    // stored handle unusable
  }
}

export async function resumeFolder(onReports: (r: ImportReport[]) => void): Promise<ImportReport[]> {
  if (!handle) return [];
  const permission = await handle.requestPermission({ mode: "read" });
  useFolder.setState({ permission });
  if (permission !== "granted") return [];
  const reports = await scan(0.5);
  startTimer(onReports);
  return reports;
}

export async function disconnectFolder(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  handle = null;
  await del(KEY, store()).catch(() => undefined);
  useFolder.setState({ name: null, permission: "none", watching: false, lastScan: null });
}
