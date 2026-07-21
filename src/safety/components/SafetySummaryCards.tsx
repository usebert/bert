import { Card } from "../../components/ui/Card";
import type { SafetySummaryMetric } from "../types";

type Props = {
  metrics: SafetySummaryMetric[];
};

const TONE_CLASS: Record<NonNullable<SafetySummaryMetric["tone"]>, string> = {
  default: "text-slate-900",
  warning: "text-amber-800",
  danger: "text-rose-800",
  success: "text-emerald-800",
};

export function SafetySummaryCards({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {metrics.map((metric) => (
        <Card key={metric.key} className="min-h-[4.5rem] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${TONE_CLASS[metric.tone || "default"]}`}>
            {metric.value}
          </p>
        </Card>
      ))}
    </div>
  );
}
