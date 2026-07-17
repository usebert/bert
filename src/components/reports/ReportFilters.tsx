import { useTranslation } from "react-i18next";
import type { ReportsDashboardFilters, ReportsDashboardQuery, ReportsDateRange } from "../../types/reportsDashboard";

const selectClass =
  "h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400";

function dateRangeKey(value: string): string {
  switch (value) {
    case "7":
      return "reports.last7Days";
    case "30":
      return "reports.last30Days";
    case "90":
      return "reports.last90Days";
    case "all":
      return "reports.allTime";
    default:
      return "";
  }
}

export function ReportFilters({
  filters,
  query,
  onChange,
}: {
  filters: ReportsDashboardFilters;
  query: ReportsDashboardQuery;
  onChange: (next: ReportsDashboardQuery) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("reports.dateRange")}</span>
        <select
          className={selectClass}
          value={query.dateRange || "30"}
          onChange={(event) => onChange({ ...query, dateRange: event.target.value as ReportsDateRange })}
        >
          {filters.dateRanges.map((value) => {
            const key = dateRangeKey(value);
            return (
              <option key={value} value={value}>
                {key ? t(key) : value}
              </option>
            );
          })}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("common.allSites")}</span>
        <select className={selectClass} value={query.site || ""} onChange={(event) => onChange({ ...query, site: event.target.value })}>
          <option value="">{t("common.allSites")}</option>
          {filters.sites.map((site) => (
            <option key={site} value={site}>
              {site}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("common.allAreas")}</span>
        <select className={selectClass} value={query.area || ""} onChange={(event) => onChange({ ...query, area: event.target.value })}>
          <option value="">{t("common.allAreas")}</option>
          {filters.areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("common.assignedTo")}</span>
        <select
          className={selectClass}
          value={query.assignee || ""}
          onChange={(event) => onChange({ ...query, assignee: event.target.value })}
        >
          <option value="">{t("common.anyone")}</option>
          {filters.assignees.map((assignee) => (
            <option key={assignee} value={assignee}>
              {assignee}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t("common.status")}</span>
        <select
          className={selectClass}
          value={query.status || ""}
          onChange={(event) => onChange({ ...query, status: event.target.value })}
        >
          <option value="">{t("reports.allStatuses")}</option>
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
