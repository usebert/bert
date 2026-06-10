import type { ReportsDashboardSummary } from "../../types/reportsDashboard";

const cards: Array<{
  key: keyof ReportsDashboardSummary;
  label: string;
  suffix?: string;
  tone?: "slate" | "green" | "amber" | "red";
}> = [
  { key: "totalChecksScheduled", label: "Checks scheduled" },
  { key: "completedChecks", label: "Completed", tone: "green" },
  { key: "overdueChecks", label: "Overdue", tone: "red" },
  { key: "openFindings", label: "Open findings", tone: "amber" },
  { key: "openActions", label: "Open actions", tone: "amber" },
  { key: "completionRatePercent", label: "Completion rate", suffix: "%", tone: "green" },
];

const toneClasses = {
  slate: "border-slate-200 bg-white text-slate-900",
  green: "border-blue-200 bg-white text-blue-950",
  amber: "border-amber-200 bg-white text-amber-950",
  red: "border-rose-200 bg-white text-rose-950",
};

export function ReportSummaryCards({ summary }: { summary: ReportsDashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.key}
          className={`rounded-[1.35rem] border p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] ${toneClasses[card.tone || "slate"]}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {summary[card.key]}
            {card.suffix || ""}
          </p>
        </div>
      ))}
    </div>
  );
}
