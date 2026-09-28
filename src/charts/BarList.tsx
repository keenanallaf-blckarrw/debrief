import { useState } from "react";
import type { Bucket } from "../../shared/analytics/stats";
import { money, pct } from "../lib/format";
import { Tip } from "../components/ui/Bits";

// Horizontal bars from a zero line: profit to the right in green, loss to the
// left in red. Values sit in their own column so they never collide with the
// bars or labels; hover for details, or switch to the table view.

export function BarList({ buckets, title, emptyText = "Not enough trades yet." }: { buckets: Bucket[]; title: string; emptyText?: string }) {
  const [asTable, setAsTable] = useState(false);
  if (!buckets.length) return <p className="py-6 text-center text-[13px] text-faint">{emptyText}</p>;
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b.net)));
  const hasNeg = buckets.some((b) => b.net < 0);
  const hasPos = buckets.some((b) => b.net > 0);
  // Where zero sits in the track: centered when there are both gains and losses.
  const zero = hasNeg && hasPos ? 0.5 : hasNeg ? 1 : 0;
  const span = hasNeg && hasPos ? 0.5 : 1;

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setAsTable(!asTable)} className="cursor-pointer text-[11.5px] text-faint underline-offset-2 hover:text-ink-2 hover:underline">
          {asTable ? "Show bars" : "Show table"}
        </button>
      </div>
      {asTable ? (
        <table className="w-full text-[12.5px] tnum">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-left text-faint">
              <th className="py-1 font-medium">Bucket</th>
              <th className="py-1 text-right font-medium">Trades</th>
              <th className="py-1 text-right font-medium">Win rate</th>
              <th className="py-1 text-right font-medium">Net</th>
              <th className="py-1 text-right font-medium">Avg</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="border-t border-line-2">
                <td className="py-1.5 text-ink-2">{b.label}</td>
                <td className="py-1.5 text-right">{b.trades}</td>
                <td className="py-1.5 text-right">{pct(b.winRate)}</td>
                <td className={`py-1.5 text-right ${b.net >= 0 ? "text-gain" : "text-loss"}`}>{money(b.net, { sign: true })}</td>
                <td className="py-1.5 text-right text-muted">{money(b.avg, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="flex flex-col gap-1" aria-label={title}>
          {buckets.map((b) => {
            const w = (Math.abs(b.net) / max) * span * 100;
            const positive = b.net >= 0;
            return (
              <li key={b.key}>
                <Tip
                  content={
                    <span>
                      <strong className={positive ? "text-gain" : "text-loss"}>{money(b.net, { sign: true })}</strong> · {b.label}
                      <br />
                      {b.trades} {b.trades === 1 ? "trade" : "trades"} · win rate {pct(b.winRate)} · avg {money(b.avg, { sign: true })}
                    </span>
                  }
                >
                  <button type="button" className="group grid w-full cursor-default grid-cols-[72px_minmax(0,1fr)_84px] items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-soft/60 focus-visible:bg-soft/60">
                    <span className="truncate text-[12.5px] text-ink-2">{b.label}</span>
                    <span className="relative h-4" aria-hidden>
                      {zero === 0.5 && <span className="absolute inset-y-0 left-1/2 w-px bg-line" />}
                      <span
                        className={`absolute top-1/2 h-3 -translate-y-1/2 ${positive ? "rounded-r-[4px] bg-gain/80" : "rounded-l-[4px] bg-loss/80"} group-hover:brightness-125`}
                        style={positive ? { left: `${zero * 100}%`, width: `${Math.max(w, 0.8)}%` } : { right: `${(1 - zero) * 100}%`, width: `${Math.max(w, 0.8)}%` }}
                      />
                    </span>
                    <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap font-mono text-[11.5px] tnum">
                      <span className="text-ink">{money(b.net, { sign: true })}</span>
                      <span className="text-faint">{b.trades}</span>
                    </span>
                  </button>
                </Tip>
              </li>
            );
          })}
        </ul>
      )}
      {!asTable && <p className="mt-2 text-right text-[10.5px] text-faint">net · trades</p>}
    </div>
  );
}
