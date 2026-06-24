/**
 * Link AuditResults rows back to assigned schedule checks for the current due instance.
 */

function trim(value) {
  return String(value ?? "").trim();
}

export function normalizeCompletionEmail(value) {
  return trim(value).toLowerCase();
}

function pickResultField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
    const match = Object.entries(record).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && trim(match[1])) {
      return trim(match[1]);
    }
  }
  return "";
}

export function mapAuditResultCompletionRecord(record = {}) {
  return {
    resultId: pickResultField(record, "Result ID", "ResultId"),
    scheduleId: pickResultField(record, "Schedule ID", "ScheduleId"),
    auditId: pickResultField(record, "Audit ID", "AuditId"),
    auditName: pickResultField(record, "Audit Name", "AuditName"),
    completedAt: pickResultField(record, "Completed At", "CompletedAt"),
    completedByEmail:
      pickResultField(record, "Completed By Email", "CompletedByEmail") ||
      pickResultField(record, "Completed By", "CompletedBy"),
    status: pickResultField(record, "Status") || "completed",
  };
}

export function isCompletionStatusCompleted(status) {
  const normalized = trim(status).toLowerCase();
  return !normalized || normalized === "completed" || normalized === "complete";
}

function normalizeAuditIdentity(value) {
  return trim(value).toLowerCase().replace(/\s+/g, " ");
}

export function auditIdsMatch(resultAuditId, ctxAuditId, resultAuditName = "", ctxAuditName = "") {
  const leftId = trim(resultAuditId);
  const rightId = trim(ctxAuditId);
  if (leftId && rightId && leftId === rightId) {
    return true;
  }
  const leftName = normalizeAuditIdentity(resultAuditName);
  const rightName = normalizeAuditIdentity(ctxAuditName);
  return Boolean(leftName && rightName && leftName === rightName);
}

export function subtractFrequencyFromDate(date, frequency) {
  const next = new Date(date);
  if (!Number.isFinite(next.getTime())) {
    return null;
  }
  const normalized = trim(frequency).toLowerCase();
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

/** Start of the due window for the current schedule instance. */
export function duePeriodStart(nextDueAt, frequency, now = new Date()) {
  const anchor = trim(nextDueAt);
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

function normalizeResultRecord(result) {
  if (!result) {
    return result;
  }
  if (trim(result.scheduleId)) {
    return result;
  }
  if (pickResultField(result, "Schedule ID", "ScheduleId")) {
    return mapAuditResultCompletionRecord(result);
  }
  return result;
}

export function matchesAssignedCheckResult(result, ctx = {}) {
  const normalized = normalizeResultRecord(result);
  if (!normalized || !ctx) {
    return false;
  }
  if (trim(normalized.scheduleId) !== trim(ctx.scheduleId)) {
    return false;
  }
  if (!auditIdsMatch(normalized.auditId, ctx.auditId, normalized.auditName, ctx.auditName)) {
    return false;
  }
  if (normalizeCompletionEmail(normalized.completedByEmail) !== normalizeCompletionEmail(ctx.email)) {
    return false;
  }
  return isCompletionStatusCompleted(normalized.status);
}

export function isCompletionForCurrentDueInstance(result, ctx = {}, now = new Date()) {
  const normalized = normalizeResultRecord(result);
  if (!matchesAssignedCheckResult(normalized, ctx)) {
    return false;
  }
  const completedAt = new Date(normalized.completedAt);
  if (!Number.isFinite(completedAt.getTime())) {
    return false;
  }
  const periodStart = duePeriodStart(ctx.nextDueAt, ctx.frequency, now);
  return completedAt.getTime() >= periodStart.getTime();
}

export function findLatestCompletionForAssignedCheck(results = [], ctx = {}) {
  let latest = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const raw of results) {
    const result = normalizeResultRecord(raw);
    if (!matchesAssignedCheckResult(result, ctx)) {
      continue;
    }
    const completedAt = new Date(result.completedAt);
    const completedAtMs = completedAt.getTime();
    if (!Number.isFinite(completedAtMs)) {
      continue;
    }
    if (!latest || completedAtMs > latestAt) {
      latest = result;
      latestAt = completedAtMs;
    }
  }
  return latest;
}

export function resolveAssignedCheckCompletion(results = [], ctx = {}, now = new Date()) {
  const mapped = results.map((row) => normalizeResultRecord(row));
  const latest = findLatestCompletionForAssignedCheck(mapped, ctx);
  const currentDueResult = mapped.find((row) => isCompletionForCurrentDueInstance(row, ctx, now));
  return {
    completedForCurrentDue: Boolean(currentDueResult),
    lastCompletedAt: latest?.completedAt || "",
    currentDueCompletedAt: currentDueResult?.completedAt || "",
  };
}

export function enrichAssignedSchedulesWithCompletion(schedules = [], rawResults = [], email = "", now = new Date()) {
  const results = rawResults.map((row) => mapAuditResultCompletionRecord(row));
  return schedules.map((schedule) => {
    const scheduleId = trim(schedule.id);
    const nextDueAt = trim(schedule.nextDueAt);
    let scheduleLastCompleted = trim(schedule.lastCompletedAt);
    const audits = (schedule.audits || []).map((audit) => {
      const ctx = {
        scheduleId,
        auditId: trim(audit.auditId),
        auditName: trim(audit.auditName),
        email,
        nextDueAt,
        frequency: trim(audit.frequency) || "Weekly",
      };
      const completion = resolveAssignedCheckCompletion(results, ctx, now);
      if (
        completion.lastCompletedAt &&
        (!scheduleLastCompleted || new Date(completion.lastCompletedAt).getTime() > new Date(scheduleLastCompleted).getTime())
      ) {
        scheduleLastCompleted = completion.lastCompletedAt;
      }
      return {
        ...audit,
        completedForCurrentDue: completion.completedForCurrentDue,
        lastCompletedAt: completion.lastCompletedAt || undefined,
        currentDueCompletedAt: completion.currentDueCompletedAt || undefined,
      };
    });
    return {
      ...schedule,
      audits,
      lastCompletedAt: scheduleLastCompleted || schedule.lastCompletedAt,
    };
  });
}

/** True when an assigned check should not show Start for the current due instance. */
export function isAssignedCheckCompletedForCurrentDue(scheduleAudit = {}) {
  return scheduleAudit.completedForCurrentDue === true;
}
