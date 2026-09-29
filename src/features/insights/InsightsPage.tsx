import { Lock, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { PeriodDebrief, StoredDebrief } from "../../../shared/ai/schemas";
import { analyzeBehavior } from "../../../shared/analytics/behavior";
import { buildInsights, splitByRules } from "../../../shared/analytics/insights";
import { byHold, byHour, byInstrument, bySequence, bySide, byWeekday, dailyNet, summarize } from "../../../shared/analytics/stats";
import { addDays } from "../../../shared/util/time";
import { BarList } from "../../charts/BarList";
import { CalendarHeatmap } from "../../charts/CalendarHeatmap";
import { EquityChart } from "../../charts/EquityChart";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Empty, Money, Segmented, Spinner } from "../../components/ui/Bits";
import { Stat } from "../../components/ui/Stat";
import { periodInput } from "../../lib/aiInputs";
import { ai, useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { dayShort, duration, money, pct, plural, ratio } from "../../lib/format";
import { usePro } from "../../lib/plan";
import { navigate } from "../../lib/router";
import { getData, openImport, openPro, saveDebrief, useStore } from "../../lib/store";

type Period = "7" | "30" | "90" | "all";
const LABEL: Record<Period, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", all: "All time" };

function ProGate({ children, what }: { children: ReactNode; what: string }) {
  const pro = usePro();
  if (pro) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-25 blur-[3px]" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
        <Lock className="size-5 text-amber" aria-hidden />
        <div className="max-w-sm text-[13.5px] text-ink-2">{what} is part of Debrief Pro.</div>
        <Button size="sm" variant="primary" onClick={() => openPro(true)}>
          Unlock Pro
        </Button>
      </div>
    </div>
  );
}

