/**
 * Company schedule service — folder-first Schedules tab I/O, assignees, My Checks.
 */
import { resolveCompanyById } from "./company-registry-service.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import {
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";
import {
  companyScheduleRecordsFromSheetPayload,
  findCompanyScheduleById,
  mergeCompanyScheduleLists,
  describeMergedScheduleDataSource,
  parseCompanyScheduleListFromRecords,
  scheduleTabRecordsPreferCanonical,
} from "../shared/schedule-list.mjs";
import {
  LEGACY_SCHEDULE_TAB,
  SCHEDULES_TAB,
  SCHEDULES_TAB_COLUMNS,
  SCHEDULE_SAVE_FAILED_CODE,
  SCHEDULE_SAVE_FAILED_MESSAGE,
  assignedUsersFromSchedule,
  buildSchedulesTabRows,
} from "../shared/schedule-save.mjs";
import { enrichAssignedSchedulesWithCompletion } from "../shared/assigned-check-completion.mjs";
import { getScheduleAssignedEmails, isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";
import { listAuditResults } from "./completion-service.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";
import { readActiveUsersFromSheetWithStats } from "./company-user-sheet-flow.mjs";
import { syncCompanyUsersCache } from "./company-users-foundation.mjs";
import { listActiveUsers as listActiveUsersFromUserService } from "./user-service.mjs";
import {
  readTabRecords as workbookReadTabRecords,
  getTabValues as workbookGetTabValues,
  ensureTabColumns as workbookEnsureTabColumns,
} from "./workbook-service.mjs";

/** Bumped when assigned-checks diagnostics shape or merge behaviour changes — verify in production via ?diagnostics=1. */
export const ASSIGNED_CHECKS_DIAGNOSTICS_VERSION = "canonical-legacy-merge-v2";

function resolveListActiveUsers(deps) {
  return typeof deps?.listActiveUsers === "function" ? deps.listActiveUsers : listActiveUsersFromUserService;
}

const SCHEDULER_ASSIGNEE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

function mapProfileRowForScheduleAssignees(row, resolvedCompanyId) {
  return {
    email: row.email,
    name: row.name,
    role: row.role,
    accessLevel: row.accessLevel,
    status: row.status,
    companyId: row.companyId || resolvedCompanyId,
    companyFolderId: row.companyFolderId || resolvedCompanyId,
    companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : [],
    companyAreasRaw: row.companyAreasRaw || "",
  };
}

async function loadSchedulerAssigneeProfiles(auth, deps, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyId = String(companyContext.companyId || companyFolderId).trim();
  let masterSheetId = String(companyContext.masterSheetId || "").trim();
  let companyName = String(companyContext.companyName || "").trim();

  if (companyFolderId && masterSheetId) {
    const cache = deps?.companyUsersCache;
    const cached = typeof cache?.getEntry === "function" ? cache.getEntry(companyFolderId) : null;
    const cacheMasterSheetId = String(cached?.masterSheetId || "").trim();
    const cacheAgeMs =
      typeof cached?.rebuiltAt === "number" && cached.rebuiltAt > 0 ? Date.now() - cached.rebuiltAt : Number.POSITIVE_INFINITY;
    const cacheMatches =
      cached &&
      Array.isArray(cached.users) &&
      cached.users.length > 0 &&
      (!cacheMasterSheetId || cacheMasterSheetId === masterSheetId) &&
      cacheAgeMs <= SCHEDULER_ASSIGNEE_CACHE_MAX_AGE_MS;

    if (cacheMatches) {
      return {
        ok: true,
        users: cached.users,
        companyId,
        companyFolderId,
        companyName,
        masterSheetId: cacheMasterSheetId || masterSheetId,
        dataSource: `company-users-cache:${cacheMasterSheetId || masterSheetId}`,
        diagnostics: {
          dataSource: `company-users-cache:${cacheMasterSheetId || masterSheetId}`,
          cacheHit: true,
          totalUsersRead: cached.users.length,
          profilesReturned: cached.users.length,
          activeOnlyCount: cached.users.length,
        },
      };
    }

    const sheetResult = await readActiveUsersFromSheetWithStats(auth, deps, {
      companyFolderId,
      companyId: companyFolderId,
      companyName,
      masterSheetId,
    });
    const members = Array.isArray(sheetResult.members) ? sheetResult.members : [];
    syncCompanyUsersCache(deps, { companyFolderId, masterSheetId }, members);
    return {
      ok: true,
      users: members,
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      dataSource: `company-workbook-users:${masterSheetId}`,
      diagnostics: {
        dataSource: `company-workbook-users:${masterSheetId}`,
        totalUsersRead: sheetResult.totalSheetRows,
        profilesReturned: members.length,
        activeOnlyCount: sheetResult.activeOnlyCount,
      },
    };
  }

  const listActiveUsers = resolveListActiveUsers(deps);
  const listed = await listActiveUsers(auth, deps, {
    companyId,
    companyFolderId,
    masterSheetId,
    companyName,
    sessionActor: companyContext.sessionActor,
    includeDiagnostics: true,
  });
  if (!listed.ok) {
    return listed;
  }

  masterSheetId = String(listed.masterSheetId || masterSheetId).trim();
  companyName = String(listed.companyName || companyName).trim();
  const resolvedCompanyId = String(listed.companyFolderId || listed.companyId || companyFolderId).trim();

  return {
    ok: true,
    users: listed.users || [],
    companyId: resolvedCompanyId,
    companyFolderId: resolvedCompanyId,
    companyName,
    masterSheetId,
    dataSource: masterSheetId ? `company-workbook-users:${masterSheetId}` : "users_tab",
    diagnostics: listed.diagnostics,
  };
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveGetTabValues(deps) {
  const injected = deps?.getTabValues;
  if (typeof injected !== "function") {
    return workbookGetTabValues;
  }
  // server.mjs injects (auth, spreadsheetId, tabName, range?) without a workbook deps arg.
  if (injected.length < 4) {
    return async (auth, depsArg, spreadsheetId, tabName, range) =>
      injected(auth, spreadsheetId, tabName, range);
  }
  return injected;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return normalize(value);
}

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function sessionCompanyId(actor = {}) {
  return String(actor.companyId || actor.companyFolderId || "").trim();
}

function mapRowObjectToHeaders(headers, rowObject) {
  return headers.map((header) => String(rowObject?.[header] ?? "").trim());
}

export function canListCompanySchedules(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  if (!isCompanyInviteActor({ role: actor.role, accessLevel: actor.accessLevel })) {
    return false;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => String(entry || "").trim()).filter(Boolean),
  );
  return targets.has(sessionCompanyId(actor));
}

function readCachedMasterSheetId(deps, companyFolderId) {
  const cache = deps?.masterSheetCache;
  if (!cache || typeof cache.getEntry !== "function") {
    return "";
  }
  const entry = cache.getEntry(companyFolderId);
  return String(entry?.masterSheetId || "").trim();
}

/** Fast path — trust signed-in session company folder + master sheet (skip Drive folder resolve). */
export function buildSessionScheduleContext(input = {}, deps = {}) {
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const companyId = String(input.companyId || companyFolderId).trim();
  const cacheEntry =
    deps?.masterSheetCache && typeof deps.masterSheetCache.getEntry === "function"
      ? deps.masterSheetCache.getEntry(companyFolderId)
      : null;
  const alternateIds = [
    companyFolderId,
    companyId,
    cacheEntry?.registryCompanyId,
    cacheEntry?.companyRegistryId,
    cacheEntry?.rootFolderId,
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);

  if (!companyFolderId || !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  return {
    ok: true,
    companyId: companyFolderId,
    companyFolderId,
    companyName: String(input.companyName || cacheEntry?.companyName || "").trim(),
    masterSheetId,
    alternateIds,
    registryRecord: null,
    contextSource: "session",
  };
}

function hasUsableGoogleAuth(auth) {
  if (!auth) {
    return false;
  }
  if (typeof auth.getAccessToken === "function") {
    return true;
  }
  const credentials = auth.credentials;
  return Boolean(credentials?.access_token || credentials?.refresh_token);
}

const FOLDER_RESOLVE_OPTS = {
  ensureTabsSync: false,
  ensureStructure: false,
  createIfMissing: false,
  skipFolderPlacementCheck: true,
  preferFolderResolution: true,
};

function resolveFolderContextFn(deps) {
  return typeof deps?.resolveCompanyFromFolder === "function"
    ? deps.resolveCompanyFromFolder
    : resolveCompanyFromFolder;
}

export async function resolveCompanyScheduleContext(auth, deps, input = {}) {
  const companyIdHint = String(input.companyId || "").trim();
  const companyFolderIdHint = String(input.companyFolderId || companyIdHint).trim();
  let companyName = String(input.companyName || "").trim();

  let resolvedCompanyFolderId = companyFolderIdHint;
  let masterSheetId = String(input.masterSheetId || "").trim();
  let registryRecord = null;

  if (hasUsableGoogleAuth(auth) && companyFolderIdHint) {
    const folderResolved = await resolveFolderContextFn(deps)(
      auth,
      deps,
      companyFolderIdHint,
      FOLDER_RESOLVE_OPTS,
    );
    if (folderResolved?.ok && folderResolved.masterSheetId) {
      resolvedCompanyFolderId = String(
        folderResolved.companyFolderId || folderResolved.companyId || companyFolderIdHint,
      ).trim();
      masterSheetId = masterSheetId || String(folderResolved.masterSheetId).trim();
      companyName = companyName || String(folderResolved.companyName || "").trim();
    }
  }

  if (!masterSheetId && companyFolderIdHint) {
    masterSheetId = readCachedMasterSheetId(deps, companyFolderIdHint);
  }

  if (companyIdHint || companyFolderIdHint) {
    registryRecord = await resolveCompanyById(auth, deps, companyIdHint || companyFolderIdHint).catch(() => null);
    if (registryRecord) {
      masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
      companyName =
        companyName ||
        String(registryRecord.companyName || registryRecord.name || registryRecord.companyFolderName || "").trim();
      resolvedCompanyFolderId = String(
        registryRecord.rootFolderId ||
          registryRecord.companyFolderId ||
          registryRecord.companyId ||
          resolvedCompanyFolderId,
      ).trim();
    }
  }

  const alternateIds = [
    registryRecord?.companyId,
    registryRecord?.rootFolderId,
    registryRecord?.companyFolderId,
    resolvedCompanyFolderId,
    companyFolderIdHint,
    companyIdHint,
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);

  if (!resolvedCompanyFolderId || !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  return {
    ok: true,
    companyId: resolvedCompanyFolderId,
    companyFolderId: resolvedCompanyFolderId,
    companyName,
    masterSheetId,
    alternateIds,
    registryRecord,
  };
}

/** Derive Schedules tab assignment columns from Users tab profiles + selected emails. */
export function buildScheduleAssignmentFields(users = [], emails = []) {
  const userByEmail = new Map();
  for (const user of users) {
    const email = normalizeEmail(user.email || user.Email);
    if (email) {
      userByEmail.set(email, user);
    }
  }

  const resolved = [];
  const seen = new Set();
  for (const rawEmail of emails) {
    const email = normalizeEmail(rawEmail);
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    const user = userByEmail.get(email);
    resolved.push({
      email,
      name: String(user?.name || user?.Name || email.split("@")[0] || email).trim() || email,
      role: String(user?.role || user?.Role || "User").trim() || "User",
    });
  }

  return {
    AssignedUserEmails: resolved.map((entry) => entry.email).join(", "),
    AssignedUserNames: resolved.map((entry) => entry.name).join(", "),
    AssignedUserRoles: resolved.map((entry) => entry.role).join(", "),
    assignedUserEmails: resolved.map((entry) => entry.email),
    assignedUsers: resolved,
  };
}

export function isActiveMyCheckScheduleStatus(schedule = {}) {
  const status = normalize(schedule.status || schedule.lifecycle || "");
  if (!status) {
    return true;
  }
  return status === "active" || status === "live" || status === "scheduled";
}

export function scheduleMatchesCompanyFolder(schedule = {}, companyFolderId = "", alternateIds = []) {
  const targets = new Set(
    [companyFolderId, ...(Array.isArray(alternateIds) ? alternateIds : [])]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  );
  if (targets.size === 0) {
    return true;
  }
  const rowId = String(schedule.companyFolderId || schedule.companyId || "").trim();
  if (!rowId) {
    return true;
  }
  return targets.has(rowId);
}

function resolveRowsToRecords(deps) {
  return typeof deps?.rowsToRecords === "function" ? deps.rowsToRecords : null;
}

async function readLegacyScheduleRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  try {
    const readResult = await readTabRecords(auth, deps, masterSheetId, LEGACY_SCHEDULE_TAB);
    if (Array.isArray(readResult?.records)) {
      return readResult.records;
    }
  } catch {
    /* fall through to row-based read for test doubles */
  }

  const getTabValues = resolveGetTabValues(deps);
  const rowsToRecords = resolveRowsToRecords(deps);
  if (!rowsToRecords) {
    return [];
  }
  try {
    const legacyRows = await getTabValues(auth, deps, masterSheetId, LEGACY_SCHEDULE_TAB);
    return rowsToRecords(legacyRows);
  } catch {
    return [];
  }
}

async function readCanonicalScheduleRecords(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  try {
    const readResult = await readTabRecords(auth, deps, masterSheetId, SCHEDULES_TAB, {
      expectedHeaders: SCHEDULES_TAB_COLUMNS,
    });
    return readResult.records || [];
  } catch {
    return [];
  }
}

async function resolveScheduleReadContext(auth, deps, input = {}) {
  if (
    input.trustSessionContext === true &&
    String(input.companyFolderId || input.companyId || "").trim() &&
    String(input.masterSheetId || "").trim()
  ) {
    const base = buildSessionScheduleContext(input, deps);
    if (!base.ok) {
      return base;
    }
    const registryRecord = await resolveCompanyById(
      auth,
      deps,
      String(input.companyFolderId || input.companyId || "").trim(),
    ).catch(() => null);
    if (registryRecord) {
      const extraIds = [
        registryRecord.companyId,
        registryRecord.rootFolderId,
        registryRecord.companyFolderId,
      ]
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
      base.alternateIds = [...new Set([...(base.alternateIds || []), ...extraIds])].filter(
        (entry, index, all) => all.indexOf(entry) === index,
      );
      base.registryRecord = registryRecord;
    }
    return base;
  }
  return resolveCompanyScheduleContext(auth, deps, input);
}

async function loadCompanySchedulesFromWorkbook(auth, deps, context, options = {}) {
  const canonicalRecords = await readCanonicalScheduleRecords(auth, deps, context.masterSheetId);
  const canonicalSchedules = parseCompanyScheduleListFromRecords(
    canonicalRecords,
    context.companyFolderId,
    context.alternateIds,
  );
  let legacyRecords = [];
  let legacySchedules = [];

  if (options.canonicalOnly !== true) {
    legacyRecords = await readLegacyScheduleRecords(auth, deps, context.masterSheetId);
    legacySchedules = parseCompanyScheduleListFromRecords(
      legacyRecords,
      context.companyFolderId,
      context.alternateIds,
    );
  }

  const schedules = mergeCompanyScheduleLists(canonicalSchedules, legacySchedules);
  let sourceTab = SCHEDULES_TAB;
  if (canonicalSchedules.length === 0 && legacySchedules.length > 0) {
    sourceTab = LEGACY_SCHEDULE_TAB;
  } else if (canonicalSchedules.length > 0 && legacySchedules.length > 0) {
    sourceTab = "merged";
  }

  const preferredRecords = scheduleTabRecordsPreferCanonical(canonicalRecords, legacyRecords);
  return {
    schedules,
    records: preferredRecords,
    sourceTab,
    canonicalRecords,
    legacyRecords,
    loadDiagnostics: {
      canonicalSchedulesCount: canonicalSchedules.length,
      legacyScheduleCount: legacySchedules.length,
      workspaceScheduleCount: 0,
      scheduleNamesListed: schedules.map((schedule) => String(schedule.scheduleName || "").trim()).filter(Boolean),
      dataSource: describeMergedScheduleDataSource(canonicalSchedules.length, legacySchedules.length),
    },
  };
}

async function migrateLegacySchedulesToCanonicalTab(auth, deps, context, schedules) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return { migrated: false };
  }
  const canonicalRecords = await readCanonicalScheduleRecords(auth, deps, context.masterSheetId);
  const existingCanonical = parseCompanyScheduleListFromRecords(
    canonicalRecords,
    context.companyFolderId,
    context.alternateIds,
  );
  if (existingCanonical.length > 0) {
    return { migrated: false, reason: "canonical_not_empty" };
  }

  const writeResult = await writeScheduleToTab(auth, deps, {
    companyFolderId: context.companyFolderId,
    companyId: context.companyId,
    masterSheetId: context.masterSheetId,
    schedules,
    skipLegacyMigration: true,
  });
  return {
    migrated: writeResult.ok === true,
    writeResult,
  };
}

