/**
 * Folder-first archive & restore — workbook rows are never deleted.
 */
import { GOOGLE_FORM_TEMPLATES_TAB } from "./google-form-templates.mjs";
import { INCIDENTS_TAB } from "./incidents-service.mjs";
import { BRIEFINGS_TAB } from "../shared/briefings.mjs";
import { USERS_TAB_COLUMNS } from "./users-tab-constants.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  ARCHIVE_FIELD_NAMES,
  ARCHIVE_RECORD_TYPES,
  buildArchivePatch,
  canArchiveRecordType,
  canViewArchiveCentre,
  countActiveSetupAdmins,
  filterArchivedWorkbookRows,
  isSetupAdminUserRecord,
  isUserArchivedRecord,
  isWorkbookRowArchived,
  mapArchivedListItem,
  normalizeArchiveType,
  CANNOT_ARCHIVE_LAST_ADMIN_MESSAGE,
} from "../shared/archive.mjs";
import {
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, keys = []) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) return direct;
    const match = Object.entries(record).find(([header]) => safeLower(header) === safeLower(key));
    if (match && trim(match[1])) return trim(match[1]);
  }
  return "";
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function archiveFailure(code, message, httpStatus = 400, details) {
  return { ok: false, code, error: message, message, httpStatus, details };
}

function actorEmail(actor = {}) {
  return safeLower(actor.email || actor.username || "");
}

async function resolveArchiveContext(auth, deps, actor, companyFolderId) {
  if (!canViewArchiveCentre(actor)) {
    return archiveFailure("ARCHIVE_PERMISSION_DENIED", "You do not have permission to use Archive.", 403);
  }
  const context = await resolveCompanyScheduleContext(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: actor?.masterSheetId,
    companyName: actor?.companyName,
  });
  if (!context.ok) {
    return {
      ...context,
      code: context.code === "COMPANY_NOT_FOUND" ? "COMPANY_WORKBOOK_NOT_FOUND" : context.code,
    };
  }
  return { ok: true, ...context };
}

async function readTabRows(auth, deps, masterSheetId, tabName) {
  const readTabRecords = resolveReadTabRecords(deps);
  const result = await readTabRecords(auth, deps, masterSheetId, tabName);
  return result.records || [];
}

async function ensureArchiveColumns(auth, deps, masterSheetId, tabName, extraColumns = []) {
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, tabName, [...extraColumns, ...ARCHIVE_FIELD_NAMES]);
}

async function patchArchiveRow(auth, deps, masterSheetId, type, id, patch) {
  const config = ARCHIVE_RECORD_TYPES[type];
  if (!config) {
    return archiveFailure("ARCHIVE_TYPE_UNSUPPORTED", "This record type cannot be archived yet.");
  }
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  await ensureArchiveColumns(auth, deps, masterSheetId, config.tab);
  await patchTabRowByHeader(auth, deps, masterSheetId, config.tab, config.idHeaders[0], id, patch, {
    matchHeaderAliases: config.idHeaders.slice(1),
  });
  return { ok: true };
}

async function findRowById(auth, deps, masterSheetId, type, id) {
  const config = ARCHIVE_RECORD_TYPES[type];
  if (!config) return null;
  const rows = await readTabRows(auth, deps, masterSheetId, config.tab);
  const want = trim(id);
  return (
    rows.find((row) => config.idHeaders.some((header) => trim(pickField(row, [header])) === want)) || null
  );
}

async function validateUserArchive(auth, deps, masterSheetId, targetId, actor) {
  const rows = await readTabRows(auth, deps, masterSheetId, "Users");
  const target = rows.find((row) => safeLower(pickField(row, ["Email"])) === safeLower(targetId));
  if (!target) {
    return archiveFailure("ARCHIVE_ITEM_NOT_FOUND", "User was not found in this company workbook.");
  }
  if (safeLower(pickField(target, ["Email"])) === actorEmail(actor)) {
    return archiveFailure("ARCHIVE_PERMISSION_DENIED", "You cannot archive your own account.");
  }
  if (isSetupAdminUserRecord(target)) {
    const activeAdmins = countActiveSetupAdmins(rows);
    if (activeAdmins <= 1 && !isUserArchivedRecord(target)) {
      return archiveFailure("CANNOT_ARCHIVE_LAST_ADMIN", CANNOT_ARCHIVE_LAST_ADMIN_MESSAGE, 409);
    }
  }
  return { ok: true, row: target };
}

export async function listCompanyArchive(auth, deps, actor, companyFolderId) {
  const context = await resolveArchiveContext(auth, deps, actor, companyFolderId);
  if (!context.ok) return context;

  const sections = {};
  const counts = {};
  for (const [type, config] of Object.entries(ARCHIVE_RECORD_TYPES)) {
    const rows = await readTabRows(auth, deps, context.masterSheetId, config.tab);
    const archived = filterArchivedWorkbookRows(rows, type).map((row) => mapArchivedListItem(row, type));
    sections[config.section] = archived;
    counts[config.section] = archived.length;
  }
  return {
    ok: true,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    sections,
    counts,
  };
}

