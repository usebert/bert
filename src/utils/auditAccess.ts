import type { AuditAccessLevel } from "../types/auditsScreenProps";
import type { Audit, AuditQuestion, AuditTemplate, ManagedSchedule } from "../types/reportsScreenProps";
import type { User } from "../types/dashboardScreenProps";
import { GOOGLE_FORM_IMPORT_STATUS } from "./googleFormImportQuestions";
import { buildGoogleFormImportQuestions } from "./googleFormImportQuestions";
import {
  assignedCheckDueLabelFromState,
  computeAssignedCheckDueHours,
  resolveScheduleDueOccurrence,
} from "./scheduleDue";
import {
  formatAssignedCheckLastCompletedAt,
} from "./assignedCheckCompletion";
import { shouldHideCompletedAssignedScheduleAudit } from "./scheduleCompletionMode";

export type CompanyReportUserLike = {
  name: string;
  email: string;
  username?: string;
};

export function normalizeAuditAccessLevel(access: AuditAccessLevel): AuditAccessLevel {
  if (access === "Complete") {
    return "Can complete";
  }
  return access;
}

export function isAuditorCompletableAccess(access: AuditAccessLevel): boolean {
  const normalized = normalizeAuditAccessLevel(access);
  return normalized === "Can complete" || normalized === "Full access";
}

export function resolveCurrentUserReportEmails(
  currentUser: User,
  companyReportUsers: CompanyReportUserLike[],
): Set<string> {
  const normalizedName = normalizeIdentity(currentUser.name);
  const normalizedUsername = normalizeIdentity(currentUser.username);
  const usernameIsEmail = currentUser.username.includes("@");
  const primaryEmail = usernameIsEmail
    ? normalizedUsername
    : normalizeIdentity(`${currentUser.username}@usebert.co.uk`);
  const legacyEmail = usernameIsEmail ? "" : normalizeIdentity(`${currentUser.username}@qmsprecast.co.uk`);

  const emails = new Set<string>();
  if (primaryEmail) {
    emails.add(primaryEmail);
  }
  if (legacyEmail) {
    emails.add(legacyEmail);
  }
  if (usernameIsEmail) {
    emails.add(normalizedUsername);
  }

  companyReportUsers.forEach((user) => {
    const userName = normalizeIdentity(user.name);
    const userEmail = normalizeIdentity(user.email);
    const userEmailLocalPart = normalizeIdentity(user.email.split("@")[0]);
    const userUsername = normalizeIdentity(user.username || "");
    const matchesUser =
      userName === normalizedName ||
      userEmail === primaryEmail ||
      userEmail === legacyEmail ||
      userEmailLocalPart === normalizedUsername ||
      userUsername === normalizedUsername ||
      (usernameIsEmail && userEmail === normalizedUsername);
    if (matchesUser && userEmail) {
      emails.add(userEmail);
    }
  });

  return emails;
}

export function buildAvailableAuditFromTemplate(
  template: AuditTemplate,
  siteArea: string,
  owner: string,
  dueLabel = "Available",
): Audit {
  return {
    id: template.id,
    name: template.name,
    category: template.source,
    siteArea,
    dueLabel,
    dueHours: 24,
    priority: "Medium",
    owner,
    templateVersion: template.source,
    status: "green",
    lastCompletedAt: "Not yet completed",
    questions: template.questions,
  };
}

function normalizeIdentity(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ").trim();
}

function findTemplateForAssignedSchedule(
  templates: AuditTemplate[],
  auditId: string,
  auditName: string,
): AuditTemplate | undefined {
  const normalizedName = normalizeIdentity(auditName);
  return templates.find((item) => {
    if (item.id === auditId) {
      return true;
    }
    if (normalizeIdentity(item.name) === normalizedName) {
      return true;
    }
    return item.name === auditName;
  });
}

function questionsForAssignedScheduleTemplate(template: AuditTemplate): AuditQuestion[] {
  if (Array.isArray(template.questions) && template.questions.length > 0) {
    return template.questions;
  }
  const isGoogleFormImport =
    String(template.translationStatus || "").trim() === GOOGLE_FORM_IMPORT_STATUS ||
    Boolean(template.googleForm?.formId || template.googleForm?.responderUrl);
  if (isGoogleFormImport) {
    return buildGoogleFormImportQuestions(template.name, template.googleForm?.responderUrl);
  }
  return [
    {
      id: `${template.id || template.name}-check`,
      text: `Complete check: ${template.name}`,
      riskLevel: "Medium",
      riskCategory: "Quality",
      autoActionRequired: false,
      requiresPhotoEvidence: false,
      requiresManagerReview: false,
    },
  ];
}

