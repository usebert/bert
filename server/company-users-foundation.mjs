/**
 * BERT company users foundation — single canonical module for People, assignees, re-sync, Godmode.
 *
 * Routes and services must import listCompanyProfiles (or syncAndListActiveUsers alias) from here.
 * Never expose PasswordHash to API clients.
 */
import { migrateUsersTabColumns } from "./company-users.mjs";
import { resolveCompanyContextFields } from "./company-context-service.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { listableProfilesFromUsersTabRecords } from "./users-tab-profiles.mjs";
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";

const COMPANY_USERS_LOAD_FAILED = "COMPANY_USERS_LOAD_FAILED";
const COMPANY_USERS_USER_MESSAGE = "Could not load company users.";

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function looksLikeDriveId(value) {
  const id = trim(value);
  return id.length >= 10 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function buildDiagnostics(base = {}) {
  const companyFolderId = trim(base.companyFolderId || base.companyId);
  const companyId = trim(base.companyId || companyFolderId);
  return {
    companyId: companyId || undefined,
    companyFolderId: companyFolderId || companyId || undefined,
    companyName: trim(base.companyName) || undefined,
    masterSheetId: trim(base.masterSheetId) || undefined,
    signedInEmail: normalizeEmail(base.signedInEmail) || undefined,
    signedInRole: trim(base.signedInRole) || undefined,
    dataSource: trim(base.dataSource) || undefined,
    failedStep: trim(base.failedStep) || undefined,
    durationMs: typeof base.durationMs === "number" ? base.durationMs : undefined,
    upstreamStatus:
      typeof base.upstreamStatus === "number" && Number.isFinite(base.upstreamStatus)
        ? base.upstreamStatus
        : undefined,
    upstreamMessage: trim(base.upstreamMessage) || undefined,
    totalRowsRead: typeof base.totalRowsRead === "number" ? base.totalRowsRead : undefined,
    profilesReturned: typeof base.profilesReturned === "number" ? base.profilesReturned : undefined,
    activeOnlyCount: typeof base.activeOnlyCount === "number" ? base.activeOnlyCount : undefined,
    activeRowsFound: typeof base.activeRowsFound === "number" ? base.activeRowsFound : undefined,
    totalSheetRows: typeof base.totalRowsRead === "number" ? base.totalRowsRead : undefined,
    activeSheetUsers: typeof base.profilesReturned === "number" ? base.profilesReturned : undefined,
    cacheUsersBefore: typeof base.cacheUsersBefore === "number" ? base.cacheUsersBefore : undefined,
    cacheOnlyUsersRemoved:
      typeof base.cacheOnlyUsersRemoved === "number" ? base.cacheOnlyUsersRemoved : undefined,
  };
}

function buildFailure(reasonCode, message, diagnostics = {}, extra = {}) {
  const builtDiagnostics = buildDiagnostics(diagnostics);
  const failedStep = trim(extra.failedStep || builtDiagnostics.failedStep) || undefined;
  return {
    ok: false,
    code: COMPANY_USERS_LOAD_FAILED,
    reasonCode,
    failedStep,
    message: message || COMPANY_USERS_USER_MESSAGE,
    error: message || COMPANY_USERS_USER_MESSAGE,
    httpStatus: extra.httpStatus || 400,
    diagnostics: builtDiagnostics,
    technicalError: extra.technicalError,
  };
}

function classifyReadError(error) {
  const message = trim(error instanceof Error ? error.message : error);
  const lower = message.toLowerCase();
  const code = trim(error?.code || "");
  const upstreamStatus = Number(error?.response?.status || error?.status || 0);

  if (
    code === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
    code === "GOOGLE_PERMISSION_DENIED" ||
    upstreamStatus === 403 ||
    lower.includes("permission")
  ) {
    return {
      reasonCode: "GOOGLE_PERMISSION_DENIED",
      failedStep: trim(error?.failedStep) || "google_sheets_read",
      upstreamStatus: upstreamStatus || 403,
      upstreamMessage: message,
    };
  }
  if (
    code === "GOOGLE_AUTH_FAILED" ||
    lower.includes("invalid_grant") ||
    lower.includes("invalid credentials") ||
    lower.includes("not connected")
  ) {
    return {
      reasonCode: "GOOGLE_AUTH_FAILED",
      failedStep: trim(error?.failedStep) || "connect_google",
      upstreamStatus: upstreamStatus || 401,
      upstreamMessage: message,
    };
  }
  if (code === "USERS_TAB_MISSING" || lower.includes("users tab is missing")) {
    return {
      reasonCode: "USERS_TAB_MISSING",
      failedStep: trim(error?.failedStep) || "users_tab_headers",
      upstreamMessage: message,
    };
  }
  if (
    code === "MASTER_SHEET_UNAVAILABLE" ||
    upstreamStatus === 404 ||
    lower.includes("not found") ||
    lower.includes("requested entity was not found")
  ) {
    return {
      reasonCode: "WORKBOOK_NOT_FOUND",
      failedStep: trim(error?.failedStep) || "master_sheet_resolve",
      upstreamStatus: upstreamStatus || 404,
      upstreamMessage: message,
    };
  }
  return {
    reasonCode: "USERS_TAB_READ_FAILED",
    failedStep: trim(error?.failedStep) || "google_sheets_read",
    upstreamStatus: upstreamStatus || undefined,
    upstreamMessage: message,
  };
}

function isStaleMasterSheetError(error) {
  const code = trim(error?.code);
  const message = trim(error instanceof Error ? error.message : error).toLowerCase();
  const upstreamStatus = Number(error?.upstreamStatus || error?.response?.status || error?.status || 0);
  return (
    code === "MASTER_SHEET_UNAVAILABLE" ||
    upstreamStatus === 404 ||
    message.includes("not found") ||
    message.includes("unable to parse range") ||
    message.includes("requested entity was not found")
  );
}

function logCompanyMembersLoad(payload = {}) {
  console.info("[company-members]", JSON.stringify(payload));
}

async function readUsersTabRecordsForCompany(auth, deps, companyContext = {}, options = {}) {
  const masterSheetId = trim(companyContext.masterSheetId);
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const companyName = trim(companyContext.companyName);
  const enrichedDeps = {
    ...deps,
    resolveUsersTab: deps.resolveUsersTab || resolveUsersTab,
    migrateUsersTabColumns: deps.migrateUsersTabColumns || migrateUsersTabColumns,
  };

  if (
    !options.skipUsersTabColumnMigration &&
    typeof enrichedDeps.migrateUsersTabColumns === "function" &&
    enrichedDeps.getTabValues
  ) {
    await enrichedDeps
      .migrateUsersTabColumns(auth, masterSheetId, enrichedDeps, {
        companyContext: { companyFolderId, companyId: companyFolderId, companyName, masterSheetId },
      })
      .catch(() => null);
  }

  const readResult = await readCompanyUsers(auth, masterSheetId, enrichedDeps, {
    companyFolderId,
    companyId: companyFolderId,
    companyName,
    masterSheetId,
  });
  if (!readResult?.ok || !Array.isArray(readResult.records)) {
    const error = new Error("Company workbook Users tab is missing or unreadable.");
    error.code = "USERS_TAB_READ_FAILED";
    error.failedStep = "users_tab_parse";
    throw error;
  }
  return readResult.records;
}

/**
 * Resolve company folder, workbook, and display name from a session or API actor.
 * companyFolderId === companyId everywhere.
 */
export async function resolveCompanyContextFromSession(auth, deps, session = {}) {
  const companyFolderId = trim(session.companyFolderId || session.companyId);
  return resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: session.masterSheetId,
    companyName: session.companyName || session.selectedCompanyName,
  });
}

