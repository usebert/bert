/**
 * Godmode-only company user reset — clears Users tab (after backup), invites, cache, auth index, sessions.
 * Preserves company folders, workbooks, schedules, operational data, and platform Godmode auth.
 */
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import { readCompanyUsers, resolveUsersTab } from "./users-tab-reader.mjs";
import { USERS_TAB_MINIMUM_HEADERS } from "./users-tab-constants.mjs";
import { readCanonicalCompanyWorkspaceRegistryMap } from "./company-workspace-registry.mjs";

export const RESET_USERS_CONFIRM_PHRASE = "RESET USERS";
export const RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE = "RESET ALL COMPANY USERS";

export const USER_RESET_WARNING =
  "This will remove all company users, pending invites, stale user cache, auth-index entries, and active sessions for this company. It will not delete company folders, schedules, reports, checks, or evidence.";

export const USER_RESET_ALL_WARNING =
  "This will remove all company users, invites, user caches, auth-index entries, and company user sessions across every company. Platform Godmode login is preserved. Company folders, workbooks, schedules, reports, checks, and evidence are not deleted.";

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function formatUsersBackupTabName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `Users_Backup_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function findSheetByTitle(workbook, tabName) {
  const sheets = workbook?.data?.sheets || workbook?.sheets || [];
  return (
    sheets.find((sheet) => String(sheet.properties?.title || sheet.title || "").trim() === String(tabName).trim()) ||
    null
  );
}

async function clearUsersTabToHeaders(deps, auth, spreadsheetId, tabTitle, headers) {
  const { ensureColumns, withSheetsQuotaRetry, google } = deps;
  const columns = Array.isArray(headers) && headers.length ? headers : USERS_TAB_MINIMUM_HEADERS;
  await ensureColumns(auth, spreadsheetId, tabTitle, columns);
  const sheets = google.sheets({ version: "v4", auth });
  const lastCol = String.fromCharCode(64 + Math.max(columns.length, 1));
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tabTitle}!A:${lastCol}`,
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabTitle}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [columns] },
    }),
  );
}

async function backupUsersTab(auth, deps, spreadsheetId, tabTitle) {
  const { getWorkbook, withSheetsQuotaRetry, google } = deps;
  const workbook = await getWorkbook(auth, spreadsheetId);
  const sheet = findSheetByTitle(workbook, tabTitle);
  if (!sheet?.properties?.sheetId && sheet?.sheetId == null) {
    return { backupTabName: "", usersBackedUp: 0 };
  }
  const sourceSheetId = sheet.properties?.sheetId ?? sheet.sheetId;
  const backupTabName = formatUsersBackupTabName();
  const sheets = google.sheets({ version: "v4", auth });
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId,
              newSheetName: backupTabName.slice(0, 100),
            },
          },
        ],
      },
    }),
  );
  const readResult = await readCompanyUsers(auth, spreadsheetId, deps, {
    resolved: { spreadsheetId, tabTitle },
  }).catch(() => ({ records: [], rowCount: 0 }));
  return {
    backupTabName,
    usersBackedUp: Number(readResult.rowCount || readResult.records?.length || 0),
  };
}

function inviteMatchesCompany(record, { companyFolderId, masterSheetId }) {
  const sheetId = String(record?.masterSheetId || record?.provisionMasterSheetId || "").trim();
  const folderId = String(record?.companyFolderId || record?.companyId || record?.provisionDriveFolderId || "").trim();
  const matchesSheet = sheetId && masterSheetId && sheetId === masterSheetId;
  const matchesFolder = folderId && companyFolderId && folderId === companyFolderId;
  return matchesSheet || matchesFolder;
}

function purgeAllCompanyUserInvitesForCompany({ readInviteStore, writeInviteStore }, { companyFolderId, masterSheetId }) {
  const store = readInviteStore();
  let invitesRemoved = 0;
  for (const [id, record] of Object.entries(store)) {
    if (record?.kind !== "company_user") {
      continue;
    }
    if (inviteMatchesCompany(record, { companyFolderId, masterSheetId })) {
      delete store[id];
      invitesRemoved += 1;
    }
  }
  writeInviteStore(store);
  return invitesRemoved;
}

function purgeAllCompanyUserInvites({ readInviteStore, writeInviteStore }) {
  const store = readInviteStore();
  let invitesRemoved = 0;
  for (const [id, record] of Object.entries(store)) {
    if (record?.kind === "company_user") {
      delete store[id];
      invitesRemoved += 1;
    }
  }
  writeInviteStore(store);
  return invitesRemoved;
}

function collectRemovedUserEmails(records = []) {
  return [...new Set(records.map((row) => normalizeEmail(row?.email || row?.Email)).filter(Boolean))].filter(
    (email) => !isPlatformOwnerEmail(email, process.env),
  );
}

