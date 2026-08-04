/**
 * Production verification schedule mutations — merge-safe writes, pause/reactivate, cleanup.
 */
import { findCompanyScheduleById } from "../shared/schedule-list.mjs";
import { SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SMOKE_EMAIL,
} from "../shared/production-verification-audit.mjs";
import {
  buildProductionVerificationSchedule,
  isActiveWorkflowVerificationSchedule,
  isWorkflowVerificationSchedule,
  isWorkflowVerificationScheduleId,
  listActiveWorkflowVerificationSchedules,
  PRODUCTION_VERIFICATION_SCHEDULE_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
} from "../shared/production-verification-schedule.mjs";
import {
  canListCompanySchedules,
  listCompanySchedules,
  resolveCompanyScheduleContext,
  writeScheduleToTab,
} from "./schedule-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function scheduleApiFailure(code, message, httpStatus = 400) {
  return { ok: false, code, error: message, message, httpStatus };
}

export function logScheduleMutationTiming(operation, stage, details = {}) {
  console.info("[schedule:mutation-timing]", {
    operation,
    stage,
    scheduleId: trim(details.scheduleId) || undefined,
    workbookId: trim(details.workbookId) || undefined,
    updatedRows: Number(details.updatedRows) || 0,
    durationMs: Number(details.durationMs) || 0,
    totalMs: Number(details.totalMs) || 0,
  });
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : null;
}

async function loadWritableSchedules(auth, deps, input = {}) {
  const listed = await listCompanySchedules(auth, deps, input);
  if (!listed.ok) {
    return listed;
  }
  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    masterSheetId: listed.masterSheetId,
    schedules: Array.isArray(listed.schedules) ? listed.schedules : [],
  };
}

async function persistMergedSchedules(auth, deps, input, schedules) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  if (ensureTabColumns) {
    await ensureTabColumns(auth, deps, context.masterSheetId, SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS);
  }
  const writeResult = await writeScheduleToTab(auth, deps, {
    ...input,
    companyId: context.companyFolderId,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    schedules,
    createdBy: trim(input.createdBy || input.requestedBy),
  });
  if (!writeResult.ok) {
    return writeResult;
  }
  const written = Number(writeResult.written) || 0;
  if (written <= 0 && schedules.length > 0) {
    return scheduleApiFailure(
      "SCHEDULE_WRITE_ZERO_ROWS",
      "Schedule save returned zero-row acknowledgement.",
      500,
    );
  }
  return {
    ok: true,
    companyId: context.companyFolderId,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    written,
    updatedRows: written,
  };
}

function assertSmokeAssigneeOnly(emails = []) {
  const normalized = emails.map(normalizeEmail).filter(Boolean);
  if (!normalized.length) {
    return scheduleApiFailure("SCHEDULE_ASSIGNEE_REQUIRED", "At least one assignee email is required.");
  }
  if (normalized.length !== 1) {
    return scheduleApiFailure(
      "SCHEDULE_ASSIGNEE_TOO_BROAD",
      "Verification schedules may only be assigned to the smoke account.",
      403,
    );
  }
  if (normalized[0] !== normalizeEmail(PRODUCTION_VERIFICATION_SMOKE_EMAIL)) {
    return scheduleApiFailure(
      "SCHEDULE_ASSIGNEE_NOT_ALLOWED",
      "Verification schedules may only be assigned to the dedicated smoke account.",
      403,
    );
  }
  return null;
}

function mergeSchedule(existing = {}, patch = {}) {
  return {
    ...existing,
    ...patch,
    id: existing.id || patch.id,
    audits: Array.isArray(patch.audits) ? patch.audits : existing.audits,
    assignedUsers: Array.isArray(patch.assignedUsers) ? patch.assignedUsers : existing.assignedUsers,
    assignedUserEmails: Array.isArray(patch.assignedUserEmails)
      ? patch.assignedUserEmails
      : existing.assignedUserEmails,
  };
}

