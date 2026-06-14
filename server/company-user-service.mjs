/**
 * Company workbook Users tab reads — never expose PasswordHash to clients.
 */
import {
  parseRoleForClient,
  buildAvailableScheduleAssigneesFromUsers,
  isExcludedCompanyProfileStatus,
} from "../shared/schedule-assignees.mjs";
import {
  parseCompanyAreas,
  sanitizeUsersTabRecords,
  migrateUsersTabColumns,
  normalizeUserStatus,
} from "./company-users.mjs";
import {
  backfillRowCompanyFields,
  pickRowCompanyFolderId,
  pickRowCompanyId,
  pickRowCompanyName,
  resolvedProfileCompanyFolderId,
  rowPassesCompanyProfileContext,
} from "./users-tab-schema.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { resolveCompanyContextFields } from "./company-context-service.mjs";
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
import {
  listActiveUsersFromSheet,
  readActiveUsersFromSheetWithStats,
} from "./company-user-sheet-flow.mjs";

const COMPANY_USERS_LOAD_FAILED = "COMPANY_USERS_LOAD_FAILED";
const COMPANY_USERS_USER_MESSAGE = "Could not load company users.";

function pickRowValue(row, ...keys) {
  if (!row || typeof row !== "object") {
    return "";
  }
  for (const key of keys) {
    const want = String(key).trim().toLowerCase();
    for (const [rawKey, rawValue] of Object.entries(row)) {
      if (String(rawKey).trim().toLowerCase() === want) {
        return String(rawValue ?? "").trim();
      }
    }
  }
  return "";
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function looksLikeDriveId(value) {
  const id = String(value || "").trim();
  return id.length >= 10 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function buildDiagnostics(base = {}) {
  const companyFolderId = String(base.companyFolderId || base.companyId || "").trim();
  const companyId = String(base.companyId || companyFolderId).trim();
  const signedInEmail = normalizeEmail(base.signedInEmail || "");
  const totalRowsRead =
    typeof base.totalRowsRead === "number"
      ? base.totalRowsRead
      : typeof base.totalSheetRows === "number"
        ? base.totalSheetRows
        : undefined;
  const activeRowsFound =
    typeof base.activeOnlyCount === "number"
      ? base.activeOnlyCount
      : typeof base.activeRowsFound === "number"
        ? base.activeRowsFound
        : typeof base.activeSheetUsers === "number"
          ? base.activeSheetUsers
          : undefined;
  const profilesReturned =
    typeof base.profilesReturned === "number"
      ? base.profilesReturned
      : typeof base.profileRowsReturned === "number"
        ? base.profileRowsReturned
        : undefined;
  return {
    companyId: companyId || undefined,
    companyFolderId: companyFolderId || companyId || undefined,
    companyName: String(base.companyName || "").trim() || undefined,
    masterSheetId: String(base.masterSheetId || "").trim() || undefined,
    signedInEmail: signedInEmail || undefined,
    signedInRole: String(base.signedInRole || "").trim() || undefined,
    dataSource: String(base.dataSource || "").trim() || undefined,
    failedStep: String(base.failedStep || "").trim() || undefined,
    durationMs: typeof base.durationMs === "number" ? base.durationMs : undefined,
    upstreamStatus:
      typeof base.upstreamStatus === "number" && Number.isFinite(base.upstreamStatus)
        ? base.upstreamStatus
        : undefined,
    upstreamMessage: String(base.upstreamMessage || "").trim() || undefined,
    totalRowsRead,
    profilesReturned,
    activeOnlyCount: activeRowsFound,
    activeRowsFound,
    totalSheetRows: totalRowsRead,
    activeSheetUsers: profilesReturned ?? activeRowsFound,
    cacheUsersBefore: typeof base.cacheUsersBefore === "number" ? base.cacheUsersBefore : undefined,
    cacheOnlyUsersRemoved:
      typeof base.cacheOnlyUsersRemoved === "number" ? base.cacheOnlyUsersRemoved : undefined,
  };
}

function logCompanyMembersLoad(payload = {}) {
  console.info("[company-members]", JSON.stringify(payload));
}

function sheetAttemptStats(sheetResult = null) {
  const members = Array.isArray(sheetResult?.members) ? sheetResult.members : [];
  const totalSheetRows =
    typeof sheetResult?.totalSheetRows === "number" ? sheetResult.totalSheetRows : members.length;
  return {
    members,
    memberCount: members.length,
    totalSheetRows,
    profilesReturned:
      typeof sheetResult?.profilesReturned === "number" ? sheetResult.profilesReturned : members.length,
  };
}

function sheetReadShowsMultipleUsers(sheetResult = null) {
  const stats = sheetAttemptStats(sheetResult);
  return stats.memberCount >= 2 || stats.totalSheetRows >= 2;
}

function cacheIsStaleVersusSheet(cacheCount, sheetResult = null) {
  const stats = sheetAttemptStats(sheetResult);
  return stats.totalSheetRows > 0 && cacheCount > 0 && cacheCount < stats.totalSheetRows;
}

function reconcileCompanyUsersCache(companyFolderId, members, meta = {}, deps = {}) {
  const cache = deps.companyUsersCache;
  if (!cache || typeof cache.rebuildCompanyUsersCache !== "function" || !companyFolderId) {
    return {
      cacheUsersBefore: 0,
      cacheOnlyUsersRemoved: 0,
      cacheOnlyEmails: [],
    };
  }
  return cache.rebuildCompanyUsersCache(companyFolderId, members, meta);
}

function buildFailure(reasonCode, message, diagnostics = {}, extra = {}) {
  const builtDiagnostics = buildDiagnostics(diagnostics);
  const failedStep = String(extra.failedStep || builtDiagnostics.failedStep || "").trim() || undefined;
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

function mapSessionActorToMember(sessionActor, companyContext = {}) {
  const email = normalizeEmail(sessionActor?.email || "");
  if (!email) {
    return null;
  }
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyAreas = Array.isArray(sessionActor?.companyAreas) ? sessionActor.companyAreas : [];
  return {
    email,
    name: String(sessionActor?.name || email.split("@")[0] || email).trim() || email,
    role: parseRoleForClient(sessionActor?.role || sessionActor?.accessLevel || "User"),
    accessLevel: String(sessionActor?.accessLevel || "").trim(),
    status: "ACTIVE",
    company: String(companyContext.companyName || sessionActor?.company || "").trim(),
    companyId: companyFolderId || String(sessionActor?.companyId || sessionActor?.companyFolderId || "").trim(),
    companyFolderId: companyFolderId || String(sessionActor?.companyFolderId || sessionActor?.companyId || "").trim(),
    companyAreas,
    companyAreasRaw: companyAreas.join(", "),
  };
}

function buildSheetReadSuccessResponse(
  sheetResult,
  {
    resolvedCompanyId,
    companyName,
    masterSheetId,
    signedInEmail,
    signedInRole,
    startedAt,
    placementWarning,
    deps,
    dataSource = "users_tab",
    warning,
    reasonCode,
    failedStep,
    upstreamMessage,
  },
) {
  const members = Array.isArray(sheetResult?.members) ? sheetResult.members : [];
  const profilesReturned = members.length;
  const activeOnlyCount =
    typeof sheetResult?.activeOnlyCount === "number"
      ? sheetResult.activeOnlyCount
      : members.filter((member) => normalizeUserStatus(member.status) === "ACTIVE").length;
  const cacheStats = reconcileCompanyUsersCache(resolvedCompanyId, members, { masterSheetId }, deps);
  const totalRowsRead = sheetResult?.totalSheetRows ?? members.length;
  logCompanyMembersLoad({
    companyFolderId: resolvedCompanyId,
    masterSheetId,
    dataSource,
    totalRowsRead,
    profilesReturned,
    activeOnlyCount,
    cacheUsersBefore: cacheStats.cacheUsersBefore,
    cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
    warning: warning || placementWarning || undefined,
    reasonCode,
    failedStep,
  });
  return {
    ok: true,
    companyId: resolvedCompanyId,
    companyFolderId: resolvedCompanyId,
    companyName: companyName || undefined,
    masterSheetId,
    users: members,
    activeCount: profilesReturned,
    warning: warning || placementWarning || undefined,
    reasonCode,
    failedStep,
    diagnostics: buildDiagnostics({
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      companyName,
      masterSheetId,
      signedInEmail,
      signedInRole,
      dataSource,
      durationMs: Date.now() - startedAt,
      totalRowsRead,
      profilesReturned,
      activeOnlyCount,
      cacheUsersBefore: cacheStats.cacheUsersBefore,
      cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
      upstreamMessage,
    }),
    cacheReconciliation: cacheStats,
  };
}

function buildSessionFallbackSuccess(sessionActor, companyContext, failure, startedAt, sheetAttempt = null) {
  if (sheetReadShowsMultipleUsers(sheetAttempt)) {
    const stats = sheetAttemptStats(sheetAttempt);
    if (stats.memberCount > 0) {
      return buildSheetReadSuccessResponse(sheetAttempt, {
        resolvedCompanyId: companyContext.companyFolderId || companyContext.companyId,
        companyName: companyContext.companyName,
        masterSheetId: companyContext.masterSheetId,
        signedInEmail: sessionActor?.email,
        signedInRole: sessionActor?.role || sessionActor?.accessLevel,
        startedAt,
        deps: {},
        dataSource: "users_tab",
        warning: "Workbook read returned multiple users; refusing session-only fallback.",
        reasonCode: failure.reasonCode,
        failedStep: failure.failedStep || failure.diagnostics?.failedStep,
        upstreamMessage: failure.diagnostics?.upstreamMessage || failure.technicalError,
      });
    }
    logCompanyMembersLoad({
      companyFolderId: companyContext.companyFolderId || companyContext.companyId,
      masterSheetId: companyContext.masterSheetId,
      dataSource: "session-fallback-rejected",
      totalRowsRead: stats.totalSheetRows,
      profilesReturned: stats.memberCount,
      reasonCode: failure.reasonCode,
      failedStep: failure.failedStep || failure.diagnostics?.failedStep,
    });
    return null;
  }
  const member = mapSessionActorToMember(sessionActor, companyContext);
  if (!member) {
    return null;
  }
  const failedStep = failure.failedStep || failure.diagnostics?.failedStep;
  const reasonCode = failure.reasonCode;
  const upstreamMessage = failure.diagnostics?.upstreamMessage || failure.technicalError;
  return {
    ok: true,
    companyId: companyContext.companyFolderId || companyContext.companyId,
    companyFolderId: companyContext.companyFolderId || companyContext.companyId,
    companyName: companyContext.companyName || undefined,
    masterSheetId: companyContext.masterSheetId || undefined,
    users: [member],
    activeCount: 1,
    warning: `Showing signed-in user only; workbook read failed (${reasonCode || failedStep || "unknown"}).`,
    reasonCode,
    failedStep,
    diagnostics: buildDiagnostics({
      companyId: companyContext.companyFolderId || companyContext.companyId,
      companyFolderId: companyContext.companyFolderId || companyContext.companyId,
      companyName: companyContext.companyName,
      masterSheetId: companyContext.masterSheetId,
      signedInEmail: sessionActor?.email,
      signedInRole: sessionActor?.role || sessionActor?.accessLevel,
      dataSource: "session-fallback",
      failedStep,
      durationMs: Date.now() - startedAt,
      upstreamMessage,
      totalRowsRead: 0,
      activeRowsFound: 1,
    }),
  };
}

function buildCacheOrSessionFallbackSuccess(
  sessionActor,
  companyContext,
  failure,
  startedAt,
  deps = {},
  sheetAttempt = null,
) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const sheetStats = sheetAttemptStats(sheetAttempt);
  if (sheetStats.memberCount > 0) {
    return buildSheetReadSuccessResponse(sheetAttempt, {
      resolvedCompanyId: companyFolderId,
      companyName: companyContext.companyName,
      masterSheetId: companyContext.masterSheetId,
      signedInEmail: sessionActor?.email,
      signedInRole: sessionActor?.role || sessionActor?.accessLevel,
      startedAt,
      deps,
      dataSource: "users_tab",
      warning: `Workbook read returned ${sheetStats.memberCount} profile(s); refusing cache/session fallback.`,
      reasonCode: failure.reasonCode,
      failedStep: failure.failedStep || failure.diagnostics?.failedStep,
      upstreamMessage: failure.diagnostics?.upstreamMessage || failure.technicalError,
    });
  }
  const cache = deps.companyUsersCache;
  const cacheEntry =
    cache && typeof cache.getEntry === "function" && companyFolderId ? cache.getEntry(companyFolderId) : null;
  const cachedMembers = Array.isArray(cacheEntry?.users)
    ? cacheEntry.users
        .map((row) => mapCompanyProfileMember(row, companyContext))
        .filter(Boolean)
    : [];

  if (cachedMembers.length > 0 && cacheIsStaleVersusSheet(cachedMembers.length, sheetAttempt)) {
    logCompanyMembersLoad({
      companyFolderId,
      masterSheetId: companyContext.masterSheetId,
      dataSource: "cache-fallback-rejected",
      cacheUsersBefore: cachedMembers.length,
      totalRowsRead: sheetStats.totalSheetRows,
      profilesReturned: sheetStats.memberCount,
      reasonCode: failure.reasonCode,
      failedStep: failure.failedStep || failure.diagnostics?.failedStep,
    });
  } else if (cachedMembers.length > 0) {
    const sessionMember = mapSessionActorToMember(sessionActor, companyContext);
    const seenEmails = new Set(cachedMembers.map((row) => normalizeEmail(row.email)));
    const members = [...cachedMembers];
    if (sessionMember && !seenEmails.has(normalizeEmail(sessionMember.email))) {
      members.unshift(sessionMember);
    }
    const failedStep = failure.failedStep || failure.diagnostics?.failedStep;
    const reasonCode = failure.reasonCode;
    const upstreamMessage = failure.diagnostics?.upstreamMessage || failure.technicalError;
    return {
      ok: true,
      companyId: companyFolderId,
      companyFolderId,
      companyName: companyContext.companyName || undefined,
      masterSheetId: companyContext.masterSheetId || cacheEntry?.masterSheetId || undefined,
      users: members,
      activeCount: members.length,
      warning: `Showing cached active users; workbook read failed (${reasonCode || failedStep || "unknown"}).`,
      reasonCode,
      failedStep,
      diagnostics: buildDiagnostics({
        companyId: companyFolderId,
        companyFolderId,
        companyName: companyContext.companyName,
        masterSheetId: companyContext.masterSheetId || cacheEntry?.masterSheetId,
        signedInEmail: sessionActor?.email,
        signedInRole: sessionActor?.role || sessionActor?.accessLevel,
        dataSource: "cache-fallback",
        failedStep,
        durationMs: Date.now() - startedAt,
        upstreamMessage,
        totalRowsRead: 0,
        activeRowsFound: members.length,
        cacheUsersBefore: cachedMembers.length,
      }),
    };
  }

  return buildSessionFallbackSuccess(sessionActor, companyContext, failure, startedAt, sheetAttempt);
}

function classifyReadError(error, payload) {
  const message = String(error instanceof Error ? error.message : error || "").trim();
  const lower = message.toLowerCase();
  const code = String(error?.code || payload?.code || "").trim();
  const upstreamStatus = Number(error?.response?.status || error?.status || payload?.status || 0);

  const failedStep = String(error?.failedStep || payload?.failedStep || "").trim();
  if (
    code === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
    code === "GOOGLE_PERMISSION_DENIED" ||
    upstreamStatus === 403 ||
    lower.includes("permission")
  ) {
    return {
      reasonCode: "GOOGLE_PERMISSION_DENIED",
      failedStep: failedStep || "google_sheets_read",
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
      failedStep: failedStep || "connect_google",
      upstreamStatus: upstreamStatus || 401,
      upstreamMessage: message,
    };
  }
  if (code === "USERS_TAB_MISSING" || lower.includes("users tab is missing")) {
    return {
      reasonCode: "USERS_TAB_MISSING",
      failedStep: failedStep || "users_tab_headers",
      upstreamStatus: upstreamStatus || undefined,
      upstreamMessage: message,
    };
  }
  if (lower.includes("schema repair") || lower.includes("users_tab_schema_repair")) {
    return {
      reasonCode: "USERS_TAB_READ_FAILED",
      failedStep: failedStep || "users_tab_schema_repair",
      upstreamStatus: upstreamStatus || undefined,
      upstreamMessage: message,
    };
  }
  if (lower.includes("parse") || code === "USERS_TAB_PARSE_FAILED") {
    return {
      reasonCode: "USERS_TAB_READ_FAILED",
      failedStep: failedStep || "users_tab_parse",
      upstreamStatus: upstreamStatus || undefined,
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
      failedStep: failedStep || "master_sheet_resolve",
      upstreamStatus: upstreamStatus || 404,
      upstreamMessage: message || String(payload?.error || ""),
    };
  }
  return {
    reasonCode: "USERS_TAB_READ_FAILED",
    failedStep: failedStep || "google_sheets_read",
    upstreamStatus: upstreamStatus || undefined,
    upstreamMessage: message || String(payload?.error || ""),
  };
}


function mapUsersTabRow(row, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const filled = backfillRowCompanyFields(row, companyContext);
  const companyAreasRaw = pickRowValue(filled, "CompanyAreas", "Company Areas", "companyAreas");
  const rowCompanyId = pickRowCompanyId(filled) || companyFolderId;
  const rowCompanyFolderId = pickRowCompanyFolderId(filled) || rowCompanyId;
  return {
    email: pickRowValue(filled, "Email", "email"),
    name: pickRowValue(filled, "Name", "name", "Full Name"),
    role: pickRowValue(filled, "Role", "role"),
    accessLevel: pickRowValue(filled, "AccessLevel", "Access Level", "accessLevel"),
    status: pickRowValue(filled, "Status", "status"),
    company: pickRowCompanyName(filled),
    companyId: rowCompanyId,
    companyFolderId: rowCompanyFolderId,
    companyAreas: parseCompanyAreas(companyAreasRaw),
    companyAreasRaw,
  };
}

function mapCompanyProfileMember(row, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const email = normalizeEmail(row.email || row.Email);
  if (!email) {
    return null;
  }
  const name = String(row.name || row.Name || "").trim();
  if (!name) {
    return null;
  }
  const status = normalizeUserStatus(row.status || row.Status);
  if (isExcludedCompanyProfileStatus(status)) {
    return null;
  }
  if (!rowPassesCompanyProfileContext(row, companyContext)) {
    return null;
  }
  const companyAreas = Array.isArray(row.companyAreas)
    ? row.companyAreas
    : parseCompanyAreas(row.companyAreasRaw || row.CompanyAreas || row.companyAreas || "");
  const resolvedFolderId = resolvedProfileCompanyFolderId(row, companyContext);
  return {
    email,
    name,
    role: parseRoleForClient(row.role || row.Role || row.accessLevel || row.AccessLevel || "User"),
    accessLevel: String(row.accessLevel || row.AccessLevel || "").trim(),
    status,
    company: row.company || row.Company || "",
    companyId: resolvedFolderId,
    companyFolderId: resolvedFolderId,
    companyAreas,
    companyAreasRaw: row.companyAreasRaw || String(row.CompanyAreas || ""),
  };
}

/** @deprecated Use mapCompanyProfileMember — kept for verify script references. */
const mapActiveCompanyMember = mapCompanyProfileMember;

function isStaleMasterSheetError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  const upstreamStatus = Number(error?.upstreamStatus || error?.response?.status || error?.status || 0);
  return (
    code === "MASTER_SHEET_UNAVAILABLE" ||
    upstreamStatus === 404 ||
    message.includes("not found") ||
    message.includes("unable to parse range") ||
    message.includes("requested entity was not found")
  );
}

export async function getCompanyUsers(auth, masterSheetId, deps, options = {}) {
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId || !auth) {
    throw new Error("masterSheetId and Google auth are required to read company users.");
  }

  const enrichedDeps = {
    ...deps,
    resolveUsersTab: deps.resolveUsersTab || resolveUsersTab,
    migrateUsersTabColumns: deps.migrateUsersTabColumns || migrateUsersTabColumns,
  };

  if (typeof enrichedDeps.migrateUsersTabColumns === "function" && enrichedDeps.getTabValues) {
    await enrichedDeps.migrateUsersTabColumns(auth, sheetId, enrichedDeps).catch(() => null);
  }

  const readResult = await readCompanyUsers(auth, sheetId, enrichedDeps, options);
  if (!readResult?.ok || !Array.isArray(readResult.records)) {
    const error = new Error("Company workbook Users tab is missing or unreadable.");
    error.code = "USERS_TAB_READ_FAILED";
    throw error;
  }

  const companyFolderId = String(options.companyFolderId || options.companyId || "").trim();
  const companyContext = {
    companyFolderId,
    companyId: companyFolderId,
    companyName: String(options.companyName || "").trim(),
    masterSheetId: sheetId,
  };
  return sanitizeUsersTabRecords(readResult.records.map((row) => mapUsersTabRow(row, companyContext)));
}

