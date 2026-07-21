import type { AuditSummaryMetric } from "../types";
import { Card, CardContent } from "../../components/ui/Card";

const toneClasses: Record<AuditSummaryMetric["tone"], string> = {
  neutral: "text-[var(--ui-text-primary)]",
  success: "text-[var(--ui-success-fg)]",
  warning: "text-[var(--ui-warning-fg)]",
  danger: "text-[var(--ui-danger-fg)]",
  info: "text-[var(--ui-info-fg)]",
};

export function AuditSummaryCards({
  metrics,
  onSelect,
}: {
  metrics: AuditSummaryMetric[];
  onSelect?: (metric: AuditSummaryMetric) => void;
}) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {metrics.map((metric) => (
        <Card
          key={metric.id}
          variant="interactive"
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          className={onSelect ? "cursor-pointer p-0" : "p-0"}
          onClick={onSelect ? () => onSelect(metric) : undefined}
        >
          <CardContent className="space-y-1 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">{metric.label}</p>
            <p className={`text-2xl font-semibold ${toneClasses[metric.tone]}`}>{metric.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
