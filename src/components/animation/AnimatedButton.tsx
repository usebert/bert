import type { ButtonHTMLAttributes, ReactNode } from "react";
import { bertArrowNudge, bertBtnInteractive } from "./animationClasses";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  showArrow?: boolean;
  loading?: boolean;
};

export function AnimatedButton({
  children,
  className = "",
  showArrow = false,
  loading = false,
  disabled,
  type = "button",
  ...rest
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-2",
        reducedMotion ? "transition-opacity duration-150" : bertBtnInteractive,
        showArrow && !reducedMotion ? `group ${bertArrowNudge}` : "",
        isDisabled ? "cursor-not-allowed opacity-60" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="bert-sync-spinner inline-flex" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" className="bert-sync-spinner-stroke origin-center" />
          </svg>
        </span>
      ) : null}
      <span className={showArrow ? "inline-flex items-center gap-2" : undefined}>{children}</span>
      {showArrow && !loading ? (
        <span className="bert-arrow-icon transition-transform duration-150 ease-out group-hover:translate-x-1" aria-hidden>
          →
        </span>
      ) : null}
    </button>
  );
}