export async function archiveCompanyRecord(auth, deps, actor, companyFolderId, input = {}) {
  const type = normalizeArchiveType(input.type);
  if (!type || !ARCHIVE_RECORD_TYPES[type]) {
    return archiveFailure("ARCHIVE_TYPE_UNSUPPORTED", "This record type cannot be archived yet.");
  }
  if (!canArchiveRecordType(actor, type)) {
    return archiveFailure("ARCHIVE_PERMISSION_DENIED", "You do not have permission to archive this record.", 403);
  }
  const id = trim(input.id);
  if (!id) {
    return archiveFailure("ARCHIVE_ITEM_NOT_FOUND", "Record id is required.");
  }

  const context = await resolveArchiveContext(auth, deps, actor, companyFolderId);
  if (!context.ok) return context;

  if (type === "user") {
    const guard = await validateUserArchive(auth, deps, context.masterSheetId, id, actor);
    if (!guard.ok) return guard;
  }

  const existing = await findRowById(auth, deps, context.masterSheetId, type, id);
  if (!existing) {
    return archiveFailure("ARCHIVE_ITEM_NOT_FOUND", "Record was not found in this company workbook.", 404);
  }
  if (isWorkbookRowArchived(existing, type)) {
    return { ok: true, alreadyArchived: true, type, id };
  }

  const patch = buildArchivePatch({
    archived: true,
    actorEmail: actorEmail(actor),
    reason: input.reason,
    type,
  });

  try {
    if (type === "user") {
      await ensureArchiveColumns(auth, deps, context.masterSheetId, "Users", USERS_TAB_COLUMNS);
    }
    const write = await patchArchiveRow(auth, deps, context.masterSheetId, type, id, patch);
    if (!write.ok) return write;
    return { ok: true, type, id, archived: true };
  } catch (error) {
    const code =
      type === "user"
        ? "ARCHIVE_WRITE_FAILED"
        : type === "googleForm"
          ? "GOOGLE_FORM_ARCHIVE_FAILED"
          : type === "audit"
            ? "AUDIT_ARCHIVE_FAILED"
            : "ARCHIVE_WRITE_FAILED";
    return archiveFailure(code, "Could not archive item. Try again.", 500, {
      technicalError: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function restoreCompanyRecord(auth, deps, actor, companyFolderId, input = {}) {
  const type = normalizeArchiveType(input.type);
  if (!type || !ARCHIVE_RECORD_TYPES[type]) {
    return archiveFailure("ARCHIVE_TYPE_UNSUPPORTED", "This record type cannot be restored yet.");
  }
  if (!canArchiveRecordType(actor, type)) {
    return archiveFailure("ARCHIVE_PERMISSION_DENIED", "You do not have permission to restore this record.", 403);
  }
  const id = trim(input.id);
  if (!id) {
    return archiveFailure("ARCHIVE_ITEM_NOT_FOUND", "Record id is required.");
  }

  const context = await resolveArchiveContext(auth, deps, actor, companyFolderId);
  if (!context.ok) return context;

  const existing = await findRowById(auth, deps, context.masterSheetId, type, id);
  if (!existing) {
    return archiveFailure("ARCHIVE_ITEM_NOT_FOUND", "Record was not found in this company workbook.", 404);
  }

  const patch = buildArchivePatch({ archived: false, type });
  if (type === "user") {
    const previousStatus = trim(pickField(existing, ["Status"])) || "ACTIVE";
    patch.Status = previousStatus.toUpperCase() === "INACTIVE" ? "ACTIVE" : previousStatus || "ACTIVE";
  }

  try {
    if (type === "user") {
      await ensureArchiveColumns(auth, deps, context.masterSheetId, "Users", USERS_TAB_COLUMNS);
    }
    const write = await patchArchiveRow(auth, deps, context.masterSheetId, type, id, patch);
    if (!write.ok) return write;
    return { ok: true, type, id, restored: true, reactivated: type === "user" };
  } catch (error) {
    const code = type === "user" ? "USER_REACTIVATE_FAILED" : "RESTORE_WRITE_FAILED";
    return archiveFailure(code, type === "user" ? "Could not reactivate user. Try again." : "Could not restore item. Try again.", 500, {
      technicalError: error instanceof Error ? error.message : String(error),
    });
  }
}

export const ARCHIVE_SERVICE_TABS = {
  users: "Users",
  actions: "Actions",
  ncrs: "NCRs",
  incidents: INCIDENTS_TAB,
  briefings: BRIEFINGS_TAB,
  audits: "AuditTemplates",
  googleForms: GOOGLE_FORM_TEMPLATES_TAB,
  schedules: "Schedules",
};
