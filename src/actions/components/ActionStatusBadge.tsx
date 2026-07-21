import type { ActionDisplayStatus } from "../types";
import { StatusBadge, statusToBadgeVariant } from "../../components/ui/StatusBadge";

export function ActionStatusBadge({ status }: { status: ActionDisplayStatus }) {
  return (
    <StatusBadge variant={statusToBadgeVariant(status)} dot>
      {status}
    </StatusBadge>
  );
}
