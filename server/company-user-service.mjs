/**
 * Company workbook Users tab reads — never expose PasswordHash to clients.
 */
import {
  parseRoleForClient,
  buildAvailableScheduleAssigneesFromUsers,
} from "../shared/schedule-assignees.mjs";
import {
  parseCompanyAreas,
  sanitizeUsersTabRecords,
  migrateUsersTabColumns,
  normalizeUserStatus,
} from "./company-users.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import {
  listActiveUsersFromSheet,
  readActiveUsersFromSheetWithStats,
} from "./company-user-sheet-flow.mjs";

const COMPANY_USERS_LOAD_FAILED = "COMPANY_USERS_LOAD_FAILED";

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
    totalSheetRows: typeof base.totalSheetRows === "number" ? base.totalSheetRows : undefined,
    activeSheetUsers: typeof base.activeSheetUsers === "number" ? base.activeSheetUsers : undefined,
    cacheUsersBefore: typeof base.cacheUsersBefore === "number" ? base.cacheUsersBefore : undefined,
    cacheOnlyUsersRemoved:
      typeof base.cacheOnlyUsersRemoved === "number" ? base.cacheOnlyUsersRemoved : undefined,
  };
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
  return {
    ok: false,
    code: COMPANY_USERS_LOAD_FAILED,
    reasonCode,
    message,
    error: message,
    httpStatus: extra.httpStatus || 400,
    diagnostics: buildDiagnostics(diagnostics),
    technicalError: extra.technicalError,
  };
}

function classifyReadError(error, payload) {
  const message = String(error instanceof Error ? error.message : error || "").trim();
  const lower = message.toLowerCase();
  const code = String(error?.code || payload?.code || "").trim();
  const upstreamStatus = Number(error?.response?.status || error?.status || payload?.status || 0);

  if (
    code === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
    code === "GOOGLE_PERMISSION_DENIED" ||
    upstreamStatus === 403 ||
    lower.includes("permission")
  ) {
    return {
      reasonCode: "GOOGLE_SHEETS_PERMISSION_DENIED",
      failedStep: "read_users_tab",
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
      failedStep: "connect_google",
      upstreamStatus: upstreamStatus || 401,
      upstreamMessage: message,
    };
  }
  if (lower.includes("users tab is missing") || lower.includes("users tab")) {
    return {
      reasonCode: "USERS_TAB_MISSING",
      failedStep: "read_users_tab",
      upstreamStatus: upstreamStatus || undefined,
      upstreamMessage: message,
    };
  }
  return {
    reasonCode: "USERS_TAB_READ_FAILED",
    failedStep: "read_users_tab",
    upstreamStatus: upstreamStatus || undefined,
    upstreamMessage: message || String(payload?.error || ""),
  };
}


function mapUsersTabRow(row, companyFolderId = "") {
  const companyAreasRaw = pickRowValue(row, "CompanyAreas", "Company Areas", "companyAreas");
  return {
    email: pickRowValue(row, "Email", "email"),
    name: pickRowValue(row, "Name", "name", "Full Name"),
    role: pickRowValue(row, "Role", "role"),
    accessLevel: pickRowValue(row, "AccessLevel", "Access Level", "accessLevel"),
    status: pickRowValue(row, "Status", "status"),
    companyId: companyFolderId || pickRowValue(row, "Company ID", "CompanyId", "companyId"),
    companyFolderId,
    companyAreas: parseCompanyAreas(companyAreasRaw),
    companyAreasRaw,
  };
}

function mapActiveCompanyMember(row, companyFolderId) {
  const email = normalizeEmail(row.email || row.Email);
  if (!email) {
    return null;
  }
  const status = normalizeUserStatus(row.status || row.Status);
  if (status !== "ACTIVE") {
    return null;
  }
  const companyAreas = Array.isArray(row.companyAreas)
    ? row.companyAreas
    : parseCompanyAreas(row.companyAreasRaw || row.CompanyAreas || row.companyAreas || "");
  return {
    email,
    name: String(row.name || row.Name || email.split("@")[0] || email).trim() || email,
    role: parseRoleForClient(row.role || row.Role || row.accessLevel || row.AccessLevel || "User"),
    accessLevel: String(row.accessLevel || row.AccessLevel || "").trim(),
    status: "ACTIVE",
    companyId: companyFolderId,
    companyFolderId,
    companyAreas,
    companyAreasRaw: row.companyAreasRaw || String(row.CompanyAreas || ""),
  };
}

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
  return sanitizeUsersTabRecords(readResult.records.map((row) => mapUsersTabRow(row, companyFolderId)));
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
        return { ok: false, reasonCode: "COMPANY_NOT_FOUND", resolved };
      }
      return { ok: false, reasonCode: "COMPANY_NOT_FOUND", resolved };
    }
    return {
      ok: true,
      masterSheetId: String(resolved.masterSheetId || "").trim(),
      companyName: String(resolved.companyName || companyName || "").trim(),
    };
  } catch (error) {
    return {
      ok: false,
      reasonCode: "COMPANY_NOT_FOUND",
      error,
    };
  }
}

