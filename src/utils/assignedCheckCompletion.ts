import type { AuditResultSummary } from "../types/resultsScreenProps";
import type { ManagedSchedule, ScheduleFrequency } from "../types/reportsScreenProps";

export type ScheduleCompletionStatusLabel = "Completed" | "Due now" | "Upcoming" | "Overdue";

const scheduleAmberThresholdHours = 2;
export type ScheduleListStatusChip = ScheduleCompletionStatusLabel;

export function isAssignedScheduleAuditCompletedForCurrentDue(
  scheduleAudit: { completedForCurrentDue?: boolean } | undefined,
): boolean {
  return scheduleAudit?.completedForCurrentDue === true;
}

function isCompletionStatusCompleted(status: string): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return !normalized || normalized === "completed" || normalized === "complete";
}

function normalizeAuditIdentity(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function auditIdsMatch(
  resultAuditId: string | undefined,
  ctxAuditId: string,
  resultAuditName = "",
  ctxAuditName = "",
): boolean {
  const leftId = String(resultAuditId || "").trim();
  const rightId = String(ctxAuditId || "").trim();
  if (leftId && rightId && leftId === rightId) {
    return true;
  }
  const leftName = normalizeAuditIdentity(resultAuditName);
  const rightName = normalizeAuditIdentity(ctxAuditName);
  return Boolean(leftName && rightName && leftName === rightName);
}

function subtractFrequencyFromDate(date: Date, frequency: string): Date | null {
  const next = new Date(date);
  if (!Number.isFinite(next.getTime())) {
    return null;
  }
  const normalized = String(frequency || "").trim().toLowerCase();
  if (normalized === "daily") {
    next.setDate(next.getDate() - 1);
  } else if (normalized === "bi-weekly" || normalized === "biweekly") {
    next.setDate(next.getDate() - 14);
  } else if (normalized === "monthly") {
    next.setMonth(next.getMonth() - 1);
  } else {
    next.setDate(next.getDate() - 7);
  }
  return next;
}

function duePeriodStart(nextDueAt: string, frequency: ScheduleFrequency | string, now = new Date()): Date {
  const anchor = String(nextDueAt || "").trim();
  if (anchor) {
    const due = new Date(anchor);
    if (Number.isFinite(due.getTime())) {
      const start = subtractFrequencyFromDate(due, frequency);
      if (start && Number.isFinite(start.getTime())) {
        return start;
      }
    }
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function matchesScheduleAuditResult(
  result: AuditResultSummary,
  scheduleId: string,
  auditId: string,
  auditName: string,
): boolean {
  if (String(result.scheduleId || "").trim() !== scheduleId) {
    return false;
  }
  if (!auditIdsMatch(result.auditId, auditId, result.auditName, auditName)) {
    return false;
  }
  return isCompletionStatusCompleted(result.status);
}

function isResultForCurrentDueInstance(
  result: AuditResultSummary,
  nextDueAt: string,
  frequency: string,
  now = new Date(),
): boolean {
  const completedAt = new Date(result.completedAt);
  if (!Number.isFinite(completedAt.getTime())) {
    return false;
  }
  const periodStart = duePeriodStart(nextDueAt, frequency, now);
  return completedAt.getTime() >= periodStart.getTime();
}

function resolveAuditCompletionFromResults(
  results: AuditResultSummary[],
  scheduleId: string,
  auditId: string,
  auditName: string,
  nextDueAt: string,
  frequency: string,
  now = new Date(),
): {
  completedForCurrentDue: boolean;
  lastCompletedAt?: string;
  currentDueCompletedAt?: string;
} {
  let latestCompletedAt = "";
  let latestCompletedAtMs = Number.NEGATIVE_INFINITY;
  let currentDueCompletedAt = "";

  for (const result of results) {
    if (!matchesScheduleAuditResult(result, scheduleId, auditId, auditName)) {
      continue;
    }
    const completedAt = String(result.completedAt || "").trim();
    const completedAtMs = new Date(completedAt).getTime();
    if (!completedAt || !Number.isFinite(completedAtMs)) {
      continue;
    }
    if (completedAtMs > latestCompletedAtMs) {
      latestCompletedAt = completedAt;
      latestCompletedAtMs = completedAtMs;
    }
    if (
      !currentDueCompletedAt &&
      isResultForCurrentDueInstance(result, nextDueAt, frequency, now)
    ) {
      currentDueCompletedAt = completedAt;
    }
  }

  return {
    completedForCurrentDue: Boolean(currentDueCompletedAt),
    lastCompletedAt: latestCompletedAt || undefined,
    currentDueCompletedAt: currentDueCompletedAt || undefined,
  };
}

export function isScheduleCompletedForCurrentDue(schedule: ManagedSchedule, now = new Date()): boolean {
  const audits = schedule.audits || [];
  if (audits.length > 0 && audits.every((audit) => audit.completedForCurrentDue === true)) {
    return true;
  }
  const lastCompleted = String(schedule.lastCompletedAt || "").trim();
  const nextDue = String(schedule.nextDueAt || "").trim();
  if (!lastCompleted || !nextDue) {
    return false;
  }
  const lastCompletedMs = new Date(lastCompleted).getTime();
  if (!Number.isFinite(lastCompletedMs)) {
    return false;
  }
  const frequency = schedule.audits[0]?.frequency || "Weekly";
  return lastCompletedMs >= duePeriodStart(nextDue, frequency, now).getTime();
}

export function scheduleLastCompletedLabel(schedule: ManagedSchedule): string {
  return formatScheduleLastCompletedLabel(schedule.lastCompletedAt);
}

export function scheduleNextDueLabel(schedule: ManagedSchedule): string | null {
  const nextDue = String(schedule.nextDueAt || "").trim();
  if (!nextDue) {
    return null;
  }
  return formatScheduleNextDueLabel(nextDue);
}

export function scheduleCompletionStatusLabel(
  schedule: ManagedSchedule,
  now = new Date(),
): ScheduleCompletionStatusLabel | null {
  return resolveScheduleListStatusChip(schedule, now);
}

export function resolveScheduleListStatusChip(
  schedule: ManagedSchedule,
  now = new Date(),
): ScheduleListStatusChip | null {
  if (schedule.lifecycle === "Archived" || schedule.healthState === "Paused") {
    return null;
  }
  if (isScheduleCompletedForCurrentDue(schedule, now)) {
    return "Completed";
  }
  const nextDue = String(schedule.nextDueAt || "").trim();
  if (!nextDue) {
    return (schedule.missedAuditCount || 0) > 0 ? "Overdue" : null;
  }
  const dueMs = new Date(nextDue).getTime();
  if (!Number.isFinite(dueMs)) {
    return null;
  }
  const diffHours = Math.round((dueMs - now.getTime()) / 36e5);
  if (diffHours < 0 || (schedule.missedAuditCount || 0) > 0) {
    return "Overdue";
  }
  if (diffHours < scheduleAmberThresholdHours) {
    return "Due now";
  }
  return "Upcoming";
}

export function mergeScheduleLastCompletedFromResults(
  schedules: ManagedSchedule[],
  results: AuditResultSummary[],
  now = new Date(),
): ManagedSchedule[] {
  const latestBySchedule = new Map<string, string>();
  results.forEach((result) => {
    const scheduleId = String(result.scheduleId || "").trim();
    const completedAt = String(result.completedAt || "").trim();
    if (!scheduleId || !completedAt || !isCompletionStatusCompleted(result.status)) {
      return;
    }
    const completedAtMs = new Date(completedAt).getTime();
    if (!Number.isFinite(completedAtMs)) {
      return;
    }
    const existing = latestBySchedule.get(scheduleId);
    if (!existing || completedAtMs > new Date(existing).getTime()) {
      latestBySchedule.set(scheduleId, completedAt);
    }
  });

  return schedules.map((schedule) => {
    const scheduleId = String(schedule.id || "").trim();
    const nextDueAt = String(schedule.nextDueAt || "").trim();
    const audits = (schedule.audits || []).map((audit) => {
      const auditId = String(audit.auditId || "").trim();
      const auditName = String(audit.auditName || "").trim();
      const completion = resolveAuditCompletionFromResults(
        results,
        scheduleId,
        auditId,
        auditName,
        nextDueAt,
        String(audit.frequency || "Weekly"),
        now,
      );
      return {
        ...audit,
        completedForCurrentDue:
          audit.completedForCurrentDue === true || completion.completedForCurrentDue,
        lastCompletedAt: completion.lastCompletedAt || audit.lastCompletedAt,
        currentDueCompletedAt: completion.currentDueCompletedAt || audit.currentDueCompletedAt,
      };
    });

    const mergedLastCompleted = latestBySchedule.get(scheduleId);
    const existingLastCompleted = String(schedule.lastCompletedAt || "").trim();
    let lastCompletedAt = existingLastCompleted || undefined;
    if (mergedLastCompleted) {
      if (
        !existingLastCompleted ||
        new Date(mergedLastCompleted).getTime() > new Date(existingLastCompleted).getTime()
      ) {
        lastCompletedAt = mergedLastCompleted;
      }
    }

    return {
      ...schedule,
      audits,
      lastCompletedAt,
    };
  });
}

export function formatAssignedCheckLastCompletedAt(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "Not yet completed";
  }
  return formatScheduleDateTime(trimmed);
}

export function formatScheduleDateTime(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    return trimmed;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatScheduleLastCompletedLabel(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "Never completed";
  }
  return formatScheduleDateTime(trimmed);
}

export function formatScheduleNextDueLabel(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const formatted = formatScheduleDateTime(trimmed);
  const diffHours = Math.round((new Date(trimmed).getTime() - Date.now()) / 36e5);
  if (diffHours < 0) {
    return `${formatted} (overdue)`;
  }
  if (diffHours < scheduleAmberThresholdHours) {
    return `${formatted} (due now)`;
  }
  return formatted;
}
