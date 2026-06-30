/**
 * Schedule due occurrence — mirrors shared/schedule-due.mjs for the client bundle.
 * Option A: scheduled time passed but still inside completion window → due now.
 */

export type ScheduleDueRejectReason =
  | "not_due_yet"
  | "window_closed"
  | "after_end_date"
  | null;

export type ScheduleDueOccurrence = {
  dueAt: string;
  windowEnd: string;
  isDueNow: boolean;
  rejectReason: ScheduleDueRejectReason;
  nextDueAt: string;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseScheduleDatePart(raw: string): Date | null {
  const value = trim(raw);
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  const dmyMatch = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmyMatch) {
    const parsed = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function parseLiveTimeParts(raw: string): { hours: number; minutes: number } {
  const value = trim(raw) || "08:00";
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return { hours: 8, minutes: 0 };
  }
  return {
    hours: Math.min(23, Math.max(0, Number(match[1]))),
    minutes: Math.min(59, Math.max(0, Number(match[2]))),
  };
}

export function combineLocalDateAndTime(datePart: Date, liveTimeRaw: string): Date {
  const { hours, minutes } = parseLiveTimeParts(liveTimeRaw);
  return new Date(datePart.getFullYear(), datePart.getMonth(), datePart.getDate(), hours, minutes, 0, 0);
}

export function normalizeScheduleFrequency(raw: string): "daily" | "weekly" | "bi-weekly" | "monthly" {
  const value = trim(raw).toLowerCase();
  if (value === "daily") {
    return "daily";
  }
  if (value === "bi-weekly" || value === "biweekly") {
    return "bi-weekly";
  }
  if (value === "monthly") {
    return "monthly";
  }
  return "weekly";
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function addMonths(date: Date, count: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + count);
  return next;
}

function dayIndexFromToken(raw: string): number {
  const token = trim(raw).toLowerCase().slice(0, 3);
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[token] ?? -1;
}

function firstOccurrenceFromStart(
  startDate: string,
  liveTime: string,
  frequency: string,
  days: string[] = [],
): Date {
  const start = parseScheduleDatePart(startDate);
  const freq = normalizeScheduleFrequency(frequency);
  const anchorDay = start || startOfLocalDay(new Date());

  if (freq === "weekly" && days.length > 0) {
    const dayIndexes = days.map(dayIndexFromToken).filter((index) => index >= 0);
    if (dayIndexes.length > 0 && !dayIndexes.includes(anchorDay.getDay())) {
      for (let offset = 0; offset < 7; offset += 1) {
        const candidateDay = addDays(anchorDay, offset);
        if (dayIndexes.includes(candidateDay.getDay())) {
          return combineLocalDateAndTime(candidateDay, liveTime);
        }
      }
    }
  }

  return combineLocalDateAndTime(anchorDay, liveTime);
}

export function nextOccurrenceAfter(dueAt: Date, frequency: string, liveTime: string, days: string[] = []): Date {
  const freq = normalizeScheduleFrequency(frequency);
  const datePart = startOfLocalDay(dueAt);

  if (freq === "daily") {
    return combineLocalDateAndTime(addDays(datePart, 1), liveTime);
  }

  if (freq === "weekly" || freq === "bi-weekly") {
    const step = freq === "bi-weekly" ? 14 : 7;
    const dayIndexes = days.map(dayIndexFromToken).filter((index) => index >= 0);
    if (dayIndexes.length === 0) {
      return combineLocalDateAndTime(addDays(datePart, step), liveTime);
    }
    for (let offset = 1; offset <= step; offset += 1) {
      const candidateDay = addDays(datePart, offset);
      if (dayIndexes.includes(candidateDay.getDay())) {
        return combineLocalDateAndTime(candidateDay, liveTime);
      }
    }
    return combineLocalDateAndTime(addDays(datePart, step), liveTime);
  }

  return combineLocalDateAndTime(addMonths(datePart, 1), liveTime);
}

export function pickScheduleDueAudit(schedule: {
  audits?: Array<{
    frequency?: string;
    liveTime?: string;
    completionHours?: number;
    days?: string[];
  }>;
}) {
  const audits = Array.isArray(schedule.audits) ? schedule.audits : [];
  return audits[0] || {};
}

export function resolveScheduleDueOccurrence(
  input: {
    startDate?: string;
    endDate?: string;
    nextDueAt?: string;
    frequency?: string;
    liveTime?: string;
    completionHours?: number;
    days?: string[];
  } = {},
  now = new Date(),
): ScheduleDueOccurrence {
  const startDate = trim(input.startDate);
  const endDate = trim(input.endDate);
  const frequency = trim(input.frequency) || "Daily";
  const liveTime = trim(input.liveTime) || "08:00";
  const completionHours = Math.max(1, Number(input.completionHours) || 24);
  const days = Array.isArray(input.days) ? input.days : [];
  const completionWindowMs = completionHours * 3600000;
  const storedNextDueAt = trim(input.nextDueAt);
  const parsedStoredDue = storedNextDueAt ? new Date(storedNextDueAt) : null;
  const hasStoredDue = parsedStoredDue && Number.isFinite(parsedStoredDue.getTime());

  const scheduleStart = parseScheduleDatePart(startDate);
  if (scheduleStart && startOfLocalDay(now).getTime() < startOfLocalDay(scheduleStart).getTime()) {
    const dueAt = firstOccurrenceFromStart(startDate, liveTime, frequency, days);
    const windowEnd = new Date(dueAt.getTime() + completionWindowMs);
    return {
      dueAt: dueAt.toISOString(),
      windowEnd: windowEnd.toISOString(),
      isDueNow: false,
      rejectReason: "not_due_yet",
      nextDueAt: dueAt.toISOString(),
    };
  }

  const endLimit = parseScheduleDatePart(endDate);
  let dueAt = scheduleStart
    ? firstOccurrenceFromStart(startDate, liveTime, frequency, days)
    : hasStoredDue
      ? parsedStoredDue
      : firstOccurrenceFromStart(startDate, liveTime, frequency, days);

  for (let step = 0; step < 400; step += 1) {
    const windowEnd = new Date(dueAt.getTime() + completionWindowMs);

    if (endLimit) {
      const endBoundary = combineLocalDateAndTime(endLimit, "23:59");
      if (dueAt.getTime() > endBoundary.getTime()) {
        return {
          dueAt: dueAt.toISOString(),
          windowEnd: windowEnd.toISOString(),
          isDueNow: false,
          rejectReason: "after_end_date",
          nextDueAt: dueAt.toISOString(),
        };
      }
    }

    if (now.getTime() < dueAt.getTime()) {
      return {
        dueAt: dueAt.toISOString(),
        windowEnd: windowEnd.toISOString(),
        isDueNow: false,
        rejectReason: "not_due_yet",
        nextDueAt: dueAt.toISOString(),
      };
    }

    if (now.getTime() <= windowEnd.getTime()) {
      return {
        dueAt: dueAt.toISOString(),
        windowEnd: windowEnd.toISOString(),
        isDueNow: true,
        rejectReason: null,
        nextDueAt: dueAt.toISOString(),
      };
    }

    const nextDueAt = nextOccurrenceAfter(dueAt, frequency, liveTime, days);
    if (now.getTime() < nextDueAt.getTime()) {
      return {
        dueAt: dueAt.toISOString(),
        windowEnd: windowEnd.toISOString(),
        isDueNow: false,
        rejectReason: "window_closed",
        nextDueAt: nextDueAt.toISOString(),
      };
    }

    dueAt = nextDueAt;
  }

  const windowEnd = new Date(dueAt.getTime() + completionWindowMs);
  return {
    dueAt: dueAt.toISOString(),
    windowEnd: windowEnd.toISOString(),
    isDueNow: false,
    rejectReason: "window_closed",
    nextDueAt: dueAt.toISOString(),
  };
}

export function enrichScheduleWithDueOccurrence<
  T extends {
    startDate?: string;
    endDate?: string;
    nextDueAt?: string;
    audits?: Array<{
      frequency?: string;
      liveTime?: string;
      completionHours?: number;
      days?: string[];
    }>;
  },
>(schedule: T, now = new Date()) {
  const audit = pickScheduleDueAudit(schedule);
  const due = resolveScheduleDueOccurrence(
    {
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      nextDueAt: schedule.nextDueAt,
      frequency: audit.frequency,
      liveTime: audit.liveTime,
      completionHours: audit.completionHours,
      days: audit.days,
    },
    now,
  );

  return {
    ...schedule,
    nextDueAt: trim(schedule.nextDueAt) || due.nextDueAt,
    dueAt: due.dueAt,
    windowEnd: due.windowEnd,
    isDueNow: due.isDueNow,
    dueRejectReason: due.rejectReason,
  };
}

export function enrichSchedulesWithDueOccurrence<
  T extends {
    startDate?: string;
    endDate?: string;
    nextDueAt?: string;
    audits?: Array<{
      frequency?: string;
      liveTime?: string;
      completionHours?: number;
      days?: string[];
    }>;
  },
>(schedules: T[], now = new Date()) {
  return schedules.map((schedule) => enrichScheduleWithDueOccurrence(schedule, now));
}

export function computeAssignedCheckDueHours(
  dueState: Pick<ScheduleDueOccurrence, "dueAt" | "windowEnd" | "isDueNow"> | null | undefined,
  now = new Date(),
): number {
  const dueAt = dueState?.dueAt ? new Date(dueState.dueAt) : null;
  const windowEnd = dueState?.windowEnd ? new Date(dueState.windowEnd) : null;
  if (!dueAt || !windowEnd || !Number.isFinite(dueAt.getTime()) || !Number.isFinite(windowEnd.getTime())) {
    return 24;
  }
  const nowMs = now.getTime();
  const dueMs = dueAt.getTime();
  const windowEndMs = windowEnd.getTime();
  if (nowMs >= dueMs && nowMs < windowEndMs) {
    return Math.round((windowEndMs - nowMs) / 36e5);
  }
  if (nowMs < dueMs) {
    return Math.round((dueMs - nowMs) / 36e5);
  }
  return Math.round((windowEndMs - nowMs) / 36e5);
}

export function assignedCheckDueLabelFromState(
  dueState: Pick<ScheduleDueOccurrence, "isDueNow" | "rejectReason"> | null | undefined,
  dueHours: number,
): string {
  if (dueState?.isDueNow) {
    return "Due today";
  }
  if (dueState?.rejectReason === "window_closed" || dueHours < 0) {
    return "Overdue";
  }
  if (dueState?.rejectReason === "not_due_yet") {
    return "Upcoming";
  }
  if (dueHours <= 24) {
    return "Due today";
  }
  return "Upcoming";
}

/** Alias for auditAccess naming consistency. */
export const resolveScheduleAuditDue = resolveScheduleDueOccurrence;
