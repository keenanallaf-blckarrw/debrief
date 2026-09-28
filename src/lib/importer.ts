import { toast } from "sonner";
import type { ExtractedTrades } from "../../shared/ai/schemas";
import { analyzeFile, analyzeTable, hasContent, type FileAnalysis } from "../../shared/import";
import { emptyParsed, type ColumnMapping, type ParsedFile } from "../../shared/import/types";
import { parseSymbol, pointValue } from "../../shared/instruments";
import { generateSampleCsv, SAMPLE_FILE_NAME, sampleNews } from "../../shared/sample";
import type { ImportMeta } from "../../shared/store/applyImport";
import { clean } from "../../shared/util/numbers";
import { parseStamp, tradingDay } from "../../shared/util/time";
import { ai, companion, useCompanion, type InboxItem } from "./companion";
import { addNews, dropMapping, getData, importParsed, queueMapping, useStore, undoImport } from "./store";
import { navigate } from "./router";

// Browser side of importing: read a file, recognize it, add it to the journal,
// and tell the trader what happened in one sentence.

export interface ImportReport {
  fileName: string;
  ok: boolean;
  message: string;
  importId?: string;
  newDays?: string[];
}

function newestDay(parsed: ParsedFile): string | null {
  const d = getData();
  const days = parsed.executions.map((e) => tradingDay(e.entryTime, d.settings.timezone, d.settings.dayGrouping));
  return days.length ? days.sort().pop()! : null;
}

/** Import one already-analyzed file. Returns a report; shows nothing itself. */
export function commitAnalysis(a: FileAnalysis, via: ImportMeta["via"]): ImportReport {
  const parsed = a.parsed;
  if (!parsed) return { fileName: a.fileName, ok: false, message: `${a.fileName} needs its columns confirmed.` };
  if (a.detection.kind === "ignore" || a.detection.kind === "unknown" || !hasContent(parsed)) {
    return { fileName: a.fileName, ok: false, message: `${a.fileName}: ${a.detection.label}. ${a.detection.note ?? "Nothing to import."}` };
  }
  const outcome = importParsed(parsed, { fileName: a.fileName, via });
  const day = newestDay(parsed);
  if (day) useStore.setState({ lastImportDays: [day] });
  return {
    fileName: a.fileName,
    ok: true,
    message: outcome.summary + (outcome.removedSample ? " The sample journal was removed." : ""),
    importId: outcome.record.id,
    newDays: day ? [day] : [],
  };
}

export function analyzeText(text: string, fileName: string, mapping?: ColumnMapping): FileAnalysis {
  return analyzeFile(text, fileName, { tz: getData().settings.timezone }, mapping);
}

function showReport(r: ImportReport): void {
  if (!r.ok || /Nothing new/.test(r.message)) {
    toast(r.message);
    return;
  }
  toast.success(r.message, {
    duration: 7000,
    action: r.newDays?.length
      ? { label: "Debrief it", onClick: () => navigate(`/day/${r.newDays![0]}`) }
      : undefined,
    cancel: r.importId ? { label: "Undo", onClick: () => undoImport(r.importId!) } : undefined,
  });
}

/** Files dropped or picked by the trader. */
export async function importFiles(files: File[], via: ImportMeta["via"] = "file"): Promise<ImportReport[]> {
  const reports: ImportReport[] = [];
  for (const file of files) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      reports.push(await importPdf(file));
      continue;
    }
    const text = await file.text();
    const a = analyzeText(text, file.name);
    if (a.suggested && !a.parsed) {
      queueMapping({ analysis: a, via });
      reports.push({ fileName: file.name, ok: false, message: `${file.name}: confirm its columns to import it.` });
      continue;
    }
    reports.push(commitAnalysis(a, via));
  }
  summarize(reports);
  return reports;
}

export function importPasted(text: string): ImportReport {
  const a = analyzeText(text, "Pasted text");
  if (a.suggested && !a.parsed) {
    queueMapping({ analysis: a, via: "paste" });
    return { fileName: "Pasted text", ok: false, message: "Confirm the columns to import the pasted rows." };
  }
  const r = commitAnalysis(a, "paste");
  showReport(r);
  return r;
}

