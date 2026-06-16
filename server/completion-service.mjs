/**
 * completionService — check completion eligibility, AuditResults tab writes, folder-filtered reads.
 * Workbook AuditResults tab is the source of truth (no cache/session/registry stores).
 */
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";
import {
  isGodmodeInviteSession,
  isCompanyInviteActor,
} from "../shared/company-invite-permissions.mjs";
import {
  getCompanySchedule,
  isActiveMyCheckScheduleStatus,
  resolveCompanyScheduleContext,
  scheduleMatchesCompanyFolder,
} from "./schedule-service.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export const AUDIT_RESULTS_TAB = "AuditResults";

export const AUDIT_RESULTS_TAB_COLUMNS = [
  "Result ID",
  "Company ID",
  "Company Folder ID",
  "Schedule ID",
  "Completed By Email",
  "Completed By Name",
  "Completed At",
  "Status",
  "Answers JSON",
  "Findings JSON",
  "Evidence Refs",
  "Created At",
  "Updated At",
  "Local Submission ID",
  "Audit ID",
  "Area ID",
  "Audit Name",
  "Completed By",
  "Sync Status",
  "Created By",
  "Updated By",
];

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function newResultId() {
  return `result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function jsonString(value, fallback = "{}") {
  if (typeof value === "string") {
    const text = value.trim();
    return text || fallback;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function pickRecordField(record = {}, ...keys) {
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

export function auditResultMatchesCompanyFolder(record = {}, companyFolderId = "") {
  const target = trim(companyFolderId);
  if (!target) {
    return true;
  }
  const folderId = pickRecordField(record, "Company Folder ID", "CompanyFolderId");
  const companyId = pickRecordField(record, "Company ID", "CompanyId");
  if (folderId) {
    return folderId === target;
  }
  if (companyId) {
    return companyId === target;
  }
  return true;
}

export function canListCompanyAuditResults(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  if (!isCompanyInviteActor({ role: actor.role, accessLevel: actor.accessLevel })) {
    return false;
  }
  const sessionCompanyId = trim(actor.companyId || actor.companyFolderId);
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean),
  );
  return targets.has(sessionCompanyId);
}

/** Build one AuditResults row — CompanyId === CompanyFolderId; JSON fields stringified. */
export function buildAuditResultRow(input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const completedAt = trim(input.completedAt) || new Date().toISOString();
  const completedByEmail = normalizeEmail(input.completedByEmail || input.email || input.completedBy);
  const completedByName =
    trim(input.completedByName || input.name || input.completedBy) ||
    completedByEmail.split("@")[0] ||
    completedByEmail;

  return {
    "Result ID": trim(input.resultId) || newResultId(),
    "Company ID": companyFolderId,
    "Company Folder ID": companyFolderId,
    "Schedule ID": trim(input.scheduleId),
    "Completed By Email": completedByEmail,
    "Completed By Name": completedByName,
    "Completed At": completedAt,
    Status: trim(input.status) || "completed",
    "Answers JSON": jsonString(input.answersJson ?? input.answers, "{}"),
    "Findings JSON": jsonString(input.findingsJson ?? input.findings, "[]"),
    "Evidence Refs": jsonString(input.evidenceRefs ?? input.evidence, "[]"),
    "Created At": trim(input.createdAt) || completedAt,
    "Updated At": trim(input.updatedAt) || completedAt,
    "Local Submission ID": trim(input.localSubmissionId),
    "Audit ID": trim(input.auditId),
    "Area ID": trim(input.areaId) || "area-main",
    "Audit Name": trim(input.auditName),
    "Completed By": completedByEmail,
    "Sync Status": "synced",
    "Created By": completedByEmail,
    "Updated By": completedByEmail,
  };
}

/** Folder match + AssignedUserEmails eligibility before completion. */
export async function verifyScheduleCompletionEligibility(auth, deps, input = {}) {
  const scheduleId = trim(input.scheduleId);
  const email = normalizeEmail(input.email || input.userEmail);
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);

  if (!scheduleId || !email || !companyFolderId) {
    return {
      ok: false,
      code: "COMPLETION_CONTEXT_MISSING",
      error: "Schedule, user email, and company folder are required.",
      httpStatus: 400,
    };
  }

  const context = await resolveCompanyScheduleContext(auth, deps, {
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId,
  });
  if (!context.ok) {
    return context;
  }

  const scheduleResult = await getCompanySchedule(auth, deps, {
    companyId: context.companyFolderId,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    scheduleId,
  });
  if (!scheduleResult.ok) {
    return scheduleResult;
  }

  const schedule = scheduleResult.schedule;
  if (!scheduleMatchesCompanyFolder(schedule, companyFolderId)) {
    return {
      ok: false,
      code: "SCHEDULE_WRONG_COMPANY",
      error: "This schedule does not belong to the selected company.",
      httpStatus: 403,
    };
  }

  if (!isActiveMyCheckScheduleStatus(schedule)) {
    return {
      ok: false,
      code: "CHECK_NOT_ACTIVE",
      error: "This check is not active.",
      httpStatus: 403,
    };
  }

  if (!isScheduleAssignedToUser(schedule, email)) {
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
    companyId: context.companyFolderId,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    email,
  };
}

/** Append completed check row to AuditResults tab via workbookService. */
export async function submitCompletedCheck(auth, deps, input = {}) {
  const email = normalizeEmail(input.email || input.userEmail || input.completedByEmail);
  const scheduleId = trim(input.scheduleId);
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);

  const eligibility = await verifyScheduleCompletionEligibility(auth, deps, {
    scheduleId,
    email,
    companyFolderId,
    masterSheetId,
  });
  if (!eligibility.ok) {
    return eligibility;
  }

  const schedule = eligibility.schedule || {};
  const row = buildAuditResultRow({
    ...input,
    scheduleId: scheduleId || trim(schedule.id),
    companyFolderId: eligibility.companyFolderId,
    companyId: eligibility.companyFolderId,
    completedByEmail: email,
    completedByName: trim(input.completedByName || input.name),
    auditId: trim(input.auditId || schedule.auditId || schedule.audits?.[0]?.auditId),
    auditName: trim(input.auditName || schedule.scheduleName || schedule.audits?.[0]?.auditName),
    status: trim(input.status || input.result) || "completed",
    answers: input.answers,
    answersJson: input.answersJson,
    findings: input.findings,
    findingsJson: input.findingsJson,
    evidence: input.evidence,
    evidenceRefs: input.evidenceRefs,
    localSubmissionId: input.localSubmissionId,
    resultId: input.resultId,
    completedAt: input.completedAt,
  });

  if (row["Company ID"] !== row["Company Folder ID"]) {
    return {
      ok: false,
      code: "AUDIT_RESULT_INVALID",
      error: "Audit result company identifiers must match.",
      httpStatus: 500,
    };
  }

  const appendTabRows = resolveAppendTabRows(deps);
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  try {
    await ensureTabColumns(auth, deps, eligibility.masterSheetId, AUDIT_RESULTS_TAB, AUDIT_RESULTS_TAB_COLUMNS);
    const written = await appendTabRows(
      auth,
      deps,
      eligibility.masterSheetId,
      AUDIT_RESULTS_TAB,
      AUDIT_RESULTS_TAB_COLUMNS,
      [row],
    );
    return {
      ok: true,
      resultId: row["Result ID"],
      companyId: eligibility.companyFolderId,
      companyFolderId: eligibility.companyFolderId,
      masterSheetId: eligibility.masterSheetId,
      scheduleId: row["Schedule ID"],
      written,
    };
  } catch (error) {
    return {
      ok: false,
      code: "CHECK_SUBMIT_FAILED",
      error: "Could not save completed check to the company workbook.",
      message: "Could not save completed check to the company workbook.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }
}

/** Read AuditResults from company workbook — filtered by CompanyFolderId. */
export async function listAuditResults(auth, deps, companyContext = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);

  const context = await resolveCompanyScheduleContext(auth, deps, {
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId,
  });
  if (!context.ok) {
    return context;
  }

  try {
    const readTabRecords = resolveReadTabRecords(deps);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, AUDIT_RESULTS_TAB, {
      expectedHeaders: AUDIT_RESULTS_TAB_COLUMNS,
    });
    const records = (readResult.records || []).filter((record) =>
      auditResultMatchesCompanyFolder(record, context.companyFolderId),
    );
    return {
      ok: true,
      companyId: context.companyFolderId,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      results: records,
    };
  } catch (error) {
    return {
      ok: false,
      code: "AUDIT_RESULTS_UNAVAILABLE",
      error: "Audit results are not available.",
      message: "Audit results are not available.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }
}

export { submitCompletedCheck as completeCheck, listAuditResults as listResults };
