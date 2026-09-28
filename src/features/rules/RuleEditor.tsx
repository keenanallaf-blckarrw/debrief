import { Plus, Trash2, X } from "lucide-react";
import { RULES, ruleLabel } from "../../../shared/rules/catalog";
import type { Rule, TimeWindow } from "../../../shared/types";
import { Badge, Info, Switch } from "../../components/ui/Bits";
import { deleteRule, upsertRule } from "../../lib/store";

// One rule, editable in place: the plain-language label updates as you type.

function NumberInput({ value, onChange, prefix, suffix, min = 0, step = 1, label }: { value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; min?: number; step?: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {prefix && <span className="text-muted">{prefix}</span>}
      <input
        type="number"
        aria-label={label}
        className="field !w-24 !py-1.5 text-center font-mono text-[13px]"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        step={step}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value)))}
      />
      {suffix && <span className="text-muted">{suffix}</span>}
    </span>
  );
}

function WindowsInput({ windows, onChange }: { windows: TimeWindow[]; onChange: (w: TimeWindow[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {windows.map((w, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          <input type="time" aria-label="Start" className="field !w-32 !py-1.5 font-mono text-[13px]" value={w.start} onChange={(e) => onChange(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="text-muted">to</span>
          <input type="time" aria-label="End" className="field !w-32 !py-1.5 font-mono text-[13px]" value={w.end} onChange={(e) => onChange(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          {windows.length > 1 && (
            <button type="button" className="cursor-pointer rounded p-1 text-faint hover:text-loss" aria-label="Remove window" onClick={() => onChange(windows.filter((_, j) => j !== i))}>
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      <button type="button" className="inline-flex w-fit cursor-pointer items-center gap-1 text-[12.5px] text-amber hover:underline" onClick={() => onChange([...windows, { start: "13:30", end: "15:30" }])}>
        <Plus className="size-3.5" /> Add another window
      </button>
    </div>
  );
}

function Params({ rule }: { rule: Rule }) {
  const save = (params: object) => upsertRule({ ...rule, params: { ...rule.params, ...params } } as Rule);
  switch (rule.kind) {
    case "maxTradesPerDay":
      return <NumberInput label="Max trades" value={rule.params.max} onChange={(max) => save({ max })} suffix="trades a day" min={1} />;
    case "maxContracts":
      return <NumberInput label="Max contracts" value={rule.params.max} onChange={(max) => save({ max })} suffix="contracts at once" min={1} />;
    case "dailyLossLimit":
      return <NumberInput label="Daily loss limit" value={rule.params.amount} onChange={(amount) => save({ amount })} prefix="-$" step={50} />;
    case "dailyProfitTarget":
      return <NumberInput label="Walk-away amount" value={rule.params.amount} onChange={(amount) => save({ amount })} prefix="+$" step={50} />;
    case "maxConsecutiveLosses":
      return <NumberInput label="Losses in a row" value={rule.params.max} onChange={(max) => save({ max })} suffix="losses in a row" min={1} />;
    case "maxLossPerTrade":
      return <NumberInput label="Max loss per trade" value={rule.params.amount} onChange={(amount) => save({ amount })} prefix="$" step={25} />;
    case "revengeCooldown":
      return <NumberInput label="Cooldown minutes" value={rule.params.minutes} onChange={(minutes) => save({ minutes })} suffix="minutes" min={1} />;
    case "newsBuffer":
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <NumberInput label="Minutes around news" value={rule.params.minutes} onChange={(minutes) => save({ minutes })} suffix="min around" min={1} />
          <select className="field !w-auto !py-1.5 text-[13px]" value={rule.params.minImpact} onChange={(e) => save({ minImpact: e.target.value })} aria-label="Which news">
            <option value="high">high-impact news</option>
            <option value="medium">medium or high-impact news</option>
          </select>
        </span>
      );
    case "tradingWindow":
      return (
        <div className="flex flex-col gap-2">
          <WindowsInput windows={rule.params.windows} onChange={(windows) => save({ windows })} />
          <select className="field !w-auto !py-1.5 text-[12.5px]" value={rule.params.timezone} onChange={(e) => save({ timezone: e.target.value })} aria-label="Timezone for these times">
            <option value="America/New_York">New York time (ET)</option>
            <option value="America/Chicago">Chicago time (CT)</option>
            <option value="America/Los_Angeles">Los Angeles time (PT)</option>
            <option value="Europe/London">London time</option>
          </select>
        </div>
      );
    case "allowedInstruments":
      return (
        <input
          className="field !w-64 !py-1.5 font-mono text-[13px]"
          aria-label="Allowed instruments"
          placeholder="MNQ, MGC"
          value={rule.params.roots.join(", ")}
          onChange={(e) => save({ roots: e.target.value.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) })}
        />
      );
    case "manual":
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <input className="field !w-72 !py-1.5 text-[13px]" aria-label="Checklist item" value={rule.label ?? ""} placeholder="e.g. Waited for the sweep" onChange={(e) => upsertRule({ ...rule, label: e.target.value })} />
          <select className="field !w-auto !py-1.5 text-[12.5px]" value={rule.params.scope} onChange={(e) => save({ scope: e.target.value })} aria-label="Tick it">
            <option value="day">tick once per session</option>
            <option value="trade">tick for every trade</option>
          </select>
        </span>
      );
    default:
      return null;
  }
}

export function RuleCard({ rule, adherence }: { rule: Rule; adherence?: { followed: number; broken: number } }) {
  const def = RULES[rule.kind];
  const total = adherence ? adherence.followed + adherence.broken : 0;
  return (
    <div className={`rounded-2xl border bg-card p-4 transition-opacity ${rule.enabled ? "border-line" : "border-line-2 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-semibold">{ruleLabel(rule)}</span>
            {def.auto ? <Badge tone="blue">auto-checked</Badge> : <Badge>you tick it</Badge>}
            {def.needs === "news" && <Badge>needs calendar</Badge>}
            {def.needs === "orders" && <Badge>needs order export</Badge>}
            <Info>{def.help}</Info>
          </div>
          {total > 0 && (
            <div className="mt-1 text-[12px] text-muted">
              Last 30 days: followed on {adherence!.followed} of {total} days
              {adherence!.broken ? <span className="text-loss"> · broken {adherence!.broken}×</span> : null}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch checked={rule.enabled} onChange={(enabled) => upsertRule({ ...rule, enabled } as Rule)} label={`Use rule: ${ruleLabel(rule)}`} />
          <button type="button" className="cursor-pointer rounded-lg p-1.5 text-faint hover:bg-soft hover:text-loss" aria-label={`Delete rule: ${ruleLabel(rule)}`} onClick={() => deleteRule(rule.id)}>
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {!(rule.kind === "noSizeUpAfterLoss" || rule.kind === "stopRequired" || rule.kind === "noStopWidening") && (
        <div className="mt-3 text-[13px]">
          <Params rule={rule} />
        </div>
      )}
    </div>
  );
}
