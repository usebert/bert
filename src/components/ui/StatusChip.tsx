export type StatusChipVariant =
  | "overdue"
  | "escalated"
  | "dueSoon"
  | "awaitingVerification"
  | "verified"
  | "closed"
  | "draft"
  | "none";

const variantClasses: Record<
  StatusChipVariant,
  { className: string; defaultLabel: string }
> = {
  overdue: {
    className:
      "border border-rose-200/90 bg-rose-50 text-rose-800 ring-1 ring-rose-500/15 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "OVERDUE",
  },
  escalated: {
    className:
      "border border-rose-200/90 bg-rose-50 text-rose-900 ring-1 ring-rose-600/20 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "ESCALATED",
  },
  dueSoon: {
    className:
      "border border-orange-200/90 bg-orange-50 text-orange-900 ring-1 ring-orange-400/20 focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "DUE SOON",
  },
  awaitingVerification: {
    className:
      "border border-sky-200/90 bg-sky-50 text-sky-900 ring-1 ring-blue-500/20 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "AWAITING VERIFICATION",
  },
  verified: {
    className:
      "border border-emerald-200/90 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-500/20 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "VERIFIED",
  },
  closed: {
    className:
      "border border-emerald-200/90 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-600/20 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "CLOSED",
  },
  draft: {
    className:
      "border border-slate-200 bg-slate-100 text-slate-700 ring-1 ring-slate-400/15 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "DRAFT",
  },
  none: {
    className:
      "border border-slate-200/90 bg-slate-100 text-slate-600 ring-1 ring-slate-400/10 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    defaultLabel: "NONE",
  },
};

type StatusChipProps = {
  variant: StatusChipVariant;
  children?: string;
  /** When true, render as focusable control (e.g. in a toolbar). */
  interactive?: boolean;
  className?: string;
};

export function StatusChip({ variant, children, interactive = false, className = "" }: StatusChipProps) {
  const spec = variantClasses[variant];
  const label = children ?? spec.defaultLabel;
  const base =
    `inline-flex max-w-full items-center justify-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none ${spec.className} ${className}`.trim();

  if (interactive) {
    return (
      <button type="button" className={base}>
        {label}
      </button>
    );
  }
  return (
    <span className={base} role="status">
      {label}
    </span>
  );
}
