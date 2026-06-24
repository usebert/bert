import type { AuditResultSummary } from "../types/resultsScreenProps";
import type { ManagedSchedule } from "../types/reportsScreenProps";

export function isAssignedScheduleAuditCompletedForCurrentDue(
  scheduleAudit: { completedForCurrentDue?: boolean } | undefined,
): boolean {
  return scheduleAudit?.completedForCurrentDue === true;
}

export function mergeScheduleLastCompletedFromResults(
  schedules: ManagedSchedule[],
  results: AuditResultSummary[],
): ManagedSchedule[] {
  const latestBySchedule = new Map<string, string>();
  results.forEach((result) => {
    const scheduleId = String(result.scheduleId || "").trim();
    const completedAt = String(result.completedAt || "").trim();
    const status = String(result.status || "completed").trim().toLowerCase();
    if (!scheduleId || !completedAt) {
      return;
    }
    if (status && status !== "completed" && status !== "complete") {
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
    const mergedLastCompleted = latestBySchedule.get(schedule.id);
    if (!mergedLastCompleted) {
      return schedule;
    }
    const existing = String(schedule.lastCompletedAt || "").trim();
    if (existing && new Date(existing).getTime() >= new Date(mergedLastCompleted).getTime()) {
      return schedule;
    }
    return {
      ...schedule,
      lastCompletedAt: mergedLastCompleted,
    };
  });
}

export function formatAssignedCheckLastCompletedAt(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "Not yet completed";
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
