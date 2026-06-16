/**
 * Company schedule service — folder-first Schedules tab I/O, assignees, My Checks.
 */
import { resolveCompanyById } from "./company-registry-service.mjs";
import {
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";
import {
  companyScheduleRecordsFromSheetPayload,
  findCompanyScheduleById,
  parseCompanyScheduleListFromRecords,
} from "../shared/schedule-list.mjs";
import {
  SCHEDULES_TAB,
  SCHEDULES_TAB_COLUMNS,
  SCHEDULE_SAVE_FAILED_CODE,
  SCHEDULE_SAVE_FAILED_MESSAGE,
  assignedUsersFromSchedule,
  buildSchedulesTabRows,
} from "../shared/schedule-save.mjs";
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";
import { listActiveUsers as listActiveUsersFromUserService } from "./user-service.mjs";
import {
  readTabRecords as workbookReadTabRecords,
  getTabValues as workbookGetTabValues,
  ensureTabColumns as workbookEnsureTabColumns,
} from "./workbook-service.mjs";

function resolveListActiveUsers(deps) {
  return typeof deps?.listActiveUsers === "function" ? deps.listActiveUsers : listActiveUsersFromUserService;
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveGetTabValues(_deps) {
  return workbookGetTabValues;
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

export async function resolveCompanyScheduleContext(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  let masterSheetId = String(input.masterSheetId || "").trim();
  const companyFolderId = String(input.companyFolderId || companyId).trim();
  let companyName = String(input.companyName || "").trim();

  if (!masterSheetId && companyFolderId) {
    masterSheetId = readCachedMasterSheetId(deps, companyFolderId);
  }

  if (companyFolderId && masterSheetId) {
    const alternateIds = [companyFolderId, companyId]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .filter((entry, index, all) => all.indexOf(entry) === index);
    return {
      ok: true,
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      alternateIds,
      registryRecord: null,
    };
  }

  let registryRecord = null;
  if (companyId) {
    registryRecord = await resolveCompanyById(auth, deps, companyId).catch(() => null);
  }

  if (!registryRecord && !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  if (registryRecord) {
    masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
    companyName =
      companyName ||
      String(registryRecord.companyName || registryRecord.name || registryRecord.companyFolderName || "").trim();
  }

  const resolvedCompanyFolderId = String(
    registryRecord?.rootFolderId ||
      companyFolderId ||
      registryRecord?.companyFolderId ||
      registryRecord?.companyId ||
      companyId,
  ).trim();

  const alternateIds = [
    registryRecord?.companyId,
    registryRecord?.rootFolderId,
    registryRecord?.companyFolderId,
    companyFolderId,
    companyId,
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);

  if (!masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company master sheet is not configured.",
      message: "Company master sheet is not configured.",
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

export function scheduleMatchesCompanyFolder(schedule = {}, companyFolderId = "") {
  const target = String(companyFolderId || "").trim();
  if (!target) {
    return true;
  }
  const rowId = String(schedule.companyFolderId || schedule.companyId || "").trim();
  if (!rowId) {
    return true;
  }
  return rowId === target;
}

/** Read Schedules tab via workbookService header-based I/O. */
export async function readSchedulesFromTab(auth, deps, input = {}) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  try {
    const readTabRecords = resolveReadTabRecords(deps);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, SCHEDULES_TAB, {
      expectedHeaders: SCHEDULES_TAB_COLUMNS,
    });
    const schedules = parseCompanyScheduleListFromRecords(
      readResult.records || [],
      context.companyFolderId,
      context.alternateIds,
    );
    return {
      ok: true,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      alternateIds: context.alternateIds,
      schedules,
      records: readResult.records || [],
    };
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
  const { writeLegacyCompanySchedules, withSheetsQuotaRetry, google } = deps;

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

    if (typeof writeLegacyCompanySchedules === "function") {
      await writeLegacyCompanySchedules(auth, context.masterSheetId, resolvedCompanyId, schedules);
    }

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
  const readResult = await readSchedulesFromTab(auth, deps, input);
  if (!readResult.ok) {
    return readResult;
  }

  const { readCompanySheetById } = deps;
  if (typeof readCompanySheetById === "function" && (readResult.schedules || []).length === 0) {
    try {
      const payload = await readCompanySheetById(auth, readResult.masterSheetId);
      const legacySchedules = companyScheduleRecordsFromSheetPayload(
        payload,
        readResult.companyFolderId,
        readResult.alternateIds,
      );
      if (legacySchedules.length > 0) {
        return { ...readResult, schedules: legacySchedules };
      }
    } catch {
      // Schedules tab is canonical; legacy read is best-effort only.
    }
  }

  return readResult;
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
    const listActiveUsers = resolveListActiveUsers(deps);
    const listed = await listActiveUsers(auth, deps, {
      companyId,
      companyFolderId,
      masterSheetId,
      companyName,
      sessionActor,
      includeDiagnostics: true,
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

    const mapped = (listed.users || []).map((row) => ({
      email: row.email,
      name: row.name,
      role: row.role,
      accessLevel: row.accessLevel,
      status: row.status,
      companyId: row.companyId || resolvedCompanyId,
      companyFolderId: row.companyFolderId || resolvedCompanyId,
      companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : [],
      companyAreasRaw: row.companyAreasRaw || "",
    }));

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
          dataSource,
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
  const listed = await readSchedulesFromTab(auth, deps, {
    ...(input.companyContext || {}),
    ...input,
    companyFolderId,
    companyId: companyFolderId,
  });
  if (!listed.ok) {
    return listed;
  }

  const schedules = (listed.schedules || []).filter((schedule) => {
    if (!scheduleMatchesCompanyFolder(schedule, companyFolderId)) {
      return false;
    }
    if (!isActiveMyCheckScheduleStatus(schedule)) {
      return false;
    }
    return isScheduleAssignedToUser(schedule, email);
  });

  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    companyName: listed.companyName,
    masterSheetId: listed.masterSheetId,
    schedules,
  };
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
