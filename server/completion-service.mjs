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
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import { appendNcrsFromCheckCompletion, linkEvidenceRefsToNcrs } from "./ncr-service.mjs";
import {
  PRODUCTION_VERIFICATION_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_RESULT_STATUS,
  PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX,
  isVerificationAuditId,
  isVerificationAuditResult,
  isVerificationScheduleId,
} from "../shared/production-verification-audit.mjs";
import {
  normalizeAuditEvidenceUploadFile,
  sanitizeAuditEvidenceRefsForWorkbook,
  uploadAuditEvidenceToDrive,
} from "./audit-evidence-upload.mjs";
import { createCompletionRequestScope } from "./completion-request-scope.mjs";

export const CHECK_COMPLETION_GOOGLE_TIMEOUT_MS = Math.min(
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
  60_000,
);
export const CHECK_COMPLETION_EVIDENCE_TIMEOUT_MS = 45_000;
export const CHECK_COMPLETION_ROUTE_TIMEOUT_MS = 120_000;

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
      code: "CHECK_COMPLETION_TIMEOUT",
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

function ncrWriteWarningFromResult(ncrResult = {}) {
  if (ncrResult.ok !== false) {
    return "";
  }
  if (ncrResult.code === "NCR_DUPLICATE_SKIPPED") {
    return "";
  }
  return trim(ncrResult.message || ncrResult.error) || "Could not save non-conformance records to the company workbook.";
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
  "Form Number",
  "Revision Number",
  "Revision ID",
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

function resolveAuditResultStatus(input = {}) {
  const explicit = trim(input.status || input.result);
  const localSubmissionId = trim(input.localSubmissionId);
  const scheduleId = trim(input.scheduleId);
  const auditId = trim(input.auditId);
  if (
    localSubmissionId.startsWith(PRODUCTION_VERIFICATION_SMOKE_LOCAL_SUBMISSION_PREFIX) ||
    isVerificationScheduleId(scheduleId) ||
    isVerificationAuditId(auditId)
  ) {
    return PRODUCTION_VERIFICATION_RESULT_STATUS;
  }
  return explicit || "completed";
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

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
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
    Status: resolveAuditResultStatus(input),
    "Answers JSON": jsonString(input.answersJson ?? input.answers, "{}"),
    "Findings JSON": jsonString(input.findingsJson ?? input.findings, "[]"),
    "Evidence Refs": jsonString(input.evidenceRefs ?? input.evidence, "[]"),
    "Created At": trim(input.createdAt) || completedAt,
    "Updated At": trim(input.updatedAt) || completedAt,
    "Local Submission ID": trim(input.localSubmissionId),
    "Audit ID": trim(input.auditId),
    "Area ID": trim(input.areaId) || "area-main",
    "Audit Name": trim(input.auditName),
    "Form Number": trim(input.formNumber || input.form_number),
    "Revision Number": trim(input.revisionNumber || input.revision_number) || "",
    "Revision ID": trim(input.revisionId || input.revision_id),
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

  const resolveCompanyContext =
    typeof deps?.resolveCompanyScheduleContext === "function"
      ? deps.resolveCompanyScheduleContext
      : resolveCompanyScheduleContext;

  let context;
  const resolveStart = Date.now();
  try {
    context = await withCheckCompletionTimeout(
      resolveCompanyContext(auth, deps, {
        companyId: companyFolderId,
        companyFolderId,
        companyName: input.companyName,
        masterSheetId: input.masterSheetId,
        trustSessionContext: input.trustSessionContext === true,
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
    resolvedContext: context,
  };
}

/** Append completed check row to AuditResults tab via workbookService. */
export async function submitCompletedCheck(auth, deps, input = {}) {
  const disableRequestScope = input.disableCompletionRequestScope === true;
  const requestScope = disableRequestScope
    ? null
    : createCompletionRequestScope(deps, {
        trustSessionContext: input.trustSessionContext === true,
        masterSheetId: input.masterSheetId,
        companyFolderId: input.companyFolderId || input.companyId,
        resolvedContext: input.resolvedContext,
        logGoogleOp: (entry) => {
          try {
            console.info("[complete-check]", {
              phase: "google_op",
              companyId: trim(input.companyFolderId || input.companyId),
              scheduleId: trim(input.scheduleId),
              userEmail: normalizeEmail(input.email || input.userEmail || input.completedByEmail),
              ...entry,
            });
          } catch {
            /* timing log must never affect submission */
          }
        },
      });
  const scopedDeps = requestScope?.deps || deps;

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
  const SKIPPED = { skipped: true, reason: "not used by complete-check path" };
  const stageMs = {
    eligibility: null,
    evidence_processing: null,
    audit_results_write: null,
    audit_findings_write: { ...SKIPPED },
    action_creation: { ...SKIPPED },
    schedule_update: { ...SKIPPED },
    ncr_write: null,
  };
  let outcome = { ok: false, code: undefined, resultId: undefined };
  let summaryLogged = false;
  const emitStageTimingsSummary = () => {
    if (summaryLogged) {
      return;
    }
    summaryLogged = true;
    try {
      if (requestScope) {
        requestScope.logSkippedOps(traceMeta);
        logCheckCompletePhase("google_ops_summary", {
          ...traceMeta,
          ...requestScope.getSummary(),
        });
      }
      logCheckCompletePhase("stage_timings_summary", {
        ...traceMeta,
        scheduleId,
        resultId: outcome.resultId || trim(input.resultId) || undefined,
        localSubmissionId: trim(input.localSubmissionId) || undefined,
        totalMs: Date.now() - startedAt,
        stages: stageMs,
        ok: outcome.ok === true,
        code: outcome.code,
        googleOps: requestScope?.getSummary()?.googleOpCount ?? undefined,
      });
    } catch {
      /* timing log must never affect submission */
    }
  };

  logCheckCompletePhase("route_entered", traceMeta);

  try {
    const validateStart = Date.now();
    logCheckCompletePhase("validate_answers_start", traceMeta);
    const eligibility = await verifyScheduleCompletionEligibility(auth, scopedDeps, {
      scheduleId,
      email,
      companyFolderId,
      companyName: input.companyName,
      masterSheetId: input.masterSheetId,
      trustSessionContext: input.trustSessionContext === true,
      startedAt,
    });
    stageMs.eligibility = Date.now() - validateStart;
    logCheckCompletePhase("validate_answers_end", { ...traceMeta, durationMs: stageMs.eligibility });
    if (!eligibility.ok) {
      outcome = { ok: false, code: eligibility.code };
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

    const resultId = trim(input.resultId) || newResultId();
    let evidenceRefs = sanitizeAuditEvidenceRefsForWorkbook(input.evidenceRefs ?? input.evidence ?? []);
    let evidenceUploadWarning = "";
    const evidenceFiles = Array.isArray(input.evidenceFiles) ? input.evidenceFiles : [];
    const attachedEvidenceRefCount = evidenceRefs.length;

    if (attachedEvidenceRefCount > 0 && evidenceFiles.length === 0) {
      logCheckCompletePhase("audit_evidence_upload_skipped", {
        ...traceMeta,
        resultId,
        attachedEvidenceRefCount,
        reason: "no_serialisable_evidence_files",
      });
      evidenceUploadWarning = "Attached evidence could not be uploaded because file data was missing from the request.";
    }

    const row = buildAuditResultRow({
      ...input,
      scheduleId: scheduleId || trim(schedule.id),
      companyFolderId: eligibility.companyFolderId,
      companyId: eligibility.companyFolderId,
      completedByEmail: email,
      completedByName: trim(input.completedByName || input.name),
      auditId,
      auditName,
      formNumber:
        input.formNumber ||
        input.form_number ||
        matchingAudit?.formNumber ||
        matchingAudit?.form_number ||
        "",
      revisionNumber:
        input.revisionNumber ||
        input.revision_number ||
        matchingAudit?.revisionNumber ||
        matchingAudit?.revision_number ||
        matchingAudit?.version ||
        "",
      revisionId:
        input.revisionId ||
        input.revision_id ||
        matchingAudit?.revisionId ||
        matchingAudit?.revision_id ||
        "",
      nextDueAt: trim(input.nextDueAt || schedule.nextDueAt),
      frequency: trim(input.frequency || matchingAudit?.frequency || "Weekly"),
      status: resolveAuditResultStatus({
        ...input,
        scheduleId,
        auditId,
      }),
      answers: input.answers,
      answersJson: input.answersJson,
      findings: input.findings,
      findingsJson: input.findingsJson,
      evidenceRefs,
      localSubmissionId: input.localSubmissionId,
      resultId,
      completedAt: input.completedAt,
    });

    if (row["Company ID"] !== row["Company Folder ID"]) {
      outcome = { ok: false, code: "AUDIT_RESULT_INVALID", resultId };
      return {
        ok: false,
        code: "AUDIT_RESULT_INVALID",
        error: "Audit result company identifiers must match.",
        httpStatus: 500,
      };
    }

    const appendTabRows = resolveAppendTabRows(scopedDeps);
    let written = 0;
    const writeStart = Date.now();
    try {
      logCheckCompletePhase("write_audit_results_start", traceMeta);
      written = await appendAuditResultRowWithRetry(
        appendTabRows,
        auth,
        scopedDeps,
        eligibility.masterSheetId,
        row,
      );
      stageMs.audit_results_write = Date.now() - writeStart;
      logCheckCompletePhase("write_audit_results_end", {
        ...traceMeta,
        durationMs: stageMs.audit_results_write,
      });
    } catch (error) {
      stageMs.audit_results_write = Date.now() - writeStart;
      logCheckCompletePhase("catch_error", {
        ...traceMeta,
        code: error?.code || "CHECK_RESULT_WRITE_FAILED",
        durationMs: Date.now() - startedAt,
      });
      const timeoutResult = completionTimeoutError("write_audit_results", error);
      if (timeoutResult.reasonCode === "GOOGLE_TIMEOUT") {
        outcome = { ok: false, code: timeoutResult.code, resultId };
        logCheckCompletePhase("response_sent", { ...traceMeta, ok: false, code: timeoutResult.code });
        return timeoutResult;
      }
      outcome = { ok: false, code: "CHECK_RESULT_WRITE_FAILED", resultId };
      logCheckCompletePhase("response_sent", { ...traceMeta, ok: false, code: "CHECK_RESULT_WRITE_FAILED" });
      return {
        ok: false,
        code: "CHECK_RESULT_WRITE_FAILED",
        error: "Could not save completed check to the company workbook.",
        message: "Could not save completed check to the company workbook.",
        httpStatus: 502,
      };
    }

    const ncrWriteStart = Date.now();
    logCheckCompletePhase("write_ncrs_start", traceMeta);
    let ncrResult;
    try {
      ncrResult = await withCheckCompletionTimeout(
        appendNcrsFromCheckCompletion(auth, scopedDeps, {
          companyId: eligibility.companyFolderId,
          companyFolderId: eligibility.companyFolderId,
          masterSheetId: eligibility.masterSheetId,
          resolvedContext: eligibility.resolvedContext,
          trustSessionContext: input.trustSessionContext === true,
          resultId: row["Result ID"],
          auditId,
          auditName,
          site: trim(input.site || input.areaId || matchingAudit?.areaId),
          completedByEmail: email,
          completedByName: trim(input.completedByName || input.name),
          completedAt: row["Completed At"],
          findings: input.findings ?? [],
          evidenceRefs,
          localSubmissionId: input.localSubmissionId,
          assignedLineManager: trim(input.assignedLineManager),
          assignedLineManagerEmail: trim(input.assignedLineManagerEmail),
        }),
        "write_ncrs",
      );
    } catch (error) {
      stageMs.ncr_write = Date.now() - ncrWriteStart;
      logCheckCompletePhase("write_ncrs_end", {
        ...traceMeta,
        durationMs: stageMs.ncr_write,
        ok: false,
      });
      ncrResult = {
        ok: false,
        code: error?.code === "GOOGLE_TIMEOUT" ? "NCR_WRITE_FAILED" : "NCR_WRITE_FAILED",
        message: "Could not save non-conformance records to the company workbook.",
        ncrs: [],
      };
    }
    if (typeof stageMs.ncr_write !== "number") {
      stageMs.ncr_write = Date.now() - ncrWriteStart;
    }
    logCheckCompletePhase("write_ncrs_end", {
      ...traceMeta,
      durationMs: stageMs.ncr_write,
      written: ncrResult.written ?? 0,
      ok: ncrResult.ok !== false,
    });

    const ncrWriteWarning = ncrWriteWarningFromResult(ncrResult);
    let ncrEvidenceLinkWarning = "";
    let createdNcrs = Array.isArray(ncrResult.ncrs) ? ncrResult.ncrs : [];

    if (evidenceFiles.length > 0) {
      const evidenceStart = Date.now();
      const normalizedFiles = evidenceFiles.map((file, index) => normalizeAuditEvidenceUploadFile(file, index));
      const validDataUrlCount = normalizedFiles.filter((file) => trim(file.dataUrl).startsWith("data:")).length;
      logCheckCompletePhase("audit_evidence_upload_start", {
        ...traceMeta,
        resultId,
        fileCount: normalizedFiles.length,
        validDataUrlCount,
        deferred: true,
      });
      try {
        const uploaded = await withCheckCompletionTimeout(
          uploadAuditEvidenceToDrive(auth, scopedDeps, {
            companyFolderId: eligibility.companyFolderId,
            masterSheetId: eligibility.masterSheetId,
            trustSessionContext: input.trustSessionContext === true,
            resultId,
            files: normalizedFiles,
          }),
          "upload_audit_evidence",
          CHECK_COMPLETION_EVIDENCE_TIMEOUT_MS,
        );
        logCheckCompletePhase("audit_evidence_upload_end", {
          ...traceMeta,
          resultId,
          uploadedCount: uploaded.evidenceRefs?.length || 0,
          folderId: uploaded.folderId || "",
          ok: uploaded.ok,
        });
        if (uploaded.evidenceRefs?.length > 0) {
          evidenceUploadWarning = "";
          const uploadedByEvidenceId = new Map(
            uploaded.evidenceRefs.map((ref) => [trim(ref.evidenceId), ref]),
          );
          evidenceRefs = evidenceRefs.map((ref) => uploadedByEvidenceId.get(trim(ref.evidenceId)) || ref);
          for (const uploadedRef of uploaded.evidenceRefs) {
            if (!evidenceRefs.some((ref) => trim(ref.evidenceId) === trim(uploadedRef.evidenceId))) {
              evidenceRefs.push(uploadedRef);
            }
          }

          // Best-effort: patch AuditResult Evidence Refs with Drive links (source of truth).
          try {
            const patchTabRowByHeader = resolvePatchTabRowByHeader(scopedDeps);
            await patchTabRowByHeader(
              auth,
              scopedDeps,
              eligibility.masterSheetId,
              AUDIT_RESULTS_TAB,
              "Result ID",
              resultId,
              {
                "Evidence Refs": jsonString(evidenceRefs, "[]"),
              },
              { matchHeaderAliases: ["Result ID", "ResultId"] },
            );
          } catch {
            // Non-blocking — NCR link + response still carry Drive metadata.
          }

          if (createdNcrs.length > 0) {
            logCheckCompletePhase("ncr_evidence_link_start", {
              ...traceMeta,
              resultId,
              ncrCount: createdNcrs.length,
            });
            try {
              const linked = await linkEvidenceRefsToNcrs(auth, scopedDeps, {
                masterSheetId: eligibility.masterSheetId,
                resultId,
                evidenceRefs,
                ncrs: createdNcrs,
              });
              createdNcrs = linked.ncrs || createdNcrs;
              if (!linked.ok) {
                ncrEvidenceLinkWarning =
                  linked.message || "Could not link uploaded evidence to non-conformance records.";
              } else if (linked.warning) {
                ncrEvidenceLinkWarning = linked.warning;
              }
              logCheckCompletePhase("ncr_evidence_link_end", {
                ...traceMeta,
                resultId,
                updated: linked.updated ?? 0,
                ok: linked.ok !== false,
              });
            } catch {
              ncrEvidenceLinkWarning = "Could not link uploaded evidence to non-conformance records.";
              logCheckCompletePhase("ncr_evidence_link_end", {
                ...traceMeta,
                resultId,
                ok: false,
                code: "NCR_EVIDENCE_LINK_FAILED",
              });
            }
          }
        }
        if (!uploaded.ok) {
          evidenceUploadWarning =
            uploaded.message || uploaded.error || "Photo evidence could not be uploaded to Google Drive.";
        } else if (uploaded.warning) {
          evidenceUploadWarning = uploaded.warning;
        }
      } catch (error) {
        logCheckCompletePhase("audit_evidence_upload_end", {
          ...traceMeta,
          resultId,
          ok: false,
          code: error?.code || "EVIDENCE_WRITE_FAILED",
        });
        evidenceUploadWarning =
          evidenceUploadWarning ||
          "Check completed, but photo evidence could not be uploaded before the request finished.";
      }
      stageMs.evidence_processing = Date.now() - evidenceStart;
    } else {
      stageMs.evidence_processing = { skipped: true, reason: "no_evidence_files_in_request" };
    }

    logCheckCompletePhase("update_schedule_status_end", {
      ...traceMeta,
      skipped: true,
      reason: "completion_derived_from_audit_results",
    });
    outcome = { ok: true, resultId: row["Result ID"] };
    logCheckCompletePhase("response_sent", { ...traceMeta, ok: true, resultId: row["Result ID"] });
    const response = {
      ok: true,
      resultId: row["Result ID"],
      companyId: eligibility.companyFolderId,
      companyFolderId: eligibility.companyFolderId,
      masterSheetId: eligibility.masterSheetId,
      scheduleId: row["Schedule ID"],
      written,
      ncrs: createdNcrs,
      evidenceRefs,
      ncrWriteWarning,
      ncrEvidenceLinkWarning,
      evidenceUploadWarning,
    };
    if (input.captureCompletionDiagnostics === true && requestScope) {
      requestScope.logSkippedOps(traceMeta);
      response.completionDiagnostics = requestScope.getSummary();
    }
    return response;
  } finally {
    emitStageTimingsSummary();
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

/** Mark a smoke verification AuditResults row as cleaned — verification rows only. */
export async function cleanupVerificationAuditResult(auth, deps, input = {}) {
  const resultId = trim(input.resultId);
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);
  const localSubmissionId = trim(input.localSubmissionId);

  if (!resultId || !companyFolderId) {
    return {
      ok: false,
      code: "CLEANUP_CONTEXT_MISSING",
      error: "Result ID and company folder are required.",
      httpStatus: 400,
    };
  }

  const existing = await getAuditResult(
    auth,
    deps,
    {
      companyFolderId,
      companyId: companyFolderId,
      masterSheetId,
      trustSessionContext: input.trustSessionContext === true,
    },
    resultId,
  );
  if (!existing.ok) {
    return existing;
  }

  const record = existing.result || {};
  if (!isVerificationAuditResult(record)) {
    return {
      ok: false,
      code: "CLEANUP_NOT_VERIFICATION_RESULT",
      error: "Only verification audit results can be cleaned up through this path.",
      httpStatus: 403,
    };
  }

  const rowLocalSubmissionId = trim(
    pickRecordField(record, "Local Submission ID", "LocalSubmissionId"),
  );
  if (
    localSubmissionId &&
    rowLocalSubmissionId &&
    rowLocalSubmissionId !== localSubmissionId
  ) {
    return {
      ok: false,
      code: "CLEANUP_SUBMISSION_MISMATCH",
      error: "The verification result does not match the submitted local submission ID.",
      httpStatus: 403,
    };
  }

  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  try {
    await patchTabRowByHeader(
      auth,
      deps,
      existing.masterSheetId,
      AUDIT_RESULTS_TAB,
      "Result ID",
      resultId,
      {
        Status: PRODUCTION_VERIFICATION_CLEANED_STATUS,
        "Updated At": new Date().toISOString(),
      },
    );
  } catch (error) {
    return {
      ok: false,
      code: "CLEANUP_WRITE_FAILED",
      error: "Could not clean up the verification audit result.",
      message: "Could not clean up the verification audit result.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }

  return {
    ok: true,
    resultId,
    companyFolderId: existing.companyFolderId,
    masterSheetId: existing.masterSheetId,
    cleaned: true,
    status: PRODUCTION_VERIFICATION_CLEANED_STATUS,
  };
}

export { submitCompletedCheck as completeCheck, listAuditResults as listResults };
