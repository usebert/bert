import type { ScheduleAssigneeOption } from "./scheduleAssignees";
import { normalizeScheduleValue } from "./scheduleAssignees";

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
  const assignedEmails = extractSheetField(record, ["assigned user emails"]);
  if (assignedEmails) {
    return assignedEmails
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  const legacy = extractSheetField(record, ["auditors", "auditor emails", "assigned auditors", "auditor"]);
  if (!legacy) {
    return [];
  }

  return legacy
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
