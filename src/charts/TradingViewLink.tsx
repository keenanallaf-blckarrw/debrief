import { ExternalLink } from "lucide-react";
import { tradingViewSymbol, tradingViewUrl } from "../../shared/instruments";
import { tradingDay } from "../../shared/util/time";
import { dayLong, timeOf } from "../lib/format";

// Opens the real futures chart on tradingview.com, in the trader's own
// TradingView account (so their plan and data apply). TradingView won't show
// CME futures inside charts embedded on other sites, so this is how Debrief
// hands off to it.

export function TradingViewLink({ symbol, at, tz, className = "" }: { symbol: string; at?: number; tz?: string; className?: string }) {
  const tv = tradingViewSymbol(symbol, at);
  const when = at !== undefined && tz ? `${dayLong(tradingDay(at, tz, "midnight"))} at ${timeOf(at, tz)}` : null;
  return (
    <a
      href={tradingViewUrl(symbol, at)}
      target="_blank"
      rel="noreferrer"
      title={`Opens ${tv} on tradingview.com, in your own TradingView account.${when ? ` To jump to this trade there, press Option+G (Alt+G on Windows) and pick ${when}.` : ""}`}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink/30 hover:text-ink ${className}`}
    >
      Open {tv.split(":").pop()} in TradingView
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
