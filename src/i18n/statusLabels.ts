/**
 * Display-only status / result label helpers.
 * Stored API / sheet values stay unchanged — only UI labels are translated.
 */
import type { TFunction } from "i18next";

export function translateLolerComplianceStatus(t: TFunction, status: string): string {
  switch (String(status || "").toLowerCase()) {
    case "compliant":
      return t("loler.status.compliant");
    case "due_soon":
      return t("status.dueSoonLabel");
    case "overdue":
      return t("status.overdueLabel");
    case "out_of_service":
      return t("status.outOfService");
    case "archived":
      return t("status.archived");
    case "upcoming":
      return t("status.upcoming");
    case "completed":
      return t("status.completed");
    case "cancelled":
      return t("status.cancelled");
    case "active":
      return t("status.active");
    default:
      return status || "—";
  }
}

export function translateLolerExaminationResult(t: TFunction, result: string): string {
  switch (String(result || "").toLowerCase()) {
    case "passed":
      return t("loler.result.passed");
    case "passed_with_observations":
      return t("loler.result.passedWithObservations");
    case "failed":
      return t("loler.result.failed");
    default:
      return result || "—";
  }
}

export function translateCalendarStatus(t: TFunction, status: string): string {
  switch (String(status || "").toLowerCase()) {
    case "upcoming":
      return t("status.upcoming");
    case "due_soon":
      return t("status.dueSoonLabel");
    case "overdue":
      return t("status.overdueLabel");
    case "completed":
      return t("status.completed");
    case "archived":
      return t("status.archived");
    case "cancelled":
      return t("status.cancelled");
    default:
      return status || "—";
  }
}

export function translatePriority(t: TFunction, priority: string): string {
  switch (String(priority || "").toLowerCase()) {
    case "low":
      return t("common.priorityLow");
    case "normal":
      return t("common.priorityNormal");
    case "high":
      return t("common.priorityHigh");
    case "urgent":
      return t("common.priorityUrgent");
    default:
      return priority || "—";
  }
}

export function translateRoleLabel(t: TFunction, role: string): string {
  switch (String(role || "").toLowerCase()) {
    case "master":
      return t("roles.master");
    case "admin":
    case "companyadmin":
    case "company_admin":
      return t("roles.admin");
    case "manager":
      return t("roles.manager");
    case "auditor":
      return t("roles.auditor");
    case "viewer":
      return t("roles.viewer");
    default:
      return role || "—";
  }
}

export function translateScheduleFrequency(t: TFunction, frequency: string): string {
  switch (String(frequency || "").toLowerCase()) {
    case "daily":
      return t("schedules.frequencyDaily");
    case "weekly":
      return t("schedules.frequencyWeekly");
    case "monthly":
      return t("schedules.frequencyMonthly");
    case "custom":
      return t("schedules.frequencyCustom");
    default:
      return frequency || "—";
  }
}

export function translateSyncQueueStatus(t: TFunction, status: string): string {
  switch (String(status || "")) {
    case "Pending Sync":
      return t("syncCentre.queued");
    case "Syncing":
      return t("syncCentre.syncing");
    case "Synced":
      return t("syncCentre.synced");
    case "Failed":
      return t("syncCentre.failed");
    case "Conflict":
      return t("syncCentre.failedConflict");
    default:
      return status || "—";
  }
}

export function translateSyncItemType(t: TFunction, itemType: string): string {
  switch (String(itemType || "")) {
    case "auditCompletion":
      return t("syncCentre.checkCompletion");
    case "auditSubmission":
      return t("syncCentre.auditSubmission");
    case "incidentReport":
      return t("syncCentre.incidentReport");
    case "actionUpdate":
      return t("syncCentre.actionUpdate");
    case "briefingCreate":
      return t("syncCentre.briefingCreated");
    case "briefingAck":
      return t("syncCentre.briefingAck");
    default:
      return t("syncCentre.queuedItem");
  }
}
