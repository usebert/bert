import { useTranslation } from "react-i18next";
import { StatusBadge, statusToBadgeVariant, type StatusBadgeVariant } from "./StatusBadge";

export type StatusChipVariant =
  | "overdue"
  | "escalated"
  | "dueSoon"
  | "awaitingVerification"
  | "verified"
  | "closed"
  | "draft"
  | "none";

const variantToBadge: Record<StatusChipVariant, StatusBadgeVariant> = {
  overdue: "danger",
  escalated: "danger",
  dueSoon: "warning",
  awaitingVerification: "info",
  verified: "success",
  closed: "success",
  draft: "neutral",
  none: "neutral",
};

const variantLabelKeys: Record<StatusChipVariant, string> = {
  overdue: "status.overdue",
  escalated: "status.escalated",
  dueSoon: "status.dueSoon",
  awaitingVerification: "status.awaitingVerification",
  verified: "status.verified",
  closed: "status.closed",
  draft: "status.draft",
  none: "status.none",
};

type StatusChipProps = {
  variant: StatusChipVariant;
  children?: string;
  /** When true, render as focusable control (e.g. in a toolbar). */
  interactive?: boolean;
  className?: string;
};

/** Domain-specific status chip — delegates visual styling to shared StatusBadge. */
export function StatusChip({ variant, children, interactive = false, className = "" }: StatusChipProps) {
  const { t } = useTranslation();
  const label = children ?? t(variantLabelKeys[variant]);
  const badge = (
    <StatusBadge variant={variantToBadge[variant]} className={className}>
      {label}
    </StatusBadge>
  );

  if (interactive) {
    return (
      <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-border-focus)] focus-visible:ring-offset-2">
        {badge}
      </button>
    );
  }
  return badge;
}

/** Map free-text operational statuses (e.g. sync queue) to shared badge variants. */
export { statusToBadgeVariant };
