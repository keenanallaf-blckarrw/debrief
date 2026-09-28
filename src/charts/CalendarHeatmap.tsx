import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { DayTotal } from "../../shared/analytics/stats";
import type { DayEvaluation } from "../../shared/rules/evaluate";
import { addDays, weekdayOf } from "../../shared/util/time";
import { money, moneyCompact, monthLabel } from "../lib/format";
import { navigate } from "../lib/router";
import { Tip } from "../components/ui/Bits";

// Month view of daily net P&L. Tint strength follows the size of the day
// relative to your biggest day; the dollar value is always printed, so color is
// never the only signal. Click a day to open its debrief.

function tint(net: number, max: number): string {
  if (Math.abs(net) < 0.005 || max <= 0) return "transparent";
  const strength = 0.1 + 0.32 * Math.min(1, Math.abs(net) / max);
  return net > 0 ? `rgba(48, 209, 88, ${strength})` : `rgba(255, 69, 58, ${strength})`;
}

export function CalendarHeatmap({
  daily,
  evaluations,
  initialMonth,
}: {
  daily: Map<string, DayTotal>;
  evaluations: (day: string) => DayEvaluation[];
  initialMonth?: string;
}) {
  const latest = initialMonth ?? ([...daily.keys()].sort().pop() ?? new Date().toISOString().slice(0, 10));
  const [cursor, setCursor] = useState(latest.slice(0, 7));
  const [y, m] = cursor.split("-").map(Number);

  const weeks = useMemo(() => {
    const first = `${cursor}-01`;
    const start = addDays(first, -((weekdayOf(first) + 6) % 7)); // back to Monday
    const rows: string[][] = [];
    let d = start;
    for (let w = 0; w < 6; w++) {
      const row: string[] = [];
      for (let i = 0; i < 7; i++) {
        row.push(d);
        d = addDays(d, 1);
      }
      if (w > 0 && row[0].slice(0, 7) !== cursor) break;
      rows.push(row);
    }
    return rows;
  }, [cursor]);

  const monthDays = [...daily.entries()].filter(([d]) => d.startsWith(cursor));
  const max = Math.max(0, ...monthDays.map(([, v]) => Math.abs(v.net)));
  const monthNet = monthDays.reduce((s, [, v]) => s + v.net, 0);
  const shift = (n: number) => {
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    setCursor(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-soft hover:text-ink" aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[132px] text-center text-[14px] font-semibold">{monthLabel(y, m)}</span>
          <button type="button" onClick={() => shift(1)} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-soft hover:text-ink" aria-label="Next month">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="text-[12.5px] text-muted">
          Month: <span className={monthNet >= 0 ? "text-gain" : "text-loss"}>{money(monthNet, { sign: true })}</span>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,0.9fr)] gap-1.5 text-[11px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Week"].map((d) => (
          <div key={d} className="pb-1 text-center font-mono uppercase tracking-wider text-faint">
            {d}
          </div>
        ))}
        {weeks.map((row) => {
          const weekNet = row.reduce((s, d) => s + (daily.get(d)?.net ?? 0), 0);
          const weekTrades = row.reduce((s, d) => s + (daily.get(d)?.trades ?? 0), 0);
          return [
            ...row.map((day) => {
              const v = daily.get(day);
              const inMonth = day.startsWith(cursor);
              const evs = evaluations(day);
              const grade = evs.length === 1 ? evs[0].grade : evs.find((e) => e.grade)?.grade ?? null;
              const weekend = weekdayOf(day) === 0 || weekdayOf(day) === 6;
              const cell = (
                <button
                  key={day}
                  type="button"
                  disabled={!v}
                  onClick={() => v && navigate(`/day/${day}`)}
                  className={`relative flex min-h-[64px] flex-col justify-between rounded-xl border p-1.5 text-left transition-colors ${
                    v ? "cursor-pointer border-line hover:border-faint" : "border-line-2"
                  } ${inMonth ? "" : "opacity-35"} ${weekend && !v ? "bg-transparent" : ""}`}
                  style={{ background: v ? tint(v.net, max) : undefined }}
                  aria-label={v ? `${day}: ${money(v.net, { sign: true })}, ${v.trades} trades${grade ? `, grade ${grade}` : ""}` : day}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-mono text-[10.5px] text-muted">{Number(day.slice(8))}</span>
                    {grade && <span className="font-bold text-[11px] text-ink">{grade}</span>}
                  </span>
                  {v && (
                    <span className="flex flex-col">
                      <span className="font-mono text-[11.5px] font-medium tnum text-ink">{moneyCompact(v.net).replace(/^\$/, "+$")}</span>
                      <span className="text-[10px] text-ink-2/80">{v.trades} {v.trades === 1 ? "trade" : "trades"}</span>
                    </span>
                  )}
                </button>
              );
              return v ? (
                <Tip key={day} content={<span><strong className={v.net >= 0 ? "text-gain" : "text-loss"}>{money(v.net, { sign: true })}</strong> · {v.trades} trades · {v.wins}W {v.losses}L{grade ? ` · grade ${grade}` : ""}</span>}>
                  {cell}
                </Tip>
              ) : (
                cell
              );
            }),
            <div key={`${row[0]}-week`} className="flex min-h-[64px] flex-col justify-center rounded-xl border border-line-2 bg-panel p-1.5 text-center">
              {weekTrades ? (
                <>
                  <span className={`font-mono text-[11.5px] font-medium tnum ${weekNet >= 0 ? "text-gain" : "text-loss"}`}>{moneyCompact(weekNet).replace(/^\$/, "+$")}</span>
                  <span className="text-[10px] text-faint">{weekTrades} trades</span>
                </>
              ) : (
                <span className="text-faint">—</span>
              )}
            </div>,
          ];
        })}
      </div>
    </div>
  );
}
