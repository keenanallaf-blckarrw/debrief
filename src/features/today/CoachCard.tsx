import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { DayDebrief, StoredDebrief } from "../../../shared/ai/schemas";
import type { DayEvaluation } from "../../../shared/rules/evaluate";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Bits";
import { dayDebriefInput } from "../../lib/aiInputs";
import { ai, useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { ago } from "../../lib/format";
import { usePro } from "../../lib/plan";
import { href } from "../../lib/router";
import { getData, openPro, saveDebrief, useStore } from "../../lib/store";

export function debriefKey(ev: DayEvaluation): string {
  return `day:${ev.day}|${ev.account}`;
}

export function CoachCard({ ev }: { ev: DayEvaluation }) {
  const { available, status } = useCompanion();
  const derived = useDerived();
  const pro = usePro();
  const stored = useStore((s) => s.data.debriefs[debriefKey(ev)]);
  const sample = useStore((s) => s.data.executions.some((e) => e.format === "sample"));
  const [busy, setBusy] = useState(false);
  const aiReady = available && status?.ai.ready;

  const run = async () => {
    setBusy(true);
    try {
      const tier = pro ? "pro" : "free";
      const input = dayDebriefInput(getData(), derived, ev, tier);
      const { result, model } = await ai<DayDebrief>("day-debrief", input);
      const record: StoredDebrief = { key: debriefKey(ev), kind: "day", label: ev.day, createdAt: Date.now(), model, tier, day: result, sample };
      saveDebrief(record);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const d = stored?.day;
  return (
    <div className="rounded-[24px] border border-line bg-soft/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.18em] text-gain">
          <Sparkles className="size-3.5" aria-hidden /> AI COACH
        </div>
        {d && aiReady && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={run}>
            Redo
          </Button>
        )}
      </div>

      {busy && !d ? (
        <Spinner label="Reading your session against your rules…" className="py-8" />
      ) : d ? (
        <div className="mt-3 animate-fade-in">
          <p className="text-[20px] font-semibold leading-snug tracking-[-0.015em] text-ink">{d.headline}</p>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{d.summary}</p>
          {d.toFix.length > 0 && (
            <div className="mt-4">
              <div className="label mb-1.5 !text-loss">Fix next</div>
              <ul className="flex flex-col gap-1.5">
                {d.toFix.slice(0, 4).map((x, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-ink-2">
                    <span className="text-loss" aria-hidden>—</span>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.wentWell.length > 0 && (
            <div className="mt-4">
              <div className="label mb-1.5 !text-gain">Keep doing</div>
              <ul className="flex flex-col gap-1.5">
                {d.wentWell.slice(0, 3).map((x, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-ink-2">
                    <span className="text-gain" aria-hidden>—</span>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3">
            <div className="label mb-1 !text-amber">Focus for next session</div>
            <p className="text-[14px] font-medium leading-relaxed text-ink">{d.focus}</p>
          </div>
          <p className="mt-4 text-[14px] italic leading-relaxed text-amber">{d.question}</p>
          <div className="mt-3 text-[11.5px] text-faint">
            {stored.tier === "free" ? "Free debrief" : "Pro debrief"} · {ago(stored.createdAt)} · coaching on process, never trade advice
            {stored.tier === "free" && !pro && (
              <button type="button" onClick={() => openPro(true)} className="ml-2 cursor-pointer text-amber hover:underline">
                Go Pro for the full read
              </button>
            )}
          </div>
        </div>
      ) : aiReady ? (
        <div className="mt-3">
          <p className="text-[14px] leading-relaxed text-ink-2">
            Your coach reads every trade against your rules and tells you, in plain words, what cost you and what to do differently next session.
          </p>
          <Button variant="primary" className="mt-4" icon={<Sparkles className="size-4" />} loading={busy} onClick={run}>
            Debrief this session
          </Button>
        </div>
      ) : (
        <div className="mt-3 text-[13.5px] leading-relaxed text-muted">
          {available ? (
            <>
              The AI coach is off. Add your Anthropic API key in{" "}
              <a href={href("/settings")} className="text-amber hover:underline">
                Settings
              </a>{" "}
              to get a written debrief of every session. Your grade and rule checks above work without it.
            </>
          ) : (
            <>
              The AI coach runs through the Debrief companion on your computer, which keeps your API key private. Start Debrief with{" "}
              <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px] text-ink-2">npm start</code> to turn it on. Your grade and rule checks work without it.
            </>
          )}
        </div>
      )}
    </div>
  );
}
