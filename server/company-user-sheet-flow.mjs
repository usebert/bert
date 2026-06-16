/**
 * Users tab as sole source of truth for active company users.
 * Invite completion, member listing, and login flow through these helpers.
 */
import {
  defaultAccessLevelForRole,
  findCompanyUsersTabRow,
  migrateUsersTabColumns,
  normalizeUserStatus,
  readCompanyUsersTabRecord,
  sanitizeUserRecordForClient,
  verifyCompanyUserPassword,
} from "./company-users.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { listableProfilesFromUsersTabRecords, activeProfilesFromUsersTabRecords } from "./users-tab-profiles.mjs";
import { inviteAccessLevelForRole } from "../shared/schedule-assignees.mjs";

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveCompanyUsersDeps(deps) {
  if (typeof deps?.getCompanyUsersDeps === "function") {
    return deps.getCompanyUsersDeps();
  }
  return deps || {};
}

async function readUsersTabRecords(auth, masterSheetId, deps, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyName = String(companyContext.companyName || "").trim();
  const enrichedDeps = {
    ...deps,
    resolveUsersTab: deps.resolveUsersTab || resolveUsersTab,
    migrateUsersTabColumns: deps.migrateUsersTabColumns || migrateUsersTabColumns,
  };

  if (
    !deps.skipUsersTabColumnMigration &&
    typeof enrichedDeps.migrateUsersTabColumns === "function" &&
    enrichedDeps.getTabValues
  ) {
    await enrichedDeps
      .migrateUsersTabColumns(auth, masterSheetId, enrichedDeps, {
        companyContext: {
          companyFolderId,
          companyId: companyFolderId,
          companyName,
          masterSheetId,
        },
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
 * Read Users tab rows and return ACTIVE company profiles plus sheet row counts for diagnostics.
 */
export async function readActiveUsersFromSheetWithStats(auth, deps, companyContext = {}) {
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyName = String(companyContext.companyName || "").trim();
  if (!auth) {
    const error = new Error("Google auth is required to read company users.");
    error.code = "USERS_TAB_READ_FAILED";
    error.reasonCode = "USERS_TAB_READ_FAILED";
    throw error;
  }
  if (!companyFolderId || !masterSheetId) {
    const error = new Error("companyFolderId and masterSheetId are required to read company users.");
    error.code = "COMPANY_CONTEXT_FAILED";
    error.reasonCode = "COMPANY_CONTEXT_FAILED";
    throw error;
  }

  const companyCtx = { companyFolderId, companyId: companyFolderId, companyName, masterSheetId };
  const records = await readUsersTabRecords(auth, masterSheetId, deps, companyCtx);
  const result = activeProfilesFromUsersTabRecords(records, companyCtx);

  if (result.totalSheetRows >= 2 && result.members.length < result.totalSheetRows) {
    console.info(
      "[company-members]",
      JSON.stringify({
        masterSheetId,
        companyFolderId,
        dataSource: "users_tab",
        readMode: "profile_filter",
        totalRowsRead: result.totalSheetRows,
        profilesReturned: result.members.length,
        activeOnlyCount: result.activeOnlyCount,
      }),
    );
  }

  return result;
}

/**
 * ACTIVE users only from the company workbook Users tab — no invites, cache, or session merge.
 */
export async function listActiveUsersFromSheet(auth, deps, companyContext = {}) {
  const result = await readActiveUsersFromSheetWithStats(auth, deps, companyContext);
  return result.members;
}

/**
 * Login eligibility — ACTIVE Users tab row with verifiable PasswordHash only.
 */
export async function canLoginCompanyUser(auth, email, password, companyContext = {}, deps = {}) {
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const emailNorm = safeLower(email);
  const pwd = String(password || "");
  if (!auth || !masterSheetId || !emailNorm || !pwd) {
    return { ok: false, reason: "missing_fields" };
  }

  const userDeps = resolveCompanyUsersDeps(deps);
  const companyUsersCache = userDeps.companyUsersCache;
  if (typeof userDeps.migrateUsersTabColumns === "function") {
    await userDeps.migrateUsersTabColumns(auth, masterSheetId, userDeps).catch(() => null);
  }

  const row = await findCompanyUsersTabRow(auth, masterSheetId, emailNorm, userDeps).catch(() => null);
  if (!row) {
    const cacheHit =
      companyUsersCache &&
      ((companyFolderId &&
        typeof companyUsersCache.isUserInCache === "function" &&
        companyUsersCache.isUserInCache(companyFolderId, emailNorm)) ||
        (typeof companyUsersCache.isUserInCacheByMasterSheet === "function" &&
          companyUsersCache.isUserInCacheByMasterSheet(masterSheetId, emailNorm)));
    if (cacheHit) {
      const resolvedFolderId =
        companyFolderId ||
        (typeof companyUsersCache.findCompanyFolderIdByMasterSheet === "function"
          ? companyUsersCache.findCompanyFolderIdByMasterSheet(masterSheetId)
          : "");
      if (typeof companyUsersCache.rebuildFromSheet === "function") {
        await companyUsersCache
          .rebuildFromSheet(auth, deps, {
            companyFolderId: resolvedFolderId,
            masterSheetId,
          })
          .catch(() => null);
      }
      return { ok: false, reason: "cache_only" };
    }
    return { ok: false, reason: "user_not_found" };
  }

  const login = await verifyCompanyUserPassword(auth, masterSheetId, emailNorm, pwd, userDeps);
  if (!login.ok) {
    return { ok: false, reason: login.reason || "invalid_credentials", status: login.status };
  }

  const rec =
    login.rec || (await readCompanyUsersTabRecord(auth, masterSheetId, emailNorm, userDeps));
  if (!rec || rec.status !== "ACTIVE") {
    return { ok: false, reason: "inactive", status: rec?.status };
  }

  return { ok: true, user: sanitizeUserRecordForClient(rec), migrated: Boolean(login.migrated) };
}

/**
 * Invite acceptance — write ACTIVE Users tab row (preserve CreatedAt), then verify login-ready.
 */
export async function completeInviteToUserRow(auth, invite, formData, deps) {
  const { writeCompanyUsers } = deps;
  if (typeof writeCompanyUsers !== "function") {
    return { ok: false, reason: "write_unavailable" };
  }

  const email = safeLower(invite?.email);
  const masterSheetId = String(invite?.masterSheetId || "").trim();
  const companyFolderId = String(invite?.companyFolderId || invite?.companyId || "").trim();
  const fullName = String(formData?.fullName || formData?.name || "").trim();
  const password = String(formData?.password || "");
  const role = String(invite?.role || "").trim();
  if (!email || !masterSheetId || !companyFolderId || !fullName || password.length < 8 || !role) {
    return { ok: false, reason: "missing_fields" };
  }

  const userDeps = resolveCompanyUsersDeps(deps);
  const existing = await findCompanyUsersTabRow(auth, masterSheetId, email, userDeps).catch(() => null);
  const createdAt =
    String(existing?.createdAt || invite?.createdAt || invite?.sentAt || "").trim() ||
    new Date().toISOString();
  const userId =
    String(existing?.userId || "").trim() ||
    `app-${email.replace(/[^a-z0-9]+/gi, "-")}-${role.toLowerCase()}`;
  const accessLevel =
    String(invite?.accessLevel || "").trim() ||
    defaultAccessLevelForRole(role) ||
    inviteAccessLevelForRole(role);

  const usersResult = await writeCompanyUsers(auth, masterSheetId, companyFolderId, [
    {
      id: userId,
      email,
      role,
      name: fullName,
      password,
      accessLevel,
      companyAreas: String(invite?.companyAreas || "").trim(),
      companyName: String(invite?.companyName || "").trim(),
      invitedBy: invite?.invitedBy || "",
      senderEmail: "",
      sentAt: createdAt,
      CreatedAt: createdAt,
      updatedAt: new Date().toISOString(),
      status: "ACTIVE",
      syncStatus: "Synced",
    },
  ]);

  if (!Number(usersResult?.written || 0)) {
    return { ok: false, reason: "write_failed" };
  }

  const login = await verifyCompanyUserPassword(auth, masterSheetId, email, password, userDeps);
  if (!login.ok) {
    return { ok: false, reason: login.reason || "login_not_ready" };
  }
  const rec =
    login.rec ||
    (await readCompanyUsersTabRecord(auth, masterSheetId, email, userDeps).catch(() => null));
  if (!rec || normalizeUserStatus(rec.status) !== "ACTIVE") {
    return { ok: false, reason: "inactive", status: rec?.status };
  }

  return { ok: true, user: sanitizeUserRecordForClient(rec), migrated: Boolean(login.migrated) };
}

/** @deprecated Use mapUsersTabProfileMember from users-tab-profiles.mjs */
export { mapUsersTabProfileMember as mapCompanyProfileMember } from "./users-tab-profiles.mjs";

/** @deprecated Use mapUsersTabProfileMember from users-tab-profiles.mjs */
export { mapUsersTabProfileMember as mapActiveCompanyMember } from "./users-tab-profiles.mjs";
