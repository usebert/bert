import type { ReportsDashboardFilters, ReportsDashboardQuery, ReportsDateRange } from "../../types/reportsDashboard";

const dateRangeLabels: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

const selectClass =
  "h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400";

export function ReportFilters({
  filters,
  query,
  onChange,
}: {
  filters: ReportsDashboardFilters;
  query: ReportsDashboardQuery;
  onChange: (next: ReportsDashboardQuery) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Date range</span>
        <select
          className={selectClass}
          value={query.dateRange || "30"}
          onChange={(event) => onChange({ ...query, dateRange: event.target.value as ReportsDateRange })}
        >
          {filters.dateRanges.map((value) => (
            <option key={value} value={value}>
              {dateRangeLabels[value] || value}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Site</span>
        <select className={selectClass} value={query.site || ""} onChange={(event) => onChange({ ...query, site: event.target.value })}>
          <option value="">All sites</option>
          {filters.sites.map((site) => (
            <option key={site} value={site}>
              {site}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Area</span>
        <select className={selectClass} value={query.area || ""} onChange={(event) => onChange({ ...query, area: event.target.value })}>
          <option value="">All areas</option>
          {filters.areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Assignee</span>
        <select
          className={selectClass}
          value={query.assignee || ""}
          onChange={(event) => onChange({ ...query, assignee: event.target.value })}
        >
          <option value="">All assignees</option>
          {filters.assignees.map((assignee) => (
            <option key={assignee} value={assignee}>
              {assignee}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Status</span>
        <select
          className={selectClass}
          value={query.status || ""}
          onChange={(event) => onChange({ ...query, status: event.target.value })}
        >
          <option value="">All statuses</option>
          {filters.statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
