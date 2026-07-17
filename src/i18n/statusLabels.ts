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
