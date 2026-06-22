import { buildAvailableAuditFromTemplate } from "./auditAccess";
import {
  complianceSchedulesFromManaged,
  nearestNextDueDate,
  computeDueHoursFromSchedule,
} from "./complianceSchedule";
import type { Audit, AuditQuestion, AuditTemplate, ManagedSchedule } from "../types/reportsScreenProps";

export const ASSIGNED_CHECK_PLACEHOLDER_QUESTIONS: AuditQuestion[] = [
  {
    id: "scheduled-check-outcome",
    text: "Record the outcome of this scheduled check.",
    fieldType: "Pass / Fail",
    required: true,
  },
  {
    id: "scheduled-check-notes",
    text: "Notes or observations",
    fieldType: "Paragraph",
    required: false,
  },
];

export function resolveScheduleAuditTemplate(
  templates: AuditTemplate[],
  auditId: string,
  auditName: string,
): AuditTemplate | undefined {
  const normalizedName = auditName.trim().toLowerCase();
  return templates.find(
    (template) =>
      template.active &&
      (template.id === auditId ||
        template.name.trim().toLowerCase() === normalizedName ||
        (normalizedName && template.name.trim().toLowerCase().includes(normalizedName)) ||
        (normalizedName && normalizedName.includes(template.name.trim().toLowerCase()))),
  );
}

export function buildPlaceholderAuditFromScheduleAudit(
  scheduleAudit: { auditId: string; auditName: string },
  siteArea: string,
  owner: string,
  dueLabel: string,
  dueHours: number,
): Audit {
  const auditId = String(scheduleAudit.auditId || scheduleAudit.auditName || "scheduled-check").trim();
  const auditName = String(scheduleAudit.auditName || auditId || "Scheduled check").trim();
  return {
    id: auditId,
    name: auditName,
    category: "Scheduled check",
    siteArea,
    dueLabel,
    dueHours,
    priority: "Medium",
    owner,
    templateVersion: "scheduled-check-placeholder",
    status: "green",
    lastCompletedAt: "Not yet completed",
    questions: ASSIGNED_CHECK_PLACEHOLDER_QUESTIONS,
  };
}

export type BuildAuditsFromAssignedSchedulesInput = {
  schedules: ManagedSchedule[];
  templates: AuditTemplate[];
  siteArea: string;
  owner: string;
  companyFolderId?: string;
};

/** Map assigned schedule rows into actionable My Checks audit cards. */
export function buildAuditsFromAssignedSchedules(input: BuildAuditsFromAssignedSchedulesInput): Audit[] {
  const companyFolderId = String(input.companyFolderId || "").trim();
  const apiCompliance = complianceSchedulesFromManaged(input.schedules);
  const built: Audit[] = [];
  const seen = new Set<string>();

  input.schedules.forEach((schedule) => {
    schedule.audits.forEach((scheduleAudit) => {
      const auditId = String(scheduleAudit.auditId || "").trim();
      const auditName = String(scheduleAudit.auditName || "").trim();
      const key = auditId || auditName.toLowerCase();
      if (!key || seen.has(key)) {
        return;
      }

      const template = resolveScheduleAuditTemplate(input.templates, auditId, auditName);
      const nextDue = nearestNextDueDate(auditId, auditName, "area-main", apiCompliance, companyFolderId);
      const dueHours = nextDue ? computeDueHoursFromSchedule(nextDue) : 24;
      const dueLabel =
        !nextDue.trim()
          ? "Available"
          : dueHours < 0
            ? "Overdue"
            : dueHours <= 24
              ? "Due today"
              : "Upcoming";

      const audit = template
        ? {
            ...buildAvailableAuditFromTemplate(
              template,
              input.siteArea,
              input.owner,
              dueLabel === "Available" ? "Available" : dueLabel,
            ),
            dueHours,
            dueLabel,
          }
        : buildPlaceholderAuditFromScheduleAudit(
            { auditId: auditId || key, auditName: auditName || auditId || "Scheduled check" },
            input.siteArea,
            input.owner,
            dueLabel,
            dueHours,
          );

      seen.add(key);
      built.push(audit);
    });
  });

  return built;
}
