import { ChevronLeft, ChevronRight, Download, ListChecks, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { summarize } from "../../../shared/analytics/stats";
import type { DayEvaluation } from "../../../shared/rules/evaluate";
import { maskAccount } from "../../../shared/trades/roundtrips";
import type { Trade } from "../../../shared/types";
import { EquityChart } from "../../charts/EquityChart";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Empty, Grade, Money } from "../../components/ui/Bits";
import { useDerived } from "../../lib/derived";
import { dayLong, dayShort, money, pct, plural } from "../../lib/format";
import { loadSample } from "../../lib/importer";
import { href, navigate } from "../../lib/router";
import { clearSample, openImport, useStore } from "../../lib/store";
import { TradeDrawer } from "../trades/TradeDrawer";
import { TradeList } from "../trades/TradeList";
import { CoachCard, debriefKey } from "./CoachCard";
import { DayGuard, DayJournalCard, DayNews, SessionReplayCard } from "./DayExtras";
import { RuleChecklist } from "./RuleChecklist";

// Today: the debrief of one trading session. Grade and rule checks come from
// the rule engine (exact, no AI); the coach explains them.

function verdict(ev: DayEvaluation): string {
  const considered = ev.followed + ev.broken;
  if (!considered) return ev.unanswered ? "Tick your checklist to get a grade" : "No checkable rules yet";
  if (!ev.broken) return `All ${considered} ${considered === 1 ? "rule" : "rules"} followed`;
  return `${ev.broken} of ${considered} rules broken`;
}

/** Long values ("+$12,345") get a slightly smaller size so they always fit their box. */
function fit(text: string): string {
  if (text.length <= 6) return "text-[18px]";
  if (text.length <= 8) return "text-[16px]";
  return "text-[14px]";
}

function SmallStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line-2 bg-panel px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="whitespace-nowrap font-semibold tracking-[-0.02em]">{children}</div>
    </div>
  );
}

