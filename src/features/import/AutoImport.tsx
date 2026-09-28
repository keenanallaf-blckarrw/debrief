import { FolderOpen, FolderSearch, Radar } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Bits";
import { companion, refreshStatus, useCompanion } from "../../lib/companion";
import { connectFolder, disconnectFolder, folderWatchSupported, resumeFolder, useFolder } from "../../lib/folderWatch";
import { importInbox, type ImportReport } from "../../lib/importer";
import { ago } from "../../lib/format";

// The two ways Debrief imports on its own:
//  1. the companion watches a folder (best: works even when Debrief is closed);
//  2. Chrome/Edge can watch a folder while the Debrief tab is open.

function report(reports: ImportReport[], none: string) {
  const ok = reports.filter((r) => r.ok);
  if (!reports.length) toast(none);
  else if (!ok.length) toast("No new trades in those files.", { description: reports.map((r) => r.message).slice(0, 5).join("\n") });
}

export function AutoImport({ compact = false }: { compact?: boolean }) {
  const { available, status } = useCompanion();
  const folder = useFolder();
  const [busy, setBusy] = useState(false);

  if (available && status) {
    const scan = async () => {
      setBusy(true);
      try {
        const r = await companion.scan();
        if (!r.items.length) toast(`No new trade exports in ${r.dir} from the last year.`);
        else report(await importInbox(r.items), "Nothing new.");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    const toggle = async (enabled: boolean) => {
      try {
        await companion.setWatch({ enabled });
        await refreshStatus();
      } catch (e) {
        toast.error((e as Error).message);
      }
    };
    return (
      <div className="rounded-2xl border border-line-2 bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <Radar className={`mt-0.5 size-5 shrink-0 ${status.watch.watching ? "text-gain" : "text-faint"}`} aria-hidden />
            <div>
              <div className="text-[14px] font-semibold">{status.watch.watching ? "Auto-import is on" : "Auto-import is paused"}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                The Debrief companion watches <span className="font-mono text-ink-2">{status.watch.dir}</span>. Export from TradingView or Tradovate as usual and the trades appear here within seconds, even if Debrief was closed.
              </p>
              {status.watch.error && <p className="mt-1 text-[12.5px] text-loss">{status.watch.error}</p>}
            </div>
          </div>
          <Switch checked={status.watch.enabled} onChange={toggle} label="Auto-import" />
        </div>
        {!compact && (
          <div className="mt-3 flex flex-wrap gap-2 pl-8">
            <Button size="sm" icon={<FolderSearch className="size-3.5" />} loading={busy} onClick={scan}>
              Scan for exports I already downloaded
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (folderWatchSupported()) {
    const connect = async () => {
      setBusy(true);
      try {
        report(await connectFolder(() => undefined), "Connected. New exports will import automatically while Debrief is open.");
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="rounded-2xl border border-line-2 bg-panel p-4">
        <div className="flex gap-3">
          <FolderOpen className={`mt-0.5 size-5 shrink-0 ${folder.watching ? "text-gain" : "text-faint"}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">
              {folder.watching ? `Watching “${folder.name}”` : folder.name ? `“${folder.name}” needs a click to resume` : "Auto-import from your Downloads folder"}
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              {folder.watching
                ? `Debrief checks this folder every few seconds while this tab is open.${folder.lastScan ? ` Last check ${ago(folder.lastScan)}.` : ""}`
                : "Give Debrief read access to your Downloads folder once. Every new TradingView or Tradovate export imports itself while Debrief is open. For importing even when it's closed, run the Debrief companion."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {folder.name && folder.permission !== "granted" ? (
                <Button size="sm" variant="primary" loading={busy} onClick={async () => report(await resumeFolder(() => undefined), "Resumed.")}>
                  Resume auto-import
                </Button>
              ) : !folder.watching ? (
                <Button size="sm" variant="primary" icon={<FolderOpen className="size-3.5" />} loading={busy} onClick={connect}>
                  Choose my Downloads folder
                </Button>
              ) : null}
              {folder.name && (
                <Button size="sm" variant="ghost" onClick={() => void disconnectFolder()}>
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line-2 bg-panel p-4 text-[12.5px] leading-relaxed text-muted">
      <div className="mb-1 text-[14px] font-semibold text-ink">Auto-import</div>
      Run the Debrief companion on your computer (see the README) and it imports every TradingView and Tradovate export as it lands in Downloads. In Chrome or Edge, Debrief can also watch a folder while it's open.
    </div>
  );
}