/** Read Schedules tab via workbookService header-based I/O. */
export async function readSchedulesFromTab(auth, deps, input = {}) {
  const includeTiming = input.includeDiagnostics === true;
  const totalStart = Date.now();
  let resolveContextMs = 0;
  let readSchedulesMs = 0;

  let context;
  const contextStart = Date.now();
  context = await resolveScheduleReadContext(auth, deps, input);
  resolveContextMs = Date.now() - contextStart;
  if (!context.ok) {
    return context;
  }

  try {
    const readStart = Date.now();
    const loaded = await loadCompanySchedulesFromWorkbook(auth, deps, context, {
      canonicalOnly: input.canonicalSchedulesOnly === true,
    });
    readSchedulesMs = Date.now() - readStart;
    let schedules = loaded.schedules;
    let migrated = false;

    if (
      loaded.sourceTab === LEGACY_SCHEDULE_TAB &&
      schedules.length > 0 &&
      input.skipLegacyMigration !== true
    ) {
      const migration = await migrateLegacySchedulesToCanonicalTab(auth, deps, context, schedules);
      migrated = migration.migrated === true;
      if (migrated) {
        const reloaded = await loadCompanySchedulesFromWorkbook(auth, deps, context, {
          canonicalOnly: input.canonicalSchedulesOnly === true,
        });
        schedules = reloaded.schedules;
      }
    }

    const result = {
      ok: true,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      alternateIds: context.alternateIds,
      schedules,
      records: loaded.records,
      sourceTab: migrated ? SCHEDULES_TAB : loaded.sourceTab,
      migratedFromLegacy: migrated,
      contextSource: context.contextSource,
      loadDiagnostics: loaded.loadDiagnostics,
    };
    if (includeTiming) {
      result.timing = {
        resolveContextMs,
        readSchedulesMs,
        totalMs: Date.now() - totalStart,
      };
    }
    return result;
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "SCHEDULE_LIST_FAILED",
      error: "Could not load schedules for this company.",
      message: "Could not load schedules for this company.",
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
    };
  }
}

