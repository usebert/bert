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
  getCompanyScheduleForCompletion,
  isActiveMyCheckScheduleStatus,
  resolveCompanyScheduleContext,
  scheduleMatchesCompanyFolder,
} from "./schedule-service.mjs";
import {
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export const CHECK_COMPLETION_GOOGLE_TIMEOUT_MS = Math.min(
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
  75_000,
);
export const CHECK_COMPLETION_ROUTE_TIMEOUT_MS = 90_000;

function logCheckCompletePhase(phase, meta = {}) {
  const { startedAt, companyId, scheduleId, userEmail, answerCount, ...rest } = meta;
  const payload = {
    phase,
    companyId: trim(companyId),
    scheduleId: trim(scheduleId),
    userEmail: normalizeEmail(userEmail),
    ...rest,
  };
  if (typeof startedAt === "number") {
    payload.elapsedMs = Date.now() - startedAt;
  }
  if (typeof answerCount === "number") {
    payload.answerCount = answerCount;
  }
  console.info("[complete-check]", payload);
}

function completionTimeoutError(operation, error) {
  if (error?.code === "GOOGLE_TIMEOUT") {
    return {
      ok: false,
      code: "CHECK_SUBMIT_TIMEOUT",
      reasonCode: "GOOGLE_TIMEOUT",
      error: "Saving your check timed out while reading or writing the company workbook.",
      message: "Saving your check timed out while reading or writing the company workbook.",
      httpStatus: 504,
    };
  }
  const technicalError = error instanceof Error ? error.message : String(error);
  console.error(`[complete-check] ${operation} failed:`, technicalError);
  return {
    ok: false,
    code: "CHECK_SUBMIT_FAILED",
    error: "Could not save completed check to the company workbook.",
    message: "Could not save completed check to the company workbook.",
    httpStatus: 502,
  };
}

async function withCheckCompletionTimeout(promise, operation, timeoutMs = CHECK_COMPLETION_GOOGLE_TIMEOUT_MS) {
  return withOperationTimeout(promise, operation, timeoutMs);
}

async function appendAuditResultRowWithRetry(appendTabRows, auth, deps, masterSheetId, row) {
  const doAppend = () =>
    appendTabRows(auth, deps, masterSheetId, AUDIT_RESULTS_TAB, AUDIT_RESULTS_TAB_COLUMNS, [row]);
  try {
    return await withCheckCompletionTimeout(doAppend(), "append_audit_results_row");
  } catch (firstError) {
    if (firstError?.code === "GOOGLE_TIMEOUT") {
      throw firstError;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await withCheckCompletionTimeout(doAppend(), "append_audit_results_row_retry");
  }
}

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
  "Next Due At",
  "Frequency",
  "Sync Status",
  "Created By",
  "Updated By",
];

export const AUDIT_RESULTS_DETAIL_COLUMNS = ["Answers JSON", "Findings JSON", "Evidence Refs"];

export const AUDIT_RESULTS_SUMMARY_READ_RANGES = ["A:H", "L:W"];

export const DEFAULT_RESULTS_LIST_LIMIT = 100;
export const DEFAULT_RESULTS_LIST_SINCE_DAYS = 30;

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

function resolveGetTabValues(deps) {
  return typeof deps?.getTabValues === "function" ? deps.getTabValues : null;
}

function resolveRowsToRecords(deps) {
  return typeof deps?.rowsToRecords === "function" ? deps.rowsToRecords : null;
}

function completedAtMsFromRecord(record = {}) {
  const completedAt = pickRecordField(record, "Completed At", "CompletedAt");
  const parsed = Date.parse(completedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function sortAuditResultsByCompletedAtDesc(records = []) {
  return [...records].sort((left, right) => completedAtMsFromRecord(right) - completedAtMsFromRecord(left));
}

export function sliceAuditResultsList(records = [], listOptions = {}) {
  const sorted = sortAuditResultsByCompletedAtDesc(records);
  const sinceDays = Number(listOptions.sinceDays);
  const hasSinceDays = Number.isFinite(sinceDays) && sinceDays > 0;
  const sinceMs = hasSinceDays ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : null;
  const filtered = sinceMs === null
    ? sorted
    : sorted.filter((record) => completedAtMsFromRecord(record) >= sinceMs);

  const offset = Math.max(Number(listOptions.offset) || 0, 0);
  const limit = Number(listOptions.limit);
  const hasLimit = Number.isFinite(limit) && limit > 0;
  const sliced = hasLimit ? filtered.slice(offset, offset + limit) : filtered.slice(offset);
  const nextOffset = offset + sliced.length;
  const hasMore = hasLimit ? nextOffset < filtered.length : false;

  return {
    results: sliced,
    totalMatched: filtered.length,
    hasMore,
    nextOffset,
  };
}

async function readAuditResultRecordById(auth, deps, masterSheetId, resultId) {
  const getTabValues = resolveGetTabValues(deps);
  const rowsToRecords = resolveRowsToRecords(deps);
  if (!getTabValues || !rowsToRecords) {
    return null;
  }

  const idColumnValues = await getTabValues(auth, deps, masterSheetId, AUDIT_RESULTS_TAB, "A:A");
  let rowIndex = -1;
  for (let index = 1; index < idColumnValues.length; index += 1) {
    if (trim(idColumnValues[index]?.[0]) === resultId) {
      rowIndex = index;
      break;
    }
  }
  if (rowIndex < 0) {
    return null;
  }

  const sheetRowNumber = rowIndex + 1;
  const headerValues = await getTabValues(auth, deps, masterSheetId, AUDIT_RESULTS_TAB, "A1:W1");
  const rowValues = await getTabValues(
    auth,
    deps,
    masterSheetId,
    AUDIT_RESULTS_TAB,
    `A${sheetRowNumber}:W${sheetRowNumber}`,
  );
  const records = rowsToRecords([...(headerValues || []), ...(rowValues || [])]);
  return records[0] || null;
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
    "Next Due At": trim(input.nextDueAt),
    Frequency: trim(input.frequency),
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
  const startedAt = Number(input.startedAt) || Date.now();
  const traceMeta = { startedAt, companyId: companyFolderId, scheduleId, userEmail: email };

  if (!scheduleId || !email || !companyFolderId) {
    return {
      ok: false,
      code: "COMPLETION_CONTEXT_MISSING",
      error: "Schedule, user email, and company folder are required.",
      httpStatus: 400,
    };
  }

  let context;
  const resolveStart = Date.now();
  try {
    context = await withCheckCompletionTimeout(
      resolveCompanyScheduleContext(auth, deps, {
        companyId: companyFolderId,
        companyFolderId,
        companyName: input.companyName,
      }),
      "resolve_company_schedule_context",
    );
  } catch (error) {
    logCheckCompletePhase("resolve_company_error", { ...traceMeta, durationMs: Date.now() - resolveStart });
    return completionTimeoutError("resolve_company_schedule_context", error);
  }
  logCheckCompletePhase("resolve_company_end", { ...traceMeta, durationMs: Date.now() - resolveStart });
  if (!context.ok) {
    return context;
  }

  const loadScheduleStart = Date.now();
  logCheckCompletePhase("load_schedule_start", traceMeta);
  let scheduleResult;
  try {
    scheduleResult = await withCheckCompletionTimeout(
      getCompanyScheduleForCompletion(auth, deps, {
        companyId: context.companyFolderId,
        companyFolderId: context.companyFolderId,
        companyName: input.companyName,
        scheduleId,
        resolvedContext: context,
      }),
      "load_schedule_for_completion",
    );
  } catch (error) {
    logCheckCompletePhase("load_schedule_error", { ...traceMeta, durationMs: Date.now() - loadScheduleStart });
    return completionTimeoutError("load_schedule_for_completion", error);
  }
  logCheckCompletePhase("load_schedule_end", { ...traceMeta, durationMs: Date.now() - loadScheduleStart });
  if (!scheduleResult.ok) {
    return scheduleResult;
  }

  const schedule = scheduleResult.schedule;
  if (!scheduleMatchesCompanyFolder(schedule, companyFolderId, context.alternateIds || [])) {
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
  const startedAt = Date.now();
  const answerCount = Array.isArray(input.answers)
    ? input.answers.length
    : input.answers && typeof input.answers === "object"
      ? Object.keys(input.answers).length
      : undefined;
  const traceMeta = { startedAt, companyId: companyFolderId, scheduleId, userEmail: email, answerCount };

  logCheckCompletePhase("route_entered", traceMeta);

  const validateStart = Date.now();
  logCheckCompletePhase("validate_answers_start", traceMeta);
  const eligibility = await verifyScheduleCompletionEligibility(auth, deps, {
    scheduleId,
    email,
    companyFolderId,
    companyName: input.companyName,
    startedAt,
  });
  logCheckCompletePhase("validate_answers_end", { ...traceMeta, durationMs: Date.now() - validateStart });
  const validateMs = Date.now() - validateStart;
  if (!eligibility.ok) {
    logCheckCompletePhase("response_sent", { ...traceMeta, ok: false, code: eligibility.code });
    return eligibility;
  }

  const schedule = eligibility.schedule || {};
  const auditId = trim(input.auditId || schedule.auditId || schedule.audits?.[0]?.auditId);
  const auditName = trim(input.auditName || schedule.scheduleName || schedule.audits?.[0]?.auditName);
  const matchingAudit =
    (schedule.audits || []).find((audit) => trim(audit.auditId) === auditId) ||
    (schedule.audits || []).find((audit) => trim(audit.auditName) === auditName) ||
    schedule.audits?.[0];
  const row = buildAuditResultRow({
    ...input,
    scheduleId: scheduleId || trim(schedule.id),
    companyFolderId: eligibility.companyFolderId,
    companyId: eligibility.companyFolderId,
    completedByEmail: email,
    completedByName: trim(input.completedByName || input.name),
    auditId,
    auditName,
    nextDueAt: trim(input.nextDueAt || schedule.nextDueAt),
    frequency: trim(input.frequency || matchingAudit?.frequency || "Weekly"),
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
  try {
    const writeStart = Date.now();
    logCheckCompletePhase("write_audit_results_start", traceMeta);
    const written = await appendAuditResultRowWithRetry(
      appendTabRows,
      auth,
      deps,
      eligibility.masterSheetId,
      row,
    );
    logCheckCompletePhase("write_audit_results_end", { ...traceMeta, durationMs: Date.now() - writeStart });
    const writeAuditResultsMs = Date.now() - writeStart;
    logCheckCompletePhase("update_schedule_status_end", {
      ...traceMeta,
      skipped: true,
      reason: "completion_derived_from_audit_results",
    });
    logCheckCompletePhase("response_sent", { ...traceMeta, ok: true, resultId: row["Result ID"] });
    return {
      ok: true,
      resultId: row["Result ID"],
      companyId: eligibility.companyFolderId,
      companyFolderId: eligibility.companyFolderId,
      masterSheetId: eligibility.masterSheetId,
      scheduleId: row["Schedule ID"],
      written,
      timingMs: {
        total: Date.now() - startedAt,
        validateMs,
        writeAuditResultsMs,
      },
    };
  } catch (error) {
    logCheckCompletePhase("catch_error", {
      ...traceMeta,
      code: error?.code || "CHECK_SUBMIT_FAILED",
      durationMs: Date.now() - startedAt,
    });
    const timeoutResult = completionTimeoutError("write_audit_results", error);
    if (timeoutResult.reasonCode === "GOOGLE_TIMEOUT") {
      logCheckCompletePhase("response_sent", { ...traceMeta, ok: false, code: timeoutResult.code });
      return timeoutResult;
    }
    const technicalError = error instanceof Error ? error.message : String(error);
    console.error("[complete-check] write_audit_results failed:", technicalError);
    logCheckCompletePhase("response_sent", { ...traceMeta, ok: false, code: "CHECK_SUBMIT_FAILED" });
    return {
      ok: false,
      code: "CHECK_SUBMIT_FAILED",
      error: "Could not save completed check to the company workbook.",
      message: "Could not save completed check to the company workbook.",
      httpStatus: 502,
    };
  }
}

/** Read AuditResults from company workbook — filtered by CompanyFolderId. */
export async function listAuditResults(auth, deps, companyContext = {}, listOptions = null) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const preResolvedContext = listOptions?.resolvedContext;

  const context =
    preResolvedContext?.ok === true
      ? preResolvedContext
      : await resolveCompanyScheduleContext(auth, deps, {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId,
        });
  if (!context.ok) {
    return context;
  }

  try {
    const ensureTabColumns = resolveEnsureTabColumns(deps);
    await ensureTabColumns(auth, deps, context.masterSheetId, AUDIT_RESULTS_TAB, AUDIT_RESULTS_TAB_COLUMNS);
    const readTabRecords = resolveReadTabRecords(deps);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, AUDIT_RESULTS_TAB, {
      expectedHeaders: AUDIT_RESULTS_TAB_COLUMNS,
      summaryOnly: true,
    });
    const records = (readResult.records || []).filter((record) =>
      auditResultMatchesCompanyFolder(record, context.companyFolderId),
    );

    if (listOptions) {
      const sliced = sliceAuditResultsList(records, listOptions);
      return {
        ok: true,
        companyId: context.companyFolderId,
        companyFolderId: context.companyFolderId,
        masterSheetId: context.masterSheetId,
        results: sliced.results,
        totalMatched: sliced.totalMatched,
        hasMore: sliced.hasMore,
        nextOffset: sliced.nextOffset,
      };
    }

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

/** Read one AuditResults row by Result ID — folder-filtered, wrong-company excluded. */
export async function getAuditResult(auth, deps, companyContext = {}, resultId = "") {
  const targetId = trim(resultId);
  if (!targetId) {
    return {
      ok: false,
      code: "RESULT_ID_REQUIRED",
      error: "Result ID is required.",
      httpStatus: 400,
    };
  }

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

  let match = await readAuditResultRecordById(auth, deps, context.masterSheetId, targetId);
  if (!match) {
    const readTabRecords = resolveReadTabRecords(deps);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, AUDIT_RESULTS_TAB, {
      expectedHeaders: AUDIT_RESULTS_TAB_COLUMNS,
    });
    match =
      (readResult.records || []).find(
        (record) =>
          pickRecordField(record, "Result ID", "ResultId") === targetId &&
          auditResultMatchesCompanyFolder(record, context.companyFolderId),
      ) || null;
  }
  if (!match) {
    return {
      ok: false,
      code: "AUDIT_RESULT_NOT_FOUND",
      error: "This completed check was not found for your company workspace.",
      message: "This completed check was not found for your company workspace.",
      httpStatus: 404,
    };
  }

  return {
    ok: true,
    companyId: context.companyFolderId,
    companyFolderId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    result: match,
  };
}

export { submitCompletedCheck as completeCheck, listAuditResults as listResults };
