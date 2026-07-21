import { Card } from "../../components/ui/Card";
import type { NcrSummaryMetric } from "../types";

export function NcrSummaryCards({ metrics }: { metrics: NcrSummaryMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {metrics.map((metric) => (
        <Card key={metric.key} className="min-h-[4.5rem] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{metric.value}</p>
        </Card>
      ))}
    </div>
  );
}
