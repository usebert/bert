import { apiUrl } from "../config/apiBase";
import type { ResolvedCompanyContext } from "./companyContextService";
import type {
  ReportsDashboardPayload,
  ReportsDashboardQuery,
} from "../types/reportsDashboard";

export type ReportsDashboardContext = Pick<
  ResolvedCompanyContext,
  "companyId" | "companyFolderId" | "companyName" | "masterSheetId"
>;

function buildQueryParams(context: ReportsDashboardContext, query: ReportsDashboardQuery = {}): URLSearchParams {
  const params = new URLSearchParams();
  const companyFolderId = String(context.companyFolderId || context.companyId || "").trim();
  if (companyFolderId) {
    params.set("companyFolderId", companyFolderId);
  }
  const masterSheetId = String(context.masterSheetId || "").trim();
  if (masterSheetId) {
    params.set("masterSheetId", masterSheetId);
  }
  const companyName = String(context.companyName || "").trim();
  if (companyName) {
    params.set("companyName", companyName);
  }
  if (query.dateRange) {
    params.set("dateRange", query.dateRange);
  }
  if (query.site) {
    params.set("site", query.site);
  }
  if (query.area) {
    params.set("area", query.area);
  }
  if (query.assignee) {
    params.set("assignee", query.assignee);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  return params;
}

function emptyPayload(): ReportsDashboardPayload {
  return {
    ok: false,
    summary: {
      totalChecksScheduled: 0,
      completedChecks: 0,
      overdueChecks: 0,
      openFindings: 0,
      openActions: 0,
      completionRatePercent: 0,
    },
    charts: {
      checksCompletedOverTime: [],
      completionRateBySiteArea: [],
      openFindingsBySeverity: [],
      openActionsByStatus: [],
      outstandingChecksByAssignee: [],
      passFailTrend: [],
    },
    filters: {
      dateRanges: ["7", "30", "90", "all"],
      sites: [],
      areas: [],
      assignees: [],
      statuses: [],
    },
    emptyState: "no-data",
    loadError: "Could not load reports right now. Try again.",
  };
}

export async function fetchReportsDashboard(
  context: ReportsDashboardContext,
  options: {
    query?: ReportsDashboardQuery;
    signal?: AbortSignal;
    diagnostics?: boolean;
  } = {},
): Promise<ReportsDashboardPayload> {
  const companyId = String(context.companyFolderId || context.companyId || "").trim();
  if (!companyId || !String(context.masterSheetId || "").trim()) {
    return {
      ...emptyPayload(),
      loadError: "Company workspace is not ready for reports yet.",
    };
  }

  const params = buildQueryParams(context, options.query);
  if (options.diagnostics) {
    params.set("diagnostics", "1");
  }

  const response = await fetch(
    apiUrl(`/api/companies/${encodeURIComponent(companyId)}/reports/dashboard?${params.toString()}`),
    {
      method: "GET",
      credentials: "include",
      signal: options.signal,
      headers: { Accept: "application/json" },
    },
  );

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.ok === false) {
    return {
      ...emptyPayload(),
      loadError: String(body.message || body.error || "Could not load reports right now. Try again."),
      technicalError: String(body.technicalError || ""),
      diagnostics: body.diagnostics as ReportsDashboardPayload["diagnostics"],
    };
  }

  return {
    ok: true,
    cached: body.cached === true,
    refreshing: body.refreshing === true,
    stale: body.stale === true,
    summary: body.summary as ReportsDashboardPayload["summary"],
    charts: body.charts as ReportsDashboardPayload["charts"],
    filters: body.filters as ReportsDashboardPayload["filters"],
    emptyState: (body.emptyState as ReportsDashboardPayload["emptyState"]) ?? null,
    diagnostics: body.diagnostics as ReportsDashboardPayload["diagnostics"],
  };
}
