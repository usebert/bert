/**
 * Company schedule service — list, get, save via company workbook context.
 */
import { resolveCompanyById } from "./company-registry-service.mjs";
import {
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";
import {
  companyScheduleRecordsFromSheetPayload,
  findCompanyScheduleById,
} from "../shared/schedule-list.mjs";
import { saveCompanySchedules } from "./schedule-save-service.mjs";
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";

function isDevDiagnosticsEnabled() {
  return (
    String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
  );
}

function sessionCompanyId(actor = {}) {
  return String(actor.companyId || actor.companyFolderId || "").trim();
}

export function canListCompanySchedules(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  if (!isCompanyInviteActor({ role: actor.role, accessLevel: actor.accessLevel })) {
    return false;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => String(entry || "").trim()).filter(Boolean),
  );
  return targets.has(sessionCompanyId(actor));
}

export async function resolveCompanyScheduleContext(auth, deps, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  let masterSheetId = String(input.masterSheetId || "").trim();
  const companyFolderId = String(input.companyFolderId || companyId).trim();
  let companyName = String(input.companyName || "").trim();

  // Folder-first: workbook + folder id are sufficient — registry is cache only.
  if (companyFolderId && masterSheetId) {
    const alternateIds = [companyFolderId, companyId]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .filter((entry, index, all) => all.indexOf(entry) === index);
    return {
      ok: true,
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId,
      alternateIds,
      registryRecord: null,
    };
  }

  let registryRecord = null;
  if (companyId) {
    registryRecord = await resolveCompanyById(auth, deps, companyId).catch(() => null);
  }

  if (!registryRecord && !masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workspace could not be resolved.",
      message: "Company workspace could not be resolved.",
      httpStatus: 404,
    };
  }

  if (registryRecord) {
    masterSheetId = masterSheetId || String(registryRecord.masterSheetId || "").trim();
    companyName =
      companyName ||
      String(registryRecord.companyName || registryRecord.name || registryRecord.companyFolderName || "").trim();
  }

  const resolvedCompanyFolderId = String(
    registryRecord?.rootFolderId ||
      companyFolderId ||
      registryRecord?.companyFolderId ||
      registryRecord?.companyId ||
      companyId,
  ).trim();

  const alternateIds = [
    registryRecord?.companyId,
    registryRecord?.rootFolderId,
    registryRecord?.companyFolderId,
    companyFolderId,
    companyId,
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);

  if (!masterSheetId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company master sheet is not configured.",
      message: "Company master sheet is not configured.",
      httpStatus: 404,
    };
  }

  return {
    ok: true,
    companyId: resolvedCompanyFolderId,
    companyFolderId: resolvedCompanyFolderId,
    companyName,
    masterSheetId,
    alternateIds,
    registryRecord,
  };
}

export async function listCompanySchedules(auth, deps, input = {}) {
  const context = await resolveCompanyScheduleContext(auth, deps, input);
  if (!context.ok) {
    return context;
  }

  const { readCompanySheetById } = deps;
  if (typeof readCompanySheetById !== "function") {
    return {
      ok: false,
      code: "SCHEDULE_LIST_UNAVAILABLE",
      error: "Schedule list is not configured.",
      message: "Could not load schedules for this company.",
      httpStatus: 500,
    };
  }

  try {
    const payload = await readCompanySheetById(auth, context.masterSheetId);
    const schedules = companyScheduleRecordsFromSheetPayload(
      payload,
      context.companyFolderId,
      context.alternateIds,
    );

    return {
      ok: true,
      companyId: context.companyId,
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      masterSheetId: context.masterSheetId,
      schedules,
    };
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "SCHEDULE_LIST_FAILED",
      error: "Could not load schedules for this company.",
      message: "Could not load schedules for this company.",
      technicalError: isDevDiagnosticsEnabled() ? technicalError : undefined,
      httpStatus: 502,
    };
  }
}

export async function getCompanySchedule(auth, deps, input = {}) {
  const scheduleId = String(input.scheduleId || "").trim();
  const listed = await listCompanySchedules(auth, deps, input);
  if (!listed.ok) {
    return listed;
  }
  const schedule = findCompanyScheduleById(listed.schedules, scheduleId);
  if (!schedule) {
    return {
      ok: false,
      code: "SCHEDULE_NOT_FOUND",
      error: "Schedule not found for this company.",
      message: "Schedule not found for this company.",
      httpStatus: 404,
    };
  }
  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    masterSheetId: listed.masterSheetId,
    schedule,
  };
}

export async function saveCompanySchedule(auth, deps, input = {}) {
  const schedule = input.schedule || input.schedulePayload || null;
  const schedules = Array.isArray(input.schedules)
    ? input.schedules
    : schedule
      ? [schedule]
      : [];
  return saveCompanySchedules(auth, deps, {
    ...input,
    schedules,
  });
}

/** Schedules where userEmail appears in assignedUserEmails. */
export async function listSchedulesAssignedToUser(auth, deps, input = {}) {
  const listed = await listCompanySchedules(auth, deps, input);
  if (!listed.ok) {
    return listed;
  }
  const userEmail = String(input.userEmail || input.email || "").trim().toLowerCase();
  const schedules = (listed.schedules || []).filter((schedule) => isScheduleAssignedToUser(schedule, userEmail));
  return { ...listed, schedules };
}

export { saveCompanySchedules };
