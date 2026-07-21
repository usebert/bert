import type { RiskLevel } from "../../types/reportsScreenProps";
import { StatusBadge } from "../../components/ui/StatusBadge";

const tone: Record<RiskLevel, "danger" | "warning" | "info" | "neutral"> = {
  Critical: "danger",
  High: "warning",
  Medium: "info",
  Low: "neutral",
};

export function ActionPriorityBadge({ priority }: { priority: RiskLevel }) {
  return (
    <StatusBadge variant={tone[priority]} dot={false}>
      {priority}
    </StatusBadge>
  );
}
