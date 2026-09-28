import { Plus, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { ParsedRules } from "../../../shared/ai/schemas";
import { AUTO_KINDS, makeRule, RULES, ruleLabel } from "../../../shared/rules/catalog";
import type { Rule, RuleKind } from "../../../shared/types";
import { addDays } from "../../../shared/util/time";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Bits";
import { ai, useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { setProfile, setRules, upsertRule, useStore } from "../../lib/store";
import { AccountGuardCard, AddGuardButton } from "./AccountGuardCard";
import { RuleCard } from "./RuleEditor";

/** Turn the AI's reading of your rules into real, editable rules. */
export function rulesFromParsed(parsed: ParsedRules): Rule[] {
  const out: Rule[] = [];
  for (const r of parsed.rules) {
    const n = r.number ?? undefined;
    switch (r.kind) {
      case "maxTradesPerDay":
      case "maxContracts":
      case "maxConsecutiveLosses":
        out.push(makeRule(r.kind, n ? { max: Math.round(n) } : undefined));
        break;
      case "dailyLossLimit":
      case "dailyProfitTarget":
      case "maxLossPerTrade":
        out.push(makeRule(r.kind, n ? { amount: Math.abs(n) } : undefined));
        break;
      case "revengeCooldown":
        out.push(makeRule(r.kind, n ? { minutes: Math.round(n) } : undefined));
        break;
      case "newsBuffer":
        out.push(makeRule(r.kind, n ? { minutes: Math.round(n) } : undefined));
        break;
      case "tradingWindow":
        out.push(makeRule(r.kind, r.windows?.length ? { windows: r.windows } : undefined));
        break;
      case "allowedInstruments":
        out.push(makeRule(r.kind, r.instruments?.length ? { roots: r.instruments.map((x) => x.toUpperCase()) } : undefined));
        break;
      case "noSizeUpAfterLoss":
      case "stopRequired":
      case "noStopWidening":
        out.push(makeRule(r.kind));
        break;
      case "manual":
        out.push(makeRule("manual", { scope: "day" }, r.label));
        break;
    }
  }
  return out;
}

/** True when the journal already has this rule (same kind; same wording for checklist items). */
function alreadyHave(existing: Rule[], r: Rule): boolean {
  if (r.kind === "manual") return existing.some((x) => x.kind === "manual" && (x.label ?? "").trim().toLowerCase() === (r.label ?? "").trim().toLowerCase());
  return existing.some((x) => x.kind === r.kind);
}

function RulesFromText() {
  const text = useStore((s) => s.data.profile.rulesText);
  const markets = useStore((s) => s.data.profile.markets);
  const existing = useStore((s) => s.data.rules);
  const { available, status } = useCompanion();
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ rules: Rule[]; notes: string } | null>(null);
  const aiReady = available && status?.ai.ready;

  const run = async () => {
    setBusy(true);
    try {
      const { result } = await ai<ParsedRules>("parse-rules", { text, markets });
      setProposal({ rules: rulesFromParsed(result), notes: result.notes });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your rules, in your own words"
        subtitle="The coach reads this for context. With the AI coach on, Debrief can also turn it into checkable rules."
      />
      <div className="px-5 pb-5 pt-3">
        <textarea
          className="field min-h-[110px] resize-y"
          value={text}
          onChange={(e) => setProfile({ rulesText: e.target.value })}
          placeholder="e.g. I wait for a liquidity sweep, then enter on a 61.8 retrace. Max 3 trades a day, stop after 2 losses, never trade the first 5 minutes or around CPI, done by 11:30. Max 5 MNQ."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button icon={<Wand2 className="size-4" />} variant={aiReady ? "primary" : "secondary"} disabled={!aiReady || text.trim().length < 3} loading={busy} onClick={run}>
            Turn these into rules
          </Button>
          {!aiReady && <span className="text-[12px] text-faint">Needs the AI coach (Settings). You can also add rules one by one below.</span>}
        </div>
        {proposal && (
          <div className="mt-4 rounded-2xl border border-amber/30 bg-amber/5 p-4">
            <div className="label mb-2 !text-amber">
              <Sparkles className="mr-1 inline size-3.5" /> The coach suggests {proposal.rules.length} rules
            </div>
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {proposal.rules.map((r) => (
                <li key={r.id} className={`flex items-center gap-2 ${alreadyHave(existing, r) ? "opacity-50" : ""}`}>
                  {RULES[r.kind].auto ? <Badge tone="blue">auto</Badge> : <Badge>tick</Badge>}
                  {ruleLabel(r)}
                  {alreadyHave(existing, r) && <span className="text-[11.5px] text-faint">(you already have this)</span>}
                </li>
              ))}
            </ul>
            {proposal.notes && <p className="mt-2 text-[12.5px] text-muted">{proposal.notes}</p>}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const fresh = proposal.rules.filter((r) => !alreadyHave(existing, r));
                  setRules([...existing, ...fresh]);
                  setProposal(null);
                  toast.success(fresh.length ? `Added ${fresh.length} ${fresh.length === 1 ? "rule" : "rules"}. Every session is now graded against them.` : "You already had all of these.");
                }}
              >
                Add the new ones
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setRules(proposal.rules); setProposal(null); }}>
                Replace my rules with these
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function AddRule({ rules }: { rules: Rule[] }) {
  const have = new Set(rules.map((r) => r.kind));
  const kinds: RuleKind[] = [...AUTO_KINDS, "manual"];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {kinds.map((k) => {
        const def = RULES[k];
        const taken = k !== "manual" && have.has(k);
        return (
          <button
            key={k}
            type="button"
            disabled={taken}
            onClick={() => upsertRule(k === "manual" ? makeRule("manual", { scope: "day" }, "New checklist item") : makeRule(k))}
            className="flex cursor-pointer flex-col items-start gap-1 rounded-2xl border border-line-2 bg-panel p-3 text-left transition-colors hover:border-faint disabled:cursor-default disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
              <Plus className="size-3.5 text-amber" aria-hidden /> {def.name}
            </span>
            <span className="text-[12px] leading-snug text-muted">{def.help}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RulesPage() {
  const rules = useStore((s) => s.data.rules);
  const guards = useStore((s) => s.data.guards);
  const derived = useDerived();

  const adherence = useMemo(() => {
    const latest = derived.days[0];
    const from = latest ? addDays(latest, -29) : null;
    const m = new Map<string, { followed: number; broken: number }>();
    for (const e of derived.evaluation.days) {
      if (from && e.day < from) continue;
      for (const c of e.checks) {
        const x = m.get(c.ruleId) ?? { followed: 0, broken: 0 };
        if (c.status === "followed") x.followed++;
        if (c.status === "broken") x.broken++;
        m.set(c.ruleId, x);
      }
    }
    return m;
  }, [derived]);

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <div className="label">Your playbook</div>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">Rules</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
          Debrief grades every session against these. Auto-checked rules are read straight from your fills; checklist items are the ones only you can answer.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {rules.length ? (
            rules.map((r) => <RuleCard key={r.id} rule={r} adherence={adherence.get(r.id)} />)
          ) : (
            <Card className="p-6 text-[14px] leading-relaxed text-muted">
              No rules yet. Pick a few below. Most traders start with a max number of trades, a daily loss limit, and "stop after two losses in a row".
            </Card>
          )}
          <h2 className="mt-4 text-[15px] font-semibold">Add a rule</h2>
          <AddRule rules={rules} />
        </div>
        <div className="flex flex-col gap-4">
          <RulesFromText />
        </div>
      </div>

      <div className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">Account Guard</h2>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-muted">
              For prop firm evaluations and funded accounts: your daily loss limit, drawdown and profit target, tracked from every closed trade.
            </p>
          </div>
          <AddGuardButton />
        </div>
        <div className="flex flex-col gap-3">
          {guards.map((g) => (
            <AccountGuardCard key={g.id} guard={g} />
          ))}
          {!guards.length && <Card className="p-5 text-[13.5px] text-muted">No account guard yet. Add one to see how close you are to your account's limits every day.</Card>}
        </div>
      </div>
    </div>
  );
}
