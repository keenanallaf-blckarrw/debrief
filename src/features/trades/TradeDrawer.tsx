import { useMemo, useState } from "react";
import type { Trade } from "../../../shared/types";
import { maskAccount } from "../../../shared/trades/roundtrips";
import { TradeChart } from "../../charts/TradeChart";
import { Badge, Chip, Money } from "../../components/ui/Bits";
import { Drawer } from "../../components/ui/Dialog";
import { useDerived } from "../../lib/derived";
import { dayLong, duration, money, price, timeOf } from "../../lib/format";
import { markTradeRule, setTradeNote, useStore } from "../../lib/store";

// One trade, up close: replay on the chart, what the rule engine flagged, and
// your notes, emotion and tags (the coach reads these too).

const EMOTIONS = ["Calm", "Confident", "Patient", "FOMO", "Revenge", "Anxious", "Bored", "Tilted", "Greedy"];

function NotesEditor({ trade }: { trade: Trade }) {
  const note = useStore((s) => s.data.tradeNotes[trade.key]);
  const [tagText, setTagText] = useState("");
  const tags = note?.tags ?? [];
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Notes</span>
        <textarea
          className="field min-h-[90px] resize-y"
          placeholder="What was the setup? What did you see, and what did you feel when you clicked?"
          value={note?.notes ?? ""}
          onChange={(e) => setTradeNote(trade.key, { notes: e.target.value })}
        />
      </label>
      <div>
        <div className="label mb-2">How you felt</div>
        <div className="flex flex-wrap gap-1.5">
          {EMOTIONS.map((e) => (
            <Chip key={e} active={note?.emotion === e} onClick={() => setTradeNote(trade.key, { emotion: note?.emotion === e ? undefined : e })}>
              {e}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-2">Tags</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTradeNote(trade.key, { tags: tags.filter((x) => x !== t) })}
              className="cursor-pointer rounded-full border border-line bg-soft px-2.5 py-1 text-[12px] text-ink-2 hover:border-loss/50 hover:text-loss"
              aria-label={`Remove tag ${t}`}
            >
              {t} ×
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = tagText.trim();
              if (t && !tags.includes(t)) setTradeNote(trade.key, { tags: [...tags, t] });
              setTagText("");
            }}
          >
            <input className="field !w-40 !py-1.5 text-[12.5px]" placeholder="Add a tag, e.g. A+ setup" value={tagText} onChange={(e) => setTagText(e.target.value)} />
          </form>
        </div>
      </div>
    </div>
  );
}

export function TradeDrawer({ trade, onClose }: { trade: Trade | null; onClose: () => void }) {
  const tz = useStore((s) => s.data.settings.timezone);
  const rules = useStore((s) => s.data.rules);
  const debriefs = useStore((s) => s.data.debriefs);
  const marks = useStore((s) => (trade ? s.data.tradeNotes[trade.key]?.manual : undefined));
  const { evaluation } = useDerived();
  const coachNote = useMemo(() => {
    if (!trade) return null;
    for (const d of Object.values(debriefs)) {
      const n = d.day?.tradeNotes.find((x) => x.tradeKey === trade.key);
      if (n) return n.note;
    }
    return null;
  }, [debriefs, trade]);

  if (!trade) return null;
  const violations = evaluation.byTrade.get(trade.key) ?? [];
  const tradeRules = rules.filter((r) => r.enabled && r.kind === "manual" && r.params.scope === "trade");

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {trade.root} <Badge tone={trade.side === "Long" ? "gain" : "loss"}>{trade.side}</Badge>
          <Money value={trade.net} className="text-[17px]" />
        </span>
      }
      description={`${dayLong(trade.day)} · ${timeOf(trade.entryTime, tz, true)} → ${timeOf(trade.exitTime, tz, true)}${trade.account ? ` · account ${maskAccount(trade.account)}` : ""}`}
    >
      <TradeChart trade={trade} tz={tz} />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Size", `${trade.peakQty} ${trade.peakQty === 1 ? "contract" : "contracts"}`],
          ["Avg entry", price(trade.avgEntry)],
          ["Avg exit", price(trade.avgExit)],
          ["Held", duration(trade.holdMs)],
          ["Gross", money(trade.pnl, { sign: true })],
          ["Commissions", trade.commissionSource === "none" ? "not included" : `${money(-trade.commission)}${trade.commissionSource === "estimate" ? " (est.)" : ""}`],
          ["Net", money(trade.net, { sign: true })],
          ["Fills", `${trade.executions.length} ${trade.executions.length === 1 ? "pair" : "pairs"}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line-2 bg-panel px-3 py-2">
            <div className="text-[11.5px] text-faint">{k}</div>
            <div className="font-mono text-[13px] tnum text-ink">{v}</div>
          </div>
        ))}
      </div>

      {(violations.length > 0 || coachNote) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {violations.length > 0 && (
            <div className="rounded-2xl border border-loss/30 bg-loss/5 p-4">
              <div className="label mb-2 !text-loss">Rules broken</div>
              <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-ink-2">
                {violations.map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
            </div>
          )}
          {coachNote && (
            <div className="rounded-2xl border border-gain/25 bg-gain/5 p-4">
              <div className="label mb-2 !text-gain">Coach's note</div>
              <p className="text-[13.5px] leading-relaxed text-ink-2">{coachNote}</p>
            </div>
          )}
        </div>
      )}

      {tradeRules.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line-2 bg-panel p-4">
          <div className="label mb-2">Your checklist for this trade</div>
          <ul className="flex flex-col gap-2">
            {tradeRules.map((r) => {
              const m = marks?.[r.id];
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span>{r.label}</span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => markTradeRule(trade.key, r.id, m === "followed" ? null : "followed")} className={`cursor-pointer rounded-lg border px-2 py-1 text-[11.5px] ${m === "followed" ? "border-gain/50 bg-gain/15 text-gain" : "border-line text-muted"}`}>
                      Followed
                    </button>
                    <button type="button" onClick={() => markTradeRule(trade.key, r.id, m === "broken" ? null : "broken")} className={`cursor-pointer rounded-lg border px-2 py-1 text-[11.5px] ${m === "broken" ? "border-loss/50 bg-loss/15 text-loss" : "border-line text-muted"}`}>
                      Broken
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <NotesEditor trade={trade} />
      </div>

      <div className="mt-6">
        <div className="label mb-2">Fills</div>
        <table className="w-full text-[12.5px] tnum">
          <thead className="text-left text-faint">
            <tr>
              <th className="py-1 font-medium">Qty</th>
              <th className="py-1 font-medium">Entry</th>
              <th className="py-1 font-medium">Exit</th>
              <th className="py-1 text-right font-medium">P&L</th>
            </tr>
          </thead>
          <tbody>
            {trade.executions.map((e) => (
              <tr key={e.id} className="border-t border-line-2">
                <td className="py-1.5">{e.qty}</td>
                <td className="py-1.5 text-muted">
                  {price(e.entryPrice)} · {timeOf(e.entryTime, tz, e.precision === "second")}
                </td>
                <td className="py-1.5 text-muted">
                  {price(e.exitPrice)} · {timeOf(e.exitTime, tz, e.precision === "second")}
                </td>
                <td className={`py-1.5 text-right ${e.pnl >= 0 ? "text-gain" : "text-loss"}`}>{money(e.pnl, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