/** Stable audit id for assigned-check UI + completion when schedule row omits auditId. */
export function resolveAssignedCheckAuditId(auditId: string, auditName: string): string {
  const trimmedId = String(auditId || "").trim();
  if (trimmedId) {
    return trimmedId;
  }
  const name = String(auditName || "").trim();
  if (!name) {
    return "scheduled-check";
  }
  return normalizeIdentity(name).replace(/\s+/g, "-") || "scheduled-check";
}

/** Build an actionable audit for My Checks from a schedule row + optional template match. */
export function buildAuditFromAssignedSchedule(input: {
  auditId: string;
  auditName: string;
  scheduleName?: string;
  templates: AuditTemplate[];
  siteArea: string;
  owner: string;
  dueLabel?: string;
  dueHours?: number;
  lastCompletedAt?: string;
}): Audit {
  const auditId = String(input.auditId || "").trim();
  const auditName = String(input.auditName || input.scheduleName || "Scheduled check").trim() || "Scheduled check";
  const resolvedAuditId = resolveAssignedCheckAuditId(auditId, auditName);
  const template = findTemplateForAssignedSchedule(input.templates, auditId, auditName);
  const dueLabel = input.dueLabel || "Available";
  const dueHours = typeof input.dueHours === "number" ? input.dueHours : 24;
  const lastCompletedAt = input.lastCompletedAt
    ? formatAssignedCheckLastCompletedAt(input.lastCompletedAt)
    : "Not yet completed";

  if (template) {
    return {
      ...buildAvailableAuditFromTemplate(template, input.siteArea, input.owner, dueLabel),
      id: resolvedAuditId || template.id,
      name: auditName || template.name,
      questions: questionsForAssignedScheduleTemplate(template),
      dueHours,
      dueLabel,
      lastCompletedAt,
    };
  }

  return {
    id: resolvedAuditId,
    name: auditName,
    category: "Scheduled check",
    siteArea: input.siteArea,
    dueLabel,
    dueHours,
    priority: "Medium",
    owner: input.owner,
    templateVersion: "Scheduled check",
    status: "green",
    lastCompletedAt,
    questions: buildGoogleFormImportQuestions(auditName),
  };
}

/** Complete Work / My Checks — built only from GET /api/me/assigned-checks schedules. */
export function buildCompleteWorkAssignedAudits(input: {
  schedules: ManagedSchedule[];
  templates: AuditTemplate[];
  siteArea: string;
  owner: string;
  companyFolderId?: string;
}): Audit[] {
  const built: Audit[] = [];
  const seen = new Set<string>();

  input.schedules.forEach((schedule) => {
    schedule.audits.forEach((scheduleAudit) => {
      if (shouldHideCompletedAssignedScheduleAudit(schedule, scheduleAudit)) {
        return;
      }
      const auditId = String(scheduleAudit.auditId || "").trim();
      const auditName = String(scheduleAudit.auditName || schedule.scheduleName || "Scheduled check").trim();
      const resolvedAuditId = resolveAssignedCheckAuditId(auditId, auditName);
      const key = resolvedAuditId || auditName.trim().toLowerCase();
      if (!key || seen.has(key)) {
        return;
      }
      const dueState = resolveScheduleDueOccurrence(
        {
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          liveTime: scheduleAudit.liveTime,
          completionHours: scheduleAudit.completionHours,
          frequency: scheduleAudit.frequency,
          days: scheduleAudit.days,
          nextDueAt: schedule.nextDueAt,
        },
      );
      const dueHours = computeAssignedCheckDueHours(dueState);
      const dueLabel = assignedCheckDueLabelFromState(dueState, dueHours);
      seen.add(key);
      built.push(
        buildAuditFromAssignedSchedule({
          auditId,
          auditName,
          scheduleName: schedule.scheduleName,
          templates: input.templates,
          siteArea: input.siteArea,
          owner: input.owner,
          dueLabel,
          dueHours,
          lastCompletedAt: scheduleAudit.lastCompletedAt,
        }),
      );
    });
  });

  return built;
}