async function resolveMasterSheetFromFolder(auth, deps, companyFolderId, companyName, masterSheetHint = "") {
  try {
    const resolved = await resolveCompanyFromFolder(auth, deps, companyFolderId, {
      companyName,
      masterSheetId: masterSheetHint,
      ensureStructure: false,
    });
    if (!resolved?.ok) {
      const reasonCode = String(resolved?.reasonCode || "").trim();
      if (reasonCode === "MASTER_SHEET_MISSING") {
        return { ok: false, reasonCode: "MISSING_MASTER_SHEET_ID", resolved };
      }
      if (reasonCode === "COMPANY_FOLDER_MISSING" || reasonCode === "COMPANY_FOLDER_INVALID") {
        return { ok: false, reasonCode: "MISSING_COMPANY_FOLDER_ID", resolved };
      }
      return { ok: false, reasonCode: "WORKBOOK_NOT_FOUND", resolved };
    }
    return {
      ok: true,
      masterSheetId: String(resolved.masterSheetId || "").trim(),
      companyName: String(resolved.companyName || companyName || "").trim(),
    };
  } catch (error) {
    return {
      ok: false,
      reasonCode: "WORKBOOK_NOT_FOUND",
      error,
    };
  }
}

/**
 * Canonical company profiles from the Users tab — all roles, companyId = companyFolderId.
 */