function summarize(reports: ImportReport[]): void {
  if (reports.length === 1) {
    showReport(reports[0]);
    return;
  }
  const ok = reports.filter((r) => r.ok);
  if (!reports.length) return;
  const withNew = ok.filter((r) => !r.message.startsWith("Nothing new")).length;
  const days = ok.flatMap((r) => r.newDays ?? []).sort();
  const title = withNew
    ? `Checked ${reports.length} files. ${withNew} had new data; the rest were already in your journal.`
    : `Checked ${reports.length} files. Everything was already in your journal.`;
  toast.success(title, {
    description: reports.map((r) => r.message).slice(0, 6).join("\n"),
    duration: 9000,
    action: days.length ? { label: "Debrief it", onClick: () => navigate(`/day/${days[days.length - 1]}`) } : undefined,
  });
}

/** Called after the trader confirms a column mapping. */
export function importWithMapping(pendingId: string, mapping: ColumnMapping): ImportReport {
  const pending = useStore.getState().mappings.find((m) => m.id === pendingId);
  if (!pending) return { fileName: "", ok: false, message: "That file is no longer waiting." };
  const a = analyzeTable(pending.analysis.table, pending.analysis.fileName, { tz: getData().settings.timezone }, mapping);
  const parsed = a.parsed ?? emptyParsed(a.detection);
  const report = commitAnalysis({ ...a, parsed }, pending.via);
  dropMapping(pendingId);
  if (pending.inboxId) void companion.inboxDone(pending.inboxId).catch(() => undefined);
  showReport(report);
  return report;
}

/** Preview what a mapping would import, without saving anything. */
export function previewMapping(analysis: FileAnalysis, mapping: ColumnMapping): ParsedFile {
  const a = analyzeTable(analysis.table, analysis.fileName, { tz: getData().settings.timezone }, mapping);
  return a.parsed ?? emptyParsed(a.detection);
}

const inFlight = new Set<string>();
let pendingRun: Promise<void> | null = null;

/** Import whatever is waiting in the companion's inbox (one run at a time). */
export function importPending(): Promise<void> {
  if (pendingRun) return pendingRun;
  pendingRun = (async () => {
    try {
      const { items } = await companion.inbox();
      const fresh = items.filter((i) => !inFlight.has(i.id) && !useStore.getState().mappings.some((m) => m.inboxId === i.id));
      if (fresh.length === 1) await importInboxItem(fresh[0]);
      else if (fresh.length > 1) await importInbox(fresh);
    } catch {
      // companion unreachable; the next status check retries
    } finally {
      pendingRun = null;
    }
  })();
  return pendingRun;
}

/** A file the companion found in the watched folder. */
export async function importInboxItem(item: InboxItem): Promise<ImportReport> {
  if (inFlight.has(item.id)) return { fileName: item.name, ok: false, message: "Already importing." };
  inFlight.add(item.id);
  try {
    return await importInboxItemOnce(item);
  } finally {
    inFlight.delete(item.id);
  }
}

async function importInboxItemOnce(item: InboxItem): Promise<ImportReport> {
  const text = await companion.inboxContent(item.id);
  const a = analyzeText(text, item.name);
  if (a.suggested && !a.parsed) {
    queueMapping({ analysis: a, via: "auto", inboxId: item.id });
    toast(`New file in Downloads: ${item.name}`, {
      description: "Debrief doesn't know this layout yet. Confirm its columns to import it.",
      action: { label: "Review", onClick: () => useStore.setState({ importOpen: true }) },
    });
    return { fileName: item.name, ok: false, message: "Needs column mapping." };
  }
  const report = commitAnalysis(a, "auto");
  await companion.inboxDone(item.id).catch(() => undefined);
  if (report.ok) {
    showReport({ ...report, message: `Auto-imported · ${report.message}` });
    const day = report.newDays?.[0];
    if (day && !report.message.startsWith("Nothing new")) void import("./autoDebrief").then((m) => m.autoDebrief(day));
  }
  return report;
}

