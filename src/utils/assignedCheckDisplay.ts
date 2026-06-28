import type { AuditDraft } from "../types/dashboardScreenProps";
import type { Audit, ManagedSchedule } from "../types/reportsScreenProps";
import { rankAuditorAudit } from "./auditorDashboard";
import { amberThresholdHours, getDueWarning } from "./dashboardHealth";
import { resolveAssignedCheckAuditId } from "./auditAccess";
import { formatScheduleDateTime } from "./assignedCheckCompletion";
import { resolveScheduleCompletionMode } from "./scheduleCompletionMode";
import type { ScheduleCompletionMode } from "../types/reportsScreenProps";

export type AssignedCheckCardStatus = "Due" | "Overdue" | "Completed" | "Not due yet";

export type AssignedCheckScheduleMeta = {
  scheduleName: string;
  frequency?: string;
  liveTime?: string;
  nextDueAt?: string;
  completionMode?: ScheduleCompletionMode;
  completedForCurrentDue?: boolean;
};

export function buildAssignedCheckScheduleMeta(
  schedules: ManagedSchedule[],
): Record<string, AssignedCheckScheduleMeta> {
  const meta: Record<string, AssignedCheckScheduleMeta> = {};
  schedules.forEach((schedule) => {
    const scheduleName = String(schedule.scheduleName || "").trim() || "Scheduled check";
    const nextDueAt = String(schedule.nextDueAt || "").trim() || undefined;
    schedule.audits.forEach((scheduleAudit) => {
      const auditId = String(scheduleAudit.auditId || "").trim();
      const auditName = String(scheduleAudit.auditName || scheduleName).trim();
      const resolvedAuditId = resolveAssignedCheckAuditId(auditId, auditName);
      if (!resolvedAuditId) {
        return;
      }
      meta[resolvedAuditId] = {
        scheduleName,
        frequency: String(scheduleAudit.frequency || "").trim() || undefined,
        liveTime: String(scheduleAudit.liveTime || "").trim() || undefined,
        nextDueAt,
        completionMode: resolveScheduleCompletionMode(schedule),
        completedForCurrentDue: scheduleAudit.completedForCurrentDue === true,
      };
    });
  });
  return meta;
}

export function sortAssignedChecksForAction(audits: Audit[], drafts: Record<string, AuditDraft>): Audit[] {
  return [...audits].sort((a, b) => {
    const rankDiff = rankAuditorAudit(a, Boolean(drafts[a.id])) - rankAuditorAudit(b, Boolean(drafts[b.id]));
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.dueHours - b.dueHours;
  });
}

export function assignedCheckCardStatus(
  audit: Audit,
  inProgress: boolean,
  completedForCurrentDue = false,
  completionMode: AssignedCheckScheduleMeta["completionMode"] = "repeatable",
): AssignedCheckCardStatus {
  if (completedForCurrentDue && completionMode === "repeatable") {
    return "Completed";
  }
  if (completedForCurrentDue && completionMode === "once-per-period") {
    return "Completed";
  }
  if (audit.dueHours < 0) {
    return "Overdue";
  }
  if (audit.dueLabel === "Available" || audit.dueLabel === "Upcoming") {
    return "Not due yet";
  }
  if (!inProgress && audit.dueHours > 24) {
    return "Not due yet";
  }
  if (audit.dueLabel === "Due today" || audit.dueHours <= 24) {
    return "Due";
  }
  if (audit.dueHours <= amberThresholdHours) {
    return "Due";
  }
  return "Not due yet";
}

/** @deprecated Use assignedCheckCardStatus — kept for callers expecting a string label. */
export function assignedCheckStatusLabel(
  audit: Audit,
  inProgress: boolean,
  completedForCurrentDue = false,
  completionMode: AssignedCheckScheduleMeta["completionMode"] = "repeatable",
): string {
  return assignedCheckCardStatus(audit, inProgress, completedForCurrentDue, completionMode);
}

export type AssignedCheckStatusTone = "danger" | "warning" | "success" | "info" | "neutral";

export function assignedCheckStatusTone(status: AssignedCheckCardStatus): AssignedCheckStatusTone {
  if (status === "Overdue") {
    return "danger";
  }
  if (status === "Due") {
    return "warning";
  }
  if (status === "Completed") {
    return "success";
  }
  return "info";
}

export function filterAssignedChecksForThingsToDo(
  audits: Audit[],
  drafts: Record<string, AuditDraft>,
  scheduleMetaByAuditId: Record<string, AssignedCheckScheduleMeta>,
): Audit[] {
  return audits.filter((audit) => {
    const inProgress = Boolean(drafts[audit.id]);
    const meta = scheduleMetaByAuditId[audit.id];
    const status = assignedCheckCardStatus(
      audit,
      inProgress,
      meta?.completedForCurrentDue === true,
      meta?.completionMode,
    );
    if (status === "Not due yet" && !inProgress) {
      return false;
    }
    return true;
  });
}

export function assignedCheckDueDetail(audit: Audit): string {
  return audit.dueLabel === "Available" ? "Ready to start" : getDueWarning(audit.dueHours);
}

export function assignedCheckDueWindowLine(
  audit: Audit,
  scheduleMeta?: AssignedCheckScheduleMeta,
): string {
  const nextDueAt = String(scheduleMeta?.nextDueAt || "").trim();
  if (nextDueAt) {
    const formatted = formatScheduleDateTime(nextDueAt);
    if (audit.dueHours < 0) {
      return `Due ${formatted} · ${assignedCheckDueDetail(audit)}`;
    }
    if (audit.dueHours <= amberThresholdHours || audit.dueLabel === "Due today") {
      return `Due ${formatted} · due now`;
    }
    return `Due ${formatted}`;
  }
  if (scheduleMeta?.liveTime) {
    return `Window ${scheduleMeta.liveTime} · ${assignedCheckDueDetail(audit)}`;
  }
  return assignedCheckDueDetail(audit);
}

export function assignedCheckFrequencyLine(scheduleMeta?: AssignedCheckScheduleMeta): string | null {
  const frequency = String(scheduleMeta?.frequency || "").trim();
  if (!frequency) {
    return null;
  }
  const liveTime = String(scheduleMeta?.liveTime || "").trim();
  return liveTime ? `${frequency} · ${liveTime}` : frequency;
}

export function assignedCheckDetailLine(
  audit: Audit,
  scheduleMeta?: AssignedCheckScheduleMeta,
): string {
  const parts = [
    scheduleMeta?.scheduleName,
    assignedCheckFrequencyLine(scheduleMeta),
    assignedCheckDueWindowLine(audit, scheduleMeta),
  ].filter(Boolean);
  return parts.join(" · ");
}
