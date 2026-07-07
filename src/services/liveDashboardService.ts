import { apiUrl } from "../config/apiBase";
import type {
  LiveDashboardContext,
  LiveDashboardPayload,
  LiveDashboardQuery,
} from "../types/liveDashboard";

function emptyMetrics() {
  return {
    todayDue: 0,
    todayCompleted: 0,
    todayOutstanding: 0,
    overdueInspections: 0,
    openActions: 0,
    overdueActions: 0,
    currentIncidents: 0,
    pendingBriefings: 0,
    complianceScore: 100,
  };
}

export function emptyLiveDashboardPayload(): LiveDashboardPayload {
  return {
    ok: false,
    generatedAt: "",
    metrics: emptyMetrics(),
    today: { dateLabel: "", due: 0, completed: 0, outstanding: 0, overdue: 0, missedChecks: 0 },
    actToday: [],
    compliance: { score: 100, label: "Good", reductions: [] },
    riskByArea: [],
    riskEmptyMessage: "No site/department data yet.",
    sections: { outstandingActions: [], overdueInspections: [], currentIncidents: [], briefings: [] },
    charts: { auditTrend: [], actionBreakdown: [], incidentTrend: [], briefingStatus: [] },
    sync: { queued: 0, failed: 0, lastStatus: "ok", lastSyncAt: "", hasIssue: false, message: "All work is synced." },
    warnings: [],
    emptyState: "no-data",
  };
}

function buildParams(context: LiveDashboardContext, query: LiveDashboardQuery): URLSearchParams {
  const params = new URLSearchParams();
  const masterSheetId = String(context.masterSheetId || "").trim();
  if (masterSheetId) {
    params.set("masterSheetId", masterSheetId);
  }
  const companyName = String(context.companyName || "").trim();
  if (companyName) {
    params.set("companyName", companyName);
  }
  if (query.refresh) {
    params.set("refresh", "1");
  }
  if (typeof query.syncQueued === "number" && query.syncQueued > 0) {
    params.set("syncQueued", String(query.syncQueued));
  }
  if (typeof query.syncFailed === "number" && query.syncFailed > 0) {
    params.set("syncFailed", String(query.syncFailed));
  }
  if (query.lastSyncAt) {
    params.set("lastSyncAt", query.lastSyncAt);
  }
  return params;
}

export async function fetchLiveDashboard(
  context: LiveDashboardContext,
  options: { query?: LiveDashboardQuery; signal?: AbortSignal } = {},
): Promise<LiveDashboardPayload> {
  const companyFolderId = String(context.companyFolderId || context.companyId || "").trim();
  if (!companyFolderId || !String(context.masterSheetId || "").trim()) {
    return {
      ...emptyLiveDashboardPayload(),
      loadError: "Company workspace is not ready yet.",
    };
  }

  const params = buildParams(context, options.query || {});
  const response = await fetch(
    apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live?${params.toString()}`),
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
      ...emptyLiveDashboardPayload(),
      loadError: String(body.message || body.error || "Could not load the live dashboard right now. Try again."),
    };
  }

  return {
    ok: true,
    cached: body.cached === true,
    stale: body.stale === true,
    generatedAt: String(body.generatedAt || ""),
    metrics: body.metrics as LiveDashboardPayload["metrics"],
    today: body.today as LiveDashboardPayload["today"],
    actToday: (body.actToday as LiveDashboardPayload["actToday"]) || [],
    compliance: body.compliance as LiveDashboardPayload["compliance"],
    riskByArea: (body.riskByArea as LiveDashboardPayload["riskByArea"]) || [],
    riskEmptyMessage: String(body.riskEmptyMessage || ""),
    sections: (body.sections as LiveDashboardPayload["sections"]) || emptyLiveDashboardPayload().sections,
    charts: (body.charts as LiveDashboardPayload["charts"]) || emptyLiveDashboardPayload().charts,
    sync: (body.sync as LiveDashboardPayload["sync"]) || emptyLiveDashboardPayload().sync,
    warnings: (body.warnings as LiveDashboardPayload["warnings"]) || [],
    emptyState: (body.emptyState as LiveDashboardPayload["emptyState"]) ?? null,
  };
}