export async function listActiveCompanyMembers(auth, deps, companyContext = {}) {
  const startedAt = Date.now();
  const sessionActor = companyContext.sessionActor || null;
  const signedInEmail = normalizeEmail(sessionActor?.email || "");
  const signedInRole = String(sessionActor?.role || sessionActor?.accessLevel || "").trim();

  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  let masterSheetId = String(companyContext.masterSheetId || "").trim();
  let companyName = String(companyContext.companyName || "").trim();

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
      { ...baseDiagnostics(), failedStep: "connect_google", dataSource: "users_tab" },
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
      ? String(folderPlacement.userMessage || folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT").trim()
      : "";

  const resolvedContext = await resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
    companyName,
  });
  masterSheetId = String(resolvedContext.masterSheetId || "").trim();
  companyName = String(resolvedContext.companyName || "").trim();

  if (!masterSheetId) {
    return buildFailure(
      "MISSING_MASTER_SHEET_ID",
      COMPANY_USERS_USER_MESSAGE,
      {
        ...baseDiagnostics(),
        companyName,
        failedStep: "master_sheet_resolve",
      },
      { httpStatus: 404, failedStep: "master_sheet_resolve" },
    );
  }

  const resolvedCompanyId = companyFolderId;

  const loadActiveUsersForSheet = async (sheetId, readDeps = deps) =>
    readActiveUsersFromSheetWithStats(auth, readDeps, {
      masterSheetId: sheetId,
      companyFolderId: resolvedCompanyId,
      companyId: resolvedCompanyId,
      companyName,
    });

  let lastSheetAttempt = null;

  try {
    let sheetResult;
    try {
      sheetResult = await loadActiveUsersForSheet(masterSheetId, {
        ...deps,
        skipUsersTabColumnMigration: true,
      });
      lastSheetAttempt = sheetResult;
      logCompanyMembersLoad({
        companyFolderId: resolvedCompanyId,
        masterSheetId,
        dataSource: "users_tab",
        readMode: "no_migration",
        totalRowsRead: sheetResult?.totalSheetRows ?? 0,
        profilesReturned: sheetResult?.members?.length ?? 0,
      });
      if (!sheetResult.members.length && (sheetResult.totalSheetRows ?? 0) === 0) {
        sheetResult = await loadActiveUsersForSheet(masterSheetId, deps);
        lastSheetAttempt = sheetResult;
        logCompanyMembersLoad({
          companyFolderId: resolvedCompanyId,
          masterSheetId,
          dataSource: "users_tab",
          readMode: "with_migration",
          totalRowsRead: sheetResult?.totalSheetRows ?? 0,
          profilesReturned: sheetResult?.members?.length ?? 0,
        });
      }
    } catch (firstError) {
      if (isStaleMasterSheetError(firstError) && companyFolderId) {
        const folderResolved = await resolveMasterSheetFromFolder(
          auth,
          deps,
          companyFolderId,
          companyName,
          masterSheetId,
        );
        if (folderResolved.ok) {
          const refreshedSheetId = String(folderResolved.masterSheetId || "").trim();
          if (refreshedSheetId && refreshedSheetId !== masterSheetId) {
            masterSheetId = refreshedSheetId;
            companyName = folderResolved.companyName || companyName;
            sheetResult = await loadActiveUsersForSheet(masterSheetId, {
              ...deps,
              skipUsersTabColumnMigration: true,
            });
            lastSheetAttempt = sheetResult;
          } else {
            throw firstError;
          }
        } else {
          throw firstError;
        }
      } else {
        throw firstError;
      }
    }

    const placementWarning = folderPlacementWarning
      ? `Company folder placement needs attention (${folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT"}).`
      : "";
    const success = buildSheetReadSuccessResponse(sheetResult, {
      resolvedCompanyId,
      companyName,
      masterSheetId,
      signedInEmail,
      signedInRole,
      startedAt,
      placementWarning,
      deps,
    });
    if (
      (sheetResult?.totalSheetRows ?? 0) > (sheetResult?.members?.length ?? 0) &&
      (sheetResult?.totalSheetRows ?? 0) >= 2
    ) {
      logCompanyMembersLoad({
        companyFolderId: resolvedCompanyId,
        masterSheetId,
        dataSource: "users_tab",
        readMode: "filtered_rows",
        totalRowsRead: sheetResult.totalSheetRows,
        profilesReturned: sheetResult.members?.length ?? 0,
      });
    }
    return success;
  } catch (error) {
    const classified = classifyReadError(error);
    const technicalError = error instanceof Error ? error.message : String(error);
    const failure = buildFailure(
      classified.reasonCode,
      COMPANY_USERS_USER_MESSAGE,
      {
        companyId: resolvedCompanyId,
        companyFolderId: resolvedCompanyId,
        companyName,
        masterSheetId,
        signedInEmail,
        signedInRole,
        dataSource: "users_tab",
        failedStep: classified.failedStep,
        durationMs: Date.now() - startedAt,
        upstreamStatus: classified.upstreamStatus,
        upstreamMessage: classified.upstreamMessage || technicalError,
        totalRowsRead: Number(error?.totalRowsRead ?? error?.totalSheetRows ?? 0) || undefined,
        activeRowsFound: Number(error?.activeRowsFound ?? error?.activeSheetUsers ?? 0) || undefined,
      },
      {
        httpStatus:
          classified.reasonCode === "GOOGLE_PERMISSION_DENIED" ||
          classified.reasonCode === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
          classified.reasonCode === "PERMISSION_DENIED"
            ? 403
            : 502,
        technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
        failedStep: classified.failedStep,
      },
    );

    try {
      const retryResult = await readActiveUsersFromSheetWithStats(
        auth,
        { ...deps, skipUsersTabColumnMigration: true },
        {
          masterSheetId,
          companyFolderId: resolvedCompanyId,
          companyId: resolvedCompanyId,
          companyName,
        },
      );
      lastSheetAttempt = retryResult;
      const retryMembers = Array.isArray(retryResult?.members) ? retryResult.members : [];
      if (retryMembers.length > 0) {
        return buildSheetReadSuccessResponse(retryResult, {
          resolvedCompanyId,
          companyName,
          masterSheetId,
          signedInEmail,
          signedInRole,
          startedAt,
          deps,
          warning: `Workbook read recovered without column migration (${classified.reasonCode || classified.failedStep || "read_failed"}).`,
          reasonCode: classified.reasonCode,
          failedStep: classified.failedStep,
          upstreamMessage: classified.upstreamMessage || technicalError,
        });
      }
    } catch {
      // fall through to cache/session fallback
    }

    const fallback = buildCacheOrSessionFallbackSuccess(
      sessionActor,
      {
        companyFolderId: resolvedCompanyId,
        companyId: resolvedCompanyId,
        companyName,
        masterSheetId,
      },
      failure,
      startedAt,
      deps,
      lastSheetAttempt,
    );
    if (fallback) {
      return fallback;
    }

    if (folderPlacementWarning && !masterSheetId) {
      return buildFailure(
        folderPlacement.reasonCode || "FOLDER_NOT_IN_COMPANIES_ROOT",
        "This company is not set up in BERT. Contact your administrator.",
        { ...baseDiagnostics(), failedStep: "company_context_resolve" },
        { httpStatus: 403, failedStep: "company_context_resolve" },
      );
    }

    return failure;
  }
}

