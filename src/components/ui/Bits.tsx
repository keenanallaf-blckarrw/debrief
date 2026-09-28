import * as Tooltip from "@radix-ui/react-tooltip";
import { Info as InfoIcon, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Grade as GradeLetter } from "../../../shared/rules/evaluate";
import { money, toneOf } from "../../lib/format";

// Small shared pieces: badges, money, tooltips, spinners, grades, switches.

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "gain" | "loss" | "amber" | "warn" | "blue"; className?: string }) {
  const tones = {
    neutral: "text-muted border-line bg-soft",
    gain: "text-gain border-gain/30 bg-gain/10",
    loss: "text-loss border-loss/30 bg-loss/10",
    amber: "text-amber border-amber/40 bg-amber/10",
    warn: "text-warn border-warn/30 bg-warn/10",
    blue: "text-blue border-blue/30 bg-blue/10",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** A P&L value: always signed, colored by direction. */
export function Money({ value, className = "", cents }: { value: number | null | undefined; className?: string; cents?: boolean }) {
  if (value === null || value === undefined) return <span className={`text-muted ${className}`}>—</span>;
  const tone = toneOf(value);
  const color = tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-ink-2";
  return <span className={`${color} ${className}`}>{money(value, { sign: true, cents })}</span>;
}

export function Info({ children, label = "What does this mean?" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        <button type="button" aria-label={label} className="inline-flex cursor-help text-faint hover:text-muted">
          <InfoIcon className="size-3.5" aria-hidden />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-50 max-w-[280px] rounded-xl border border-line bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink-2 shadow-xl animate-fade-in">
          {children}
          <Tooltip.Arrow className="fill-raised" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={100}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-50 max-w-[300px] rounded-xl border border-line bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-ink-2 shadow-xl">
          {content}
          <Tooltip.Arrow className="fill-raised" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Spinner({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 text-[13px] text-muted ${className}`} role="status">
      <Loader2 className="size-4 animate-spin text-amber" aria-hidden />
      {label}
    </div>
  );
}

export function gradeColor(g: GradeLetter | null | undefined): string {
  if (g === "A" || g === "B") return "text-gain";
  if (g === "C") return "text-warn";
  if (g === "D" || g === "F") return "text-loss";
  return "text-faint";
}

export function Grade({ grade, className = "" }: { grade: GradeLetter | null | undefined; className?: string }) {
  return (
    <span className={`font-extrabold leading-none tracking-[-0.04em] ${gradeColor(grade)} ${className}`} aria-label={grade ? `Grade ${grade}` : "No grade"}>
      {grade ?? "–"}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-40 ${checked ? "border-amber bg-amber" : "border-line bg-soft"}`}
    >
      <span className={`inline-block size-[16px] rounded-full shadow transition-transform ${checked ? "translate-x-[18px] bg-amber-ink" : "translate-x-[2px] bg-ink"}`} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-xl border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-[10px] font-medium transition-colors ${size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]"} ${value === o.value ? "bg-soft text-ink" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 text-faint">{icon}</div>}
      <div className="text-[16px] font-semibold">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[12px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${active ? "border-transparent bg-amber text-amber-ink hover:brightness-110" : "border-line text-muted hover:border-faint hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{children}</kbd>;
}
