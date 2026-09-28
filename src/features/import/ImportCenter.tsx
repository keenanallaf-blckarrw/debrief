import { ClipboardPaste, FileSpreadsheet, History, Undo2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Bits";
import { Modal } from "../../components/ui/Dialog";
import { ago, dateTimeOf, plural } from "../../lib/format";
import { importFiles, importPasted } from "../../lib/importer";
import { openImport, undoImport, useStore } from "../../lib/store";
import { AutoImport } from "./AutoImport";
import { ExportGuide } from "./ExportGuide";

export function DropZone({ onDone, big = false }: { onDone?: () => void; big?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      await importFiles([...files]);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void handle(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed px-6 text-center transition-colors ${big ? "py-12" : "py-8"} ${
        over ? "border-amber bg-amber/5" : "border-line hover:border-faint"
      }`}
    >
      <Upload className={`mb-3 size-6 ${over ? "text-amber" : "text-faint"}`} aria-hidden />
      <div className="text-[14.5px] font-semibold">{busy ? "Importing…" : "Drop your trade exports here"}</div>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted">
        CSV from Tradovate, TradingView, NinjaTrader or any broker. Drop several at once; duplicates are skipped automatically.
      </p>
      <Button size="sm" className="mt-4" icon={<FileSpreadsheet className="size-3.5" />} onClick={() => input.current?.click()} loading={busy}>
        Choose files
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".csv,.tsv,.txt,.pdf,text/csv,application/pdf,text/plain"
        className="hidden"
        onChange={(e) => {
          void handle(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PasteBox() {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="…or paste CSV rows here (include the header row)"
        className="field min-h-[84px] resize-y font-mono text-[12px]"
      />
      <div>
        <Button size="sm" icon={<ClipboardPaste className="size-3.5" />} disabled={!text.trim()} onClick={() => {
          importPasted(text);
          setText("");
        }}>
          Import pasted rows
        </Button>
      </div>
    </div>
  );
}

function ImportHistory() {
  const imports = useStore((s) => s.data.imports);
  if (!imports.length) return <p className="text-[12.5px] text-faint">Nothing imported yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line-2 rounded-2xl border border-line-2 bg-panel">
      {imports.slice(0, 12).map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[13px] font-medium">{r.fileName}</span>
              <Badge>{r.formatLabel}</Badge>
              {r.via === "auto" && <Badge tone="gain">auto</Badge>}
            </div>
            <div className="mt-0.5 text-[12px] text-muted">
              {r.added.executions ? plural(r.added.executions, "fill pair") : "No new fills"}
              {r.added.cash ? ` · ${plural(r.added.cash, "ledger line")}` : ""}
              {r.added.orders ? ` · ${plural(r.added.orders, "order event")}` : ""}
              {r.duplicates ? ` · ${r.duplicates} already in journal` : ""}
              {r.range ? ` · ${dateTimeOf(r.range.from, "UTC").split(",")[0]}–${dateTimeOf(r.range.to, "UTC").split(",")[0]}` : ""} · {ago(r.importedAt)}
            </div>
            {r.warnings.length > 0 && <div className="mt-1 text-[12px] leading-relaxed text-warn">{r.warnings[0]}</div>}
          </div>
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => undoImport(r.id)} aria-label={`Undo import of ${r.fileName}`}>
            Undo
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ImportCenter() {
  const open = useStore((s) => s.importOpen);
  const mappings = useStore((s) => s.mappings);
  return (
    <Modal open={open} onOpenChange={openImport} title="Bring in your trades" description="Debrief reads your broker's own export, so every number is exact." width="max-w-[760px]">
      <div className="flex flex-col gap-6">
        <DropZone onDone={() => undefined} />
        <PasteBox />
        <div>
          <div className="label mb-2">Automatic</div>
          <AutoImport />
        </div>
        {mappings.length > 0 && (
          <div>
            <div className="label mb-2">Waiting for you</div>
            <p className="text-[12.5px] text-muted">
              {plural(mappings.length, "file")} in a layout Debrief hasn't seen before. The column check opens automatically; close it to come back later.
            </p>
          </div>
        )}
        <div>
          <div className="label mb-2">How to export</div>
          <ExportGuide />
        </div>
        <div>
          <div className="label mb-2 flex items-center gap-1.5">
            <History className="size-3.5" aria-hidden /> Import history
          </div>
          <ImportHistory />
        </div>
      </div>
    </Modal>
  );
}
