/**
 * Production smoke verification schedules — workflow gate (bert-smoke-schedule-*).
 * Distinct from the permanent audit verification schedule (bert-sch-production-verification).
 */
import { getUkTodayKey } from "./uk-date-time.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_AUDIT_NAME,
  PRODUCTION_VERIFICATION_SMOKE_EMAIL,
  PRODUCTION_VERIFICATION_SMOKE_NAME,
  PRODUCTION_VERIFICATION_SMOKE_ROLE,
  isVerificationScheduleId,
} from "./production-verification-audit.mjs";

export const PRODUCTION_VERIFICATION_SCHEDULE_ID_PREFIX = "bert-smoke-schedule-";
export const PRODUCTION_VERIFICATION_SCHEDULE_TITLE = "BERT Verification Schedule";
export const PRODUCTION_VERIFICATION_SCHEDULE_DESCRIPTION =
  "Automated production Schedule workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_SCHEDULE_SOURCE = "production-schedules-workflow";
export const PRODUCTION_VERIFICATION_SCHEDULE_MARKER = "verification";
export const PRODUCTION_VERIFICATION_SCHEDULE_CLEANED_STATUS = "verification-cleaned";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, "");
      if (normalizedHeader === normalizedKey || normalizedHeader.includes(normalizedKey)) {
        const text = trim(value);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

export function isWorkflowVerificationScheduleId(scheduleId = "") {
  return trim(scheduleId).startsWith(PRODUCTION_VERIFICATION_SCHEDULE_ID_PREFIX);
}

export function isWorkflowVerificationSchedule(schedule = {}) {
  const scheduleId = trim(schedule.id || schedule.scheduleId);
  if (isWorkflowVerificationScheduleId(scheduleId)) {
    return true;
  }
  const verificationSource = pickField(schedule, "verificationSource", "Verification Source", "VerificationSource");
  if (normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_SCHEDULE_SOURCE)) {
    return true;
  }
  const verificationMarker = pickField(schedule, "verificationMarker", "Verification Marker", "VerificationMarker");
  if (
    normalize(verificationMarker) === normalize(PRODUCTION_VERIFICATION_SCHEDULE_MARKER) &&
    normalize(pickField(schedule, "scheduleName", "name", "Schedule Name")) ===
      normalize(PRODUCTION_VERIFICATION_SCHEDULE_TITLE)
  ) {
    return true;
  }
  return false;
}

export function isActiveWorkflowVerificationSchedule(schedule = {}) {
  if (!isWorkflowVerificationSchedule(schedule)) {
    return false;
  }
  const status = normalize(pickField(schedule, "status", "Status"));
  return status !== PRODUCTION_VERIFICATION_SCHEDULE_CLEANED_STATUS;
}

export function isOperationalSchedule(schedule = {}) {
  if (isWorkflowVerificationSchedule(schedule)) {
    return false;
  }
  if (isVerificationScheduleId(trim(schedule.id || schedule.scheduleId))) {
    return false;
  }
  const scheduleName = trim(schedule.scheduleName || schedule.name);
  if (/bert\s+verification/i.test(scheduleName)) {
    return false;
  }
  return true;
}

export function isOperationalAssignedCheck(schedule = {}) {
  return isOperationalSchedule(schedule);
}

