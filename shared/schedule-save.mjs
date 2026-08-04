/**
 * Schedule save helpers — Schedules tab columns, assignedUsers payload, backward-compat load.
 */
import { inviteAccessLevelForRole } from "./schedule-assignees.mjs";
import { getScheduleAssignedEmails, isValidAssigneeEmail } from "./schedule-assignment.mjs";
import { resolveScheduleCompletionMode } from "./schedule-completion-mode.mjs";

export const SCHEDULES_TAB = "Schedules";
/** @deprecated Legacy singular tab — read/migrate only; never write here. */
export const LEGACY_SCHEDULE_TAB = "Schedule";

export const SCHEDULES_TAB_COLUMNS = [
  "Schedule ID",
  "Company Folder ID",
  "Schedule Name",
  "Template Name",
  "Audit ID",
  "Frequency",
  "Days Of Week",
  "Start Date",
  "End Date",
  "Continuous",
  "Due Window",
  "Assigned User Emails",
  "Assigned User Names",
  "Assigned User Roles",
  "Status",
  "Created By",
  "Created At",
  "Updated At",
  "Auditors",
  "Auditor Emails",
  "Assigned Auditors",
  "Completion Mode",
  "Verification Source",
  "Verification Marker",
  "Health State",
  "Next Due At",
  "Paused At",
  "Paused By",
  "Reactivated At",
];

export const SCHEDULE_SAVE_FAILED_CODE = "SCHEDULE_SAVE_FAILED";
export const SCHEDULE_SAVE_FAILED_MESSAGE = "BERT could not save this schedule. Try again.";

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

export function normalizeAssignedUser(user = {}) {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return null;
  }
  return {
    email,
    name: String(user.name || email.split("@")[0] || email).trim() || email,
    role: String(user.role || "User").trim() || "User",
    accessLevel: String(user.accessLevel || inviteAccessLevelForRole(user.role || "User")).trim(),
  };
}

export function buildAssignedUsersFromSelection(selectedIds = [], assigneeOptions = [], tabRows = []) {
  const users = [];
  const seen = new Set();

  for (const selectedId of selectedIds) {
    const key = normalize(selectedId);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const assignee = assigneeOptions.find(
      (option) =>
        normalize(option.id) === key ||
        normalize(option.email) === key ||
        normalize(option.name) === key,
    );
    const tabRow = tabRows.find((row) => normalize(row.email) === key);

    const normalized = normalizeAssignedUser({
      email: assignee?.email || tabRow?.email || (isValidAssigneeEmail(selectedId) ? selectedId : ""),
      name: assignee?.name || tabRow?.name,
      role: assignee?.role || tabRow?.role || "User",
      accessLevel: tabRow?.accessLevel || inviteAccessLevelForRole(assignee?.role || tabRow?.role || "User"),
    });
    if (normalized) {
      users.push(normalized);
    }
  }

  return users;
}

export function assignedUsersFromSchedule(schedule = {}) {
  if (Array.isArray(schedule.assignedUsers) && schedule.assignedUsers.length > 0) {
    return schedule.assignedUsers.map((user) => normalizeAssignedUser(user)).filter(Boolean);
  }

  const emails = getScheduleAssignedEmails(schedule);
  if (emails.length > 0) {
    return emails
      .map((email) =>
        normalizeAssignedUser({
          email,
          name: email.split("@")[0] || email,
          role: "User",
          accessLevel: "operational",
        }),
      )
      .filter(Boolean);
  }

  return [];
}

export function assignedUserEmailsFromSchedule(schedule = {}) {
  return getScheduleAssignedEmails(schedule);
}

export function formatDueWindow(audit = {}) {
  const liveTime = String(audit.liveTime || "08:00").trim() || "08:00";
  const completionHours = Number(audit.completionHours) || 24;
  return `${liveTime}|${completionHours}h`;
}

export function parseDueWindow(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { liveTime: "08:00", completionHours: 24 };
  }
  const [liveTimePart, completionPart] = raw.split("|");
  const liveTime = String(liveTimePart || "08:00").trim() || "08:00";
  const completionHours = Number(String(completionPart || "").replace(/[^\d.]/g, "")) || 24;
  return { liveTime, completionHours };
}

function scheduleStatusForSave(schedule = {}) {
  const lifecycle = String(schedule.lifecycle || "").trim().toLowerCase();
  const explicit = String(schedule.status || "").trim();
  if (explicit) {
    return explicit;
  }
  if (lifecycle === "archived") {
    return "Archived";
  }
  return "ACTIVE";
}

