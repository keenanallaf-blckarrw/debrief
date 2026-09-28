import { createStore, get, set } from "idb-keyval";
import type { AppData } from "../../shared/store/data";

// Your journal is saved in this browser's own database (IndexedDB), so it works
// offline and nothing leaves your computer. If IndexedDB isn't available
// (some private windows), localStorage is used instead.

const KEY = "debrief:data:v2";
let store: ReturnType<typeof createStore> | null = null;

function idb() {
  if (!store) store = createStore("debrief", "journal");
  return store;
}

export async function loadData(): Promise<unknown | null> {
  try {
    const v = await get(KEY, idb());
    if (v) return v;
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function write(data: AppData): Promise<void> {
  try {
    await set(KEY, data, idb());
    return;
  } catch {
    // fall through
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    console.warn("Debrief couldn't save to this browser's storage.");
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: AppData | null = null;

export function saveDataSoon(data: AppData): void {
  pending = data;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (pending) void write(pending);
    pending = null;
  }, 350);
}

export function flushSave(): void {
  if (timer && pending) {
    clearTimeout(timer);
    timer = null;
    void write(pending);
    pending = null;
  }
}

/** Ask the browser not to evict Debrief's storage when space runs low. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // not supported
  }
}

/** Remember small UI preferences (e.g. a collapsed section). Never your journal. */
export function pref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`debrief:pref:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`debrief:pref:${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
