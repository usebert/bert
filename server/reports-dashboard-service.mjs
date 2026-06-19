/**
 * Company reports dashboard — workbook read, cache, timeout, role visibility.
 */
import {
  buildReportsDashboardFromTabs,
  canViewReportsDashboard,
  REPORTS_DASHBOARD_TABS,
  REPORTS_LOAD_ERROR,
} from "../shared/reports-dashboard.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";

const CACHE_TTL_MS = 60_000;
const READ_TIMEOUT_MS = 8_000;

/** @type {Map<string, { expiresAt: number, payload: object }>} */
const dashboardCache = new Map();

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function cacheKey(companyFolderId, masterSheetId, filterKey) {
  return `${companyFolderId}::${masterSheetId}::${filterKey}`;
}

function buildFilterKey(input = {}) {
  return [
    input.dateRange || "30",
    input.site || "",
    input.area || "",
    input.assignee || "",
    input.status || "",
    input.actorEmail || "",
    input.actorRole || "",
    (input.actorAreas || []).join(","),
  ].join("|");
}

function withTimeout(promise, timeoutMs, label = "workbook read") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function pickDashboardTabs(payload = {}) {
  const data = payload.data || {};
  const tabData = {};
  const failedTabs = [];
  const startedAt = Date.now();

  for (const tab of REPORTS_DASHBOARD_TABS) {
    if (!Array.isArray(data[tab])) {
      tabData[tab] = [];
      if (!payload.tabs?.some((name) => String(name).toLowerCase() === tab.toLowerCase())) {
        failedTabs.push(tab);
      }
      continue;
    }
    tabData[tab] = data[tab];
  }

  return {
    tabData,
    failedTabs,
    durationMs: Date.now() - startedAt,
  };
}

export async function getReportsDashboard(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const actor = input.actor || null;
  const includeDiagnostics = input.includeDiagnostics === true || isDevDiagnosticsEnabled();
  const filters = {
    dateRange: String(input.dateRange || "30").trim() || "30",
    site: String(input.site || "").trim(),
    area: String(input.area || "").trim(),
    assignee: String(input.assignee || "").trim(),
    status: String(input.status || "").trim(),
  };

  const context = await resolveCompanyScheduleContext(auth, deps, {
    companyId,
    companyFolderId: String(input.companyFolderId || companyId).trim(),
    masterSheetId,
    companyName: String(input.companyName || "").trim(),
  });

  if (!context.ok) {
    return {
      ok: false,
      code: context.code,
      error: REPORTS_LOAD_ERROR,
      message: REPORTS_LOAD_ERROR,
      httpStatus: context.httpStatus || 404,
      technicalError: context.technicalError || context.error,
    };
  }

  if (
    !canViewReportsDashboard(actor, context.companyFolderId, [
      companyId,
      context.companyId,
      ...context.alternateIds,
    ])
  ) {
    return {
      ok: false,
      code: "REPORTS_FORBIDDEN",
      error: "You do not have permission to view reports for this company.",
      message: "You do not have permission to view reports for this company.",
      httpStatus: 403,
    };
  }

  const filterKey = buildFilterKey({
    ...filters,
    actorEmail: actor?.email || "",
    actorRole: actor?.role || "",
    actorAreas: actor?.companyAreas || [],
  });
  const key = cacheKey(context.companyFolderId, context.masterSheetId, filterKey);
  const cached = dashboardCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return {
      ok: true,
      cached: true,
      refreshing: false,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      ...cached.payload,
      diagnostics: includeDiagnostics ? cached.payload.diagnostics : undefined,
    };
  }

  const { readCompanySheetById } = deps;
  if (typeof readCompanySheetById !== "function") {
    return {
      ok: false,
      code: "REPORTS_UNAVAILABLE",
      error: REPORTS_LOAD_ERROR,
      message: REPORTS_LOAD_ERROR,
      httpStatus: 500,
    };
  }

  const readStartedAt = Date.now();
  let sheetPayload;
  let failedTabs = [];
  let durationMs = 0;

  try {
    sheetPayload = await withTimeout(
      readCompanySheetById(auth, context.masterSheetId),
      READ_TIMEOUT_MS,
      "Reports dashboard workbook read",
    );
    const picked = pickDashboardTabs(sheetPayload);
    failedTabs = picked.failedTabs;
    durationMs = Date.now() - readStartedAt;

    const built = buildReportsDashboardFromTabs(picked.tabData, {
      companyFolderId: context.companyFolderId,
      alternateIds: context.alternateIds,
      dateRange: filters.dateRange,
      filters,
      actor,
    });

    const payload = {
      summary: built.summary,
      charts: built.charts,
      filters: built.filters,
      emptyState: built.emptyState,
      diagnostics: includeDiagnostics
        ? {
            failedTabs: [...new Set([...failedTabs, ...built.missingTabs])],
            technicalError: failedTabs.length > 0 ? `Missing tabs: ${failedTabs.join(", ")}` : "",
            durationMs,
            masterSheetId: context.masterSheetId,
          }
        : undefined,
    };

    dashboardCache.set(key, {
      expiresAt: now + CACHE_TTL_MS,
      payload,
    });

    return {
      ok: true,
      cached: false,
      refreshing: false,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      ...payload,
    };
  } catch (error) {
    durationMs = Date.now() - readStartedAt;
    if (cached) {
      return {
        ok: true,
        cached: true,
        refreshing: false,
        stale: true,
        companyId: context.companyId,
        companyFolderId: context.companyFolderId,
        companyName: context.companyName,
        masterSheetId: context.masterSheetId,
        ...cached.payload,
        diagnostics: includeDiagnostics
          ? {
              ...(cached.payload.diagnostics || {}),
              technicalError: error instanceof Error ? error.message : String(error),
              durationMs,
            }
          : undefined,
      };
    }

    return {
      ok: false,
      code: "REPORTS_LOAD_FAILED",
      error: REPORTS_LOAD_ERROR,
      message: REPORTS_LOAD_ERROR,
      httpStatus: 500,
      technicalError: error instanceof Error ? error.message : String(error),
      diagnostics: includeDiagnostics
        ? {
            failedTabs,
            technicalError: error instanceof Error ? error.message : String(error),
            durationMs,
            masterSheetId: context.masterSheetId,
          }
        : undefined,
    };
  }
}

export function clearReportsDashboardCache(companyFolderId, masterSheetId) {
  if (!companyFolderId && !masterSheetId) {
    dashboardCache.clear();
    return;
  }
  for (const key of dashboardCache.keys()) {
    if (key.startsWith(`${companyFolderId}::${masterSheetId || ""}`)) {
      dashboardCache.delete(key);
    }
  }
}

export async function warmReportsDashboardCache(auth, deps, input = {}) {
  return getReportsDashboard(auth, deps, input);
}
