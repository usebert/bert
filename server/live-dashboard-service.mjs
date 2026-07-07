/**
 * Live operational dashboard service — reads existing company workbook tabs and
 * aggregates them into an actionable payload.
 *
 * Design guarantees:
 *  - Folder-first: resolves company context with the same resolveCompanyScheduleContext
 *    pattern used by briefings/incidents so one company can never read another's rows.
 *  - Resilient: every data source is read in its own try/catch. A single failed tab is
 *    added to `warnings` and never crashes the whole dashboard.
 *  - Stale-while-revalidate friendly: short TTL cache, returns cached instantly on error.
 *  - Safe failures: error responses contain no stack traces, tokens, hashes or raw payloads.
 */
import {
  buildLiveDashboardFromSources,
  canViewLiveDashboard,
  LIVE_DASHBOARD_LOAD_ERROR,
} from "../shared/live-dashboard.mjs";
import { resolveCompanyScheduleContext as defaultResolveContext } from "./schedule-service.mjs";
import { readTabRecords as defaultReadTabRecords } from "./workbook-service.mjs";

const CACHE_TTL_MS = 45_000;
const READ_TIMEOUT_MS = 8_000;

/** @type {Map<string, { expiresAt: number, payload: object }>} */
const dashboardCache = new Map();

/** Tab name → source key on the shared builder input. */
const SOURCE_TABS = [
  { tab: "Schedules", key: "schedules" },
  { tab: "AuditResults", key: "auditResults", summaryOnly: true },
  { tab: "AuditFindings", key: "auditFindings" },
  { tab: "Actions", key: "actions" },
  { tab: "Incidents", key: "incidents" },
  { tab: "NCRs", key: "ncrs" },
  { tab: "Briefings", key: "briefings" },
  { tab: "BriefingRecipients", key: "briefingRecipients" },
  { tab: "Areas", key: "areas" },
  { tab: "Sites", key: "sites" },
  { tab: "SyncLog", key: "syncLog", summaryOnly: true },
];

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function cacheKey(companyFolderId, masterSheetId, actor) {
  const role = String(actor?.role || "").trim();
  const scopeEmail = role === "Auditor" ? String(actor?.email || "").trim().toLowerCase() : "*";
  return `${companyFolderId}::${masterSheetId}::${role}::${scopeEmail}`;
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise)
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

/**
 * Read every source tab independently. One failing tab does not fail the others.
 * @returns {{ sources: object, failedSources: string[] }}
 */
async function readAllSources(auth, deps, masterSheetId) {
  const readTabRecords = typeof deps.readTabRecords === "function" ? deps.readTabRecords : defaultReadTabRecords;
  const sources = {};
  const failedSources = [];

  await Promise.all(
    SOURCE_TABS.map(async ({ tab, key, summaryOnly }) => {
      try {
        const result = await withTimeout(
          readTabRecords(auth, deps, masterSheetId, tab, summaryOnly ? { summaryOnly: true } : {}),
          READ_TIMEOUT_MS,
          `Live dashboard read ${tab}`,
        );
        sources[key] = Array.isArray(result?.records) ? result.records : [];
      } catch {
        sources[key] = [];
        failedSources.push(tab);
      }
    }),
  );

  return { sources, failedSources };
}

function toActor(actor, companyFolderId) {
  if (!actor) {
    return null;
  }
  return {
    kind: actor.kind,
    role: actor.role,
    email: actor.email,
    name: actor.name,
    accessLevel: actor.accessLevel,
    companyId: actor.companyId || actor.companyFolderId || companyFolderId,
    companyFolderId: actor.companyFolderId || actor.companyId || companyFolderId,
    companyAreas: actor.companyAreas,
  };
}

/**
 * Load the live operational dashboard for a company.
 */
export async function getLiveDashboard(auth, deps, input = {}) {
  const resolveContext =
    typeof deps.resolveCompanyScheduleContext === "function"
      ? deps.resolveCompanyScheduleContext
      : defaultResolveContext;

  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  const companyFolderIdHint = String(input.companyFolderId || companyId).trim();
  const masterSheetIdHint = String(input.masterSheetId || "").trim();
  const actor = input.actor || null;
  const includeDiagnostics = input.includeDiagnostics === true || isDevDiagnosticsEnabled();
  const syncQueue = input.syncQueue || {};

  const context = await resolveContext(auth, deps, {
    companyId,
    companyFolderId: companyFolderIdHint,
    masterSheetId: masterSheetIdHint,
    companyName: String(input.companyName || "").trim(),
  });

  if (!context.ok) {
    return {
      ok: false,
      code: context.code || "COMPANY_CONTEXT_MISSING",
      error: LIVE_DASHBOARD_LOAD_ERROR,
      message: LIVE_DASHBOARD_LOAD_ERROR,
      httpStatus: context.httpStatus || 404,
    };
  }

  if (
    !canViewLiveDashboard(actor, context.companyFolderId, [companyId, context.companyId, ...(context.alternateIds || [])])
  ) {
    return {
      ok: false,
      code: "LIVE_DASHBOARD_FORBIDDEN",
      error: "You do not have permission to view this dashboard.",
      message: "You do not have permission to view this dashboard.",
      httpStatus: 403,
    };
  }

  const key = cacheKey(context.companyFolderId, context.masterSheetId, actor);
  const now = Date.now();
  const cached = dashboardCache.get(key);
  if (cached && cached.expiresAt > now && input.forceRefresh !== true) {
    return {
      ok: true,
      cached: true,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      ...cached.payload,
      diagnostics: includeDiagnostics ? cached.payload.diagnostics : undefined,
    };
  }

  try {
    const { sources, failedSources } = await readAllSources(auth, deps, context.masterSheetId);

    const built = buildLiveDashboardFromSources(sources, {
      companyFolderId: context.companyFolderId,
      alternateIds: [companyId, context.companyId, ...(context.alternateIds || [])],
      actor: toActor(actor, context.companyFolderId),
      now: new Date(),
      syncQueue,
      failedSources,
    });

    const generatedAt = new Date().toISOString();
    const payload = {
      generatedAt,
      metrics: built.metrics,
      today: built.today,
      actToday: built.actToday,
      compliance: built.compliance,
      riskByArea: built.riskByArea,
      riskEmptyMessage: built.riskEmptyMessage,
      sections: built.sections,
      charts: built.charts,
      sync: built.sync,
      warnings: built.warnings,
      emptyState: built.emptyState,
      diagnostics: includeDiagnostics ? { failedSources, masterSheetId: context.masterSheetId } : undefined,
    };

    dashboardCache.set(key, { expiresAt: now + CACHE_TTL_MS, payload });

    return {
      ok: true,
      cached: false,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      ...payload,
    };
  } catch (error) {
    if (cached) {
      return {
        ok: true,
        cached: true,
        stale: true,
        companyId: context.companyId,
        companyFolderId: context.companyFolderId,
        companyName: context.companyName,
        masterSheetId: context.masterSheetId,
        ...cached.payload,
        diagnostics: includeDiagnostics ? cached.payload.diagnostics : undefined,
      };
    }
    return {
      ok: false,
      code: "LIVE_DASHBOARD_LOAD_FAILED",
      error: LIVE_DASHBOARD_LOAD_ERROR,
      message: LIVE_DASHBOARD_LOAD_ERROR,
      httpStatus: 500,
      technicalError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clearLiveDashboardCache(companyFolderId, masterSheetId) {
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