/** @deprecated Prefer resolveCompanyContextFromSession — kept for route parity with docs. */
export const resolveCompanyContext = resolveCompanyContextFromSession;

/**
 * Read profile rows from the company workbook Users tab (header names, legacy + new schema).
 * Returns { members, totalSheetRows, profilesReturned, activeOnlyCount, ... } — never PasswordHash.
 */
export async function readUsersTabProfiles(auth, deps, companyContext = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const companyName = trim(companyContext.companyName);
  if (!auth || !masterSheetId) {
    return { members: [], totalSheetRows: 0, profilesReturned: 0, activeOnlyCount: 0, activeSheetUsers: 0 };
  }

  const companyCtx = {
    ...companyContext,
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
    companyName,
  };

  let records = await readUsersTabRecordsForCompany(auth, deps, companyCtx, {
    skipUsersTabColumnMigration: true,
  });
  let result = listableProfilesFromUsersTabRecords(records, companyCtx);

  if (result.members.length === 0 && result.totalSheetRows === 0) {
    records = await readUsersTabRecordsForCompany(auth, deps, companyCtx, {
      skipUsersTabColumnMigration: false,
    });
    result = listableProfilesFromUsersTabRecords(records, companyCtx);
  }

  return result;
}

/**
 * Rebuild server company-users cache after a successful sheet read.
 */
export function syncCompanyUsersCache(deps, companyContext = {}, profiles = []) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const cache = deps?.companyUsersCache;
  if (!cache || typeof cache.rebuildCompanyUsersCache !== "function" || !companyFolderId) {
    return {
      cacheUsersBefore: 0,
      cacheOnlyUsersRemoved: 0,
      cacheOnlyEmails: [],
      keptEmails: Array.isArray(profiles) ? profiles.map((row) => trim(row.email)).filter(Boolean) : [],
    };
  }
  return cache.rebuildCompanyUsersCache(companyFolderId, profiles, { masterSheetId });
}