/** Import every pending file from the companion's inbox, oldest first. */
export async function importInbox(items: InboxItem[]): Promise<ImportReport[]> {
  const reports: ImportReport[] = [];
  for (const item of [...items].sort((a, b) => a.modifiedAt - b.modifiedAt)) {
    if (inFlight.has(item.id)) continue;
    inFlight.add(item.id);
    try {
      const text = await companion.inboxContent(item.id);
      const a = analyzeText(text, item.name);
      if (a.suggested && !a.parsed) {
        queueMapping({ analysis: a, via: "auto", inboxId: item.id });
        reports.push({ fileName: item.name, ok: false, message: `${item.name}: confirm its columns.` });
        continue;
      }
      reports.push(commitAnalysis(a, "auto"));
      await companion.inboxDone(item.id).catch(() => undefined);
    } catch (err) {
      reports.push({ fileName: item.name, ok: false, message: `${item.name}: ${(err as Error).message}` });
    } finally {
      inFlight.delete(item.id);
    }
  }
  if (reports.length) summarize(reports);
  return reports;
}

// ---------- PDFs and anything else, read by the AI coach ----------

async function importPdf(file: File): Promise<ImportReport> {
  if (!useCompanion.getState().status?.ai.ready) {
    return {
      fileName: file.name,
      ok: false,
      message: `${file.name}: PDFs are read by the AI coach, which is off. Export the CSV version instead (Position History), or turn on the AI coach in Settings.`,
    };
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const data = btoa(binary);
  const tz = getData().settings.timezone;
  const t = toast.loading(`Reading ${file.name} with the AI coach…`);
  try {
    const { result } = await ai<ExtractedTrades>("extract-trades", { fileName: file.name, mediaType: "application/pdf", data, timezone: tz });
    toast.dismiss(t);
    const parsed = extractedToParsed(result, tz);
    if (!parsed.executions.length) return { fileName: file.name, ok: false, message: `${file.name}: ${result.note || "No trades found."}` };
    return commitAnalysis(
      { fileName: file.name, table: { headers: [], rows: [] }, detection: parsed.detection, parsed },
      "ai",
    );
  } catch (err) {
    toast.dismiss(t);
    return { fileName: file.name, ok: false, message: `${file.name}: ${(err as Error).message}` };
  }
}

export function extractedToParsed(x: ExtractedTrades, tz: string): ParsedFile {
  const parsed = emptyParsed({ format: "ai-extracted", label: "Read by the AI coach", kind: "trades", needsMapping: false }, x.trades.length);
  for (const t of x.trades) {
    const entry = parseStamp(t.entryTime, tz);
    const exit = t.exitTime ? parseStamp(t.exitTime, tz) : entry;
    if (!entry || !exit || !(t.qty > 0)) {
      parsed.skippedRows++;
      continue;
    }
    const info = parseSymbol(t.symbol);
    const ep = t.entryPrice ?? 0;
    const xp = t.exitPrice ?? ep;
    const pnl = t.pnl ?? (t.side === "Long" ? xp - ep : ep - xp) * t.qty * pointValue(info);
    parsed.executions.push({
      symbol: t.symbol,
      root: info.root,
      side: t.side,
      qty: t.qty,
      entryPrice: clean(ep),
      exitPrice: clean(xp),
      entryTime: Math.min(entry.ms, exit.ms),
      exitTime: Math.max(entry.ms, exit.ms),
      pnl: clean(pnl, 2),
      precision: entry.precision === "second" ? "second" : "minute",
    });
  }
  parsed.warnings.push("These trades were read from a document by AI. Double-check a few against your statement.");
  return parsed;
}

// ---------- The guided tour ----------

export function loadSample(): void {
  const d = getData();
  const today = tradingDay(Date.now(), d.settings.timezone, "midnight");
  // End on the last completed weekday so the tour shows a finished session.
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const endDay = end.toISOString().slice(0, 10);
  const csv = generateSampleCsv({ endDay, tz: d.settings.timezone });
  const a = analyzeText(csv, SAMPLE_FILE_NAME);
  if (!a.parsed) return;
  const parsed: ParsedFile = { ...a.parsed, detection: { ...a.parsed.detection, format: "sample", label: "Sample journal" }, warnings: [] };
  importParsed(parsed, { fileName: SAMPLE_FILE_NAME, via: "sample" });
  addNews(sampleNews(endDay));
}
