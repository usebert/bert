/**
 * Check service — open assigned checks; completion delegated to completionService.
 */
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";
import { listCompanySchedules, listMyChecks } from "./schedule-service.mjs";
import {
  listAuditResults,
  submitCompletedCheck,
  verifyScheduleCompletionEligibility,
} from "./completion-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

/** Schedules from workbook where signed-in user is in assignedUserEmails (active + company scoped). */
export async function listAssignedChecks(auth, deps, input = {}) {
  return listMyChecks(auth, deps, input);
}

export { listAssignedChecks as listSchedulesAssignedToUser };

/** Validate user may open this schedule check (assigned on Schedules tab). */
export async function openAssignedCheck(auth, deps, input = {}) {
  const scheduleId = trim(input.scheduleId);
  const userEmail = trim(input.userEmail || input.email);
  const got = await listMyChecks(auth, deps, input);
  if (!got.ok) {
    return got;
  }
  const schedule = (got.schedules || []).find((row) => trim(row.id) === scheduleId);
  if (!schedule) {
    const listed = await listCompanySchedules(auth, deps, input);
    if (!listed.ok) {
      return listed;
    }
    const fallback = (listed.schedules || []).find((row) => trim(row.id) === scheduleId);
    if (!fallback) {
      return {
        ok: false,
        code: "SCHEDULE_NOT_FOUND",
        error: "Schedule not found for this company.",
        httpStatus: 404,
      };
    }
    if (userEmail && !isScheduleAssignedToUser(fallback, userEmail)) {
      return {
        ok: false,
        code: "CHECK_NOT_ASSIGNED",
        error: "This check is not assigned to your account.",
        httpStatus: 403,
      };
    }
    return {
      ok: true,
      schedule: fallback,
      companyId: listed.companyId,
      companyFolderId: listed.companyFolderId,
      masterSheetId: listed.masterSheetId,
    };
  }
  if (userEmail && !isScheduleAssignedToUser(schedule, userEmail)) {
    return {
      ok: false,
      code: "CHECK_NOT_ASSIGNED",
      error: "This check is not assigned to your account.",
      httpStatus: 403,
    };
  }
  return {
    ok: true,
    schedule,
    companyId: got.companyId,
    companyFolderId: got.companyFolderId,
    masterSheetId: got.masterSheetId,
  };
}

export {
  submitCompletedCheck,
  listAuditResults,
  verifyScheduleCompletionEligibility,
};