async function resolveResetTarget(auth, deps, { companyFolderId, masterSheetIdHint, companyName }) {
  const folderId = String(companyFolderId || "").trim();
  if (!folderId) {
    return { ok: false, httpStatus: 400, error: "companyFolderId is required." };
  }
  let masterSheetId = String(masterSheetIdHint || "").trim();
  let resolvedCompanyName = String(companyName || "").trim();
  if (!masterSheetId || !resolvedCompanyName) {
    const folderResolved = await resolveCompanyFromFolder(
      auth,
      { google: deps.google, ...deps.registryDeps },
      folderId,
      { companyName: resolvedCompanyName, ensureStructure: false },
    );
    if (folderResolved?.ok) {
      masterSheetId = masterSheetId || String(folderResolved.masterSheetId || "").trim();
      resolvedCompanyName = resolvedCompanyName || String(folderResolved.companyName || "").trim();
    }
  }
  if (!masterSheetId) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Company master spreadsheet ID is required to reset users.",
    };
  }
  return {
    ok: true,
    companyFolderId: folderId,
    companyId: folderId,
    masterSheetId,
    companyName: resolvedCompanyName,
  };
}

export async function resetCompanyUsers(deps, auth, input = {}) {
  const {
    readInviteStore,
    writeInviteStore,
    companyUsersCache,
    authIndex,
    sessionRevocation,
    getWorkbook,
    ensureColumns,
    withSheetsQuotaRetry,
    google,
    registryDeps,
  } = deps;

  const target = await resolveResetTarget(auth, deps, input);
  if (!target.ok) {
    return target;
  }

  const { companyFolderId, masterSheetId, companyName } = target;
  const usersDeps = {
    google,
    withSheetsQuotaRetry,
    ensureColumns,
    getWorkbook,
    readCompanyUsers,
    resolveUsersTab,
  };

  const resolvedTab = await resolveUsersTab(auth, masterSheetId, usersDeps, { createIfMissing: false });
  const tabTitle = resolvedTab.tabTitle || "Users";
  const existingUsers = await readCompanyUsers(auth, masterSheetId, usersDeps, { resolved: resolvedTab }).catch(
    () => ({ records: [], rowCount: 0 }),
  );
  const removedEmails = collectRemovedUserEmails(existingUsers.records || []);
  const usersRemoved = Number(existingUsers.rowCount || existingUsers.records?.length || 0);

  const backup = await backupUsersTab(auth, { ...usersDeps, getWorkbook, withSheetsQuotaRetry, google }, masterSheetId, tabTitle);
  await clearUsersTabToHeaders(
    { ensureColumns, withSheetsQuotaRetry, google },
    auth,
    masterSheetId,
    tabTitle,
    USERS_TAB_MINIMUM_HEADERS,
  );

  const invitesRemoved = purgeAllCompanyUserInvitesForCompany(
    { readInviteStore, writeInviteStore },
    { companyFolderId, masterSheetId },
  );

  const cacheResult =
    typeof companyUsersCache?.clearCompanyUsersCache === "function"
      ? companyUsersCache.clearCompanyUsersCache(companyFolderId)
      : { cacheEntriesRemoved: 0 };

  const authIndexResult =
    typeof authIndex?.clearCompanyAuthIndexEntries === "function"
      ? authIndex.clearCompanyAuthIndexEntries({ companyFolderId, masterSheetId })
      : { authIndexEntriesRemoved: 0 };

  const sessionResult =
    typeof sessionRevocation?.revokeCompanyUserSessions === "function"
      ? sessionRevocation.revokeCompanyUserSessions({
          companyFolderId,
          masterSheetId,
          emails: removedEmails.length ? removedEmails : authIndexResult.removedEmails || [],
        })
      : { sessionsInvalidated: removedEmails.length };

  console.log("[company-user-reset] completed", {
    companyFolderId,
    masterSheetIdPrefix: masterSheetId.slice(0, 8),
    usersRemoved,
    invitesRemoved,
    backupTabName: backup.backupTabName,
  });

  return {
    ok: true,
    companyId: companyFolderId,
    companyFolderId,
    companyName,
    masterSheetId,
    usersBackedUp: usersRemoved,
    usersRemoved,
    invitesRemoved,
    cacheEntriesRemoved: cacheResult.cacheEntriesRemoved ?? 0,
    authIndexEntriesRemoved: authIndexResult.authIndexEntriesRemoved ?? 0,
    sessionsInvalidated: sessionResult.sessionsInvalidated ?? removedEmails.length,
    backupTabName: backup.backupTabName,
    preservedOperationalData: true,
    godmodePreserved: true,
  };
}

