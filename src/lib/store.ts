import { create } from "zustand";
import type { FileAnalysis } from "../../shared/import";
import type { ParsedFile } from "../../shared/import/types";
import { mergeNews } from "../../shared/news";
import { applyImport, removeImport, removeSample, type ImportMeta, type ImportOutcome } from "../../shared/store/applyImport";
import { accountsOf } from "../../shared/trades/roundtrips";
import { defaultData, normalizeData, type AppData } from "../../shared/store/data";
import type {
  AccountGuard,
  DayJournal,
  ManualMark,
  NewsEvent,
  Profile,
  Rule,
  Settings,
  TradeNote,
} from "../../shared/types";
import type { StoredDebrief, StoredPlaybook } from "../../shared/ai/schemas";
import { loadData, requestPersistence, saveDataSoon } from "./persist";

// One store for the whole app. Every change goes through `update`, which saves
// to the browser automatically. Pure logic (importing, dedupe, grading) lives in
// shared/ and is unit-tested; this file only wires it to React.

export interface PendingMapping {
  id: string;
  analysis: FileAnalysis;
  via: ImportMeta["via"];
  /** Companion inbox id, so the file can be marked done once handled. */
  inboxId?: string;
}

interface State {
  data: AppData;
  hydrated: boolean;
  importOpen: boolean;
  proOpen: boolean;
  mappings: PendingMapping[];
  /** Keys of executions added by the most recent import (for "view" links). */
  lastImportDays: string[];
}

export const useStore = create<State>(() => ({
  data: defaultData(),
  hydrated: false,
  importOpen: false,
  proOpen: false,
  mappings: [],
  lastImportDays: [],
}));

export const getData = () => useStore.getState().data;

export function update(fn: (d: AppData) => AppData): void {
  const next = fn(useStore.getState().data);
  useStore.setState({ data: next });
  saveDataSoon(next);
}

export async function hydrate(): Promise<void> {
  const raw = await loadData();
  const data = raw ? normalizeData(raw) : defaultData();
  useStore.setState({ data, hydrated: true });
  void requestPersistence();
}

export function replaceAll(raw: unknown): AppData {
  const data = normalizeData(raw);
  useStore.setState({ data });
  saveDataSoon(data);
  return data;
}

// ---------- UI state ----------
export const openImport = (open = true) => useStore.setState({ importOpen: open });
export const openPro = (open = true) => useStore.setState({ proOpen: open });

export function queueMapping(m: Omit<PendingMapping, "id">): void {
  useStore.setState((s) => ({ mappings: [...s.mappings, { ...m, id: `${Date.now()}-${Math.random()}` }] }));
}
export function dropMapping(id: string): void {
  useStore.setState((s) => ({ mappings: s.mappings.filter((m) => m.id !== id) }));
}

// ---------- Imports ----------
export function importParsed(parsed: ParsedFile, meta: ImportMeta): ImportOutcome {
  const outcome = applyImport(getData(), parsed, meta);
  let data = outcome.data;
  // An Account Guard set up before any trades existed belongs to the only account there is.
  const accounts = accountsOf(data.executions);
  if (accounts.length === 1 && data.guards.some((g) => !g.account)) {
    data = { ...data, guards: data.guards.map((g) => (g.account ? g : { ...g, account: accounts[0] })) };
  }
  useStore.setState({ data });
  saveDataSoon(data);
  return { ...outcome, data };
}

export function undoImport(importId: string): void {
  update((d) => removeImport(d, importId));
}

export function clearSample(): void {
  update((d) => removeSample(d));
}

// ---------- Profile, settings, rules ----------
export function setProfile(patch: Partial<Profile>): void {
  update((d) => ({ ...d, profile: { ...d.profile, ...patch } }));
}

export function setSettings(patch: Partial<Settings>): void {
  update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
}

export function finishOnboarding(): void {
  update((d) => ({ ...d, onboarded: true }));
}

export function setRules(rules: Rule[]): void {
  update((d) => ({ ...d, rules }));
}

export function upsertRule(rule: Rule): void {
  update((d) => {
    const exists = d.rules.some((r) => r.id === rule.id);
    return { ...d, rules: exists ? d.rules.map((r) => (r.id === rule.id ? rule : r)) : [...d.rules, rule] };
  });
}

export function deleteRule(id: string): void {
  update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id) }));
}

export function upsertGuard(guard: AccountGuard): void {
  update((d) => {
    const exists = d.guards.some((g) => g.id === guard.id);
    return { ...d, guards: exists ? d.guards.map((g) => (g.id === guard.id ? guard : g)) : [...d.guards, guard] };
  });
}

export function deleteGuard(id: string): void {
  update((d) => ({ ...d, guards: d.guards.filter((g) => g.id !== id) }));
}

// ---------- Journal ----------
export function setTradeNote(key: string, patch: Partial<TradeNote>): void {
  update((d) => ({ ...d, tradeNotes: { ...d.tradeNotes, [key]: { ...d.tradeNotes[key], ...patch } } }));
}

export function setDayJournal(day: string, patch: Partial<DayJournal>): void {
  update((d) => ({ ...d, journal: { ...d.journal, [day]: { ...d.journal[day], ...patch } } }));
}

export function markDayRule(day: string, ruleId: string, mark: ManualMark | null): void {
  update((d) => {
    const current = { ...(d.journal[day]?.manual ?? {}) };
    if (mark) current[ruleId] = mark;
    else delete current[ruleId];
    return { ...d, journal: { ...d.journal, [day]: { ...d.journal[day], manual: current } } };
  });
}

export function markTradeRule(key: string, ruleId: string, mark: ManualMark | null): void {
  update((d) => {
    const current = { ...(d.tradeNotes[key]?.manual ?? {}) };
    if (mark) current[ruleId] = mark;
    else delete current[ruleId];
    return { ...d, tradeNotes: { ...d.tradeNotes, [key]: { ...d.tradeNotes[key], manual: current } } };
  });
}

export function saveDebrief(debrief: StoredDebrief): void {
  update((d) => ({ ...d, debriefs: { ...d.debriefs, [debrief.key]: debrief } }));
}

export function savePlaybook(playbook: StoredPlaybook): void {
  update((d) => ({ ...d, playbook }));
}

export function addNews(events: NewsEvent[]): void {
  if (!events.length) return;
  const d = getData();
  const merged = mergeNews(d.news, events);
  if (merged.length === d.news.length && merged.every((e, i) => e.id === d.news[i]?.id)) return;
  update((x) => ({ ...x, news: mergeNews(x.news, events) }));
}

export function markSeen(signatures: string[]): void {
  if (!signatures.length) return;
  const now = Date.now();
  update((d) => {
    const seen = { ...d.seenFiles };
    for (const s of signatures) seen[s] = now;
    return { ...d, seenFiles: seen };
  });
}

export function resetEverything(): void {
  const fresh = defaultData();
  useStore.setState({ data: fresh, mappings: [] });
  saveDataSoon(fresh);
}