/** Write company schedules to Schedules tab via workbookService (AssignedUserEmails is primary). */
export async function writeScheduleToTab(auth, deps, input = {}) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const schedules = Array.isArray(input.schedules) ? input.schedules : [];
  const createdBy = String(input.createdBy || "").trim();
  const resolvedCompanyId = context.companyFolderId;
  const { withSheetsQuotaRetry, google } = deps;

  try {
    const ensureTabColumns = resolveEnsureTabColumns(deps);
    await ensureTabColumns(auth, deps, context.masterSheetId, SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS);

    const headers = SCHEDULES_TAB_COLUMNS;
    const getTabValues = resolveGetTabValues(deps);
    const existingRows = await getTabValues(auth, deps, context.masterSheetId, SCHEDULES_TAB);
    const existingDataRows = existingRows.length > 0 ? existingRows.slice(1) : [];
    const companyFolderIndex = headers.indexOf("Company Folder ID");

    const keptRows = existingDataRows.filter(
      (row) => String(row[companyFolderIndex] || "").trim() !== resolvedCompanyId,
    );

    const nextRows = schedules.flatMap((schedule) => {
      const assignedUsers = assignedUsersFromSchedule({
        ...schedule,
        createdBy: schedule.createdBy || schedule.createdByEmail || createdBy,
      });
      const actorRole = String(schedule.createdByRole || "").trim();
      return buildSchedulesTabRows(
        {
          ...schedule,
          companyId: schedule.companyId || schedule.companyFolderId || resolvedCompanyId,
          companyFolderId: schedule.companyFolderId || schedule.companyId || resolvedCompanyId,
          createdBy: schedule.createdBy || schedule.createdByEmail || createdBy,
          createdByEmail: schedule.createdByEmail || schedule.createdBy || createdBy,
          createdByRole: actorRole,
          assignedUsersJson:
            schedule.assignedUsersJson ||
            (assignedUsers.length > 0 ? JSON.stringify(assignedUsers) : ""),
        },
        assignedUsers,
      );
    });

    const sheets = google.sheets({ version: "v4", auth });
    await (withSheetsQuotaRetry
      ? withSheetsQuotaRetry(() =>
          sheets.spreadsheets.values.clear({
            spreadsheetId: context.masterSheetId,
            range: `${SCHEDULES_TAB}!A:ZZ`,
          }),
        )
      : sheets.spreadsheets.values.clear({
          spreadsheetId: context.masterSheetId,
          range: `${SCHEDULES_TAB}!A:ZZ`,
        }));
    await (withSheetsQuotaRetry
      ? withSheetsQuotaRetry(() =>
          sheets.spreadsheets.values.update({
            spreadsheetId: context.masterSheetId,
            range: `${SCHEDULES_TAB}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [headers, ...keptRows, ...nextRows.map((row) => mapRowObjectToHeaders(headers, row))],
            },
          }),
        )
      : sheets.spreadsheets.values.update({
          spreadsheetId: context.masterSheetId,
          range: `${SCHEDULES_TAB}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [headers, ...keptRows, ...nextRows.map((row) => mapRowObjectToHeaders(headers, row))],
          },
        }));

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      masterSheetId: context.masterSheetId,
      written: nextRows.length,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: SCHEDULE_SAVE_FAILED_CODE,
      error: SCHEDULE_SAVE_FAILED_MESSAGE,
      message: SCHEDULE_SAVE_FAILED_MESSAGE,
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
    };
  }
}

