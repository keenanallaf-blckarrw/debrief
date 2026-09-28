import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-[20px] border border-line bg-card ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  eyebrow,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 px-5 pt-5 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function Section({ title, subtitle, action, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
