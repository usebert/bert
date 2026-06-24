/**
 * Schedule completion mode — repeatable (default) vs once-per-period.
 */

function trim(value) {
  return String(value ?? "").trim();
}

const ONCE_PER_PERIOD_ALIASES = new Set([
  "once-per-period",
  "once per period",
  "once per due period",
  "once-per-due-period",
  "once",
]);

export function normalizeScheduleCompletionMode(value) {
  const normalized = trim(value).toLowerCase().replace(/_/g, "-");
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

export function resolveScheduleCompletionMode(schedule = {}) {
  return normalizeScheduleCompletionMode(schedule.completionMode || schedule["Completion Mode"]) || "repeatable";
}

export function isOncePerPeriodSchedule(schedule = {}) {
  return resolveScheduleCompletionMode(schedule) === "once-per-period";
}

export function shouldHideCompletedAssignedScheduleAudit(schedule = {}, scheduleAudit = {}) {
  if (!isOncePerPeriodSchedule(schedule)) {
    return false;
  }
  return scheduleAudit.completedForCurrentDue === true;
}

export function formatScheduleCompletionModeLabel(mode) {
  return resolveScheduleCompletionMode({ completionMode: mode }) === "once-per-period"
    ? "Once per due period"
    : "Repeatable";
}
