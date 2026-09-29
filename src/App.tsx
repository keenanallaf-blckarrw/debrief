import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useRef } from "react";
import { Toaster } from "sonner";
import { Shell } from "./components/layout/Shell";
import { ImportCenter } from "./features/import/ImportCenter";
import { MappingDialog } from "./features/import/MappingDialog";
import { Onboarding } from "./features/onboarding/Onboarding";
import { ProDialog } from "./features/settings/ProDialog";
import { CoachPage } from "./features/coach/CoachPage";
import { InsightsPage } from "./features/insights/InsightsPage";
import { MarketPage } from "./features/market/MarketPage";
import { RulesPage } from "./features/rules/RulesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TodayPage } from "./features/today/TodayPage";
import { TradesPage } from "./features/trades/TradesPage";
import { companion, useCompanion, watchCompanion } from "./lib/companion";
import { derive } from "./lib/derived";
import { restoreFolder } from "./lib/folderWatch";
import { importInboxItem, importPending, refreshOutdatedSample, type ImportReport } from "./lib/importer";
import { flushSave } from "./lib/persist";
import { useRoute } from "./lib/router";
import { addNews, getData, hydrate, useStore } from "./lib/store";
import { toast } from "sonner";

function Page() {
  const route = useRoute();
  const [head, arg] = route.parts;
  // A new page starts at the top (opening a trade drawer keeps your place).
  useEffect(() => {
    if (head !== "trades" || !arg) window.scrollTo({ top: 0 });
  }, [head, head === "trades" ? undefined : arg]);
  switch (head) {
    case undefined:
      return <TodayPage />;
    case "day":
      return <TodayPage day={arg} />;
    case "trades":
      return <TradesPage openKey={arg} />;
    case "insights":
      return <InsightsPage />;
    case "rules":
      return <RulesPage />;
    case "market":
      return <MarketPage />;
    case "coach":
      return <CoachPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <TodayPage />;
  }
}

function useCompanionSync() {
  const available = useCompanion((s) => s.available);
  const onboarded = useStore((s) => s.data.onboarded);
  const hydrated = useStore((s) => s.hydrated);
  const synced = useRef(false);

  // Live: a new export landed in the watched folder. If an event was missed
  // (companion restarted, laptop slept), the pending check picks the file up.
  useEffect(() => {
    if (!hydrated) return;
    return watchCompanion(
      (item) => {
        if (getData().onboarded) void importInboxItem(item);
      },
      () => {
        if (getData().onboarded) void importPending();
      },
    );
  }, [hydrated]);

  // Once connected: import anything that arrived while Debrief was closed, and
  // refresh the economic calendar.
  useEffect(() => {
    if (!available || !hydrated) return;
    const syncCalendar = () =>
      companion
        .calendar()
        .then((r) => addNews(r.events))
        .catch(() => undefined);
    void syncCalendar();
    const t = setInterval(syncCalendar, 60 * 60_000);
    if (onboarded && !synced.current) {
      synced.current = true;
      void importPending();
    }
    return () => clearInterval(t);
  }, [available, hydrated, onboarded]);

  // Save price charts while Yahoo still has the fine candles (1-minute for 30
  // days, 5-minute for 60). The companion skips days it already saved, so
  // asking each time Debrief opens, and after each import, is cheap.
  const executions = useStore((s) => s.data.executions);
  const prefetchOn = useStore((s) => s.data.settings.prefetchCharts);
  useEffect(() => {
    if (!available || !hydrated || !prefetchOn) return;
    const t = setTimeout(() => {
      const since = Date.now() - 59 * 86_400_000;
      const recent = derive(getData())
        .allTrades.filter((tr) => tr.entryTime > since)
        .map((tr) => ({ symbol: tr.symbol, entry: tr.entryTime, exit: tr.exitTime }));
      if (recent.length) void companion.prefetch(recent.slice(-500)).catch(() => undefined);
    }, 3_000);
    return () => clearTimeout(t);
  }, [available, hydrated, prefetchOn, executions]);

  // Keep a daily backup file on your computer (companion only).
  useEffect(() => {
    if (!available) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.data === prev.data || !s.data.onboarded) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void companion.backup(s.data).catch(() => undefined), 20_000);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [available]);
}

function reportFolder(reports: ImportReport[]) {
  const ok = reports.filter((r) => r.ok);
  if (ok.length) toast.success(`Auto-imported ${ok.length} ${ok.length === 1 ? "file" : "files"} from your folder.`, { description: ok.map((r) => r.message).join("\n") });
}

export default function App() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.data.onboarded);

  useEffect(() => {
    void hydrate().then(() => {
      refreshOutdatedSample();
      return restoreFolder(reportFolder);
    });
    const onHide = () => flushSave();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  useCompanionSync();

  return (
    <Tooltip.Provider delayDuration={200}>
      {!hydrated ? (
        <div className="min-h-screen bg-bg" />
      ) : !onboarded ? (
        <Onboarding />
      ) : (
        <Shell>
          <Page />
        </Shell>
      )}
      <ImportCenter />
      <MappingDialog />
      <ProDialog />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!bg-raised !border-line !text-ink !rounded-2xl",
            description: "!text-muted whitespace-pre-line",
            actionButton: "!bg-amber !text-amber-ink",
            cancelButton: "!bg-soft !text-ink",
          },
        }}
      />
    </Tooltip.Provider>
  );
}
