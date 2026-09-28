import {
  BookOpenCheck,
  CalendarClock,
  ChartNoAxesCombined,
  Download,
  ListChecks,
  MessageSquareText,
  Settings as SettingsIcon,
  Sparkles,
  SquareActivity,
} from "lucide-react";
import type { ReactNode } from "react";
import { maskAccount } from "../../../shared/trades/roundtrips";
import { useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { useFolder } from "../../lib/folderWatch";
import { usePro } from "../../lib/plan";
import { href, useRoute } from "../../lib/router";
import { openImport, openPro, setSettings, useStore } from "../../lib/store";
import { Button } from "../ui/Button";
import { Tip } from "../ui/Bits";

export const NAV = [
  { to: "/", match: ["", "day"], label: "Today", icon: SquareActivity },
  { to: "/trades", match: ["trades"], label: "Trades", icon: BookOpenCheck },
  { to: "/insights", match: ["insights"], label: "Insights", icon: ChartNoAxesCombined },
  { to: "/rules", match: ["rules"], label: "Rules", icon: ListChecks },
  { to: "/market", match: ["market"], label: "Market", icon: CalendarClock },
  { to: "/coach", match: ["coach"], label: "Coach", icon: MessageSquareText },
  { to: "/settings", match: ["settings"], label: "Settings", icon: SettingsIcon },
];

function Wordmark() {
  return (
    <a href={href("/")} className="text-[21px] font-extrabold tracking-[-0.03em] text-ink">
      Debrief<span className="text-amber">.</span>
    </a>
  );
}

function SyncStatus() {
  const { available, status } = useCompanion();
  const folder = useFolder();
  let dot = "bg-faint";
  let text = "Manual import";
  let detail = "Drop exports into Debrief, or start the Debrief companion to import them automatically.";
  if (available && status) {
    if (status.watch.enabled && status.watch.watching) {
      dot = "bg-gain";
      text = "Auto-import on";
      detail = `Watching ${status.watch.dir} for new TradingView and Tradovate exports.`;
    } else {
      dot = "bg-warn";
      text = "Companion on";
      detail = status.watch.error ?? "Auto-import is paused. Turn it on in Settings.";
    }
  } else if (folder.watching) {
    dot = "bg-gain";
    text = "Watching folder";
    detail = `Checking "${folder.name}" every few seconds while this tab is open.`;
  }
  return (
    <Tip content={detail}>
      <a href={href("/settings")} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted hover:bg-soft hover:text-ink">
        <span className={`size-2 rounded-full ${dot} ${dot === "bg-gain" ? "animate-pulse-soft" : ""}`} aria-hidden />
        {text}
        {available && status?.ai.ready && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-amber">
            <Sparkles className="size-3" aria-hidden /> AI
          </span>
        )}
      </a>
    </Tip>
  );
}

function AccountPicker() {
  const { accounts } = useDerived();
  const account = useStore((s) => s.data.settings.account);
  if (accounts.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-[12px] text-muted">
      <span className="sr-only">Account</span>
      <select
        value={accounts.includes(account) ? account : ""}
        onChange={(e) => setSettings({ account: e.target.value })}
        className="field !h-8 !w-auto !rounded-[10px] !py-0 !text-[12.5px]"
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a} value={a}>
            Account {maskAccount(a)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const pro = usePro();
  const pending = useStore((s) => s.mappings.length);
  const active = (match: string[]) => match.includes(route.parts[0] ?? "");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[228px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line-2 bg-panel px-3 py-5 lg:flex">
        <div className="px-2">
          <Wordmark />
          <div className="mt-0.5 text-[11.5px] text-faint">AI coach for traders</div>
        </div>
        <Button variant="primary" className="mx-1 mt-6" icon={<Download className="size-4" />} onClick={() => openImport(true)}>
          Import trades
          {pending > 0 && <span className="ml-1 rounded-full bg-amber-ink/20 px-1.5 text-[11px]">{pending}</span>}
        </Button>
        <nav className="mt-5 flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ to, match, label, icon: Icon }) => (
            <a
              key={to}
              href={href(to)}
              aria-current={active(match) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors ${
                active(match) ? "bg-soft text-ink" : "text-muted hover:bg-soft/60 hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
              {label === "Coach" && !pro && <span className="ml-auto font-mono text-[9.5px] tracking-wider text-amber">PRO</span>}
            </a>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-1">
          <SyncStatus />
          {!pro ? (
            <button type="button" onClick={() => openPro(true)} className="cursor-pointer rounded-xl border border-amber/40 px-3 py-2 text-left text-[12.5px] text-amber hover:bg-amber/10">
              <span className="font-semibold">★ Go Pro</span>
              <span className="block text-[11.5px] text-muted">Deep analytics & the full AI coach</span>
            </button>
          ) : (
            <div className="px-2 font-mono text-[10.5px] tracking-widest text-amber">PRO</div>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line-2 bg-bg/85 px-4 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <Wordmark />
          </div>
          <div className="hidden text-[12.5px] text-faint lg:block">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          <div className="flex items-center gap-2">
            <AccountPicker />
            <Button size="sm" variant="primary" className="lg:hidden" icon={<Download className="size-3.5" />} onClick={() => openImport(true)}>
              Import
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-6 lg:px-8 lg:pb-16">{children}</main>

        {/* Bottom tabs (phones) */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-line-2 bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
          {NAV.map(({ to, match, label, icon: Icon }) => (
            <a key={to} href={href(to)} aria-current={active(match) ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[9.5px] ${active(match) ? "text-ink" : "text-faint"}`}>
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
