/**
 * Folder-first archive & restore — workbook rows are never deleted.
 */
import fs from "node:fs";
import path from "node:path";
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
import { readAuditTemplates } from "./company-audit-mapping.mjs";

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

function auditTemplateRowToSheetRow(template = {}) {
  const status = safeLower(template.status || template.Status || "active") || "active";
  return {
    "Audit ID": trim(template.id || template["Audit ID"]),
    "Audit Name": trim(template.name || template.template_name || template["Audit Name"]),
    Category: trim(template.category || template.Category),
    Status: status,
    "Created At": trim(template.createdAt || template.created_at || template["Created At"]),
    "Form Number": trim(template.formNumber || template.form_number || template["Form Number"]),
    "Revision Number": String(
      template.revisionNumber || template.revision_number || template["Revision Number"] || 1,
    ),
    "Revision ID": trim(template.revisionId || template.revision_id || template["Revision ID"]),
    "Supersedes Revision ID": trim(
      template.supersedesRevisionId || template.supersedes_revision_id || template["Supersedes Revision ID"],
    ),
    "Superseded By Revision ID": trim(
      template.supersededByRevisionId ||
        template.superseded_by_revision_id ||
        template["Superseded By Revision ID"],
    ),
    "Revision Reason": trim(
      template.revisionReason || template.revision_reason || template["Revision Reason"],
    ),
    "Copy Reason": trim(template.copyReason || template.copy_reason || template["Copy Reason"]),
    Archived: trim(template.archived || template.Archived) || (status === "superseded" || status === "archived" ? "true" : "false"),
    ArchivedAt: trim(template.archivedAt || template.archived_at || template.ArchivedAt),
    ArchivedBy: trim(template.archivedBy || template.archived_by || template.ArchivedBy),
    ArchiveReason: trim(
      template.archiveReason ||
        template.archive_reason ||
        template.ArchiveReason ||
        template.revisionReason ||
        template.revision_reason,
    ),
  };
}

function auditBuilderTemplateToSheetRow(template = {}) {
  return auditTemplateRowToSheetRow({
    id: template.id,
    name: template.template_name || template.name,
    category: template.category,
    status: template.status,
    createdAt: template.created_at || template.createdAt,
    formNumber: template.form_number || template.formNumber,
    revisionNumber: template.revision_number || template.revisionNumber,
    revisionId: template.revision_id || template.revisionId,
    supersedesRevisionId: template.supersedes_revision_id || template.supersedesRevisionId,
    supersededByRevisionId: template.superseded_by_revision_id || template.supersededByRevisionId,
    revisionReason: template.revision_reason || template.revisionReason,
    copyReason: template.copy_reason || template.copyReason,
    archived: template.archived === true ? "true" : template.archived,
    archivedAt: template.archived_at || template.archivedAt || template.updated_at,
    archivedBy: template.archived_by || template.archivedBy || template.created_by,
    archiveReason: template.archive_reason || template.archiveReason || template.revision_reason,
  });
}

/** Recover superseded/archived audit revisions from the audit-builder session store when the sheet was wiped by an active-only sync. */
function readSessionArchivedAuditRows(sessionDir, masterSheetId) {
  const root = trim(sessionDir);
  const sheetId = trim(masterSheetId);
  if (!root || !sheetId) return [];
  try {
    const filePath = path.join(root, "audit-builder", "workspaces.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const workspaces = data?.workspaces && typeof data.workspaces === "object" ? data.workspaces : {};
    const exact = workspaces[sheetId];
    const fuzzyKeys = Object.keys(workspaces).filter(
      (key) => key !== sheetId && (key.includes(sheetId) || sheetId.includes(key)),
    );
    const buckets = [exact, ...fuzzyKeys.map((key) => workspaces[key])].filter(Boolean);
    const templates = buckets.flatMap((bucket) => Object.values(bucket?.templates || {}));
    return templates
      .map((template) => auditBuilderTemplateToSheetRow(template))
      .filter((row) => isWorkbookRowArchived(row, "audit") && trim(row["Audit ID"]) && trim(row["Audit Name"]));
  } catch {
    return [];
  }
}

function mergeArchiveRowsById(primaryRows = [], extraRows = []) {
  const byId = new Map();
  for (const row of [...primaryRows, ...extraRows]) {
    const id = trim(pickField(row, ["Audit ID", "AuditId", "Google Form ID", "FormId", "BERT Template ID", "id"]));
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, row);
  }
  return [...byId.values()];
}

async function readAuditArchiveRows(auth, deps, masterSheetId) {
  const sheetId = trim(masterSheetId);
  let workbookRows = [];
  try {
    const mapped = await readAuditTemplates(deps, auth, sheetId);
    workbookRows = (mapped || []).map((row) => auditTemplateRowToSheetRow(row));
  } catch {
    workbookRows = await readTabRows(auth, deps, sheetId, ARCHIVE_RECORD_TYPES.audit.tab);
  }
  if (workbookRows.length === 0) {
    workbookRows = await readTabRows(auth, deps, sheetId, ARCHIVE_RECORD_TYPES.audit.tab);
  }
  const sessionRows = readSessionArchivedAuditRows(deps?.sessionDir, sheetId);
  const merged = mergeArchiveRowsById(workbookRows, sessionRows);
  return {
    workbookRows,
    sessionRows,
    mergedRows: merged,
    archivedRows: filterArchivedWorkbookRows(merged, "audit"),
  };
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

export async function listCompanyArchive(auth, deps, actor, companyFolderId, options = {}) {
  const context = await resolveArchiveContext(auth, deps, actor, companyFolderId);
  if (!context.ok) return context;

  const sections = {};
  const counts = {};
  let auditDiagnostics = null;

  for (const [type, config] of Object.entries(ARCHIVE_RECORD_TYPES)) {
    let archived;
    if (type === "audit") {
      const auditRead = await readAuditArchiveRows(auth, deps, context.masterSheetId);
      archived = auditRead.archivedRows.map((row) => mapArchivedListItem(row, type));
      auditDiagnostics = {
        workbookAuditRows: auditRead.workbookRows.length,
        sessionAuditRows: auditRead.sessionRows.length,
        returnedAuditRows: archived.length,
        sectionKey: config.section,
        masterSheetIdPresent: Boolean(trim(context.masterSheetId)),
      };
    } else {
      const rows = await readTabRows(auth, deps, context.masterSheetId, config.tab);
      archived = filterArchivedWorkbookRows(rows, type).map((row) => mapArchivedListItem(row, type));
    }
    sections[config.section] = archived;
    counts[config.section] = archived.length;
  }

  const payload = {
    ok: true,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    sections,
    counts,
  };

  const wantDiagnostics =
    options.debugArchive === true ||
    String(deps?.debugArchive || "").trim() === "1" ||
    String(process.env.BERT_ARCHIVE_DEBUG || "").trim() === "1";
  if (wantDiagnostics && auditDiagnostics) {
    payload.diagnostics = {
      audits: auditDiagnostics,
      // Safe counts only — no tokens, PasswordHash, or row payloads.
    };
  }

  return payload;
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
