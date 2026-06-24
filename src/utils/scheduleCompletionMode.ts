import type { ManagedSchedule, ManagedScheduleAudit } from "../types/reportsScreenProps";

export type ScheduleCompletionMode = "repeatable" | "once-per-period";

const ONCE_PER_PERIOD_ALIASES = new Set([
  "once-per-period",
  "once per period",
  "once per due period",
  "once-per-due-period",
  "once",
]);

export function normalizeScheduleCompletionMode(
  value: string | undefined | null,
): ScheduleCompletionMode | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!normalized) {
    return null;
  }
  if (ONCE_PER_PERIOD_ALIASES.has(normalized)) {
    return "once-per-period";
  }
  if (normalized === "repeatable" || normalized === "repeat") {
    return "repeatable";
  }
  return null;
}

/** Default is repeatable — only hide completed due instances when explicitly once-per-period. */
export function resolveScheduleCompletionMode(
  schedule: Pick<ManagedSchedule, "completionMode"> | undefined,
): ScheduleCompletionMode {
  return normalizeScheduleCompletionMode(schedule?.completionMode) || "repeatable";
}

export function isOncePerPeriodSchedule(schedule: Pick<ManagedSchedule, "completionMode"> | undefined): boolean {
  return resolveScheduleCompletionMode(schedule) === "once-per-period";
}

export function formatScheduleCompletionModeLabel(mode: ScheduleCompletionMode | string | undefined): string {
  const resolved = normalizeScheduleCompletionMode(mode) || "repeatable";
  return resolved === "once-per-period" ? "Once per due period" : "Repeatable";
}

export function shouldHideCompletedAssignedScheduleAudit(
  schedule: Pick<ManagedSchedule, "completionMode"> | undefined,
  scheduleAudit: Pick<ManagedScheduleAudit, "completedForCurrentDue"> | undefined,
): boolean {
  if (!isOncePerPeriodSchedule(schedule)) {
    return false;
  }
  return scheduleAudit?.completedForCurrentDue === true;
}

export function isAssignedScheduleAuditHiddenForCompletion(
  schedule: Pick<ManagedSchedule, "completionMode"> | undefined,
  scheduleAudit: Pick<ManagedScheduleAudit, "completedForCurrentDue"> | undefined,
): boolean {
  return shouldHideCompletedAssignedScheduleAudit(schedule, scheduleAudit);
}
