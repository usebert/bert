import type { AuditDisplayStatus } from "../types";
import { StatusBadge, statusToBadgeVariant } from "../../components/ui/StatusBadge";

const STATUS_VARIANT: Partial<Record<AuditDisplayStatus, "success" | "warning" | "danger" | "info" | "neutral">> = {
  "Due today": "info",
  Overdue: "danger",
  "In progress": "warning",
  Draft: "warning",
  Completed: "success",
  Failed: "danger",
  "Awaiting sync": "warning",
  "Sync failed": "danger",
  Upcoming: "neutral",
  Available: "neutral",
};

export function AuditStatusBadge({ status }: { status: AuditDisplayStatus | string }) {
  const variant = STATUS_VARIANT[status as AuditDisplayStatus] ?? statusToBadgeVariant(String(status));
  return <StatusBadge variant={variant}>{status}</StatusBadge>;
}
