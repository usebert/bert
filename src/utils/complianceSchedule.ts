import type { ComplianceScheduleRow } from "../types/complianceLoop";
import {
  getScheduleAssignedEmails,
  isScheduleAssignedToAnyEmail,
} from "./scheduleAssignment";

export function isScheduleDue(nextDueDate: string, today = new Date()): boolean {
  if (!nextDueDate.trim()) {
    return true;
  }
  const due = new Date(nextDueDate);
  if (!Number.isFinite(due.getTime())) {
    return true;
  }
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  return due.getTime() <= endOfToday.getTime();
}

export function userMatchesScheduleAssignment(
  schedule: ComplianceScheduleRow,
  _user: { name: string; username: string; role: string },
  userEmails: Set<string>,
): boolean {
  void _user;
  const assignedEmails = getScheduleAssignedEmails(schedule);
  if (assignedEmails.length === 0) {
    const legacyAssigned = String(schedule.assignedUser || "").trim();
    if (!legacyAssigned) {
      return true;
    }
    return isScheduleAssignedToAnyEmail({ assignedUserEmails: legacyAssigned }, userEmails);
  }
  return isScheduleAssignedToAnyEmail(schedule, userEmails);
}

function isActiveScheduleRow(schedule: ComplianceScheduleRow): boolean {
  const status = (schedule.status || "").trim().toLowerCase();
  return status !== "paused" && status !== "archived";
}

export function schedulesForAudit(
  auditId: string,
  auditName: string,
  areaId: string,
  schedules: ComplianceScheduleRow[],
  companyFolderId: string,
): ComplianceScheduleRow[] {
  const normalizedName = auditName.trim().toLowerCase();
  return schedules.filter((schedule) => {
    if (schedule.companyFolderId && schedule.companyFolderId !== companyFolderId) {
      return false;
    }
    const auditMatch =
      schedule.auditId === auditId ||
      schedule.auditName.trim().toLowerCase() === normalizedName;
    if (!auditMatch) {
      return false;
    }
    if (schedule.areaId && areaId && schedule.areaId !== areaId) {
      return false;
    }
    const status = (schedule.status || "").trim().toLowerCase();
    return status !== "paused" && status !== "archived";
  });
}

export function auditIsDueFromSchedules(
  auditId: string,
  auditName: string,
  areaId: string,
  schedules: ComplianceScheduleRow[],
  companyFolderId: string,
): boolean {
  const matching = schedulesForAudit(auditId, auditName, areaId, schedules, companyFolderId);
  if (matching.length === 0) {
    return true;
  }
  return matching.some(
    (schedule) => isActiveScheduleRow(schedule) && (isScheduleDue(schedule.nextDueDate) || Boolean(schedule.nextDueDate.trim())),
  );
}

export function computeDueHoursFromSchedule(nextDueDate: string): number {
  if (!nextDueDate.trim()) {
    return 24;
  }
  const due = new Date(nextDueDate);
  if (!Number.isFinite(due.getTime())) {
    return 24;
  }
  return Math.round((due.getTime() - Date.now()) / 36e5);
}

export function nearestNextDueDate(
  auditId: string,
  auditName: string,
  areaId: string,
  schedules: ComplianceScheduleRow[],
  companyFolderId: string,
): string {
  const matching = schedulesForAudit(auditId, auditName, areaId, schedules, companyFolderId);
  const dates = matching
    .map((schedule) => schedule.nextDueDate)
    .filter((value) => value.trim())
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  return dates[0] || "";
}

export function complianceSchedulesFromManaged(
  managed: Array<{
    id: string;
    companyFolderId: string;
    lifecycle: string;
    nextDueAt?: string;
    auditors?: string[];
    assignedUserEmails?: string[];
    assignedUsers?: Array<{ email?: string }>;
    audits: Array<{ auditId: string; auditName: string; frequency: string }>;
  }>,
): ComplianceScheduleRow[] {
  return managed.flatMap((schedule) => {
    const assignedEmails = getScheduleAssignedEmails(schedule);
    return schedule.audits.map((audit) => ({
      scheduleId: schedule.id,
      areaId: "",
      auditId: audit.auditId,
      auditName: audit.auditName,
      frequency: audit.frequency,
      nextDueDate: schedule.nextDueAt || "",
      assignedRole: "",
      assignedUser: assignedEmails.join(", "),
      assignedUserEmails: assignedEmails,
      companyFolderId: schedule.companyFolderId,
      status: schedule.lifecycle === "Archived" ? "archived" : "active",
    }));
  });
}