export function buildProductionVerificationScheduleId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_SCHEDULE_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationSchedule(input = {}) {
  const runId = input.runId ?? Date.now();
  const scheduleId = trim(input.scheduleId) || buildProductionVerificationScheduleId(runId);
  const now = input.now instanceof Date ? input.now : new Date();
  const iso = now.toISOString();
  const today = trim(input.startDate) || getUkTodayKey(now);
  const assignedEmail = trim(input.assignedEmail || PRODUCTION_VERIFICATION_SMOKE_EMAIL).toLowerCase();
  const assignedName = trim(input.assignedName || PRODUCTION_VERIFICATION_SMOKE_NAME);
  const assignedRole = trim(input.assignedRole || PRODUCTION_VERIFICATION_SMOKE_ROLE);
  const liveTime = trim(input.liveTime) || "23:59";

  return {
    id: scheduleId,
    scheduleId,
    companyFolderId: trim(input.companyFolderId),
    companyId: trim(input.companyFolderId),
    scheduleName: trim(input.scheduleName) || PRODUCTION_VERIFICATION_SCHEDULE_TITLE,
    description: trim(input.description) || PRODUCTION_VERIFICATION_SCHEDULE_DESCRIPTION,
    lifecycle: "Live",
    status: trim(input.status) || "ACTIVE",
    startDate: today,
    endDate: trim(input.endDate) || "",
    completionMode: "repeatable",
    createdAt: iso,
    updatedAt: iso,
    createdByEmail: trim(input.createdByEmail) || assignedEmail,
    createdByRole: assignedRole,
    verificationSource: PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
    verificationMarker: PRODUCTION_VERIFICATION_SCHEDULE_MARKER,
    assignedUsers: [
      {
        email: assignedEmail,
        name: assignedName,
        role: assignedRole,
        accessLevel: "full",
      },
    ],
    assignedUserEmails: [assignedEmail],
    audits: [
      {
        auditId: PRODUCTION_VERIFICATION_AUDIT_ID,
        auditName: PRODUCTION_VERIFICATION_AUDIT_NAME,
        frequency: trim(input.frequency) || "Daily",
        days: [],
        liveTime,
        completionHours: Number(input.completionHours) || 24,
      },
    ],
    healthState: trim(input.healthState) || "",
    nextDueAt: trim(input.nextDueAt) || "",
    pausedAt: trim(input.pausedAt) || "",
    pausedBy: trim(input.pausedBy) || "",
    reactivatedAt: trim(input.reactivatedAt) || "",
  };
}

export function countScheduleBaselines(schedules = [], assignedChecks = []) {
  const list = Array.isArray(schedules) ? schedules : [];
  const checks = Array.isArray(assignedChecks) ? assignedChecks : [];
  const operational = list.filter((item) => isOperationalSchedule(item));
  const verification = list.filter((item) => isWorkflowVerificationSchedule(item));
  const activeVerification = list.filter((item) => isActiveWorkflowVerificationSchedule(item));
  const activeSchedules = list.filter((item) => {
    const status = normalize(item.status || item.lifecycle);
    return status === "active" || status === "live" || status === "scheduled";
  });
  const pausedSchedules = list.filter((item) => {
    const status = normalize(item.status || item.lifecycle);
    return status === "paused" || normalize(item.healthState) === "paused";
  });
  const operationalChecks = checks.filter((item) => isOperationalAssignedCheck(item));
  const verificationChecks = checks.filter((item) => isWorkflowVerificationSchedule(item));

  return {
    visibleCount: list.length,
    operationalCount: operational.length,
    activeCount: activeSchedules.length,
    pausedCount: pausedSchedules.length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
    assignedCheckCount: checks.length,
    operationalAssignedCheckCount: operationalChecks.length,
    verificationAssignedCheckCount: verificationChecks.length,
  };
}

export function listActiveWorkflowVerificationSchedules(schedules = []) {
  return (Array.isArray(schedules) ? schedules : []).filter((item) => isActiveWorkflowVerificationSchedule(item));
}

export function findScheduleById(schedules = [], scheduleId = "") {
  const target = trim(scheduleId).toLowerCase();
  return (Array.isArray(schedules) ? schedules : []).find(
    (item) => trim(item.id || item.scheduleId).toLowerCase() === target,
  );
}

export function assignedCheckForSchedule(assignedChecks = [], scheduleId = "") {
  const target = trim(scheduleId).toLowerCase();
  const matches = (Array.isArray(assignedChecks) ? assignedChecks : []).filter(
    (item) => trim(item.id || item.scheduleId).toLowerCase() === target,
  );
  return matches;
}
