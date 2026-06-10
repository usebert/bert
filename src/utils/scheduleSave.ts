import type { ScheduleAssigneeOption } from "./scheduleAssignees";
import { normalizeScheduleValue } from "./scheduleAssignees";
import { getScheduleAssignedEmails } from "./scheduleAssignment";

export type ScheduleAssignedUser = {
  email: string;
  name: string;
  role: string;
  accessLevel: string;
};

function accessLevelForRole(role: string): string {
  const normalized = normalizeScheduleValue(role);
  if (normalized === "admin" || normalized === "company admin") {
    return "full";
  }
  if (normalized === "auditor") {
    return "AUDITOR";
  }
  return "operational";
}

export function buildAssignedUsersForSave(
  selectedIds: string[],
  assigneeOptions: ScheduleAssigneeOption[],
): ScheduleAssignedUser[] {
  const users: ScheduleAssignedUser[] = [];
  const seen = new Set<string>();

  for (const selectedId of selectedIds) {
    const key = normalizeScheduleValue(selectedId);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const assignee = assigneeOptions.find(
      (option) =>
        normalizeScheduleValue(option.id) === key ||
        normalizeScheduleValue(option.email) === key ||
        normalizeScheduleValue(option.name) === key,
    );
    const email = (assignee?.email || selectedId).trim().toLowerCase();
    if (!email) {
      continue;
    }

    const role = assignee?.role || "User";
    users.push({
      email,
      name: (assignee?.name || email.split("@")[0] || email).trim(),
      role: String(role),
      accessLevel: accessLevelForRole(String(role)),
    });
  }

  return users;
}

export function parseAuditorEmailsFromSheetRecord(record: Record<string, string>): string[] {
  return getScheduleAssignedEmails({
    assignedUserEmails: extractSheetField(record, ["assigned user emails"]),
    auditorEmails: extractSheetField(record, ["auditor emails"]),
    auditors: extractSheetField(record, ["auditors", "auditor"]),
    assignedAuditors: extractSheetField(record, ["assigned auditors"]),
  });
}

export function parseAssignedUsersFromSheetRecord(record: Record<string, string>): ScheduleAssignedUser[] {
  const emailsRaw = extractSheetField(record, ["assigned user emails"]);
  if (emailsRaw) {
    const emails = emailsRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const names = extractSheetField(record, ["assigned user names"])
      .split(",")
      .map((entry) => entry.trim());
    const roles = extractSheetField(record, ["assigned user roles"])
      .split(",")
      .map((entry) => entry.trim());
    return emails.map((email, index) => ({
      email: email.trim().toLowerCase(),
      name: names[index] || email.split("@")[0] || email,
      role: roles[index] || "User",
      accessLevel: accessLevelForRole(roles[index] || "User"),
    }));
  }

  return parseAuditorEmailsFromSheetRecord(record).map((email) => ({
    email: email.trim().toLowerCase(),
    name: email.split("@")[0] || email,
    role: "User",
    accessLevel: "operational",
  }));
}

export function parseDueWindowFromSheet(value: string): { liveTime: string; completionHours: number } {
  const raw = value.trim();
  if (!raw) {
    return { liveTime: "08:00", completionHours: 24 };
  }
  const [liveTimePart, completionPart] = raw.split("|");
  const liveTime = (liveTimePart || "08:00").trim() || "08:00";
  const completionHours = Number(String(completionPart || "").replace(/[^\d.]/g, "")) || 24;
  return { liveTime, completionHours };
}

export function scheduleSheetRecordsPreferSchedulesTab(
  scheduleRecords: Record<string, string>[],
  schedulesRecords: Record<string, string>[],
): Record<string, string>[] {
  return schedulesRecords.length > 0 ? schedulesRecords : scheduleRecords;
}

function extractSheetField(record: Record<string, string>, keys: string[]): string {
  const normalizedKeys = keys.map((key) => normalizeScheduleValue(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record)) {
    const normalizedHeader = normalizeScheduleValue(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

export function formatScheduleSaveError(payload: {
  message?: string;
  error?: string;
  technicalError?: string;
  code?: string;
}): string {
  const base = payload.message || payload.error || "BERT could not save this schedule. Try again.";
  if (payload.technicalError && import.meta.env.DEV) {
    return `${base} (${payload.technicalError})`;
  }
  return base;
}
