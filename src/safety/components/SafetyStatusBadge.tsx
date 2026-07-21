import { StatusBadge } from "../../components/ui/StatusBadge";
import type { SafetyDisplayStatus } from "../types";

const STATUS_VARIANT: Record<SafetyDisplayStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  Reported: "info",
  "Under investigation": "warning",
  "Action required": "danger",
  "Awaiting review": "warning",
  Closed: "success",
  Archived: "neutral",
};

type Props = {
  status: SafetyDisplayStatus;
  className?: string;
};

export function SafetyStatusBadge({ status, className }: Props) {
  return (
    <StatusBadge variant={STATUS_VARIANT[status]} className={className}>
      {status}
    </StatusBadge>
  );
}
