import { StatusBadge } from "../../components/ui/StatusBadge";
import type { NcrDisplayStatus } from "../types";

const VARIANT: Record<NcrDisplayStatus, "info" | "warning" | "danger" | "success" | "neutral"> = {
  Open: "info",
  "Containment required": "warning",
  "Cause analysis required": "warning",
  "Corrective action required": "danger",
  "Awaiting verification": "info",
  Closed: "success",
  Overdue: "danger",
  Archived: "neutral",
};

export function NcrStatusBadge({ status }: { status: NcrDisplayStatus }) {
  return <StatusBadge variant={VARIANT[status]}>{status}</StatusBadge>;
}