export async function listCompanySchedules(auth, deps, input = {}) {
  return readSchedulesFromTab(auth, deps, input);
}

async function readScheduleRecordsByScheduleId(auth, deps, masterSheetId, scheduleId) {
  const targetId = String(scheduleId || "").trim();
  if (!targetId) {
    return null;
  }

  const getTabValues = resolveGetTabValues(deps);
  const rowsToRecords = resolveRowsToRecords(deps);
  if (!getTabValues || !rowsToRecords) {
    return null;
  }

  const idColumnValues = await getTabValues(auth, deps, masterSheetId, SCHEDULES_TAB, "A:A");
  const matchingSheetRows = [];
  for (let index = 1; index < idColumnValues.length; index += 1) {
    if (String(idColumnValues[index]?.[0] || "").trim() === targetId) {
      matchingSheetRows.push(index + 1);
    }
  }
  if (matchingSheetRows.length === 0) {
    return [];
  }

  const headerValues = await getTabValues(auth, deps, masterSheetId, SCHEDULES_TAB, "A1:W1");
  const minRow = Math.min(...matchingSheetRows);
  const maxRow = Math.max(...matchingSheetRows);
  const blockValues = await getTabValues(auth, deps, masterSheetId, SCHEDULES_TAB, `A${minRow}:W${maxRow}`);
  const records = rowsToRecords([...(headerValues || []), ...(blockValues || [])]);
  return records.filter((record) => {
    const rowScheduleId = String(record["Schedule ID"] || record.ScheduleId || "").trim();
    return rowScheduleId === targetId;
  });
}

