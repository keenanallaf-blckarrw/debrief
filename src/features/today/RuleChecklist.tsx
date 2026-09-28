import { CircleCheck, CircleDashed, CircleSlash, TriangleAlert } from "lucide-react";
import type { DayEvaluation, RuleCheck } from "../../../shared/rules/evaluate";
import type { Rule } from "../../../shared/types";
import { Tip } from "../../components/ui/Bits";
import { markDayRule } from "../../lib/store";

// The session checklist from the pitch: each rule followed or broken, with the
// exact reason. Checklist items only you can answer get Followed / Broken buttons.

function StatusIcon({ status }: { status: RuleCheck["status"] }) {
  if (status === "followed") return <CircleCheck className="size-[18px] shrink-0 text-gain" aria-label="Followed" />;
  if (status === "broken") return <TriangleAlert className="size-[18px] shrink-0 text-loss" aria-label="Broken" />;
  if (status === "na") return <CircleSlash className="size-[18px] shrink-0 text-faint" aria-label="No data" />;
  return <CircleDashed className="size-[18px] shrink-0 text-warn" aria-label="Not ticked yet" />;
}

const STATUS_TEXT: Record<RuleCheck["status"], string> = {
  followed: "Followed",
  broken: "Broken",
  unanswered: "Tick it",
  na: "No data",
};

export function RuleChecklist({ ev, rules }: { ev: DayEvaluation; rules: Rule[] }) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return (
    <ul className="flex flex-col">
      {ev.checks.map((c) => {
        const rule = byId.get(c.ruleId);
        const manualDay = rule?.kind === "manual" && rule.params.scope === "day";
        return (
          <li key={c.ruleId} className="flex items-start gap-3 border-b border-line-2 py-2.5 last:border-b-0">
            <StatusIcon status={c.status} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium leading-snug text-ink">{c.label}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">
                {c.violations.length && c.status === "broken" ? (
                  <Tip content={<ul className="list-disc pl-4">{c.violations.slice(0, 8).map((v, i) => <li key={i}>{v.message}</li>)}</ul>}>
                    <span className="cursor-help underline decoration-dotted underline-offset-2">{c.violations[0].message}{c.violations.length > 1 ? ` (+${c.violations.length - 1} more)` : ""}</span>
                  </Tip>
                ) : (
                  c.detail
                )}
              </div>
            </div>
            {manualDay ? (
              <div className="flex shrink-0 gap-1" role="group" aria-label={`Did you follow: ${c.label}`}>
                <button
                  type="button"
                  onClick={() => markDayRule(ev.day, c.ruleId, c.status === "followed" ? null : "followed")}
                  aria-pressed={c.status === "followed"}
                  className={`cursor-pointer rounded-lg border px-2 py-1 text-[11.5px] font-medium ${c.status === "followed" ? "border-gain/50 bg-gain/15 text-gain" : "border-line text-muted hover:text-ink"}`}
                >
                  Followed
                </button>
                <button
                  type="button"
                  onClick={() => markDayRule(ev.day, c.ruleId, c.status === "broken" ? null : "broken")}
                  aria-pressed={c.status === "broken"}
                  className={`cursor-pointer rounded-lg border px-2 py-1 text-[11.5px] font-medium ${c.status === "broken" ? "border-loss/50 bg-loss/15 text-loss" : "border-line text-muted hover:text-ink"}`}
                >
                  Broken
                </button>
              </div>
            ) : (
              <span className={`shrink-0 text-[12px] font-semibold ${c.status === "followed" ? "text-gain" : c.status === "broken" ? "text-loss" : c.status === "na" ? "text-faint" : "text-warn"}`}>
                {STATUS_TEXT[c.status]}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