/**
 * Canonical company profile list — resolve context, read Users tab, sync cache.
 * Single path: read sheet → map all listable rows → rebuild cache → return.
 * Never falls back to cache/session when the sheet has more rows than the fallback would return.
 */
export async function listCompanyProfiles(auth, deps, companyContext = {}) {
  const startedAt = Date.now();
  const sessionActor = companyContext.sessionActor || null;
  const signedInEmail = normalizeEmail(sessionActor?.email || "");
  const signedInRole = trim(sessionActor?.role || sessionActor?.accessLevel);

  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  let masterSheetId = trim(companyContext.masterSheetId);
  let companyName = trim(companyContext.companyName);

  const baseDiagnostics = () =>
    buildDiagnostics({
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      signedInEmail,
      signedInRole,
      dataSource: "users_tab",
      durationMs: Date.now() - startedAt,
    });

  if (!auth) {
    return buildFailure(
      "GOOGLE_AUTH_FAILED",
      "Please connect Google before loading company users.",
      { ...baseDiagnostics(), failedStep: "connect_google" },
      { httpStatus: 401, failedStep: "connect_google" },
    );
  }

  if (!companyFolderId) {
    return buildFailure(
      "MISSING_COMPANY_CONTEXT",
      COMPANY_USERS_USER_MESSAGE,
      { ...baseDiagnostics(), failedStep: "company_context_resolve" },
      { httpStatus: 404, failedStep: "company_context_resolve" },
    );
  }

  if (!looksLikeDriveId(companyFolderId)) {
    return buildFailure(
      "INVALID_COMPANY_ID",
      "Company workspace id is invalid.",
      { ...baseDiagnostics(), failedStep: "company_context_resolve" },
      { httpStatus: 400, failedStep: "company_context_resolve" },
    );
  }

  const folderPlacement = await validateCompanyFolderUnderCompaniesRoot(auth, deps, companyFolderId, {
    companyFolderName: companyName,
  }).catch(() => ({ ok: false, reasonCode: "FOLDER_NOT_IN_COMPANIES_ROOT" }));
  const folderPlacementWarning =
    folderPlacement?.ok === false
      ? trim(folderPlacement.userMessage || folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT")
      : "";

  const resolvedContext = await resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
    companyName,
  });
  masterSheetId = trim(resolvedContext.masterSheetId);
  companyName = trim(resolvedContext.companyName);

  if (!masterSheetId) {
    return buildFailure(
      "MISSING_MASTER_SHEET_ID",
      COMPANY_USERS_USER_MESSAGE,
      { ...baseDiagnostics(), companyName, failedStep: "master_sheet_resolve" },
      { httpStatus: 404, failedStep: "master_sheet_resolve" },
    );
  }

  const resolvedCompanyId = companyFolderId;
  const companyCtx = {
    companyFolderId: resolvedCompanyId,
    companyId: resolvedCompanyId,
    companyName,
    masterSheetId,
  };

  try {
    const sheetResult = await readUsersTabProfiles(auth, deps, companyCtx);
    const members = sheetResult.members;
    const cacheStats = syncCompanyUsersCache(deps, companyCtx, members);
    const placementWarning = folderPlacementWarning
      ? `Company folder placement needs attention (${folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT"}).`
      : "";

    logCompanyMembersLoad({
      companyFolderId: resolvedCompanyId,
      masterSheetId,
      dataSource: "users_tab",
      totalRowsRead: sheetResult.totalSheetRows,
      profilesReturned: members.length,
      activeOnlyCount: sheetResult.activeOnlyCount,
      cacheUsersBefore: cacheStats.cacheUsersBefore,
      cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
    });

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      companyName: companyName || undefined,
      masterSheetId,
      users: members,
      activeCount: members.length,
      warning: placementWarning || undefined,
      diagnostics: buildDiagnostics({
        companyId: resolvedCompanyId,
        companyFolderId: resolvedCompanyId,
        companyName,
        masterSheetId,
        signedInEmail,
        signedInRole,
        dataSource: "users_tab",
        durationMs: Date.now() - startedAt,
        totalRowsRead: sheetResult.totalSheetRows,
        profilesReturned: members.length,
        activeOnlyCount: sheetResult.activeOnlyCount,
        cacheUsersBefore: cacheStats.cacheUsersBefore,
        cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
      }),
      cacheReconciliation: cacheStats,
    };
  } catch (error) {
    if (isStaleMasterSheetError(error) && companyFolderId) {
      try {
        const folderResolved = await resolveCompanyFromFolder(auth, deps, companyFolderId, {
          companyName,
          masterSheetId,
          ensureStructure: false,
          skipFolderPlacementCheck: true,
        });
        const refreshedSheetId = trim(folderResolved?.masterSheetId);
        if (folderResolved?.ok && refreshedSheetId && refreshedSheetId !== masterSheetId) {
          const refreshedCtx = {
            ...companyCtx,
            masterSheetId: refreshedSheetId,
            companyName: trim(folderResolved.companyName) || companyName,
          };
          const sheetResult = await readUsersTabProfiles(auth, deps, refreshedCtx);
          const members = sheetResult.members;
          const cacheStats = syncCompanyUsersCache(deps, refreshedCtx, members);
          return {
            ok: true,
            companyId: resolvedCompanyId,
            companyFolderId: resolvedCompanyId,
            companyName: refreshedCtx.companyName || undefined,
            masterSheetId: refreshedSheetId,
            users: members,
            activeCount: members.length,
            diagnostics: buildDiagnostics({
              companyId: resolvedCompanyId,
              companyFolderId: resolvedCompanyId,
              companyName: refreshedCtx.companyName,
              masterSheetId: refreshedSheetId,
              signedInEmail,
              signedInRole,
              dataSource: "users_tab",
              durationMs: Date.now() - startedAt,
              totalRowsRead: sheetResult.totalSheetRows,
              profilesReturned: members.length,
              activeOnlyCount: sheetResult.activeOnlyCount,
              cacheUsersBefore: cacheStats.cacheUsersBefore,
              cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
            }),
            cacheReconciliation: cacheStats,
          };
        }
      } catch {
        // fall through to structured failure
      }
    }

    const classified = classifyReadError(error);
    const technicalError = error instanceof Error ? error.message : String(error);
    return buildFailure(
      classified.reasonCode,
      COMPANY_USERS_USER_MESSAGE,
      {
        ...baseDiagnostics(),
        companyName,
        masterSheetId,
        failedStep: classified.failedStep,
        upstreamStatus: classified.upstreamStatus,
        upstreamMessage: classified.upstreamMessage || technicalError,
      },
      {
        httpStatus:
          classified.reasonCode === "GOOGLE_PERMISSION_DENIED" ||
          classified.reasonCode === "GOOGLE_SHEETS_PERMISSION_DENIED"
            ? 403
            : 502,
        technicalError,
        failedStep: classified.failedStep,
      },
    );
  }
}

