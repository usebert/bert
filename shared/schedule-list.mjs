/**
 * Company schedule list — parse Schedules tab rows, company filter, backward compat.
 */
import {
  LEGACY_SCHEDULE_TAB,
  SCHEDULES_TAB,
  parseAssignedUsersFromRecord,
  parseDueWindow,
  scheduleRecordsPreferSchedulesTab,
} from "./schedule-save.mjs";

export { LEGACY_SCHEDULE_TAB, SCHEDULES_TAB };
import { getScheduleAssignedEmails } from "./schedule-assignment.mjs";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function extractField(record, keys) {
  const normalizedKeys = keys.map((key) => normalize(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

export function normalizeScheduleLifecycle(raw) {
  const value = normalize(raw);
  if (value === "archived") {
    return "Archived";
  }
  if (value === "live" || value === "active") {
    return "Live";
  }
  return "Live";
}

export function scheduleRecordCompanyFolderId(record = {}, fallbackCompanyFolderId = "") {
  return (
    extractField(record, ["company folder id", "company folder", "folder id", "company id"]) ||
    String(fallbackCompanyFolderId || "").trim()
  );
}

/** Old rows without company id belong to the workbook company. */
export function scheduleBelongsToCompany(record = {}, companyFolderId = "", alternateIds = []) {
  const rowId = extractField(record, ["company folder id", "company folder", "folder id", "company id"]);
  if (!rowId) {
    return true;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => String(entry || "").trim()).filter(Boolean),
  );
  return targets.has(rowId);
}

function normalizeScheduleFrequency(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "Weekly";
  }
  const lower = value.toLowerCase();
  if (lower === "bi-weekly" || lower === "biweekly") {
    return "Bi-Weekly";
  }
  if (lower === "daily") return "Daily";
  if (lower === "weekly") return "Weekly";
  if (lower === "monthly") return "Monthly";
  return value;
}

function parseDays(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Group sheet rows into company schedule list items (one item per Schedule ID).
 */
export function parseCompanyScheduleListFromRecords(records = [], companyFolderId = "", alternateIds = []) {
  const grouped = new Map();

  records.forEach((record, index) => {
    if (!scheduleBelongsToCompany(record, companyFolderId, alternateIds)) {
      return;
    }

    const rowCompanyFolderId = scheduleRecordCompanyFolderId(record, companyFolderId);
    const scheduleId = extractField(record, ["schedule id"]) || `schedule-row-${index + 1}`;
    const existing = grouped.get(scheduleId);
    const auditId = extractField(record, ["audit id"]) || `audit-row-${index + 1}`;
    const auditName =
      extractField(record, ["template name", "audit name", "audit", "template"]) || "Unnamed audit";
    const dueWindow = parseDueWindow(extractField(record, ["due window"]));

    const audit = {
      id: `${scheduleId}-${auditId}`,
      auditId,
      auditName,
      days: parseDays(extractField(record, ["days of week", "days"])),
      frequency: normalizeScheduleFrequency(extractField(record, ["frequency"])),
      liveTime: extractField(record, ["live time", "send time", "time"]) || dueWindow.liveTime,
      completionHours:
        Number(extractField(record, ["completion hours", "due hours", "hours"])) || dueWindow.completionHours,
    };

    if (existing) {
      existing.audits.push(audit);
      return;
    }

    const assignedUsers = parseAssignedUsersFromRecord(record);
    const assignedUserEmails = getScheduleAssignedEmails({
      assignedUserEmails: extractField(record, ["assigned user emails"]),
      assignedUsersJson: extractField(record, ["assigned users json", "assignedusersjson"]),
      assignedUsers,
      auditorEmails: extractField(record, ["auditor emails"]),
      auditors: extractField(record, ["auditors", "auditor"]),
      assignedAuditors: extractField(record, ["assigned auditors"]),
    });
    const createdBy = extractField(record, ["created by", "created by email", "createdbyemail"]);
    const createdByRole = extractField(record, ["created by role", "createdbyrole"]);
    const status = extractField(record, ["status", "lifecycle"]);

    grouped.set(scheduleId, {
      id: scheduleId,
      rootId: extractField(record, ["root id"]) || scheduleId,
      parentScheduleId: extractField(record, ["parent schedule id"]) || undefined,
      versionNumber: Number(extractField(record, ["version number"])) || 1,
      versionLabel: extractField(record, ["version label"]) || "a",
      lifecycle: normalizeScheduleLifecycle(status),
      status: status || "ACTIVE",
      companyFolderId: rowCompanyFolderId,
      companyId: rowCompanyFolderId,
      scheduleName: extractField(record, ["schedule name", "name"]) || "Unnamed schedule",
      audits: [audit],
      assignedUsers,
      assignedUserEmails,
      assignedUsersJson: assignedUsers.length > 0 ? JSON.stringify(assignedUsers) : "",
      auditors: assignedUserEmails,
      startDate: extractField(record, ["start date"]),
      endDate: extractField(record, ["end date"]),
      createdBy,
      createdByEmail: createdBy,
      createdByRole,
      createdAt: extractField(record, ["created at", "created"]),
      updatedAt: extractField(record, ["updated at", "updated"]),
      archivedAt: extractField(record, ["archived at"]) || undefined,
      reactivatedAt: extractField(record, ["reactivated at"]) || undefined,
      missedAuditCount: Number(extractField(record, ["missed audit count"])) || 0,
      lastCompletedAt: extractField(record, ["last completed at"]) || undefined,
      nextDueAt: extractField(record, ["next due at"]) || undefined,
    });
  });

  return Array.from(grouped.values()).sort((left, right) =>
    String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
  );
}

export function companyScheduleRecordsFromSheetPayload(payload = {}, companyFolderId = "", alternateIds = []) {
  const scheduleRecords = Array.isArray(payload?.data?.[LEGACY_SCHEDULE_TAB])
    ? payload.data[LEGACY_SCHEDULE_TAB]
    : [];
  const schedulesRecords = Array.isArray(payload?.data?.[SCHEDULES_TAB]) ? payload.data[SCHEDULES_TAB] : [];
  const preferred = scheduleRecordsPreferSchedulesTab(scheduleRecords, schedulesRecords);
  return parseCompanyScheduleListFromRecords(preferred, companyFolderId, alternateIds);
}

/** Prefer canonical Schedules tab row objects; fall back to legacy Schedule only when canonical is empty. */
export function scheduleTabRecordsPreferCanonical(canonicalRecords = [], legacyRecords = []) {
  return scheduleRecordsPreferSchedulesTab(legacyRecords, canonicalRecords);
}

export function findCompanyScheduleById(schedules = [], scheduleId = "") {
  const target = String(scheduleId || "").trim();
  if (!target) {
    return null;
  }
  return schedules.find((schedule) => String(schedule.id || "").trim() === target) || null;
}
