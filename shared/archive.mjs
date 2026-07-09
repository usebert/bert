/**
 * Archive & restore helpers — shared server + client.
 * Archive is not delete: rows stay in the workbook with metadata.
 */

export const ARCHIVE_FIELD_NAMES = ["Archived", "ArchivedAt", "ArchivedBy", "ArchiveReason"];

export const ARCHIVE_SECTION_IDS = [
  "users",
  "actions",
  "ncrs",
  "incidents",
  "briefings",
  "audits",
  "googleForms",
  "schedules",
] ;

export const ARCHIVE_RECORD_TYPES = {
  user: {
    section: "users",
    tab: "Users",
    idHeaders: ["Email"],
    labelHeaders: ["Name", "Full Name"],
    restoreLabel: "Reactivate",
    userLifecycle: true,
  },
  action: {
    section: "actions",
    tab: "Actions",
    idHeaders: ["Action ID"],
    labelHeaders: ["Source Question Text", "Source Audit Name"],
    restoreLabel: "Restore",
  },
  ncr: {
    section: "ncrs",
    tab: "NCRs",
    idHeaders: ["NCR ID"],
    labelHeaders: ["Title", "Description", "Reference"],
    restoreLabel: "Restore",
    statusArchiveValue: "Archived",
  },
  incident: {
    section: "incidents",
    tab: "Incidents",
    idHeaders: ["IncidentId", "Incident ID"],
    labelHeaders: ["Description", "IncidentType"],
    restoreLabel: "Restore",
  },
  briefing: {
    section: "briefings",
    tab: "Briefings",
    idHeaders: ["BriefingId"],
    labelHeaders: ["Title"],
    restoreLabel: "Restore",
  },
  audit: {
    section: "audits",
    tab: "AuditTemplates",
    idHeaders: ["Audit ID", "AuditId"],
    labelHeaders: ["Audit Name", "Category"],
    restoreLabel: "Restore",
    statusArchiveValue: "archived",
  },
  googleForm: {
    section: "googleForms",
    tab: "GoogleFormTemplates",
    idHeaders: ["Google Form ID", "FormId", "BERT Template ID"],
    labelHeaders: ["Template Name", "Name"],
    restoreLabel: "Restore",
    altTab: "GoogleFormTemplates",
    syncTab: "GoogleFormTemplates",
    syncIdHeaders: ["FormId"],
    syncLabelHeaders: ["Name"],
    statusArchiveValue: "Archived",
  },
  schedule: {
    section: "schedules",
    tab: "Schedules",
    idHeaders: ["Schedule ID"],
    labelHeaders: ["Schedule Name"],
    restoreLabel: "Restore",
    statusArchiveValue: "Archived",
  },
};

const TRUTHY = new Set(["true", "yes", "1", "archived", "inactive", "disabled"]);
const ACTIVE_USER_STATUSES = new Set(["active"]);
const SETUP_ADMIN_ROLES = new Set(["admin", "master"]);

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

export function pickArchiveField(record = {}, fieldName) {
  return pickField(record, [fieldName, fieldName.replace(/([A-Z])/g, " $1").trim()]);
}

export function archiveTruthy(value) {
  return TRUTHY.has(safeLower(value));
}

export function isUserArchivedRecord(record = {}) {
  return archiveTruthy(pickArchiveField(record, "Archived"));
}

export function isScheduleArchivedRecord(record = {}) {
  const status = safeLower(pickField(record, ["Status", "status", "Lifecycle", "lifecycle"]));
  if (status === "archived") return true;
  return archiveTruthy(pickArchiveField(record, "Archived"));
}

export function isAuditArchivedRecord(record = {}) {
  const status = safeLower(pickField(record, ["Status", "status"]));
  if (status === "archived") return true;
  return archiveTruthy(pickArchiveField(record, "Archived"));
}

export function isGoogleFormArchivedRecord(record = {}) {
  const status = safeLower(pickField(record, ["Status", "status", "Sync Status"]));
  if (status === "archived") return true;
  return archiveTruthy(pickArchiveField(record, "Archived"));
}

export function isWorkbookRowArchived(record = {}, type = "") {
  const config = ARCHIVE_RECORD_TYPES[type];
  if (type === "user") return isUserArchivedRecord(record);
  if (type === "schedule") return isScheduleArchivedRecord(record);
  if (type === "audit") return isAuditArchivedRecord(record);
  if (type === "googleForm") return isGoogleFormArchivedRecord(record);
  if (config?.statusArchiveValue && safeLower(pickField(record, ["Status", "status"])) === safeLower(config.statusArchiveValue)) {
    return true;
  }
  return archiveTruthy(pickArchiveField(record, "Archived"));
}

