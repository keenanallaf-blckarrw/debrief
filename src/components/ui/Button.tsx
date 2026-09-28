import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-amber text-amber-ink hover:brightness-110 font-semibold",
  secondary: "bg-soft text-ink hover:bg-raised border border-line",
  outline: "bg-transparent text-amber border border-amber/50 hover:bg-amber/10",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-soft",
  danger: "bg-transparent text-loss border border-loss/40 hover:bg-loss/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px] rounded-[10px] gap-1.5",
  md: "h-10 px-4 text-[13.5px] rounded-xl gap-2",
  lg: "h-12 px-6 text-[15px] rounded-[14px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  /** Icon placed after the label, e.g. an arrow on "Continue". */
  iconRight?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", loading, icon, iconRight, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-[filter,background-color,color,opacity] duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
}
