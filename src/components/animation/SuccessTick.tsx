import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

type Props = {
  className?: string;
  label?: string;
};

export function SuccessTick({ className = "h-8 w-8", label = "Success" }: Props) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700",
        reducedMotion ? "" : "bert-success-tick",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