/** Fast schedule lookup for completion — trusts session masterSheetId, skips legacy migration. */
export async function getCompanyScheduleForCompletion(auth, deps, input = {}) {
  const scheduleId = String(input.scheduleId || "").trim();
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();

  const context = masterSheetId
    ? await resolveScheduleReadContext(auth, deps, {
        ...input,
        companyFolderId,
        companyId: companyFolderId,
        masterSheetId,
        trustSessionContext: true,
      })
    : await resolveCompanyScheduleContext(auth, deps, {
        companyId: companyFolderId,
        companyFolderId,
        masterSheetId,
        companyName: input.companyName,
      });

  if (!context.ok) {
    return context;
  }

  let records = await readScheduleRecordsByScheduleId(auth, deps, context.masterSheetId, scheduleId);
  if (records === null) {
    const loaded = await loadCompanySchedulesFromWorkbook(auth, deps, context, {
      canonicalOnly: true,
    });
    records = (loaded.records || []).filter(
      (record) => String(record["Schedule ID"] || record.ScheduleId || "").trim() === scheduleId,
    );
  }

  if (!records || records.length === 0) {
    return {
      ok: false,
      code: "SCHEDULE_NOT_FOUND",
      error: "Schedule not found for this company.",
      message: "Schedule not found for this company.",
      httpStatus: 404,
    };
  }

  const schedules = parseCompanyScheduleListFromRecords(
    records,
    context.companyFolderId,
    context.alternateIds || [],
  );
  const schedule = findCompanyScheduleById(schedules, scheduleId);
  if (!schedule) {
    return {
      ok: false,
      code: "SCHEDULE_NOT_FOUND",
      error: "Schedule not found for this company.",
      message: "Schedule not found for this company.",
      httpStatus: 404,
    };
  }

  return {
    ok: true,
    companyId: context.companyFolderId,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    schedule,
  };
}