export async function createVerificationSchedule(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  if (!canListCompanySchedules(actor, companyFolderId)) {
    return scheduleApiFailure("SCHEDULE_FORBIDDEN", "You do not have permission to create schedules.", 403);
  }
  const scheduleId = trim(input.scheduleId);
  if (!isWorkflowVerificationScheduleId(scheduleId)) {
    return scheduleApiFailure(
      "SCHEDULE_VERIFICATION_ID_REQUIRED",
      "Verification schedules must use the bert-smoke-schedule- ID prefix.",
      403,
    );
  }
  const assigneeCheck = assertSmokeAssigneeOnly(
    input.assignedUserEmails || (input.assignedUsers || []).map((user) => user.email),
  );
  if (assigneeCheck) {
    return assigneeCheck;
  }
  const templateId = trim(input.templateId || input.auditId || PRODUCTION_VERIFICATION_AUDIT_ID);
  if (templateId !== PRODUCTION_VERIFICATION_AUDIT_ID) {
    return scheduleApiFailure(
      "SCHEDULE_TEMPLATE_NOT_ALLOWED",
      "Verification schedules must use the bert-verify-audit-v1 template.",
      403,
    );
  }

  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    companyName: trim(input.companyName),
    createdBy: trim(actor?.email),
    requestedBy: trim(actor?.email),
  };
  const loaded = await loadWritableSchedules(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }

  const existing = findCompanyScheduleById(loaded.schedules, scheduleId);
  if (existing) {
    if (!isWorkflowVerificationSchedule(existing)) {
      return scheduleApiFailure("SCHEDULE_ID_CONFLICT", "Schedule ID is already used by a non-verification record.", 409);
    }
    logScheduleMutationTiming("create", "idempotent", {
      scheduleId,
      workbookId: loaded.masterSheetId,
      updatedRows: 0,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      schedule: existing,
      scheduleId,
      alreadyExists: true,
      updatedRows: 0,
      masterSheetId: loaded.masterSheetId,
    };
  }

  const payload = buildProductionVerificationSchedule({
    ...input,
    scheduleId,
    companyFolderId,
    createdByEmail: trim(actor?.email),
    assignedEmail: normalizeEmail(input.assignedEmail || PRODUCTION_VERIFICATION_SMOKE_EMAIL),
  });
  const nextSchedules = [...loaded.schedules, payload];
  const writeResult = await persistMergedSchedules(auth, deps, contextInput, nextSchedules);
  if (!writeResult.ok) {
    return writeResult;
  }

  const refreshed = await loadWritableSchedules(auth, deps, contextInput);
  const schedule = refreshed.ok ? findCompanyScheduleById(refreshed.schedules, scheduleId) : payload;
  logScheduleMutationTiming("create", "create", {
    scheduleId,
    workbookId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    schedule,
    scheduleId,
    masterSheetId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
  };
}

export async function patchVerificationSchedule(auth, deps, actor, companyFolderId, scheduleId, input = {}) {
  const startedAt = Date.now();
  if (!canListCompanySchedules(actor, companyFolderId)) {
    return scheduleApiFailure("SCHEDULE_FORBIDDEN", "You do not have permission to edit schedules.", 403);
  }
  if (!isWorkflowVerificationScheduleId(scheduleId)) {
    return scheduleApiFailure(
      "SCHEDULE_VERIFICATION_ID_REQUIRED",
      "Only verification schedules can be patched through this path.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    createdBy: trim(actor?.email),
    requestedBy: trim(actor?.email),
  };
  const loaded = await loadWritableSchedules(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const existing = findCompanyScheduleById(loaded.schedules, scheduleId);
  if (!existing) {
    return scheduleApiFailure("SCHEDULE_NOT_FOUND", "Schedule not found.", 404);
  }
  if (!isWorkflowVerificationSchedule(existing)) {
    return scheduleApiFailure("SCHEDULE_NOT_VERIFICATION", "Only verification schedules can be patched through this path.", 403);
  }

  const patch = {};
  if (input.scheduleName !== undefined) patch.scheduleName = trim(input.scheduleName);
  if (input.description !== undefined) patch.description = trim(input.description);
  if (input.endDate !== undefined) patch.endDate = trim(input.endDate);
  if (input.audits !== undefined) patch.audits = input.audits;
  if (Array.isArray(input.audits) && input.audits.length > 0) {
    const audit = input.audits[0];
    if (trim(audit.auditId) && trim(audit.auditId) !== PRODUCTION_VERIFICATION_AUDIT_ID) {
      return scheduleApiFailure("SCHEDULE_TEMPLATE_LOCKED", "Verification schedule template cannot be changed.", 409);
    }
  }
  if (input.assignedUserEmails !== undefined || input.assignedUsers !== undefined) {
    const assigneeCheck = assertSmokeAssigneeOnly(
      input.assignedUserEmails || (input.assignedUsers || []).map((user) => user.email),
    );
    if (assigneeCheck) {
      return assigneeCheck;
    }
    patch.assignedUsers = input.assignedUsers;
    patch.assignedUserEmails = input.assignedUserEmails;
  }
  if (!Object.keys(patch).length) {
    return { ok: true, schedule: existing, updatedRows: 0, unchanged: true };
  }
  patch.updatedAt = nowIso();
  patch.status = existing.status || "ACTIVE";
  patch.lifecycle = existing.lifecycle || "Live";

  const nextSchedules = loaded.schedules.map((item) =>
    trim(item.id) === scheduleId ? mergeSchedule(existing, patch) : item,
  );
  const writeResult = await persistMergedSchedules(auth, deps, contextInput, nextSchedules);
  if (!writeResult.ok) {
    return writeResult;
  }
  const refreshed = await loadWritableSchedules(auth, deps, contextInput);
  const schedule = refreshed.ok ? findCompanyScheduleById(refreshed.schedules, scheduleId) : mergeSchedule(existing, patch);
  logScheduleMutationTiming("patch", "patch", {
    scheduleId,
    workbookId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, schedule, updatedRows: writeResult.updatedRows };
}

export async function pauseVerificationSchedule(auth, deps, actor, companyFolderId, scheduleId, input = {}) {
  const startedAt = Date.now();
  if (!canListCompanySchedules(actor, companyFolderId)) {
    return scheduleApiFailure("SCHEDULE_FORBIDDEN", "You do not have permission to pause schedules.", 403);
  }
  if (!isWorkflowVerificationScheduleId(scheduleId)) {
    return scheduleApiFailure("SCHEDULE_VERIFICATION_ID_REQUIRED", "Only verification schedules can be paused through this path.", 403);
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    createdBy: trim(actor?.email),
    requestedBy: trim(actor?.email),
  };
  const loaded = await loadWritableSchedules(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const existing = findCompanyScheduleById(loaded.schedules, scheduleId);
  if (!existing) {
    return scheduleApiFailure("SCHEDULE_NOT_FOUND", "Schedule not found.", 404);
  }
  if (!isWorkflowVerificationSchedule(existing)) {
    return scheduleApiFailure("SCHEDULE_NOT_VERIFICATION", "Only verification schedules can be paused through this path.", 403);
  }
  const status = trim(existing.status).toUpperCase();
  if (status === "PAUSED") {
    return { ok: true, schedule: existing, alreadyPaused: true, updatedRows: 0 };
  }

  const pausedUntil =
    trim(input.pausedUntil) ||
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const patch = {
    status: "PAUSED",
    lifecycle: "Live",
    healthState: "Paused",
    nextDueAt: pausedUntil,
    pausedAt: nowIso(),
    pausedBy: trim(actor?.email),
    updatedAt: nowIso(),
  };
  const nextSchedules = loaded.schedules.map((item) =>
    trim(item.id) === scheduleId ? mergeSchedule(existing, patch) : item,
  );
  const writeResult = await persistMergedSchedules(auth, deps, contextInput, nextSchedules);
  if (!writeResult.ok) {
    return writeResult;
  }
  const refreshed = await loadWritableSchedules(auth, deps, contextInput);
  const schedule = refreshed.ok ? findCompanyScheduleById(refreshed.schedules, scheduleId) : mergeSchedule(existing, patch);
  logScheduleMutationTiming("pause", "pause", {
    scheduleId,
    workbookId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, schedule, updatedRows: writeResult.updatedRows };
}

export async function reactivateVerificationSchedule(auth, deps, actor, companyFolderId, scheduleId, input = {}) {
  const startedAt = Date.now();
  if (!canListCompanySchedules(actor, companyFolderId)) {
    return scheduleApiFailure("SCHEDULE_FORBIDDEN", "You do not have permission to reactivate schedules.", 403);
  }
  if (!isWorkflowVerificationScheduleId(scheduleId)) {
    return scheduleApiFailure(
      "SCHEDULE_VERIFICATION_ID_REQUIRED",
      "Only verification schedules can be reactivated through this path.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    createdBy: trim(actor?.email),
    requestedBy: trim(actor?.email),
  };
  const loaded = await loadWritableSchedules(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const existing = findCompanyScheduleById(loaded.schedules, scheduleId);
  if (!existing) {
    return scheduleApiFailure("SCHEDULE_NOT_FOUND", "Schedule not found.", 404);
  }
  if (!isWorkflowVerificationSchedule(existing)) {
    return scheduleApiFailure(
      "SCHEDULE_NOT_VERIFICATION",
      "Only verification schedules can be reactivated through this path.",
      403,
    );
  }
  const status = trim(existing.status).toUpperCase();
  if (status === "ACTIVE" && trim(existing.healthState).toLowerCase() !== "paused") {
    return { ok: true, schedule: existing, alreadyActive: true, updatedRows: 0 };
  }

  const patch = {
    status: "ACTIVE",
    lifecycle: "Live",
    healthState: "",
    nextDueAt: "",
    pausedAt: "",
    pausedBy: "",
    reactivatedAt: nowIso(),
    updatedAt: nowIso(),
  };
  const nextSchedules = loaded.schedules.map((item) =>
    trim(item.id) === scheduleId ? mergeSchedule(existing, patch) : item,
  );
  const writeResult = await persistMergedSchedules(auth, deps, contextInput, nextSchedules);
  if (!writeResult.ok) {
    return writeResult;
  }
  const refreshed = await loadWritableSchedules(auth, deps, contextInput);
  const schedule = refreshed.ok ? findCompanyScheduleById(refreshed.schedules, scheduleId) : mergeSchedule(existing, patch);
  logScheduleMutationTiming("reactivate", "reactivate", {
    scheduleId,
    workbookId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ok: true, schedule, updatedRows: writeResult.updatedRows };
}

export async function cleanupVerificationSchedule(auth, deps, actor, companyFolderId, scheduleId, input = {}) {
  const startedAt = Date.now();
  if (!isWorkflowVerificationScheduleId(scheduleId)) {
    return scheduleApiFailure(
      "CLEANUP_NOT_VERIFICATION_SCHEDULE",
      "Only verification schedules with the bert-smoke-schedule- prefix can be cleaned up through this path.",
      403,
    );
  }
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    createdBy: trim(actor?.email),
    requestedBy: trim(actor?.email),
  };
  const loaded = await loadWritableSchedules(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const existing = findCompanyScheduleById(loaded.schedules, scheduleId);
  if (!existing) {
    return {
      ok: true,
      cleaned: true,
      alreadyCleaned: true,
      scheduleId,
      masterSheetId: loaded.masterSheetId,
      updatedRows: 0,
    };
  }
  if (!isWorkflowVerificationSchedule(existing)) {
    return scheduleApiFailure(
      "CLEANUP_NOT_VERIFICATION_SCHEDULE",
      "Only verification schedules can be cleaned up through this path.",
      403,
    );
  }

  const nextSchedules = loaded.schedules.filter((item) => trim(item.id) !== scheduleId);
  const writeResult = await persistMergedSchedules(auth, deps, contextInput, nextSchedules);
  if (!writeResult.ok) {
    return writeResult;
  }
  logScheduleMutationTiming("cleanup", "single", {
    scheduleId,
    workbookId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    cleaned: true,
    scheduleId,
    masterSheetId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    status: PRODUCTION_VERIFICATION_SCHEDULE_CLEANED_STATUS,
  };
}

export async function cleanupStaleVerificationSchedules(auth, deps, actor, companyFolderId, input = {}) {
  const startedAt = Date.now();
  const contextInput = {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: trim(input.masterSheetId),
    createdBy: trim(actor?.email),
    requestedBy: trim(actor?.email),
  };
  const loaded = await loadWritableSchedules(auth, deps, contextInput);
  if (!loaded.ok) {
    return loaded;
  }
  const stale = listActiveWorkflowVerificationSchedules(loaded.schedules);
  const keepScheduleId = trim(input.keepScheduleId);
  const toRemove = stale.filter((item) => !keepScheduleId || trim(item.id) !== keepScheduleId);
  if (!toRemove.length) {
    return {
      ok: true,
      cleanedCount: 0,
      results: [],
      masterSheetId: loaded.masterSheetId,
      updatedRows: 0,
    };
  }
  const removeIds = new Set(toRemove.map((item) => trim(item.id)));
  const nextSchedules = loaded.schedules.filter((item) => !removeIds.has(trim(item.id)));
  const writeResult = await persistMergedSchedules(auth, deps, contextInput, nextSchedules);
  if (!writeResult.ok) {
    return writeResult;
  }
  logScheduleMutationTiming("cleanup", "stale", {
    workbookId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return {
    ok: true,
    cleanedCount: toRemove.length,
    results: toRemove.map((item) => ({ scheduleId: item.id, ok: true })),
    masterSheetId: writeResult.masterSheetId,
    updatedRows: writeResult.updatedRows,
  };
}

export function isVerificationScheduleMutationBody(body = {}) {
  const scheduleId = trim(body.scheduleId);
  const verificationSource = trim(body.verificationSource);
  return isWorkflowVerificationScheduleId(scheduleId) || verificationSource === PRODUCTION_VERIFICATION_SCHEDULE_SOURCE;
}
