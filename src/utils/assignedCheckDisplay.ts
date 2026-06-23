import type { AuditDraft } from "../types/dashboardScreenProps";
import type { Audit, ManagedSchedule } from "../types/reportsScreenProps";
import { rankAuditorAudit } from "./auditorDashboard";
import { getAuditTrafficStatus, getDueWarning } from "./dashboardHealth";
import { resolveAssignedCheckAuditId } from "./auditAccess";

export type AssignedCheckScheduleMeta = {
  scheduleName: string;
  frequency?: string;
  liveTime?: string;
};

export function buildAssignedCheckScheduleMeta(
  schedules: ManagedSchedule[],
): Record<string, AssignedCheckScheduleMeta> {
  const meta: Record<string, AssignedCheckScheduleMeta> = {};
  schedules.forEach((schedule) => {
    const scheduleName = String(schedule.scheduleName || "").trim() || "Scheduled check";
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

export function assignedCheckStatusLabel(audit: Audit, inProgress: boolean): string {
  if (audit.dueLabel === "Available") {
    return "Available";
  }
  if (inProgress) {
    return "In progress";
  }
  if (audit.dueHours < 0) {
    return "Overdue";
  }
  return getAuditTrafficStatus(audit.dueHours);
}

export function assignedCheckDueDetail(audit: Audit): string {
  return audit.dueLabel === "Available" ? "Ready to start" : getDueWarning(audit.dueHours);
}

export function assignedCheckDetailLine(
  audit: Audit,
  scheduleMeta?: AssignedCheckScheduleMeta,
): string {
  const parts = [
    scheduleMeta?.scheduleName,
    scheduleMeta?.frequency,
    scheduleMeta?.liveTime,
    assignedCheckDueDetail(audit),
  ].filter(Boolean);
  return parts.join(" · ");
}