export function buildSchedulesTabRows(schedule = {}, assignedUsers = []) {
  const users = assignedUsers.length > 0 ? assignedUsers : assignedUsersFromSchedule(schedule);
  const emails = assignedUserEmailsFromSchedule({ ...schedule, assignedUsers: users }).join(", ");
  const names = users.map((user) => user.name).join(", ");
  const roles = users.map((user) => user.role).join(", ");
  const continuous = !String(schedule.endDate || "").trim();
  const createdByEmail = String(schedule.createdByEmail || schedule.createdBy || "").trim();
  const createdByRole = String(schedule.createdByRole || users[0]?.role || "").trim();
  const assignedUsersJson =
    schedule.assignedUsersJson ||
    (users.length > 0 ? JSON.stringify(users) : "");

  return (Array.isArray(schedule.audits) ? schedule.audits : []).map((audit) => ({
    "Schedule ID": String(schedule.id || "").trim(),
    "Company Folder ID": String(schedule.companyFolderId || schedule.companyId || "").trim(),
    "Schedule Name": String(schedule.scheduleName || "").trim(),
    "Template Name": String(audit.auditName || "").trim(),
    "Audit ID": String(audit.auditId || "").trim(),
    Frequency: String(audit.frequency || "").trim(),
    "Days Of Week": (Array.isArray(audit.days) ? audit.days : []).join(", "),
    "Start Date": String(schedule.startDate || "").trim(),
    "End Date": String(schedule.endDate || "").trim(),
    Continuous: continuous ? "true" : "false",
    "Due Window": formatDueWindow(audit),
    "Completion Mode":
      String(schedule.completionMode || "").trim() === "once-per-period"
        ? "Once per due period"
        : String(schedule.completionMode || "").trim() === "repeatable"
          ? "Repeatable"
          : "",
    "Assigned User Emails": emails,
    "Assigned User Names": names,
    "Assigned User Roles": roles,
    Status: scheduleStatusForSave(schedule),
    "Created By": createdByEmail,
    "Created At": String(schedule.createdAt || schedule.updatedAt || "").trim(),
    "Updated At": String(schedule.updatedAt || "").trim(),
    Auditors: emails,
    "Auditor Emails": emails,
    "Assigned Auditors": names || emails,
    "Completion Mode": resolveScheduleCompletionMode(schedule),
    companyId: String(schedule.companyId || schedule.companyFolderId || "").trim(),
    assignedUserEmails: emails,
    assignedUsersJson,
    createdByEmail,
    createdByRole,
    "Verification Source": String(schedule.verificationSource || "").trim(),
    "Verification Marker": String(schedule.verificationMarker || "").trim(),
    "Health State": String(schedule.healthState || "").trim(),
    "Next Due At": String(schedule.nextDueAt || "").trim(),
    "Paused At": String(schedule.pausedAt || "").trim(),
    "Paused By": String(schedule.pausedBy || "").trim(),
    "Reactivated At": String(schedule.reactivatedAt || "").trim(),
  }));
}

function assignedUsersFromJsonField(record = {}) {
  const jsonRaw = extractField(record, ["assigned users json", "assignedusersjson"]);
  if (!jsonRaw) {
    return [];
  }
  try {
    const parsed = typeof jsonRaw === "string" ? JSON.parse(jsonRaw) : jsonRaw;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) =>
        normalizeAssignedUser(
          typeof entry === "string"
            ? { email: entry }
            : {
                email: entry?.email,
                name: entry?.name,
                role: entry?.role,
                accessLevel: entry?.accessLevel,
              },
        ),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function parseAssignedUsersFromRecord(record = {}) {
  const emailsRaw = extractField(record, ["assigned user emails", "assigneduseremails"]);
  if (emailsRaw) {
    const emails = emailsRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const names = extractField(record, ["assigned user names", "assignedusernames"])
      .split(",")
      .map((entry) => entry.trim());
    const roles = extractField(record, ["assigned user roles", "assigneduserroles"])
      .split(",")
      .map((entry) => entry.trim());
    return emails
      .map((email, index) =>
        normalizeAssignedUser({
          email,
          name: names[index] || email.split("@")[0] || email,
          role: roles[index] || "User",
          accessLevel: inviteAccessLevelForRole(roles[index] || "User"),
        }),
      )
      .filter(Boolean);
  }

  const fromJson = assignedUsersFromJsonField(record);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const legacyRaw = extractField(record, ["auditors", "auditor emails", "assigned auditors", "auditor"]);
  if (!legacyRaw) {
    return [];
  }

  return legacyRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((email) =>
      normalizeAssignedUser({
        email,
        name: email.split("@")[0] || email,
        role: "User",
        accessLevel: "operational",
      }),
    )
    .filter(Boolean);
}

export function parseAuditorEmailsFromRecord(record = {}) {
  return parseAssignedUsersFromRecord(record).map((user) => user.email);
}

export function scheduleRecordsPreferSchedulesTab(scheduleRecords = [], schedulesRecords = []) {
  return schedulesRecords.length > 0 ? schedulesRecords : scheduleRecords;
}
