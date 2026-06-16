/**
 * Company workbook Users tab reads — never expose PasswordHash to clients.
 */
import {
  parseRoleForClient,
  buildAvailableScheduleAssigneesFromUsers,
  isExcludedCompanyProfileStatus,
} from "../shared/schedule-assignees.mjs";
import { buildCompanyFolderUrl } from "../shared/company-folder-links.mjs";
import {
  parseCompanyAreas,
  sanitizeUsersTabRecords,
  migrateUsersTabColumns,
  normalizeUserStatus,
  updateCompanyUserRecord,
} from "./company-users.mjs";
import {
  backfillRowCompanyFields,
  isWorkbookScopedCompanyContext,
  pickRowCompanyFolderId,
  pickRowCompanyId,
  pickRowCompanyName,
  resolvedProfileCompanyFolderId,
  rowPassesCompanyProfileContext,
} from "./users-tab-schema.mjs";
import { readCompanyUsers, resolveUsersTab, repairUsersTabSchema } from "./users-tab-reader.mjs";
import { resolveCompanyContextFields } from "./company-context-service.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
import {
  listCompanyProfiles as listCompanyProfilesFromFoundation,
  readUsersTabProfiles,
  rebuildUsersFromSheet as rebuildUsersFromSheetFoundation,
} from "./company-users-foundation.mjs";
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
    companyFolderUrl: buildCompanyFolderUrl(companyFolderId || companyId) || undefined,
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
  if (!isWorkbookScopedCompanyContext(companyContext) && !rowPassesCompanyProfileContext(row, companyContext)) {
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

async function resolveMasterSheetFromFolder(auth, deps, companyFolderId, companyName) {
  try {
    const resolved = await resolveCompanyFromFolder(auth, deps, companyFolderId, {
      companyName,
      ensureStructure: false,
      ensureTabsSync: false,
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
 * Delegates to company-users-foundation listCompanyProfiles (single sheet read path).
 */
export async function listActiveCompanyMembers(auth, deps, companyContext = {}) {
  return listCompanyProfilesFromFoundation(auth, deps, companyContext);
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
  return rebuildUsersFromSheetFoundation(auth, deps, companyContext);
}

/** userService API — read raw Users tab rows (sanitized, no PasswordHash in API responses). */
export async function readUsersTab(auth, deps, companyContext = {}) {
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const readResult = await readCompanyUsers(auth, masterSheetId, deps, {
    companyFolderId,
    companyId: companyFolderId,
    companyName: String(companyContext.companyName || "").trim(),
    masterSheetId,
  });
  if (!readResult?.ok) {
    return readResult;
  }
  return {
    ok: true,
    records: sanitizeUsersTabRecords(readResult.records || []),
    rowCount: readResult.rowCount ?? readResult.records?.length ?? 0,
    masterSheetId,
    companyFolderId,
  };
}

/** userService API — write/update a Users tab row by email. */
export { updateCompanyUserRecord as writeUserRow };

/** userService API — repair shifted Users tab schema and backfill company columns. */
export { repairUsersTabSchema };

/** userService API — rebuild server cache from sheet after successful read. */
export { rebuildUsersFromSheet as rebuildUserCacheFromSheet };
