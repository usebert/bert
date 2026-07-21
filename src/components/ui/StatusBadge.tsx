import type { ReactNode } from "react";
import { cn } from "../../styles/ui-foundation";

export type StatusBadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

export type StatusBadgeTone = StatusBadgeVariant;

const variantClasses: Record<StatusBadgeVariant, string> = {
  success:
    "border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] text-[var(--ui-success-fg)]",
  warning:
    "border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] text-[var(--ui-warning-fg)]",
  danger:
    "border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] text-[var(--ui-danger-fg)]",
  info: "border-[var(--ui-info-border)] bg-[var(--ui-info-bg)] text-[var(--ui-info-fg)]",
  neutral:
    "border-[var(--ui-neutral-border)] bg-[var(--ui-neutral-bg)] text-[var(--ui-neutral-fg)]",
};

/** Map common BERT operational statuses to badge variants. */
export function statusToBadgeVariant(status: string): StatusBadgeVariant {
  const key = status.trim().toLowerCase();
  if (["open", "pending", "draft", "offline", "pending sync", "waiting"].includes(key)) {
    return key === "draft" ? "neutral" : key === "offline" ? "warning" : "info";
  }
  if (["closed", "approved", "completed", "synced", "verified", "active"].includes(key)) {
    return "success";
  }
  if (["overdue", "failed", "conflict", "escalated", "danger"].includes(key)) {
    return "danger";
  }
  if (["due today", "due soon", "syncing"].includes(key)) {
    return "warning";
  }
  return "neutral";
}

type StatusBadgeProps = {
  variant?: StatusBadgeVariant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
};

export function StatusBadge({ variant = "neutral", children, className, dot = true }: StatusBadgeProps) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        variantClasses[variant],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