export function isWorkbookRowActive(record = {}, type = "") {
  return !isWorkbookRowArchived(record, type);
}

export function filterActiveWorkbookRows(rows = [], type = "") {
  return rows.filter((row) => isWorkbookRowActive(row, type));
}

export function filterArchivedWorkbookRows(rows = [], type = "") {
  return rows.filter((row) => isWorkbookRowArchived(row, type));
}

export function buildArchivePatch({ archived = true, actorEmail = "", reason = "", type = "" } = {}) {
  const now = new Date().toISOString();
  const patch = {
    Archived: archived ? "true" : "false",
    ArchivedAt: archived ? now : "",
    ArchivedBy: archived ? trim(actorEmail) : "",
    ArchiveReason: archived ? trim(reason) : "",
  };
  const config = ARCHIVE_RECORD_TYPES[type];
  if (type === "user") {
    patch.Status = archived ? "INACTIVE" : "ACTIVE";
  } else if (config?.statusArchiveValue) {
    patch.Status = archived ? config.statusArchiveValue : "ACTIVE";
  }
  return patch;
}

export function mapArchivedListItem(record = {}, type = "") {
  const config = ARCHIVE_RECORD_TYPES[type];
  const id = pickField(record, config?.idHeaders || []);
  const title = pickField(record, config?.labelHeaders || []) || id || "Archived record";
  return {
    id,
    type,
    title,
    archived: true,
    archivedAt: pickArchiveField(record, "ArchivedAt"),
    archivedBy: pickArchiveField(record, "ArchivedBy"),
    archiveReason: pickArchiveField(record, "ArchiveReason"),
    status: pickField(record, ["Status", "status"]),
    site: pickField(record, ["Site", "SiteIds", "Area", "Area ID", "Location"]),
    department: pickField(record, ["Department", "DepartmentIds"]),
    email: pickField(record, ["Email", "RecipientEmail", "Assigned To Name"]),
    role: pickField(record, ["Role", "role"]),
    raw: record,
  };
}

export function normalizeArchiveType(value = "") {
  const key = safeLower(value);
  const aliases = {
    users: "user",
    user: "user",
    action: "action",
    actions: "action",
    ncr: "ncr",
    ncrs: "ncr",
    incident: "incident",
    incidents: "incident",
    briefing: "briefing",
    briefings: "briefing",
    audit: "audit",
    audits: "audit",
    googleform: "googleForm",
    googleforms: "googleForm",
    "google-form": "googleForm",
    schedule: "schedule",
    schedules: "schedule",
    report: "report",
    reports: "report",
  };
  return aliases[key] || "";
}

export function canViewArchiveCentre(actor = {}) {
  const role = safeLower(actor.role);
  return role === "master" || role === "admin" || role === "manager";
}

export function canArchiveRecordType(actor = {}, type = "") {
  if (!canViewArchiveCentre(actor)) return false;
  if (type === "user") {
    const role = safeLower(actor.role);
    return role === "master" || role === "admin";
  }
  return true;
}

export function isSetupAdminUserRecord(record = {}) {
  const role = safeLower(pickField(record, ["Role", "role", "AccessLevel", "accesslevel"]));
  return SETUP_ADMIN_ROLES.has(role);
}

export function isActiveUserRecord(record = {}) {
  const status = safeLower(pickField(record, ["Status", "status"]));
  return ACTIVE_USER_STATUSES.has(status) && !isUserArchivedRecord(record);
}

export function countActiveSetupAdmins(records = []) {
  return records.filter((record) => isSetupAdminUserRecord(record) && isActiveUserRecord(record)).length;
}

export const ARCHIVE_CONFIRM_MESSAGE =
  "Archive this item? It will be hidden from active views but can be restored from Archive.";
export const ARCHIVE_OFFLINE_MESSAGE = "Archiving needs a connection.";
export const RESTORE_OFFLINE_MESSAGE = "Restoring needs a connection.";
export const RESTORE_CONFIRM_MESSAGE = "Restore this item? It will return to active views.";
export const REACTIVATE_USER_CONFIRM_MESSAGE =
  "Reactivate this user? They will be able to access BERT again if their login details are valid.";
export const CANNOT_ARCHIVE_LAST_ADMIN_MESSAGE = "You cannot archive the last setup/admin user.";
