import { Newspaper, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { SessionReplay } from "../../../shared/ai/schemas";
import { eventsOnDay } from "../../../shared/news";
import { evaluateGuard } from "../../../shared/rules/account";
import type { DayEvaluation } from "../../../shared/rules/evaluate";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Bits";
import { Meter } from "../../components/ui/Stat";
import { replayInput } from "../../lib/aiInputs";
import { ai, useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { money, timeOf } from "../../lib/format";
import { href } from "../../lib/router";
import { getData, setDayJournal, useStore } from "../../lib/store";

export function DayNews({ day }: { day: string }) {
  const news = useStore((s) => s.data.news);
  const tz = useStore((s) => s.data.settings.timezone);
  const grouping = useStore((s) => s.data.settings.dayGrouping);
  const { newsDays } = useDerived();
  const events = eventsOnDay(news, day, tz, grouping).filter((e) => e.impact === "high" || e.impact === "medium");
  return (
    <Card>
      <CardHeader title="News that day" eyebrow={<span className="inline-flex items-center gap-1.5"><Newspaper className="size-3.5" /> Economic calendar</span>} />
      <div className="px-5 pb-5 pt-3">
        {!newsDays.has(day) ? (
          <p className="text-[13px] leading-relaxed text-muted">No calendar saved for this day. The companion saves the Forex Factory calendar every week from now on.</p>
        ) : events.length === 0 ? (
          <p className="text-[13px] text-muted">No high or medium-impact releases.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 text-[13px]">
                <span className="w-[62px] shrink-0 font-mono text-[12px] tnum text-muted">{timeOf(e.time, tz)}</span>
                <span className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${e.impact === "high" ? "bg-loss" : "bg-warn"}`} aria-hidden />
                <span className="text-ink-2">
                  {e.title} <span className="text-faint">{e.currency}</span>
                  <span className="sr-only">{e.impact} impact</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function DayGuard({ ev }: { ev: DayEvaluation }) {
  const guards = useStore((s) => s.data.guards);
  const { allTrades, accounts } = useDerived();
  const guard = guards.find((g) => g.account && g.account === ev.account) ?? guards.find((g) => !g.account);
  if (!guard) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-faint" aria-hidden />
          <div>
            <div className="text-[14px] font-semibold">Trading a prop firm account?</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Most evaluations are failed on a risk limit, not strategy. Add your account's daily loss limit and drawdown to the{" "}
              <a className="text-amber hover:underline" href={href("/rules")}>
                Account Guard
              </a>{" "}
              and Debrief shows how close you are every day.
            </p>
          </div>
        </div>
      </Card>
    );
  }
  const s = evaluateGuard(guard, allTrades, ev.day);
  const day = s.days.find((d) => d.day === ev.day);
  const dayNet = day?.net ?? ev.net;
  const breached = s.breaches.filter((b) => b.day === ev.day);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          {breached.length ? <ShieldAlert className="size-5 shrink-0 text-loss" aria-hidden /> : <ShieldCheck className="size-5 shrink-0 text-gain" aria-hidden />}
          {guard.name}
        </div>
        <span className="font-mono text-[12.5px] text-muted">balance {money(day?.balance ?? s.balance)}</span>
      </div>
      {guard.dailyLossLimit ? (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[12.5px]">
            <span className="text-muted">Daily loss used</span>
            <span className="font-mono tnum text-ink-2">
              {money(Math.max(0, -dayNet))} of {money(guard.dailyLossLimit)}
            </span>
          </div>
          <Meter value={Math.max(0, -dayNet)} max={guard.dailyLossLimit} tone={-dayNet >= guard.dailyLossLimit ? "loss" : -dayNet >= guard.dailyLossLimit * 0.7 ? "warn" : "gain"} label="Daily loss used" />
        </div>
      ) : null}
      {s.threshold !== null && day && (
        <div className="mt-3 text-[12.5px] text-muted">
          Drawdown room at the close: <span className="font-mono tnum text-ink-2">{money(day.balance - (day.threshold ?? s.threshold))}</span>
        </div>
      )}
      {breached.map((b, i) => (
        <p key={i} className="mt-3 text-[13px] leading-relaxed text-loss">
          {b.message}
        </p>
      ))}
      {!guard.account && accounts.length > 1 && (
        <p className="mt-3 text-[12px] leading-relaxed text-warn">
          This guard adds up {accounts.length} accounts.{" "}
          <a href={href("/rules")} className="underline">
            Pick its account
          </a>{" "}
          so the limits match your prop firm's.
        </p>
      )}
    </Card>
  );
}

export function DayJournalCard({ day }: { day: string }) {
  const j = useStore((s) => s.data.journal[day]);
  const moods = ["😣", "🙁", "😐", "🙂", "😄"];
  return (
    <Card>
      <CardHeader title="Your journal" subtitle="Write it while it's fresh. The coach reads it too." />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">Plan before the open</span>
          <textarea className="field min-h-[70px] resize-y" placeholder="Bias, key levels, what you're waiting for…" value={j?.plan ?? ""} onChange={(e) => setDayJournal(day, { plan: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">After the session</span>
          <textarea className="field min-h-[90px] resize-y" placeholder="What happened? Where did you go off script, and why?" value={j?.reflection ?? ""} onChange={(e) => setDayJournal(day, { reflection: e.target.value })} />
        </label>
        <div>
          <div className="label mb-2">How did it feel?</div>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Mood">
            {moods.map((m, i) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={j?.mood === i + 1}
                aria-label={`Mood ${i + 1} of 5`}
                onClick={() => setDayJournal(day, { mood: j?.mood === i + 1 ? undefined : i + 1 })}
                className={`cursor-pointer rounded-xl border px-2.5 py-1.5 text-[18px] ${j?.mood === i + 1 ? "border-amber bg-amber/10" : "border-line opacity-60 hover:opacity-100"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SessionReplayCard({ ev }: { ev: DayEvaluation }) {
  const { available, status } = useCompanion();
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState<SessionReplay | null>(null);
  const tz = useStore((s) => s.data.settings.timezone);
  if (!available || !status?.ai.ready) return null;
  const run = async () => {
    setBusy(true);
    try {
      const { result } = await ai<SessionReplay>("session-replay", replayInput(getData(), ev));
      setReplay(result);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="What was the market doing?"
        subtitle="Searches the news for your session and checks your entry times against it."
        action={!replay && <Button size="sm" onClick={run} loading={busy}>Look it up</Button>}
      />
      <div className="px-5 pb-5 pt-3">
        {busy && <Spinner label="Searching the news around your entries…" />}
        {replay && (
          <div className="animate-fade-in">
            <p className="text-[16px] font-semibold leading-snug">{replay.headline}</p>
            <ul className="mt-3 flex flex-col divide-y divide-line-2">
              {replay.happened.slice(0, 4).map((h, i) => (
                <li key={i} className="flex gap-3 py-2 text-[13px]">
                  <span className="w-[76px] shrink-0 font-mono text-[12px] text-muted">{h.time}</span>
                  <span>
                    <span className="font-medium text-ink">{h.what}</span>
                    <span className="block text-muted">{h.plain}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-xl border border-amber/30 bg-amber/5 px-3 py-2.5">
              <div className="label mb-1 !text-amber">Your entries</div>
              <p className="text-[13px] leading-relaxed text-ink-2">{replay.yourEntries}</p>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">{replay.backdrop}</p>
            <p className="mt-2 text-[11.5px] text-faint">Context for your journal, not trade advice. Times shown as the news reported them ({tz === "America/New_York" ? "ET" : "New York time"}).</p>
          </div>
        )}
      </div>
    </Card>
  );
}