function GradeCard({ ev, rulesCount }: { ev: DayEvaluation; rulesCount: number }) {
  const rules = useStore((s) => s.data.rules);
  const s = summarize(ev.trades);
  const net = money(s.net, { sign: true });
  const win = pct(s.winRate);
  return (
    // The card lays itself out by its own width: beside the coach on a wide
    // screen it's narrow, so the checklist moves under the grade instead of
    // squeezing the stat boxes.
    <Card className="@container overflow-hidden">
      <div className="grid gap-6 p-6 @min-[760px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col justify-between gap-6">
          <div className="flex items-center gap-5">
            <Grade grade={ev.grade} className="text-[108px]" />
            <div>
              <div className="label">Process grade</div>
              <div className="mt-1 text-[19px] font-semibold leading-tight tracking-[-0.01em]">{verdict(ev)}</div>
              {ev.score !== null && <div className="mt-1 text-[12.5px] text-muted">Discipline score {ev.score}/100</div>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SmallStat label="Net">
              <Money value={s.net} className={fit(net)} />
            </SmallStat>
            <SmallStat label="Trades">
              <span className={fit(String(s.trades))}>{s.trades}</span>
            </SmallStat>
            <SmallStat label="Win rate">
              <span className={fit(win)}>{win}</span>
            </SmallStat>
          </div>
          {s.commission > 0 && <div className="-mt-3 text-[11.5px] text-faint">Net after {money(s.commission)} in commissions.</div>}
        </div>
        <div className="min-w-0">
          <div className="label mb-1">Your rules today</div>
          {rulesCount ? (
            <RuleChecklist ev={ev} rules={rules} />
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed border-line p-4 text-[13px] leading-relaxed text-muted">
              Debrief grades your session against <em>your</em> rules. Add a few (max trades a day, a daily loss limit, stop after two losses…) and every session gets a grade.
              <div className="mt-3">
                <Button size="sm" variant="primary" icon={<ListChecks className="size-3.5" />} onClick={() => navigate("/rules")}>
                  Set my rules
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function NoTrades() {
  return (
    <Card>
      <Empty
        icon={<Download className="size-8" />}
        title="No trades yet"
        action={
          <>
            <Button variant="primary" icon={<Download className="size-4" />} onClick={() => openImport(true)}>
              Import my trades
            </Button>
            <Button icon={<Sparkles className="size-4" />} onClick={loadSample}>
              Explore with sample data
            </Button>
          </>
        }
      >
        Export your trade history from Tradovate or TradingView and drop it in, or let the companion pick it up from your Downloads folder automatically.
      </Empty>
    </Card>
  );
}

export function TodayPage({ day }: { day?: string }) {
  const derived = useDerived();
  const tz = useStore((s) => s.data.settings.timezone);
  const rules = useStore((s) => s.data.rules);
  const notes = useStore((s) => s.data.tradeNotes);
  const debriefs = useStore((s) => s.data.debriefs);
  const hasSample = useStore((s) => s.data.executions.some((e) => e.format === "sample"));
  const [open, setOpen] = useState<Trade | null>(null);

  const days = derived.days;
  const current = day && days.includes(day) ? day : days[0];
  const idx = current ? days.indexOf(current) : -1;
  const evs = current ? derived.dayEvaluations(current) : [];
  const enabledRules = rules.filter((r) => r.enabled).length;

  const coachNotes = useMemo(() => {
    const m = new Map<string, string>();
    for (const ev of evs) for (const n of debriefs[debriefKey(ev)]?.day?.tradeNotes ?? []) m.set(n.tradeKey, n.note);
    return m;
  }, [evs, debriefs]);

  if (!days.length) {
    return (
      <div>
        <h1 className="mb-6 text-[28px] font-bold tracking-[-0.025em]">Know exactly what you did.</h1>
        <NoTrades />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {hasSample && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px]">
          <span className="text-ink-2">
            You're exploring <strong className="text-amber">sample data</strong>. Import your own trades and it's replaced automatically.
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => openImport(true)}>
              Import mine
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSample}>
              Remove sample
            </Button>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Session debrief</div>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">{dayLong(current)}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" aria-label="Earlier session" disabled={idx >= days.length - 1} onClick={() => navigate(`/day/${days[idx + 1]}`)} icon={<ChevronLeft className="size-4" />} />
          <select className="field !h-8 !w-auto !py-0 text-[12.5px]" value={current} onChange={(e) => navigate(`/day/${e.target.value}`)} aria-label="Pick a session">
            {days.map((d) => (
              <option key={d} value={d}>
                {dayShort(d)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" aria-label="Later session" disabled={idx <= 0} onClick={() => navigate(`/day/${days[idx - 1]}`)} icon={<ChevronRight className="size-4" />} />
        </div>
      </div>

      {evs.map((ev) => (
        <section key={ev.account} className="mb-10" aria-label={`Account ${maskAccount(ev.account)}`}>
          {evs.length > 1 && <div className="label mb-2">Account {maskAccount(ev.account)}</div>}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <GradeCard ev={ev} rulesCount={enabledRules} />
              <Card>
                <CardHeader title="How the day unfolded" subtitle="Running net P&L, trade by trade." />
                <div className="px-2 pb-2 pt-1">
                  <EquityChart trades={ev.trades} tz={tz} mode="trades" height={210} label="Running net P&L during the session" />
                </div>
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <CoachCard ev={ev} />
              <DayGuard ev={ev} />
            </div>
          </div>

          <Card className="mt-4">
            <CardHeader
              title={plural(ev.trades.length, "trade")}
              subtitle="Click a trade to replay it on the chart and add notes."
              action={
                <a href={href("/trades")} className="text-[12.5px] text-muted hover:text-ink">
                  All trades →
                </a>
              }
            />
            <div className="pb-2 pt-3">
              <TradeList trades={ev.trades} tz={tz} violations={derived.evaluation.byTrade} notes={notes} onOpen={setOpen} coachNotes={coachNotes} />
            </div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <DayJournalCard day={ev.day} />
            <div className="flex flex-col gap-4">
              <DayNews day={ev.day} />
              <SessionReplayCard ev={ev} />
            </div>
          </div>
        </section>
      ))}
      <TradeDrawer trade={open} onClose={() => setOpen(null)} />
    </div>
  );
}
