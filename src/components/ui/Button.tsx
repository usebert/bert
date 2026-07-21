import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, focusRing } from "../../styles/ui-foundation";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "default" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-[color-mix(in_srgb,var(--ui-accent)_55%,transparent)] bg-[var(--ui-accent)] text-[var(--ui-text-inverse)] shadow-[var(--ui-shadow-sm)] hover:bg-[var(--ui-accent-hover)] active:scale-[0.98]",
  secondary:
    "border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] text-[var(--ui-brand)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-bg-muted)] active:scale-[0.98]",
  outline:
    "border border-[var(--ui-border-strong)] bg-transparent text-[var(--ui-text-primary)] hover:bg-[var(--ui-bg-muted)] active:scale-[0.98]",
  ghost:
    "border border-transparent bg-transparent text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text-primary)]",
  danger:
    "border border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] text-[var(--ui-danger-fg)] hover:bg-[color-mix(in_srgb,var(--ui-danger-bg)_80%,#fecdd3)] active:scale-[0.98]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-[var(--ui-control-height-sm)] px-3 text-xs",
  default: "min-h-[var(--ui-control-height)] px-4 text-sm",
  lg: "min-h-[var(--ui-control-height-lg)] px-5 text-sm",
  icon: "h-[var(--ui-control-height)] w-[var(--ui-control-height)] p-0",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "default",
  loading = false,
  loadingLabel = "Loading",
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "bert-ui-motion inline-flex items-center justify-center gap-2 rounded-[var(--ui-radius-sm)] font-semibold transition-[background-color,border-color,color,transform,opacity] duration-[var(--ui-transition)]",
        focusRing,
        variantClasses[variant],
        sizeClasses[size],
        isDisabled && "cursor-not-allowed opacity-60",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
            aria-hidden
          />
          <span className="sr-only">{loadingLabel}</span>
          {children ? <span className="opacity-90">{children}</span> : null}
        </>
      ) : (
        <>
          {leftIcon ? <span className="inline-flex shrink-0 items-center">{leftIcon}</span> : null}
          {children}
          {rightIcon ? <span className="inline-flex shrink-0 items-center">{rightIcon}</span> : null}
        </>
      )}
    </button>
  );
}
