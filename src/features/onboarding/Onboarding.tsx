import { ArrowRight, Check, FolderSearch, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { makeRule, RULES, ruleLabel } from "../../../shared/rules/catalog";
import type { Rule } from "../../../shared/types";
import { Button } from "../../components/ui/Button";
import { Chip, Field } from "../../components/ui/Bits";
import { companion, useCompanion } from "../../lib/companion";
import { ago, plural } from "../../lib/format";
import { importInbox, loadSample } from "../../lib/importer";
import { finishOnboarding, getData, replaceAll, setProfile, setRules, upsertGuard, useStore } from "../../lib/store";
import { AutoImport } from "../import/AutoImport";
import { DropZone } from "../import/ImportCenter";
import { newGuard } from "../rules/AccountGuardCard";
import { MARKETS, STRATEGIES } from "./options";

// First run, four short steps: who you are, your rules, your account, your trades.

interface Starter {
  rule: Rule;
  on: boolean;
}

function starterSet(): Starter[] {
  return [
    { rule: makeRule("maxTradesPerDay", { max: 3 }), on: true },
    { rule: makeRule("dailyLossLimit", { amount: 500 }), on: true },
    { rule: makeRule("maxConsecutiveLosses", { max: 2 }), on: true },
    { rule: makeRule("revengeCooldown", { minutes: 5 }), on: true },
    { rule: makeRule("maxContracts", { max: 5 }), on: false },
    { rule: makeRule("tradingWindow"), on: false },
    { rule: makeRule("newsBuffer", { minutes: 5, minImpact: "high" }), on: false },
    { rule: makeRule("noSizeUpAfterLoss"), on: false },
  ];
}

function Steps({ step }: { step: number }) {
  const names = ["You", "Your rules", "Your account", "Your trades"];
  return (
    <ol className="mb-10 flex flex-wrap gap-2" aria-label="Setup steps">
      {names.map((n, i) => (
        <li key={n} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${i === step ? "border-amber/60 text-amber" : i < step ? "border-line text-ink-2" : "border-line-2 text-faint"}`} aria-current={i === step ? "step" : undefined}>
          {i < step ? <Check className="size-3.5" aria-hidden /> : <span className="font-mono">{i + 1}</span>} {n}
        </li>
      ))}
    </ol>
  );
}

function RestoreOffer() {
  const { available, status } = useCompanion();
  if (!available || !status?.backups.latest) return null;
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3 text-[13px]">
      <span>Found a Debrief backup on this computer from {ago(status.backups.latest)}.</span>
      <Button
        size="sm"
        variant="primary"
        icon={<RotateCcw className="size-3.5" />}
        onClick={async () => {
          try {
            const b = await companion.latestBackup();
            const d = replaceAll(b.data);
            if (!d.onboarded) finishOnboarding();
            toast.success(`Welcome back. Restored ${plural(d.executions.length, "fill")} and ${plural(d.rules.length, "rule")}.`);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        Restore it
      </Button>
    </div>
  );
}

export function Onboarding() {
  const profile = useStore((s) => s.data.profile);
  const [step, setStep] = useState(0);
  const [starters, setStarters] = useState<Starter[]>(starterSet);
  const [checklist, setChecklist] = useState<string[]>(["Set my daily bias before the open"]);
  const [newItem, setNewItem] = useState("");
  const [guardOn, setGuardOn] = useState(false);
  const [guardAmounts, setGuardAmounts] = useState({ start: 50000, daily: 1000, dd: 2000, target: 3000 });
  const { available, status } = useCompanion();
  const [scan, setScan] = useState<{ busy: boolean; found: number | null; dir?: string }>({ busy: false, found: null });
  const tradeCount = useStore((s) => s.data.executions.length);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const canNext = step !== 0 || (profile.name.trim() && profile.markets.length && profile.strategies.length);

  const saveRules = () => {
    const rules = [...starters.filter((s) => s.on).map((s) => s.rule), ...checklist.filter(Boolean).map((c) => makeRule("manual", { scope: "day" }, c))];
    setRules(rules);
  };
  const saveGuard = () => {
    if (!guardOn) return;
    const g = newGuard();
    upsertGuard({ ...g, name: "My evaluation", startBalance: guardAmounts.start, dailyLossLimit: guardAmounts.daily || undefined, maxDrawdown: guardAmounts.dd || undefined, profitTarget: guardAmounts.target || undefined });
  };

  const scanDownloads = async () => {
    setScan({ busy: true, found: null });
    try {
      const r = await companion.scan();
      setScan({ busy: false, found: r.items.length, dir: r.dir });
      if (r.items.length) await importInbox(r.items);
    } catch (e) {
      setScan({ busy: false, found: null });
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const next = () => {
    if (step === 1) saveRules();
    if (step === 2) saveGuard();
    setStep(step + 1);
  };

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[720px] px-6 pb-20 pt-16">
        <div className="mb-3 font-mono text-[12px] font-medium uppercase tracking-[0.25em] text-amber">Debrief</div>
        <Steps step={step} />

        {step === 0 && (
          <div className="animate-fade-in">
            <RestoreOffer />
            <h1 className="text-[46px] font-extrabold leading-[1.04] tracking-[-0.035em]">
              You wrote the rules.
              <br />
              <span className="text-loss">Debrief holds you to them.</span>
            </h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-muted">
              Debrief reads your trades straight from your broker's export and grades every session against your own rules. No signals, no opinions. An honest mirror.
            </p>
            <div className="mt-10 flex flex-col gap-7">
              <Field label="What should we call you">
                <input className="field max-w-sm text-[15px]" value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} placeholder="Your first name" autoFocus />
              </Field>
              <div>
                <div className="label mb-2.5">Markets you trade</div>
                <div className="flex flex-wrap gap-2">
                  {MARKETS.map((m) => (
                    <Chip key={m} active={profile.markets.includes(m)} onClick={() => setProfile({ markets: toggle(profile.markets, m) })}>
                      {m}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-2.5">How you trade</div>
                <div className="flex flex-wrap gap-2">
                  {STRATEGIES.map((m) => (
                    <Chip key={m} active={profile.strategies.includes(m)} onClick={() => setProfile({ strategies: toggle(profile.strategies, m) })}>
                      {m}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-fade-in">
            <h1 className="text-[34px] font-extrabold tracking-[-0.03em]">What are your rules?</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
              Every session gets a grade: rules followed ÷ rules checked. Debrief checks these from your fills automatically. Change the numbers to match your plan.
            </p>
            <ul className="mt-7 flex flex-col gap-2">
              {starters.map((s, i) => (
                <li key={s.rule.id} className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${s.on ? "border-line bg-card" : "border-line-2"}`}>
                  <label className="flex min-w-0 cursor-pointer items-center gap-3">
                    <input type="checkbox" checked={s.on} onChange={() => setStarters(starters.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} className="size-4 shrink-0 accent-[#d8a94b]" />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">{ruleLabel(s.rule)}</span>
                      <span className="block text-[12px] text-faint">{RULES[s.rule.kind].help}</span>
                    </span>
                  </label>
                  {"max" in s.rule.params || "amount" in s.rule.params || ("minutes" in s.rule.params && s.rule.kind !== "newsBuffer") ? (
                    <input
                      type="number"
                      aria-label={`Number for: ${ruleLabel(s.rule)}`}
                      className="field !w-24 shrink-0 !py-1.5 text-center font-mono"
                      value={(s.rule.params as { max?: number; amount?: number; minutes?: number }).max ?? (s.rule.params as { amount?: number }).amount ?? (s.rule.params as { minutes?: number }).minutes ?? 0}
                      onChange={(e) => {
                        const n = Math.max(0, Number(e.target.value));
                        const p = s.rule.params as Record<string, unknown>;
                        const key = "max" in p ? "max" : "amount" in p ? "amount" : "minutes";
                        setStarters(starters.map((x, j) => (j === i ? { ...x, on: true, rule: { ...x.rule, params: { ...p, [key]: n } } as Rule } : x)));
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            <h2 className="mt-8 text-[16px] font-semibold">Your checklist</h2>
            <p className="mt-1 text-[13px] text-muted">Things only you can answer. You'll tick them in each debrief.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input className="field" value={c} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Checklist item ${i + 1}`} />
                  <Button variant="ghost" size="sm" onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} aria-label="Remove">
                    ×
                  </Button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newItem.trim()) setChecklist([...checklist, newItem.trim()]);
                setNewItem("");
              }}
            >
              <input className="field" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder='e.g. "Only trade at key levels" or "Waited for the sweep"' />
              <Button type="submit">Add</Button>
            </form>
            <Field label="Anything else, in your own words (optional)" className="mt-8" hint="The AI coach reads this, and can turn it into more rules later on the Rules page.">
              <textarea className="field min-h-[90px]" value={profile.rulesText} onChange={(e) => setProfile({ rulesText: e.target.value })} placeholder="e.g. I wait for SMT divergence between ES and NQ, then enter on a 61.8 retrace. Done by 11:30." />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in">
            <h1 className="text-[34px] font-extrabold tracking-[-0.03em]">Trading a prop firm account?</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
              Most evaluations are failed on a risk limit, not a bad strategy. The Account Guard tracks your daily loss limit, drawdown and profit target from every trade. You can change this any time.
            </p>
            <div className="mt-7 flex gap-2">
              <Chip active={guardOn} onClick={() => setGuardOn(true)}>Yes, set it up</Chip>
              <Chip active={!guardOn} onClick={() => setGuardOn(false)}>Not now</Chip>
            </div>
            {guardOn && (
              <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-line bg-card p-5">
                {([
                  ["start", "Starting balance"],
                  ["daily", "Daily loss limit"],
                  ["dd", "Max drawdown (trailing)"],
                  ["target", "Profit target"],
                ] as const).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input type="number" className="field font-mono" value={guardAmounts[k]} onChange={(e) => setGuardAmounts({ ...guardAmounts, [k]: Math.max(0, Number(e.target.value)) })} />
                  </Field>
                ))}
                <p className="col-span-2 text-[12px] text-faint">Typical numbers for a $50K evaluation. Check your firm's current rules; you can fine-tune drawdown type and more on the Rules page.</p>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-in">
            <h1 className="text-[34px] font-extrabold tracking-[-0.03em]">Bring in your trades</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
              Debrief reads the export your broker already gives you, so every number is exact. Duplicates are skipped, so dropping the same file twice is fine.
            </p>
            {available && status && (
              <div className="mt-7 rounded-2xl border border-gain/30 bg-gain/5 p-5">
                <div className="flex items-start gap-3">
                  <FolderSearch className="mt-0.5 size-5 shrink-0 text-gain" aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">Find the exports you already downloaded</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">
                      The Debrief companion is running. It can look in <span className="font-mono text-ink-2">{status.watch.dir}</span> for Tradovate and TradingView exports from the past year and import them all at once. After that, every new export imports itself.
                    </p>
                    <Button className="mt-3" variant="primary" loading={scan.busy} onClick={scanDownloads} icon={<FolderSearch className="size-4" />}>
                      Scan my Downloads
                    </Button>
                    {scan.found !== null && (
                      <p className="mt-2 text-[12.5px] text-ink-2">{scan.found ? `Found ${plural(scan.found, "export")}.` : "No trade exports found there from the past year."}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!available && (
              <div className="mt-7">
                <AutoImport compact />
              </div>
            )}
            <div className="mt-5">
              <DropZone big />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-muted">
              <span>No export handy?</span>
              <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => { loadSample(); finishOnboarding(); }}>
                Explore with sample data
              </Button>
            </div>
            {tradeCount > 0 && <p className="mt-6 text-[14px] text-gain">{plural(getData().executions.length, "fill pair")} imported. You're ready.</p>}
          </div>
        )}

        <div className="mt-12 flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <Button variant="primary" size="lg" disabled={!canNext} onClick={next} iconRight={<ArrowRight className="size-4" />}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={finishOnboarding} iconRight={<ArrowRight className="size-4" />}>
              {tradeCount ? "See my debrief" : "Skip for now"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
