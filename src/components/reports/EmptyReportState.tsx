import type { ReportsDashboardEmptyState } from "../../types/reportsDashboard";

const REPORTS_EMPTY_NO_DATA = "No report data yet. Complete a check to start building live reports.";
const REPORTS_EMPTY_SCHEDULES_ONLY = "Schedules are set up. Reports will appear once checks are completed.";

export function EmptyReportState({ state }: { state: ReportsDashboardEmptyState }) {
  if (!state) {
    return null;
  }

  const message = state === "schedules-only" ? REPORTS_EMPTY_SCHEDULES_ONLY : REPORTS_EMPTY_NO_DATA;

  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-slate-800">{message}</p>
    </div>
  );
}