/**
 * Canonical active company members from the Users tab — all roles, companyId = companyFolderId.
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
      { httpStatus: 401 },
    );
  }

  if (!companyFolderId) {
    return buildFailure(
      "MISSING_COMPANY_CONTEXT",
      "Company workspace is not selected.",
      { ...baseDiagnostics(), failedStep: "select_company" },
      { httpStatus: 404 },
    );
  }

  if (!looksLikeDriveId(companyFolderId)) {
    return buildFailure(
      "INVALID_COMPANY_ID",
      "Company workspace id is invalid.",
      { ...baseDiagnostics(), failedStep: "select_company" },
      { httpStatus: 400 },
    );
  }

  let registryRecord = null;
  if (companyFolderId) {
    registryRecord = await resolveCompanyById(auth, deps, companyFolderId).catch(() => null);
  }

  if (registryRecord) {
    masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
    companyName =
      companyName ||
      String(registryRecord.companyName || registryRecord.name || registryRecord.companyFolderName || "").trim();
  }

  if (!masterSheetId) {
    const folderResolved = await resolveMasterSheetFromFolder(auth, deps, companyFolderId, companyName, masterSheetId);
    if (folderResolved.ok) {
      masterSheetId = folderResolved.masterSheetId;
      companyName = folderResolved.companyName || companyName;
    } else {
      const reasonCode = folderResolved.reasonCode || "MISSING_MASTER_SHEET_ID";
      return buildFailure(
        reasonCode,
        reasonCode === "COMPANY_NOT_FOUND"
          ? "Company workspace could not be found."
          : "Company master sheet is not configured.",
        {
          ...baseDiagnostics(),
          companyName,
          failedStep: reasonCode === "COMPANY_NOT_FOUND" ? "resolve_company_folder" : "link_master_sheet",
          upstreamMessage:
            folderResolved.resolved?.userMessage ||
            (folderResolved.error instanceof Error ? folderResolved.error.message : String(folderResolved.error || "")),
        },
        {
          httpStatus: reasonCode === "COMPANY_NOT_FOUND" ? 404 : 404,
          technicalError: isDevDiagnosticsEnabled()
            ? folderResolved.resolved?.userMessage || String(folderResolved.error || "")
            : undefined,
        },
      );
    }
  }

  const resolvedCompanyId = companyFolderId;

  const loadActiveUsersForSheet = async (sheetId) =>
    readActiveUsersFromSheetWithStats(auth, deps, {
      masterSheetId: sheetId,
      companyFolderId: resolvedCompanyId,
      companyId: resolvedCompanyId,
    });

  try {
    let sheetResult;
    try {
      sheetResult = await loadActiveUsersForSheet(masterSheetId);
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
            sheetResult = await loadActiveUsersForSheet(masterSheetId);
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

    const members = Array.isArray(sheetResult?.members) ? sheetResult.members : [];
    const cacheStats = reconcileCompanyUsersCache(
      resolvedCompanyId,
      members,
      { masterSheetId },
      deps,
    );

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      companyName: companyName || undefined,
      masterSheetId,
      users: members,
      activeCount: members.length,
      diagnostics: buildDiagnostics({
        companyId: resolvedCompanyId,
        companyFolderId: resolvedCompanyId,
        companyName,
        masterSheetId,
        signedInEmail,
        signedInRole,
        dataSource: "users_tab",
        durationMs: Date.now() - startedAt,
        totalSheetRows: sheetResult?.totalSheetRows ?? members.length,
        activeSheetUsers: sheetResult?.activeSheetUsers ?? members.length,
        cacheUsersBefore: cacheStats.cacheUsersBefore,
        cacheOnlyUsersRemoved: cacheStats.cacheOnlyUsersRemoved,
      }),
      cacheReconciliation: cacheStats,
    };
  } catch (error) {
    const classified = classifyReadError(error);
    const technicalError = error instanceof Error ? error.message : String(error);
    const failure = buildFailure(
      classified.reasonCode,
      "Could not load users from the company workbook.",
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
      },
      {
        httpStatus:
          classified.reasonCode === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
          classified.reasonCode === "PERMISSION_DENIED"
            ? 403
            : 502,
        technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      },
    );

    return failure;
  }
}

export { listActiveUsersFromSheet };

export async function getAssignableUsers(auth, masterSheetId, deps, options = {}) {
  const companyId = String(options.companyId || options.companyFolderId || "").trim();
  const selectedArea = String(options.selectedArea || "").trim();
  const includeDiagnostics = options.includeDiagnostics === true;

  const listed = await listActiveCompanyMembers(auth, deps, {
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
 * Godmode — read Users tab ACTIVE rows and replace server cache (remove cache-only users).
 */
export async function rebuildUsersFromSheet(auth, deps, companyContext = {}) {
  const listed = await listActiveCompanyMembers(auth, deps, companyContext);
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