export { listActiveUsersFromSheet };

export async function getAssignableUsers(auth, masterSheetId, deps, options = {}) {
  const companyId = String(options.companyId || options.companyFolderId || "").trim();
  const selectedArea = String(options.selectedArea || "").trim();
  const includeDiagnostics = options.includeDiagnostics === true;

  const listed = await syncAndListActiveUsers(auth, deps, {
    companyId,
    companyFolderId: String(options.companyFolderId || companyId).trim(),
    masterSheetId,
    companyName: options.companyName,
    sessionActor: options.sessionActor,
  });

  if (!listed.ok) {
    throw new Error(listed.message || listed.error || "Could not load company users.");
  }

  const mapped = listed.users.map((row) => ({
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
    masterSheetId,
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

export { listActiveCompanyMembers as listActiveUsers };

/**
 * Canonical active-users sync — resolve folder/workbook, read Users tab, rebuild cache.
 * Used by GET /users, schedule assignees, company members, and Godmode People.
 */
export async function syncAndListActiveUsers(auth, deps, companyContext = {}) {
  return listActiveCompanyMembers(auth, deps, companyContext);
}

/**
 * Godmode — read Users tab ACTIVE rows and replace server cache (remove cache-only users).
 */
export async function rebuildUsersFromSheet(auth, deps, companyContext = {}) {
  const listed = await syncAndListActiveUsers(auth, deps, companyContext);
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
