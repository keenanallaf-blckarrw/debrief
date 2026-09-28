import type { ReactNode } from "react";
import { Info } from "./Bits";

// Stat tile: label · value · optional note. Values use proportional figures.

export function Stat({
  label,
  value,
  note,
  help,
  tone,
  className = "",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  help?: ReactNode;
  tone?: "gain" | "loss" | "warn";
  className?: string;
}) {
  const color = tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className={`rounded-2xl border border-line-2 bg-panel px-4 py-3 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {help && <Info>{help}</Info>}
      </div>
      <div className={`mt-1 text-[21px] font-semibold tracking-[-0.02em] ${color}`}>{value}</div>
      {note && <div className="mt-0.5 text-[12px] text-faint">{note}</div>}
    </div>
  );
}

/** A progress track toward a limit or target. */
export function Meter({
  value,
  max,
  tone = "amber",
  label,
}: {
  value: number;
  max: number;
  tone?: "amber" | "gain" | "loss" | "warn";
  label?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = { amber: "bg-amber", gain: "bg-gain", loss: "bg-loss", warn: "bg-warn" }[tone];
  const track = { amber: "bg-amber/15", gain: "bg-gain/15", loss: "bg-loss/15", warn: "bg-warn/15" }[tone];
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full ${track}`} role="meter" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full rounded-full ${fill} transition-[width] duration-500`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