export async function getCompanySchedule(auth, deps, input = {}) {
  const scheduleId = String(input.scheduleId || "").trim();
  const listed = await listCompanySchedules(auth, deps, input);
  if (!listed.ok) {
    return listed;
  }
  const schedule = findCompanyScheduleById(listed.schedules, scheduleId);
  if (!schedule) {
    return {
      ok: false,
      code: "SCHEDULE_NOT_FOUND",
      error: "Schedule not found for this company.",
      message: "Schedule not found for this company.",
      httpStatus: 404,
    };
  }
  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    masterSheetId: listed.masterSheetId,
    schedule,
  };
}

export async function saveCompanySchedule(auth, deps, input = {}) {
  const schedule = input.schedule || input.schedulePayload || null;
  const schedules = Array.isArray(input.schedules)
    ? input.schedules
    : schedule
      ? [schedule]
      : [];
  return writeScheduleToTab(auth, deps, {
    ...input,
    schedules,
  });
}

/** Scheduler assignees — same ACTIVE Users tab rows as People (listActiveUsers). */
export async function listSchedulerAssignees(auth, deps, companyContext = {}) {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const companyId = String(companyContext.companyId || companyFolderId).trim();
  let masterSheetId = String(companyContext.masterSheetId || "").trim();
  let companyName = String(companyContext.companyName || "").trim();
  const selectedArea = String(companyContext.selectedArea || companyContext.area || "").trim();
  const includeDiagnostics = companyContext.includeDiagnostics === true;
  const sessionActor = companyContext.sessionActor || null;
  const signedInEmail = normalizeEmail(sessionActor?.email || companyContext.signedInEmail || "");

  if (!companyFolderId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  const dataSource = masterSheetId ? `company-workbook-users:${masterSheetId}` : "users_tab";

  try {
    const listed = await loadSchedulerAssigneeProfiles(auth, deps, {
      companyId,
      companyFolderId,
      masterSheetId,
      companyName,
      sessionActor,
    });

    if (!listed.ok) {
      return {
        ok: false,
        code: listed.code || "USERS_TAB_READ_FAILED",
        error: listed.error || listed.message || "Could not load users from the company workbook.",
        message: listed.message || listed.error || "Could not load users from the company workbook.",
        httpStatus: listed.httpStatus || 502,
        diagnostics: listed.diagnostics,
      };
    }

    masterSheetId = String(listed.masterSheetId || masterSheetId).trim();
    companyName = String(listed.companyName || companyName).trim();
    const resolvedCompanyId = String(listed.companyFolderId || listed.companyId || companyFolderId).trim();

    const mapped = (listed.users || []).map((row) => mapProfileRowForScheduleAssignees(row, resolvedCompanyId));

    const result = buildAvailableScheduleAssigneesFromUsers(mapped, {
      companyId: resolvedCompanyId,
      masterSheetId,
      selectedArea,
      includeDiagnostics,
    });

    const diagnostics = includeDiagnostics
      ? {
          ...(result.diagnostics || {}),
          ...(listed.diagnostics || {}),
          currentCompanyId: resolvedCompanyId,
          currentCompanyName: companyName || undefined,
          masterSheetId,
          signedInEmail: signedInEmail || undefined,
          assignableUsersReturned: result.assignees.length,
          dataSource: listed.dataSource || dataSource,
        }
      : undefined;

    return {
      ok: true,
      companyId: resolvedCompanyId,
      companyFolderId: resolvedCompanyId,
      companyName: companyName || undefined,
      masterSheetId,
      assignees: result.assignees,
      auditors: result.assignees,
      diagnostics,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "USERS_TAB_READ_FAILED",
      error: "Could not load users from the company workbook.",
      message: "Could not load users from the company workbook.",
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
    };
  }
}

/** My Checks — assignedUserEmails + active status + company folder match. */
export async function listMyChecks(auth, deps, input = {}) {
  const email = normalizeEmail(input.email || input.userEmail);
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const includeDiagnostics = input.includeDiagnostics === true;
  const trustSessionContext = input.trustSessionContext === true && Boolean(companyFolderId && masterSheetId);
  const totalStart = Date.now();

  const listed = await readSchedulesFromTab(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    companyName: String(input.companyName || "").trim(),
    masterSheetId,
    trustSessionContext,
    skipLegacyMigration: true,
    includeDiagnostics,
  });
  if (!listed.ok) {
    return listed;
  }

  const alternateIds = Array.isArray(listed.alternateIds) ? listed.alternateIds : [];
  const excluded = [];
  const filterStart = Date.now();
  const schedules = (listed.schedules || []).filter((schedule) => {
    if (!scheduleMatchesCompanyFolder(schedule, companyFolderId, alternateIds)) {
      if (includeDiagnostics) {
        excluded.push({
          scheduleId: schedule.id,
          scheduleName: schedule.scheduleName,
          reason: "company_folder_mismatch",
          scheduleCompanyFolderId: String(schedule.companyFolderId || schedule.companyId || "").trim(),
          assignedUserEmails: getScheduleAssignedEmails(schedule),
          status: schedule.status,
          lifecycle: schedule.lifecycle,
        });
      }
      return false;
    }
    if (!isActiveMyCheckScheduleStatus(schedule)) {
      if (includeDiagnostics) {
        excluded.push({
          scheduleId: schedule.id,
          scheduleName: schedule.scheduleName,
          reason: "inactive_status",
          assignedUserEmails: getScheduleAssignedEmails(schedule),
          status: schedule.status,
          lifecycle: schedule.lifecycle,
        });
      }
      return false;
    }
    if (!isScheduleAssignedToUser(schedule, email)) {
      if (includeDiagnostics) {
        excluded.push({
          scheduleId: schedule.id,
          scheduleName: schedule.scheduleName,
          reason: "not_assigned",
          assignedUserEmails: getScheduleAssignedEmails(schedule),
          status: schedule.status,
          lifecycle: schedule.lifecycle,
        });
      }
      return false;
    }
    return true;
  });
  const filterSchedulesMs = Date.now() - filterStart;

  let enrichedSchedules = schedules;
  const completionStart = Date.now();
  try {
    const listedResults = await listAuditResults(auth, deps, {
      companyFolderId: listed.companyFolderId || companyFolderId,
      companyId: listed.companyFolderId || companyFolderId,
      masterSheetId: listed.masterSheetId || masterSheetId,
    });
    if (listedResults.ok) {
      enrichedSchedules = enrichAssignedSchedulesWithCompletion(
        schedules,
        listedResults.results || [],
        email,
      );
    }
  } catch {
    enrichedSchedules = schedules;
  }
  const auditResultsMs = Date.now() - completionStart;

  const result = {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    companyName: listed.companyName,
    masterSheetId: listed.masterSheetId,
    schedules: enrichedSchedules,
  };

  if (includeDiagnostics) {
    const resolveContextMs = Number(listed.timing?.resolveContextMs) || 0;
    const readSchedulesMs = Number(listed.timing?.readSchedulesMs) || 0;
    result.diagnostics = {
      assignedChecksDiagnosticsVersion: ASSIGNED_CHECKS_DIAGNOSTICS_VERSION,
      signedInEmail: email,
      companyFolderId,
      alternateIds,
      masterSheetId: listed.masterSheetId,
      contextSource: listed.contextSource || (trustSessionContext ? "session" : "resolved"),
      canonicalSchedulesCount: listed.loadDiagnostics?.canonicalSchedulesCount ?? 0,
      legacyScheduleCount: listed.loadDiagnostics?.legacyScheduleCount ?? 0,
      workspaceScheduleCount: listed.loadDiagnostics?.workspaceScheduleCount ?? 0,
      scheduleNamesListed: listed.loadDiagnostics?.scheduleNamesListed ?? [],
      dataSource: listed.loadDiagnostics?.dataSource || listed.sourceTab || "unknown",
      totalListed: (listed.schedules || []).length,
      includedCount: schedules.length,
      excluded,
      included: schedules.map((schedule) => ({
        scheduleId: schedule.id,
        scheduleName: schedule.scheduleName,
        assignedUserEmails: getScheduleAssignedEmails(schedule),
        assignedUsers: Array.isArray(schedule.assignedUsers) ? schedule.assignedUsers : [],
        audits: (schedule.audits || []).map((audit) => ({
          auditId: audit.auditId,
          auditName: audit.auditName,
        })),
        status: schedule.status,
        lifecycle: schedule.lifecycle,
        companyFolderId: String(schedule.companyFolderId || schedule.companyId || "").trim(),
      })),
      timing: {
        resolveContextMs,
        readSchedulesMs,
        filterSchedulesMs,
        auditResultsMs,
        templateHydrationMs: 0,
        totalMs: Date.now() - totalStart,
      },
    };
  }

  return result;
}

/** @deprecated Prefer listMyChecks — filters by email only (no status/company gate). */
export async function listSchedulesAssignedToUser(auth, deps, input = {}) {
  return listMyChecks(auth, deps, input);
}

export async function saveCompanySchedules(auth, deps, input = {}) {
  return writeScheduleToTab(auth, deps, input);
}

export {
  listCompanySchedules as listSchedules,
  saveCompanySchedule as saveSchedule,
  listMyChecks as listAssignedChecks,
  listSchedulerAssignees as listScheduleAssignees,
};
