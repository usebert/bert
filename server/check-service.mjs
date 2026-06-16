/**
 * Check service — open assigned checks and submit results to AuditResults tab.
 */
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";
import { listCompanySchedules } from "./schedule-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function newResultId() {
  return `result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Schedules from workbook where signed-in user is in assignedUserEmails. */
export async function listAssignedChecks(auth, deps, input = {}) {
  const userEmail = trim(input.userEmail || input.email);
  const listed = await listCompanySchedules(auth, deps, input);
  if (!listed.ok) {
    return listed;
  }
  const schedules = (listed.schedules || []).filter((schedule) => isScheduleAssignedToUser(schedule, userEmail));
  return {
    ok: true,
    companyId: listed.companyId,
    companyFolderId: listed.companyFolderId,
    masterSheetId: listed.masterSheetId,
    schedules,
  };
}

export { listAssignedChecks as listSchedulesAssignedToUser };

/** Validate user may open this schedule check (assigned on Schedules tab). */
export async function openAssignedCheck(auth, deps, input = {}) {
  const scheduleId = trim(input.scheduleId);
  const userEmail = trim(input.userEmail || input.email);
  const got = await listCompanySchedules(auth, deps, input);
  if (!got.ok) {
    return got;
  }
  const schedule = (got.schedules || []).find((row) => trim(row.id) === scheduleId);
  if (!schedule) {
    return {
      ok: false,
      code: "SCHEDULE_NOT_FOUND",
      error: "Schedule not found for this company.",
      httpStatus: 404,
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

/** Append completed check row to AuditResults — workbook is source of truth. */
export async function submitCompletedCheck(auth, deps, input = {}) {
  const masterSheetId = trim(input.masterSheetId);
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const { appendRowObjects } = deps;

  if (!masterSheetId || !companyFolderId) {
    return {
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "Company workbook context is required before submitting a check.",
      httpStatus: 400,
    };
  }
  if (typeof appendRowObjects !== "function") {
    return {
      ok: false,
      code: "CHECK_SUBMIT_UNAVAILABLE",
      error: "Check submission is not configured.",
      httpStatus: 500,
    };
  }

  const result = input.result && typeof input.result === "object" ? input.result : {};
  const completedAt = trim(result.completedAt) || new Date().toISOString();
  const row = {
    "Result ID": trim(result.resultId) || newResultId(),
    "Local Submission ID": trim(result.localSubmissionId) || trim(input.localSubmissionId),
    "Audit ID": trim(result.auditId || input.auditId),
    "Area ID": trim(result.areaId) || "area-main",
    "Company ID": companyFolderId,
    "Audit Name": trim(result.auditName || input.auditName),
    "Completed By": trim(result.completedBy || input.completedBy || input.userEmail),
    "Completed At": completedAt,
    Status: trim(result.status || result.result) || "completed",
    "Answers JSON": typeof result.answersJson === "string" ? result.answersJson : JSON.stringify(result.answers || {}),
    "Created At": completedAt,
    "Updated At": completedAt,
    "Created By": trim(result.completedBy || input.userEmail),
    "Updated By": trim(result.completedBy || input.userEmail),
    "Sync Status": "synced",
    ...(result.extraFields && typeof result.extraFields === "object" ? result.extraFields : {}),
  };

  const written = await appendRowObjects(auth, masterSheetId, "AuditResults", [row]);
  return {
    ok: true,
    resultId: row["Result ID"],
    companyFolderId,
    masterSheetId,
    written,
  };
}

/** Read AuditResults rows for Godmode / reports (diagnostics-friendly). */
export async function listAuditResults(auth, deps, input = {}) {
  const masterSheetId = trim(input.masterSheetId);
  const { getTabValues, rowsToRecords } = deps;
  if (!masterSheetId || typeof getTabValues !== "function") {
    return {
      ok: false,
      code: "AUDIT_RESULTS_UNAVAILABLE",
      error: "Audit results are not available.",
      httpStatus: 400,
    };
  }
  const values = await getTabValues(auth, masterSheetId, "AuditResults");
  const results = typeof rowsToRecords === "function" ? rowsToRecords(values) : [];
  return {
    ok: true,
    masterSheetId,
    companyFolderId: trim(input.companyFolderId || input.companyId),
    results,
  };
}
