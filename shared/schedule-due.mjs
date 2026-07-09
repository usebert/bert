/**
 * Schedule due occurrence — start date, live time, completion window, frequency.
 * Option A: if scheduled time passed but still inside completion window → due now.
 */
import { parseUkDateInput, ukDateKeyFromTimestamp, ukDateTimeToUtcDate, ukStartOfDayUtc } from "./uk-date-time.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

export function parseScheduleDatePart(raw) {
  const value = trim(raw);
  if (!value) {
    return null;
  }
  const normalized = parseUkDateInput(value);
  return normalized ? ukStartOfDayUtc(normalized) : null;
}

export function parseLiveTimeParts(raw) {
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

export function combineLocalDateAndTime(datePart, liveTimeRaw) {
  const { hours, minutes } = parseLiveTimeParts(liveTimeRaw);
  const key = ukDateKeyFromTimestamp(datePart);
  if (!key) {
    return new Date(Number.NaN);
  }
  const [year, month, day] = key.split("-").map((part) => Number(part));
  return ukDateTimeToUtcDate({ year, month, day, hour: hours, minute: minutes, second: 0 });
}

export function normalizeScheduleFrequency(raw) {
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

function startOfLocalDay(date) {
  const key = ukDateKeyFromTimestamp(date);
  return key ? ukStartOfDayUtc(key) : new Date(Number.NaN);
}

function addDays(date, count) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function addMonths(date, count) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

function ukDayOfWeek(date) {
  const key = ukDateKeyFromTimestamp(date);
  if (!key) return -1;
  const [year, month, day] = key.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayIndexFromToken(raw) {
  const token = trim(raw).toLowerCase().slice(0, 3);
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[token] ?? -1;
}

function firstOccurrenceFromStart(startDate, liveTime, frequency, days = []) {
  const start = parseScheduleDatePart(startDate);
  const freq = normalizeScheduleFrequency(frequency);
  const anchorDay = start || startOfLocalDay(new Date());

  if (freq === "weekly" && Array.isArray(days) && days.length > 0) {
    const dayIndexes = days.map(dayIndexFromToken).filter((index) => index >= 0);
    if (dayIndexes.length > 0 && !dayIndexes.includes(ukDayOfWeek(anchorDay))) {
      for (let offset = 0; offset < 7; offset += 1) {
        const candidateDay = addDays(anchorDay, offset);
        if (dayIndexes.includes(ukDayOfWeek(candidateDay))) {
          return combineLocalDateAndTime(candidateDay, liveTime);
        }
      }
    }
  }

  return combineLocalDateAndTime(anchorDay, liveTime);
}

export function nextOccurrenceAfter(dueAt, frequency, liveTime, days = []) {
  const freq = normalizeScheduleFrequency(frequency);
  const datePart = startOfLocalDay(dueAt);

  if (freq === "daily") {
    return combineLocalDateAndTime(addDays(datePart, 1), liveTime);
  }

  if (freq === "weekly" || freq === "bi-weekly") {
    const step = freq === "bi-weekly" ? 14 : 7;
    const dayIndexes = (Array.isArray(days) ? days : []).map(dayIndexFromToken).filter((index) => index >= 0);
    if (dayIndexes.length === 0) {
      return combineLocalDateAndTime(addDays(datePart, step), liveTime);
    }
    for (let offset = 1; offset <= step; offset += 1) {
      const candidateDay = addDays(datePart, offset);
      if (dayIndexes.includes(ukDayOfWeek(candidateDay))) {
        return combineLocalDateAndTime(candidateDay, liveTime);
      }
    }
    return combineLocalDateAndTime(addDays(datePart, step), liveTime);
  }

  return combineLocalDateAndTime(addMonths(datePart, 1), liveTime);
}

export function pickScheduleDueAudit(schedule = {}) {
  const audits = Array.isArray(schedule.audits) ? schedule.audits : [];
  return audits[0] || {};
}

export function resolveScheduleDueOccurrence(input = {}, now = new Date()) {
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

export function enrichScheduleWithDueOccurrence(schedule = {}, now = new Date()) {
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

  const preservedNextDueAt = trim(schedule.nextDueAt);
  return {
    ...schedule,
    nextDueAt: preservedNextDueAt || due.nextDueAt,
    dueAt: due.dueAt,
    windowEnd: due.windowEnd,
    isDueNow: due.isDueNow,
    dueRejectReason: due.rejectReason,
    rejectReason: due.rejectReason,
    audits: (Array.isArray(schedule.audits) ? schedule.audits : []).map((row) => ({
      ...row,
      dueAt: due.dueAt,
      windowEnd: due.windowEnd,
      isDueNow: due.isDueNow,
      rejectReason: due.rejectReason,
    })),
  };
}

export function enrichSchedulesWithDueOccurrence(schedules = [], now = new Date()) {
  return (Array.isArray(schedules) ? schedules : []).map((schedule) => enrichScheduleWithDueOccurrence(schedule, now));
}

/** Alias used by assigned-checks service. */
export const enrichScheduleWithComputedDue = enrichScheduleWithDueOccurrence;

export function computeAssignedCheckDueHours(dueState, now = new Date()) {
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

export function assignedCheckDueLabelFromState(dueState, dueHours) {
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

export function buildAssignedCheckDueDiagnostics(schedule = {}, now = new Date()) {
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
    scheduleId: trim(schedule.id),
    scheduleName: trim(schedule.scheduleName),
    startDate: trim(schedule.startDate) || undefined,
    liveTime: trim(audit.liveTime) || "08:00",
    frequency: trim(audit.frequency) || "Daily",
    completionHours: Math.max(1, Number(audit.completionHours) || 24),
    assigneeEmails: Array.isArray(schedule.assignedUserEmails) ? schedule.assignedUserEmails : [],
    dueAt: due.dueAt,
    windowEnd: due.windowEnd,
    nextDueAt: due.nextDueAt,
    isDueNow: due.isDueNow,
    rejectReason: due.rejectReason,
    serverTime: now.toISOString(),
    serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Alias for verify scripts and client mirror naming. */
export const resolveScheduleAuditDue = resolveScheduleDueOccurrence;