function PeriodDebriefCard({ label, trades }: { label: string; trades: ReturnType<typeof useDerived>["trades"] }) {
  const { available, status } = useCompanion();
  const derived = useDerived();
  const pro = usePro();
  const key = `period:${label}|${getData().settings.account || "all"}`;
  const stored = useStore((s) => s.data.debriefs[key]);
  const [busy, setBusy] = useState(false);
  if (!available || !status?.ai.ready) return null;
  const run = async () => {
    if (!pro) return openPro(true);
    setBusy(true);
    try {
      const { result, model } = await ai<PeriodDebrief>("period-debrief", periodInput(getData(), derived, trades, label, "pro"));
      const rec: StoredDebrief = { key, kind: "period", label, createdAt: Date.now(), model, tier: "pro", period: result };
      saveDebrief(rec);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const p = stored?.period;
  return (
    <Card className="mb-4">
      <CardHeader
        eyebrow={<span className="inline-flex items-center gap-1.5 !text-gain"><Sparkles className="size-3.5" /> AI coach</span>}
        title={p ? p.headline : `Debrief the whole period (${label.toLowerCase()})`}
        subtitle={p ? undefined : "Patterns across days: when you trade best, where you leak, and what to focus on next."}
        action={<Button size="sm" variant={p ? "ghost" : "primary"} loading={busy} onClick={run}>{p ? "Redo" : pro ? "Debrief this period" : "Pro: debrief this period"}</Button>}
      />
      {busy && !p && <Spinner label="Reading every session in this period…" className="px-5 py-6" />}
      {p && (
        <div className="grid gap-5 px-5 pb-5 pt-3 md:grid-cols-2">
          <div>
            <p className="text-[14px] leading-relaxed text-ink-2">{p.summary}</p>
            <div className="mt-4 rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3">
              <div className="label mb-1 !text-amber">Focus next</div>
              <ul className="flex flex-col gap-1 text-[13.5px] text-ink">
                {p.focus.slice(0, 3).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-[13.5px] italic text-amber">{p.question}</p>
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <div className="label mb-1.5">Patterns</div>
              <ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-ink-2">
                {p.patterns.slice(0, 6).map((x, i) => (
                  <li key={i} className="flex gap-2"><span className="text-loss" aria-hidden>—</span>{x}</li>
                ))}
              </ul>
            </div>
            {p.dayNotes.length > 0 && (
              <div>
                <div className="label mb-1.5">Days to learn from</div>
                <ul className="flex flex-col gap-1">
                  {p.dayNotes.slice(0, 6).map((d) => (
                    <li key={d.day}>
                      <button type="button" onClick={() => navigate(`/day/${d.day}`)} className="cursor-pointer text-left text-[13px] text-ink-2 hover:text-ink">
                        <span className="mr-2 font-mono text-[12px] text-muted">{dayShort(d.day)}</span>
                        {d.note}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function InsightsPage() {
  const derived = useDerived();
  const tz = useStore((s) => s.data.settings.timezone);
  const news = useStore((s) => s.data.news);
  const rules = useStore((s) => s.data.rules);
  const [period, setPeriod] = useState<Period>("30");

  const latest = derived.days[0];
  const trades = useMemo(() => {
    const from = period === "all" || !latest ? null : addDays(latest, -Number(period) + 1);
    return derived.trades.filter((t) => !from || t.day >= from);
  }, [derived.trades, period, latest]);

  const s = useMemo(() => summarize(trades), [trades]);
  const behavior = useMemo(() => analyzeBehavior(trades, { news, newsDays: derived.newsDays }), [trades, news, derived.newsDays]);
  const brokenKeys = useMemo(() => new Set(trades.filter((t) => derived.evaluation.byTrade.has(t.key)).map((t) => t.key)), [trades, derived.evaluation]);
  const split = useMemo(() => (rules.length ? splitByRules(trades, brokenKeys) : null), [rules.length, trades, brokenKeys]);
  const insights = useMemo(() => buildInsights(trades, s, behavior, { timezone: tz, ruleSplit: split }), [trades, s, behavior, tz, split]);
  const daily = useMemo(() => dailyNet(derived.trades), [derived.trades]);
  const pro = usePro();

  const keys = new Set(trades.map((t) => t.key));
  const dayEvals = derived.evaluation.days.filter((e) => e.trades.some((t) => keys.has(t.key)) && e.score !== null);
  const avgScore = dayEvals.length ? Math.round(dayEvals.reduce((a, e) => a + (e.score ?? 0), 0) / dayEvals.length) : null;
  const cleanDays = dayEvals.filter((e) => e.broken === 0).length;

  const ruleCounts = useMemo(() => {
    const m = new Map<string, { label: string; broken: number; checked: number }>();
    for (const e of dayEvals) {
      for (const c of e.checks) {
        if (c.status !== "followed" && c.status !== "broken") continue;
        const x = m.get(c.ruleId) ?? { label: c.label, broken: 0, checked: 0 };
        x.checked++;
        if (c.status === "broken") x.broken++;
        m.set(c.ruleId, x);
      }
    }
    return [...m.values()].sort((a, b) => b.broken - a.broken);
  }, [dayEvals]);

  if (!derived.trades.length) {
    return (
      <Card>
        <Empty title="Insights appear once you've imported trades" action={<Button variant="primary" onClick={() => openImport(true)}>Import trades</Button>}>
          Your edge by hour, the cost of broken rules, and the habits that leak money.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Insights</div>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">How you really trade</h1>
        </div>
        <Segmented<Period>
          value={period}
          onChange={setPeriod}
          options={(Object.keys(LABEL) as Period[]).map((p) => ({ value: p, label: p === "all" ? "All" : `${p}d` }))}
        />
      </div>

      {/* Hero + KPIs */}
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="flex flex-col justify-center p-5">
          <div className="text-[12.5px] text-muted">Net P&L · {LABEL[period].toLowerCase()}</div>
          <Money value={s.net} className="mt-1 text-[48px] font-bold leading-none tracking-[-0.03em]" />
          <div className="mt-2 text-[12.5px] text-faint">
            {s.trades} trades over {s.days} days · {s.greenDays} green, {s.redDays} red
            {s.commission > 0 ? ` · ${money(s.commission)} commissions` : ""}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Win rate" value={pct(s.winRate)} note={`${s.wins}W · ${s.losses}L`} help="Winning trades out of all trades that won or lost (breakeven trades don't count)." />
          <Stat label="Profit factor" value={ratio(s.profitFactor)} tone={s.profitFactor !== null && s.profitFactor < 1 ? "loss" : undefined} help="Dollars won ÷ dollars lost. Above 1.0 means your winners pay for your losers." />
          <Stat label="Avg per trade" value={<Money value={s.expectancy} />} help="Net P&L divided by the number of trades: what an average trade is worth to you." />
          <Stat label="Avg win / loss" value={<span className="flex flex-wrap items-baseline gap-x-1.5 text-[18px]"><Money value={s.avgWin} /><span className="text-faint">/</span><Money value={s.avgLoss} /></span>} note={s.payoff ? `payoff ${s.payoff.toFixed(2)}×` : undefined} help="Your average winner and average loser. Payoff is how many times bigger the average win is." />
          <Stat label="Max drawdown" value={money(-s.maxDrawdown)} tone={s.maxDrawdown > 0 ? "loss" : undefined} help="The deepest drop from a high point in your running P&L during this period." />
          <Stat label="Discipline" value={avgScore === null ? "—" : `${avgScore}/100`} note={dayEvals.length ? `${cleanDays} of ${dayEvals.length} days rule-clean` : "Add rules to track"} help="Average of your daily process scores: rules followed ÷ rules checked." />
        </div>
      </div>

      <PeriodDebriefCard label={LABEL[period]} trades={trades} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Equity curve" subtitle="Running net P&L. Green while you're above where you started, red below." />
          <div className="px-2 pb-2 pt-2">
            <EquityChart trades={trades} tz={tz} mode={period === "7" ? "trades" : "days"} height={280} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Your findings" subtitle="Computed from your fills. The biggest dollar effects come first." />
          <div className="px-5 pb-5 pt-3">
            {insights.length ? (
              <ul className="flex flex-col gap-3">
                {insights.slice(0, pro ? 6 : 2).map((i) => (
                  <li key={i.id} className="flex gap-3">
                    {i.tone === "good" ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-gain" aria-hidden /> : <TrendingDown className={`mt-0.5 size-4 shrink-0 ${i.tone === "bad" ? "text-loss" : "text-muted"}`} aria-hidden />}
                    <div>
                      <div className="text-[13.5px] font-semibold leading-snug">{i.title}</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{i.detail}</div>
                    </div>
                  </li>
                ))}
                {!pro && insights.length > 2 && (
                  <li>
                    <button type="button" onClick={() => openPro(true)} className="cursor-pointer text-[12.5px] text-amber hover:underline">
                      + {insights.length - 2} more findings with Pro
                    </button>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Import a few more sessions and Debrief will start spotting patterns.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Calendar" subtitle="Every trading day, colored by result. Click a day to open its debrief." />
          <div className="px-5 pb-5 pt-3">
            <CalendarHeatmap daily={daily} evaluations={derived.dayEvaluations} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Rules vs results" subtitle="What following your own rules is worth." />
          <div className="px-5 pb-5 pt-3">
            {split && (split.broken.trades || split.clean.trades) ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-gain/25 bg-gain/5 p-3">
                    <div className="text-[12px] text-muted">Followed your rules</div>
                    <Money value={split.clean.net} className="text-[22px] font-semibold" />
                    <div className="text-[12px] text-faint">{split.clean.trades} trades · {pct(split.clean.winRate)} win rate</div>
                  </div>
                  <div className="rounded-2xl border border-loss/25 bg-loss/5 p-3">
                    <div className="text-[12px] text-muted">Broke a rule</div>
                    <Money value={split.broken.net} className="text-[22px] font-semibold" />
                    <div className="text-[12px] text-faint">{split.broken.trades} trades · {pct(split.broken.winRate)} win rate</div>
                  </div>
                </div>
                {split.broken.trades > 0 && split.broken.net < 0 && (
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                    Without the {plural(split.broken.trades, "trade")} that broke your rules, you'd be at <Money value={split.clean.net} className="font-semibold" /> instead of{" "}
                    <Money value={split.clean.net + split.broken.net} className="font-semibold" />.
                  </p>
                )}
                {ruleCounts.length > 0 && (
                  <div className="mt-4">
                    <div className="label mb-2">Most broken</div>
                    <ul className="flex flex-col gap-2">
                      {ruleCounts.slice(0, 5).map((r) => (
                        <li key={r.label} className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="min-w-0 truncate text-ink-2">{r.label}</span>
                          <span className="shrink-0 font-mono text-[12px] tnum text-muted">
                            broken {r.broken} of {r.checked} days
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted">
                Set your rules and Debrief will show how your rule-following trades compare with the rest.{" "}
                <button type="button" onClick={() => navigate("/rules")} className="cursor-pointer text-amber hover:underline">
                  Set rules
                </button>
              </p>
            )}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-[17px] font-semibold">Where your edge lives</h2>
      <ProGate what="The deep breakdown of your trading">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["By hour of entry", byHour(trades, tz)],
            ["By trade number of the day", bySequence(trades)],
            ["By weekday", byWeekday(trades)],
            ["By hold time", byHold(trades)],
            ["By direction", bySide(trades)],
            ["By instrument", byInstrument(trades)],
          ].map(([title, buckets]) => (
            <Card key={title as string}>
              <CardHeader title={title as string} />
              <div className="px-4 pb-4 pt-1">
                <BarList buckets={buckets as ReturnType<typeof byHour>} title={title as string} />
              </div>
            </Card>
          ))}
        </div>
      </ProGate>

      <h2 className="mb-3 mt-8 text-[17px] font-semibold">Habits</h2>
      <ProGate what="Behavior tracking">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label={`Re-entries <${behavior.revenge.minutes}m after a loss`} value={behavior.revenge.trades} note={behavior.revenge.trades ? `${money(behavior.revenge.net, { sign: true })} · ${pct(behavior.revenge.winRate)} win` : "none"} tone={behavior.revenge.net < 0 ? "loss" : undefined} help="Trades opened within minutes of closing a loser: the classic revenge trade." />
          <Stat label="Size after a loss" value={behavior.sizeAfterLoss.afterLoss ? behavior.sizeAfterLoss.afterLoss.toFixed(1) : "—"} note={behavior.sizeAfterLoss.afterWin ? `vs ${behavior.sizeAfterLoss.afterWin.toFixed(1)} after a win` : undefined} help="Average contracts on the trade right after a loser, versus right after a winner." />
          <Stat label="Loser vs winner hold" value={behavior.holdRatio ? `${behavior.holdRatio.toFixed(1)}×` : "—"} note={`${duration(s.avgHoldLossMs)} vs ${duration(s.avgHoldWinMs)}`} tone={behavior.holdRatio && behavior.holdRatio > 1.5 ? "loss" : undefined} help="How much longer you hold losing trades than winning ones. Above 1 means losers get more rope." />
          <Stat label="After 2 losses in a row" value={behavior.afterLossStreak.trades} note={behavior.afterLossStreak.trades ? money(behavior.afterLossStreak.net, { sign: true }) : "none"} tone={behavior.afterLossStreak.net < 0 ? "loss" : undefined} help="Trades taken while already on a two-loss streak that day." />
          <Stat label="Heavy days" value={behavior.overtrading.days} note={behavior.overtrading.days ? `${money(behavior.overtrading.net, { sign: true })} on them` : `none (${behavior.overtrading.threshold}+ trades)`} help="Days with at least twice your usual number of trades." />
          <Stat label="Near big news" value={behavior.news ? behavior.news.trades : "—"} note={behavior.news ? money(behavior.news.net, { sign: true }) : "needs the calendar"} help="Entries within 15 minutes of a high-impact economic release." />
        </div>
      </ProGate>
    </div>
  );
}
