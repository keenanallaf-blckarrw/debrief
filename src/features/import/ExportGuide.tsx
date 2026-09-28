import { useState } from "react";

// Step-by-step instructions for getting trade history out of each platform.

const GUIDES: { id: string; name: string; steps: string[]; tip?: string }[] = [
  {
    id: "tradovate",
    name: "Tradovate (also most prop firm accounts)",
    steps: [
      "Open Tradovate in your browser or the desktop app.",
      "Click the ☰ menu, then Reports.",
      "Pick the date range, then choose the Position History tab and click Download (the arrow icon).",
      "Optional: download Cash History too. It adds your real commissions and your starting balance.",
      "Optional: download Orders. It lets Debrief see your stop losses.",
    ],
    tip: "Import the file straight from the download. Opening it in Excel or Numbers and saving again strips the seconds from every time.",
  },
  {
    id: "tradingview",
    name: "TradingView (connected broker or paper trading)",
    steps: [
      "Open the Trading Panel at the bottom of a TradingView chart.",
      "Go to the History tab (or Orders → Filled).",
      "Click the ⋯ or export icon at the right of the panel and choose Export data.",
      "Optional: open the Notifications log tab and export it too. It shows every stop you placed and moved.",
    ],
    tip: "TradingView names these files like tradovate-orders-…csv or paper-trading-…csv. The companion picks them up automatically.",
  },
  {
    id: "ninjatrader",
    name: "NinjaTrader",
    steps: [
      "Open the Trade Performance window (New → Trade Performance).",
      "Pick your account and dates, then click Generate.",
      "Right-click the Trades grid and choose Export, saving as CSV.",
    ],
    tip: "The first time, Debrief asks you to confirm which column is which. After that it's one drop.",
  },
  {
    id: "other",
    name: "Any other broker",
    steps: [
      "Look for Trade History, Closed Positions or Statements in your broker's website.",
      "Export as CSV (spreadsheet) rather than PDF.",
      "Drop it into Debrief and confirm the columns once.",
    ],
    tip: "PDF statements work too when the AI coach is on: Debrief reads the trades out of the document.",
  },
];

export function ExportGuide() {
  const [open, setOpen] = useState<string | null>("tradovate");
  return (
    <div className="flex flex-col gap-2">
      {GUIDES.map((g) => (
        <div key={g.id} className="rounded-2xl border border-line-2 bg-panel">
          <button
            type="button"
            onClick={() => setOpen(open === g.id ? null : g.id)}
            aria-expanded={open === g.id}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-[13.5px] font-medium"
          >
            {g.name}
            <span className="text-faint">{open === g.id ? "−" : "+"}</span>
          </button>
          {open === g.id && (
            <div className="px-4 pb-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {g.tip && <p className="mt-3 rounded-xl bg-amber/8 px-3 py-2 text-[12.5px] leading-relaxed text-amber">{g.tip}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