export async function resetAllCompanyUsers(deps, auth) {
  const registryMap = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps.registryDeps || deps).catch(
    () => ({ map: new Map() }),
  );
  const companies = registryMap?.map instanceof Map ? [...registryMap.map.values()] : [];
  const reports = [];
  let totals = {
    usersBackedUp: 0,
    usersRemoved: 0,
    invitesRemoved: 0,
    cacheEntriesRemoved: 0,
    authIndexEntriesRemoved: 0,
    sessionsInvalidated: 0,
    companiesProcessed: 0,
  };

  for (const record of companies) {
    const companyFolderId = String(record?.companyFolderId || record?.companyId || "").trim();
    const masterSheetId = String(record?.masterSheetId || "").trim();
    if (!companyFolderId || !masterSheetId) {
      continue;
    }
    const result = await resetCompanyUsers(deps, auth, {
      companyFolderId,
      masterSheetId,
      companyName: String(record?.companyName || "").trim(),
    });
    if (!result.ok) {
      reports.push({
        companyFolderId,
        ok: false,
        error: result.error || "Reset failed.",
      });
      continue;
    }
    totals.companiesProcessed += 1;
    totals.usersBackedUp += result.usersBackedUp || 0;
    totals.usersRemoved += result.usersRemoved || 0;
    totals.invitesRemoved += result.invitesRemoved || 0;
    totals.cacheEntriesRemoved += result.cacheEntriesRemoved || 0;
    totals.authIndexEntriesRemoved += result.authIndexEntriesRemoved || 0;
    totals.sessionsInvalidated += result.sessionsInvalidated || 0;
    reports.push({
      companyFolderId,
      companyName: result.companyName,
      ok: true,
      backupTabName: result.backupTabName,
      usersRemoved: result.usersRemoved,
    });
  }

  if (typeof deps.companyUsersCache?.clearAllCompanyUsersCache === "function") {
    const cacheSweep = deps.companyUsersCache.clearAllCompanyUsersCache();
    totals.cacheEntriesRemoved = Math.max(totals.cacheEntriesRemoved, cacheSweep.cacheEntriesRemoved || 0);
  }
  if (typeof deps.authIndex?.clearAllCompanyAuthIndexEntries === "function") {
    const authSweep = deps.authIndex.clearAllCompanyAuthIndexEntries();
    totals.authIndexEntriesRemoved = Math.max(totals.authIndexEntriesRemoved, authSweep.authIndexEntriesRemoved || 0);
  }
  totals.invitesRemoved = Math.max(totals.invitesRemoved, purgeAllCompanyUserInvites(deps));

  return {
    ok: true,
    ...totals,
    companies: reports,
    preservedOperationalData: true,
    godmodePreserved: true,
  };
}

export function installCompanyUserResetRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
  } = deps;

  app.post(
    "/api/godmode/companies/:companyId/reset-users",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({
          ok: false,
          error: "Google connection required to reset company users.",
        });
      }

      const companyFolderId = String(req.params?.companyId || req.body?.companyFolderId || "").trim();
      const confirmPhrase = String(req.body?.confirmPhrase || req.body?.confirmation || "").trim();
      const masterSheetId = String(req.body?.masterSheetId || "").trim();
      const companyName = String(req.body?.companyName || "").trim();

      if (!companyFolderId) {
        return res.status(400).json({ ok: false, error: "Company folder ID is required." });
      }
      if (confirmPhrase !== RESET_USERS_CONFIRM_PHRASE) {
        return res.status(400).json({
          ok: false,
          blocker: "confirm_required",
          error: `Type ${RESET_USERS_CONFIRM_PHRASE} to confirm this reset.`,
        });
      }

      try {
        const result = await resetCompanyUsers(deps, authed, {
          companyFolderId,
          masterSheetId,
          companyName,
        });
        if (!result.ok) {
          return res.status(result.httpStatus || 502).json(result);
        }
        return res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[company-user-reset] reset-users failed:", message);
        return res.status(500).json({
          ok: false,
          error: "Company user reset failed.",
          technicalError: message,
        });
      }
    },
  );

  app.post(
    "/api/godmode/reset-all-company-users",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      const authed = getAuthedClient();
      if (!envConfigured() || !authed) {
        return res.status(401).json({
          ok: false,
          error: "Google connection required to reset all company users.",
        });
      }

      const confirmPhrase = String(req.body?.confirmPhrase || req.body?.confirmation || "").trim();
      if (confirmPhrase !== RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE) {
        return res.status(400).json({
          ok: false,
          blocker: "confirm_required",
          error: `Type ${RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE} to confirm this reset.`,
        });
      }

      try {
        const result = await resetAllCompanyUsers(deps, authed);
        return res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[company-user-reset] reset-all-company-users failed:", message);
        return res.status(500).json({
          ok: false,
          error: "Reset all company users failed.",
          technicalError: message,
        });
      }
    },
  );
}
