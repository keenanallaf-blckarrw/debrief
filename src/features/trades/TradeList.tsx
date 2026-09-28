import { MessageSquareText, TriangleAlert } from "lucide-react";
import type { Violation } from "../../../shared/rules/evaluate";
import { maskAccount } from "../../../shared/trades/roundtrips";
import type { Trade, TradeNote } from "../../../shared/types";
import { Badge, Money, Tip } from "../../components/ui/Bits";
import { tradingDay, weekdayOf } from "../../../shared/util/time";
import { dayShort, duration, price, timeOf } from "../../lib/format";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Evening futures trades count toward the next trading day; say which evening. */
function CalendarTime({ ms, day, tz }: { ms: number; day: string; tz: string }) {
  const cal = tradingDay(ms, tz, "midnight");
  if (cal === day) return <>{timeOf(ms, tz)}</>;
  return (
    <Tip content={`Entered ${WEEKDAY[weekdayOf(cal)]} evening. Futures sessions roll at 6 PM New York time, so it counts toward ${dayShort(day)}.`}>
      <span>
        <span className="text-faint">{WEEKDAY[weekdayOf(cal)]} </span>
        {timeOf(ms, tz)}
      </span>
    </Tip>
  );
}

// A scannable list of trades: time, side, size, prices, hold, net, and any rule
// the trade broke. Clicking a row opens the trade on its chart.

export function TradeList({
  trades,
  tz,
  violations,
  notes,
  onOpen,
  showDay = false,
  showAccount = false,
  coachNotes,
}: {
  trades: Trade[];
  tz: string;
  violations: Map<string, Violation[]>;
  notes: Record<string, TradeNote>;
  onOpen: (t: Trade) => void;
  showDay?: boolean;
  showAccount?: boolean;
  coachNotes?: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-left text-[11.5px] text-faint">
            <th className="py-2 pl-4 font-medium">{showDay ? "Day · time" : "Time"}</th>
            <th className="py-2 font-medium">Trade</th>
            <th className="py-2 font-medium">Size</th>
            <th className="py-2 font-medium">Entry → exit</th>
            <th className="py-2 font-medium">Held</th>
            <th className="py-2 pr-2 text-right font-medium">Net</th>
            <th className="py-2 pr-4 font-medium">Rules</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const v = violations.get(t.key) ?? [];
            const note = notes[t.key];
            const coach = coachNotes?.get(t.key);
            return (
              <tr
                key={t.key}
                tabIndex={0}
                onClick={() => onOpen(t)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(t))}
                className="cursor-pointer border-t border-line-2 transition-colors hover:bg-soft/50 focus-visible:bg-soft/50"
                aria-label={`${t.root} ${t.side} ${t.peakQty} contracts, net ${t.net}`}
              >
                <td className="py-2.5 pl-4 font-mono text-[12px] tnum text-muted">
                  {showDay && <span className="mr-2 text-ink-2">{dayShort(t.day)}</span>}
                  <CalendarTime ms={t.entryTime} day={t.day} tz={tz} />
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{t.root}</span>
                    <Badge tone={t.side === "Long" ? "gain" : "loss"}>{t.side}</Badge>
                    {t.sideUncertain && (
                      <Tip content="This came from a file without seconds, so long/short is a best guess. Import the original export to fix it.">
                        <span className="text-[11px] text-warn">?</span>
                      </Tip>
                    )}
                    {showAccount && t.account && <span className="font-mono text-[11px] text-faint">{maskAccount(t.account)}</span>}
                    {(note?.notes || coach) && <MessageSquareText className="size-3.5 text-faint" aria-label="Has notes" />}
                  </div>
                  {coach && <div className="mt-0.5 max-w-[360px] truncate text-[12px] text-muted">{coach}</div>}
                </td>
                <td className="py-2.5 font-mono tnum text-ink-2">{t.peakQty}</td>
                <td className="py-2.5 font-mono text-[12px] tnum text-muted">
                  {price(t.avgEntry)} → {price(t.avgExit)}
                </td>
                <td className="py-2.5 font-mono text-[12px] tnum text-muted">{duration(t.holdMs)}</td>
                <td className="py-2.5 pr-2 text-right font-mono font-medium tnum">
                  <Money value={t.net} cents />
                </td>
                <td className="py-2.5 pr-4">
                  {v.length ? (
                    <Tip content={<ul className="list-disc pl-4">{v.map((x, i) => <li key={i}>{x.message}</li>)}</ul>}>
                      <span className="inline-flex items-center gap-1 rounded-md bg-loss/12 px-1.5 py-0.5 text-[11.5px] font-medium text-loss">
                        <TriangleAlert className="size-3" aria-hidden />
                        {v.length} broken
                      </span>
                    </Tip>
                  ) : (
                    <span className="text-[11.5px] text-faint">clean</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