/** Backward-compatible alias — same implementation as listCompanyProfiles. */
export async function syncAndListActiveUsers(auth, deps, companyContext = {}) {
  return listCompanyProfiles(auth, deps, companyContext);
}

/**
 * Godmode — read Users tab and replace server cache (remove cache-only users).
 */
export async function rebuildUsersFromSheet(auth, deps, companyContext = {}) {
  const listed = await listCompanyProfiles(auth, deps, companyContext);
  if (!listed.ok) {
    return listed;
  }
  const reconciliation = listed.cacheReconciliation || {
    cacheUsersBefore: listed.diagnostics?.cacheUsersBefore ?? 0,
    cacheOnlyUsersRemoved: listed.diagnostics?.cacheOnlyUsersRemoved ?? 0,
    cacheOnlyEmails: [],
    keptEmails: (listed.users || []).map((row) => row.email),
  };
  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    companyName: listed.companyName,
    masterSheetId: listed.masterSheetId,
    users: listed.users,
    activeCount: listed.activeCount,
    diagnostics: listed.diagnostics,
    removed: reconciliation.cacheOnlyEmails || [],
    kept: reconciliation.keptEmails || (listed.users || []).map((row) => row.email),
    cacheUsersBefore: reconciliation.cacheUsersBefore,
    cacheOnlyUsersRemoved: reconciliation.cacheOnlyUsersRemoved,
  };
}

export async function getAssignableUsers(auth, deps, companyContext = {}) {
  const companyId = trim(companyContext.companyId || companyContext.companyFolderId);
  const selectedArea = trim(companyContext.selectedArea);
  const includeDiagnostics = companyContext.includeDiagnostics === true;

  const listed = await listCompanyProfiles(auth, deps, companyContext);
  if (!listed.ok) {
    throw new Error(listed.message || listed.error || "Could not load company users.");
  }

  const mapped = (listed.users || []).map((row) => ({
    email: row.email,
    name: row.name,
    role: row.role,
    accessLevel: row.accessLevel,
    status: row.status,
    companyId: row.companyId || companyId,
    companyFolderId: row.companyFolderId || companyId,
    companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : [],
    companyAreasRaw: row.companyAreasRaw || "",
  }));

  const result = buildAvailableScheduleAssigneesFromUsers(mapped, {
    companyId,
    masterSheetId: trim(companyContext.masterSheetId),
    selectedArea,
    includeDiagnostics,
  });

  return {
    users: mapped,
    assignees: result.assignees,
    auditors: result.auditors,
    diagnostics: result.diagnostics,
  };
}
