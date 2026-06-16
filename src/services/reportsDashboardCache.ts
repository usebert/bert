import { storageKeys } from "../config/storageKeys";
import type { ReportsDashboardPayload, ReportsDashboardQuery } from "../types/reportsDashboard";

export const REPORTS_DASHBOARD_LOAD_TIMEOUT_MS = 2000;

export type ReportsDashboardCacheEntry = {
  companyId: string;
  filterKey: string;
  payload: ReportsDashboardPayload;
  cachedAt: number;
};

function filterCacheKey(query: ReportsDashboardQuery = {}): string {
  return [query.dateRange || "30", query.site || "", query.area || "", query.assignee || "", query.status || ""].join(
    "|",
  );
}

export function readReportsDashboardCache(
  companyId: string,
  query: ReportsDashboardQuery = {},
): ReportsDashboardCacheEntry | null {
  if (typeof window === "undefined" || !companyId.trim()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.reportsDashboardCache);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, ReportsDashboardCacheEntry>;
    const entry = parsed[`${companyId.trim()}::${filterCacheKey(query)}`];
    if (!entry?.payload?.summary) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeReportsDashboardCache(entry: ReportsDashboardCacheEntry): void {
  if (typeof window === "undefined" || !entry.companyId.trim()) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.reportsDashboardCache);
    const parsed = raw ? (JSON.parse(raw) as Record<string, ReportsDashboardCacheEntry>) : {};
    parsed[`${entry.companyId.trim()}::${entry.filterKey}`] = entry;
    window.localStorage.setItem(storageKeys.reportsDashboardCache, JSON.stringify(parsed));
  } catch {
    /* ignore quota */
  }
}
