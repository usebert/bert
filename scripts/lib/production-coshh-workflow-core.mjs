/**
 * Production COSHH workflow checks — shared by live verifier and unit tests.
 */
import {
  assessmentReviewedMarker,
  assessmentSubmittedMarker,
  buildProductionVerificationCoshhAssessment,
  buildProductionVerificationCoshhAssessmentId,
  buildProductionVerificationCoshhAssessmentNumber,
  buildProductionVerificationCoshhId,
  buildProductionVerificationCoshhSubstance,
  buildProductionVerificationSdsDocumentId,
  buildProductionVerificationSdsFileName,
  countCoshhBaselines,
  defaultVerificationReviewDate,
  findCoshhById,
  isOperationalCoshhRegister,
  isVerificationCoshhAssessment,
  isVerificationCoshhRegister,
  listActiveVerificationCoshhRegisters,
  PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION,
  PRODUCTION_VERIFICATION_COSHH_PPE,
  PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME,
  PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY,
  PRODUCTION_VERIFICATION_COSHH_SOURCE,
} from "../../shared/production-verification-coshh.mjs";
import { getUkTodayKey } from "../../shared/uk-date-time.mjs";
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  createFetchTransport,
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  buildTimeoutFailureResult,
  createWorkflowDiagnostics,
  isStageTimeoutError,
  wrapTransportWithTimeouts,
} from "./production-workflow-diagnostics.mjs";
import {
  isTransientNetworkError,
  isTransientWorkflowFailure,
  requestWithTransientRetries,
} from "./production-risk-assessment-transient-retry.mjs";

export { performProductionSmokeLogin, maskEmail, createFetchTransport };

export const COSHH_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_COSHH_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  coshhApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createProduct: 120_000,
  createDraft: 120_000,
  readback: 60_000,
  editAssessment: 120_000,
  hazardClassification: 120_000,
  ppeAndControls: 120_000,
  sds: 60_000,
  saveDraft: 120_000,
  submit: 120_000,
  approverLogin: 90_000,
  approveActivate: 120_000,
  detailVerification: 60_000,
  review: 120_000,
  healthSafetyOverview: 60_000,
  dashboard: 60_000,
  notifications: 5_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "coshhApi",
  "baseline",
  "staleCleanup",
  "createProduct",
  "createDraft",
  "readback",
  "editAssessment",
  "hazardClassification",
  "ppeAndControls",
  "sds",
  "saveDraft",
  "submit",
  "approverLogin",
  "approveActivate",
  "detailVerification",
  "review",
  "healthSafetyOverview",
  "dashboard",
  "notifications",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  coshhApi: "COSHH API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createProduct: "Create Product",
  createDraft: "Create Draft",
  readback: "Readback",
  editAssessment: "Edit Assessment",
  hazardClassification: "Hazard Classification",
  ppeAndControls: "PPE and Controls",
  sds: "SDS",
  saveDraft: "Save Draft",
  submit: "Submit",
  approverLogin: "Approver Login",
  approveActivate: "Approve / Activate",
  detailVerification: "Detail Verification",
  review: "Review",
  healthSafetyOverview: "H&S Overview",
  dashboard: "Dashboard",
  notifications: "Notifications",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createProduct",
  "createDraft",
  "readback",
  "editAssessment",
  "hazardClassification",
  "ppeAndControls",
  "sds",
  "saveDraft",
  "submit",
  "approverLogin",
  "approveActivate",
  "detailVerification",
  "review",
  "healthSafetyOverview",
  "dashboard",
  "cleanup",
]);

const REPORT_LABEL_WIDTH = 24;

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return trim(value).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function coshhListPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/coshh`, masterSheetId);
}

function coshhDetailPath(companyFolderId, coshhId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}`,
    masterSheetId,
  );
}

function coshhAssessmentsPath(companyFolderId, coshhId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}/assessments`,
    masterSheetId,
  );
}

function coshhAssessmentDetailPath(companyFolderId, assessmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh-assessments/${encodeURIComponent(assessmentId)}`,
    masterSheetId,
  );
}

function healthSafetyOverviewPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/health-safety/overview`, masterSheetId);
}

function verificationSubstancePath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/substance`,
    masterSheetId,
  );
}

function verificationSubstancePatchPath(companyFolderId, coshhId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/substance/${encodeURIComponent(coshhId)}`,
    masterSheetId,
  );
}

function verificationAssessmentPath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/assessments`,
    masterSheetId,
  );
}

function verificationAssessmentPatchPath(companyFolderId, assessmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/assessments/${encodeURIComponent(assessmentId)}`,
    masterSheetId,
  );
}

function verificationAssessmentSubmitPath(companyFolderId, assessmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/assessments/${encodeURIComponent(assessmentId)}/submit`,
    masterSheetId,
  );
}

function verificationAssessmentApprovePath(companyFolderId, assessmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/assessments/${encodeURIComponent(assessmentId)}/approve`,
    masterSheetId,
  );
}

function verificationAssessmentReviewPath(companyFolderId, assessmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification/assessments/${encodeURIComponent(assessmentId)}/review`,
    masterSheetId,
  );
}

function coshhItemsFromListResponse(response) {
  return Array.isArray(response?.json?.items) ? response.json.items : [];
}

function assessmentsFromListResponse(response) {
  return Array.isArray(response?.json?.items) ? response.json.items : [];
}

function coshhDetailRecord(response) {
  return response?.json?.item || {};
}

function assessmentDetailRecord(response) {
  return response?.json?.item || {};
}

function coshhAlreadyVisible(detailResponse, coshhId) {
  return detailResponse?.status === 200 && detailResponse?.json?.ok === true && trim(coshhDetailRecord(detailResponse).id) === trim(coshhId);
}

function assessmentAlreadyVisible(detailResponse, assessmentId) {
  return (
    detailResponse?.status === 200 &&
    detailResponse?.json?.ok === true &&
    trim(assessmentDetailRecord(detailResponse).id) === trim(assessmentId)
  );
}

function isSelfApprovalBlockedResponse(response) {
  if (response?.status !== 403) {
    return false;
  }
  const code = trim(response?.json?.code);
  const message = trim(response?.json?.message || response?.json?.error);
  return (
    code === "COSHH_SELF_APPROVAL_BLOCKED" ||
    /self[- ]?approv/i.test(message) ||
    /own submission/i.test(message)
  );
}

function operationalSummaryFromCoshh(items = []) {
  const operational = items.filter((item) => isOperationalCoshhRegister(item) && normalizeStatus(item.status) !== "archived");
  return {
    overdue: operational.filter((item) => item.status === "overdue").length,
    reviewDue: operational.filter((item) => item.status === "review_due").length,
    missingSds: operational.filter((item) => item.status === "missing_sds").length,
    assessmentRequired: operational.filter((item) => item.status === "assessment_required").length,
  };
}

function overviewMentionsVerificationCoshh(overview = {}, coshhId = "") {
  const target = trim(coshhId).toLowerCase();
  const attention = Array.isArray(overview.attentionItems) ? overview.attentionItems : [];
  return attention.some((item) => {
    const recordId = trim(item.recordId).toLowerCase();
    const id = trim(item.id).toLowerCase();
    return recordId === target || id.includes(target);
  });
}

export function loadCoshhWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowCoshhMutation =
    trim(env.BERT_SMOKE_ALLOW_COSHH_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_COSHH_MUTATION).toLowerCase() === "true";
  const reviewerUsername = trim(env.BERT_SMOKE_COSHH_REVIEWER_USERNAME);
  const reviewerPassword = trim(env.BERT_SMOKE_COSHH_REVIEWER_PASSWORD);
  const reviewerExpectedEmail = trim(env.BERT_SMOKE_COSHH_REVIEWER_EXPECTED_EMAIL).toLowerCase();
  const hasReviewerCredentials = Boolean(reviewerUsername && reviewerPassword);
  return {
    ...base,
    allowCoshhMutation,
    reviewerUsername,
    reviewerPassword,
    reviewerExpectedEmail,
    hasReviewerCredentials,
    selfApprovalMode: !hasReviewerCredentials,
    totalBudgetMs: COSHH_VERIFIER_BUDGET_MS,
  };
}

export function redactSafeResponseBody(value) {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  try {
    return JSON.stringify(value, (key, val) => {
      if (/password|token|cookie|hash|secret/i.test(key)) {
        return "***";
      }
      if (typeof val === "string" && /bert_company_session=|bert_master_session=/i.test(val)) {
        return "***";
      }
      if (typeof val === "string" && val.length > 500) {
        return `${val.slice(0, 500)}…`;
      }
      return val;
    });
  } catch {
    return "(unserializable)";
  }
}

export function formatCoshhWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production COSHH Workflow",
    "==========================================",
    "",
  ];

  for (const key of CHECK_KEYS) {
    const check = result.checks[key] || { status: "FAIL" };
    const status = check.status === "SKIP" ? "SKIP" : check.status || "FAIL";
    lines.push(`${CHECK_LABELS[key].padEnd(REPORT_LABEL_WIDTH)} ${status}`);
  }

  lines.push("");
  if (result.apiVersion) {
    lines.push(`API Version: ${result.apiVersion}`);
  }
  if (result.apiSha) {
    lines.push(`API SHA: ${result.apiSha}`);
  }
  if (result.accountEmail) {
    lines.push(`Account: ${maskEmail(result.accountEmail)}`);
  }
  if (result.approverEmail) {
    lines.push(`Approver: ${maskEmail(result.approverEmail)}`);
  } else if (result.selfApprovalMode && result.checks.authentication?.status === "PASS") {
    lines.push("Approver: self");
  }
  if (result.coshhId) {
    lines.push(`COSHH ID: ${result.coshhId}`);
  }
  if (result.assessmentNumber) {
    lines.push(`Assessment Number: ${result.assessmentNumber}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
  }
  lines.push("");

  if (result.ok) {
    lines.push("RESULT");
    lines.push("READY FOR CUSTOMERS");
  } else {
    lines.push("RESULT");
    lines.push("FAILED");
    lines.push("");
    lines.push("Failed stage:");
    lines.push(result.failedStage || CHECK_LABELS[result.failedKey] || "Unknown");
    lines.push("");
    if (result.httpStatus) {
      lines.push(`HTTP status: ${result.httpStatus}`);
    }
    lines.push("");
    lines.push("Safe response body:");
    lines.push(result.safeResponseBody || "(none)");
    lines.push("");
    lines.push("Likely cause:");
    lines.push(result.failureReason || "Unknown failure");
    if (result.remediation) {
      lines.push("");
      lines.push("Suggested remediation:");
      lines.push(result.remediation);
    }
  }

  return lines.join("\n");
}

export async function attemptVerificationCoshhCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationCoshhId = trim(context.verificationCoshhId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_COSHH_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({ kind: "bulk", ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  if (verificationCoshhId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(verificationCoshhId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_COSHH_STAGE_TIMEOUTS_MS.cleanup },
      );
      const singleOk = single.status === 200 && single.json?.ok === true;
      results.push({
        kind: "single",
        coshhId: verificationCoshhId,
        ok: singleOk,
        status: single.status,
        rejected: single.status === 403,
      });
    } catch (error) {
      results.push({
        kind: "single",
        coshhId: verificationCoshhId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rejectedSingle = results.some((item) => item.kind === "single" && item.rejected);
  return { ok: !rejectedSingle && results.every((item) => item.ok), results };
}

function assertResponseSafe(json, label) {
  assertNoPasswordHash(JSON.stringify(json || {}), label);
}

async function pollCoshhDetail(request, companyFolderId, masterSheetId, coshhId, options = {}) {
  const maxAttempts = options.maxAttempts || 10;
  const intervalMs = options.intervalMs ?? 500;
  let lastResponse;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResponse = await request("GET", coshhDetailPath(companyFolderId, coshhId, masterSheetId), undefined, {
      stageKey: options.stageKey || "readback",
    });
    if (coshhAlreadyVisible(lastResponse, coshhId)) {
      return { ok: true, response: lastResponse, item: coshhDetailRecord(lastResponse) };
    }
    if (intervalMs > 0 && attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  return { ok: false, response: lastResponse };
}

async function pollAssessmentDetail(request, companyFolderId, masterSheetId, assessmentId, options = {}) {
  const maxAttempts = options.maxAttempts || 10;
  const intervalMs = options.intervalMs ?? 500;
  let lastResponse;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResponse = await request("GET", coshhAssessmentDetailPath(companyFolderId, assessmentId, masterSheetId), undefined, {
      stageKey: options.stageKey || "readback",
    });
    if (assessmentAlreadyVisible(lastResponse, assessmentId)) {
      return { ok: true, response: lastResponse, item: assessmentDetailRecord(lastResponse) };
    }
    if (intervalMs > 0 && attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  return { ok: false, response: lastResponse };
}

export async function runProductionCoshhWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  const todayKey = getUkTodayKey();
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || (() => {}),
      prefix: "[coshh-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || COSHH_VERIFIER_BUDGET_MS,
      stageTimeouts: { ...DEFAULT_COSHH_STAGE_TIMEOUTS_MS, ...(options.stageTimeouts || {}) },
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  let request = timedTransport.request.bind(timedTransport);
  let approverRequest = request;

  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationCoshhId: "",
    verificationAssessmentId: "",
  };

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationCoshhCleanup(request, workflowContext));
  }

  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    runId,
    durationMs: 0,
    accountEmail: config.expectedEmail || "",
    selfApprovalMode: config.selfApprovalMode,
  };

  let coshhListCache = [];
  let baselineOperationalSummary = null;
  let baselineHealthMetrics = null;
  let mustRunCleanup = false;
  let deferredFailure = null;

  function pass(key, status = "PASS") {
    result.checks[key] = { status };
  }

  function skip(key, reason) {
    result.checks[key] = { status: "SKIP", reason };
  }

  function fail(failedKey, failureReason, remediation, httpStatus, responseBody, extra = {}) {
    result.failedKey = failedKey;
    result.failedStage = CHECK_LABELS[failedKey] || failedKey;
    result.failureReason = failureReason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    result.checks[failedKey] = { status: "FAIL", failureReason };
    Object.assign(result, extra);
    if (!mustRunCleanup || failedKey === "cleanup") {
      for (const checkKey of CHECK_KEYS) {
        if (result.checks[checkKey].status === "PENDING") {
          result.checks[checkKey] = { status: "SKIP" };
        }
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  function failFromTimeout(stageKey, error, stageDurationMs) {
    diagnostics.failStage(stageKey, "TIMEOUT", stageDurationMs);
    const timeoutMeta = buildTimeoutFailureResult({
      stageKey,
      stageLabel: CHECK_LABELS[stageKey],
      method: error.method,
      safeUrl: error.safeUrl,
      elapsedMs: error.elapsedMs,
      timeoutMs: error.timeoutMs,
      totalElapsedMs: diagnostics.elapsedMs(),
    });
    return fail(
      stageKey,
      `${timeoutMeta.failureReason} (${error.method} ${error.safeUrl}, elapsed ${error.elapsedMs}ms).`,
      timeoutMeta.remediation,
      timeoutMeta.httpStatus,
      {
        timeout: true,
        stage: CHECK_LABELS[stageKey],
        method: error.method,
        safeUrl: error.safeUrl,
        elapsedMs: error.elapsedMs,
        timeoutMs: error.timeoutMs,
      },
    );
  }

  async function runStage(stageKey, fn) {
    currentStageKey = stageKey;
    diagnostics.beginStage(stageKey, CHECK_LABELS[stageKey]);
    const stageStarted = Date.now();
    try {
      const earlyExit = await fn();
      if (earlyExit?.failedKey) {
        diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
        return earlyExit;
      }
      const status = result.checks[stageKey]?.status || "PASS";
      if (status === "SKIP") {
        diagnostics.endStage(stageKey, "SKIP", Date.now() - stageStarted);
      } else if (status === "FAIL") {
        diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      } else {
        pass(stageKey, status === "PENDING" ? "PASS" : status);
        diagnostics.endStage(stageKey, status === "PENDING" ? "PASS" : status, Date.now() - stageStarted);
      }
      return null;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        return failFromTimeout(stageKey, error, Date.now() - stageStarted);
      }
      diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      return fail(stageKey, error instanceof Error ? error.message : String(error), "Inspect server logs for this stage.");
    }
  }

  async function runPostCreateStage(key, fn) {
    const stageResult = await runStage(key, fn);
    if (stageResult) {
      deferredFailure = stageResult;
    }
    return stageResult;
  }

  async function finalizeMutationWorkflow() {
    const cleanupResult = await runStage("cleanup", async () => {
      const cleanup = await attemptVerificationCoshhCleanup(request, workflowContext);
      if (!cleanup.ok) {
        return fail(
          "cleanup",
          "Verification COSHH cleanup did not succeed.",
          "Inspect POST /api/companies/:id/coshh/verification-cleanup and single-record cleanup.",
          500,
          cleanup,
        );
      }
      const listAfter = await request("GET", coshhListPath(workflowContext.companyFolderId, workflowContext.masterSheetId), undefined, {
        stageKey: "cleanup",
      });
      const remaining = listActiveVerificationCoshhRegisters(coshhItemsFromListResponse(listAfter));
      if (remaining.length > 0) {
        return fail(
          "cleanup",
          "Active verification COSHH records remain after cleanup.",
          "Inspect verification COSHH cleanup archive path.",
          listAfter.status,
          { remainingCount: remaining.length },
        );
      }
      pass("cleanup");
      return null;
    });
    if (cleanupResult?.failedKey) {
      return cleanupResult;
    }
    if (deferredFailure) {
      return fail(
        deferredFailure.failedKey,
        deferredFailure.failureReason,
        deferredFailure.remediation,
        deferredFailure.httpStatus,
        deferredFailure.safeResponseBody,
      );
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const companyFolderId = trim(config.companyFolderId);
  const masterSheetId = trim(config.masterSheetId);
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;

  const authFail = await runStage("authentication", async () => {
    const health = await request("GET", "/api/health", undefined, { stageKey: "authentication" });
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    const loginResult = await performProductionSmokeLogin(config, timedTransport);
    if (!loginResult.ok) {
      return fail(
        "authentication",
        loginResult.failureReason || "Production login failed.",
        loginResult.remediation || "Inspect smoke credentials and company session enrichment.",
        loginResult.httpStatus,
        loginResult.responseBody,
      );
    }
    result.accountEmail = loginResult.accountEmail || config.expectedEmail;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const coshhApiFail = await runStage("coshhApi", async () => {
    let listResponse;
    try {
      listResponse = await requestWithTransientRetries(request, "GET", coshhListPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "coshhApi",
        maxRetries: 2,
      }).then((item) => item.response);
    } catch (error) {
      return fail(
        "coshhApi",
        `COSHH API request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/coshh.",
      );
    }
    if (listResponse.status !== 200 || listResponse.json?.ok !== true) {
      return fail(
        "coshhApi",
        `COSHH register list returned HTTP ${listResponse.status}.`,
        "Inspect COSHH list route and company workbook tabs.",
        listResponse.status,
        listResponse.json,
      );
    }
    if (!Array.isArray(listResponse.json?.items)) {
      return fail("coshhApi", "COSHH list response is missing items array.", "Inspect COSHH list response shape.");
    }
    coshhListCache = coshhItemsFromListResponse(listResponse);
    pass("coshhApi");
    return null;
  });
  if (coshhApiFail) {
    return coshhApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    const baseline = countCoshhBaselines(coshhListCache, [], todayKey);
    result.baseline = baseline;
    baselineOperationalSummary = operationalSummaryFromCoshh(coshhListCache);
    try {
      const overviewResponse = await request("GET", healthSafetyOverviewPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "baseline",
      });
      if (overviewResponse.status === 200 && overviewResponse.json?.ok === true) {
        baselineHealthMetrics = overviewResponse.json.metrics || {};
      }
    } catch {
      /* optional */
    }
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  skip("notifications", "COSHH notifications are client/background derived; no safe server notification API.");
  skip("search", "COSHH register search is client-side only.");

  if (!config.allowCoshhMutation) {
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key, "BERT_SMOKE_ALLOW_COSHH_MUTATION is not enabled.");
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const verificationCoshhId = buildProductionVerificationCoshhId(runId);
  const verificationAssessmentId = buildProductionVerificationCoshhAssessmentId(runId);
  const assessmentNumber = buildProductionVerificationCoshhAssessmentNumber(runId);
  const expectedSdsDocumentId = buildProductionVerificationSdsDocumentId(runId);
  const expectedSdsFileName = buildProductionVerificationSdsFileName(runId);
  const reviewDate = defaultVerificationReviewDate(todayKey);
  result.coshhId = verificationCoshhId;
  result.assessmentNumber = assessmentNumber;
  workflowContext.verificationCoshhId = verificationCoshhId;
  workflowContext.verificationAssessmentId = verificationAssessmentId;

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    const cleanupResponse = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/verification-cleanup`,
      { companyFolderId, masterSheetId, keepCoshhId: verificationCoshhId },
      { stageKey: "staleCleanup" },
    );
    if (cleanupResponse.status !== 200 || cleanupResponse.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup returned HTTP ${cleanupResponse.status}.`,
        "Inspect POST /api/companies/:id/coshh/verification-cleanup.",
        cleanupResponse.status,
        cleanupResponse.json,
      );
    }
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) {
    return staleCleanupFail;
  }

  const createProductFail = await runStage("createProduct", async () => {
    const payload = buildProductionVerificationCoshhSubstance({
      runId,
      coshhId: verificationCoshhId,
      companyFolderId,
      todayKey,
      reviewDate,
    });
    let createResponse;
    try {
      createResponse = await requestWithTransientRetries(
        request,
        "POST",
        verificationSubstancePath(companyFolderId, masterSheetId),
        { ...payload, companyFolderId, masterSheetId, verificationSource: PRODUCTION_VERIFICATION_COSHH_SOURCE },
        { stageKey: "createProduct", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
      ).then((item) => item.response);
    } catch (error) {
      if (isStageTimeoutError(error) || isTransientNetworkError(error)) {
        const polled = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
          stageKey: "createProduct",
          maxAttempts: options.listPollMaxAttempts || 10,
          intervalMs: options.listPollIntervalMs ?? 500,
        });
        if (polled.ok) {
          mustRunCleanup = true;
          pass("createProduct");
          return null;
        }
      }
      throw error;
    }
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createProduct",
        `Create verification substance returned HTTP ${createResponse.status}.`,
        "Inspect POST /api/companies/:id/coshh/verification/substance.",
        createResponse.status,
        createResponse.json,
      );
    }
    if (Number(createResponse.json?.updatedRows ?? 0) <= 0 && !createResponse.json?.alreadyExists) {
      return fail(
        "createProduct",
        "Create substance returned zero-row acknowledgement.",
        "Inspect COSHH register append acknowledgement from Sheets.",
        createResponse.status,
        createResponse.json,
      );
    }
    mustRunCleanup = true;
    pass("createProduct");
    return null;
  });
  if (createProductFail) {
    if (mustRunCleanup) {
      const terminal = await finalizeMutationWorkflow();
      return terminal || createProductFail;
    }
    return createProductFail;
  }

  const substanceVisible = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
    stageKey: "createDraft",
    maxAttempts: options.listPollMaxAttempts || 20,
    intervalMs: options.listPollIntervalMs ?? 1000,
  });
  if (!substanceVisible.ok) {
    const terminal = await finalizeMutationWorkflow();
    return (
      terminal ||
      fail(
        "createDraft",
        "Verification substance not visible before assessment create.",
        "Inspect COSHH register read-after-write after substance create.",
        substanceVisible.response?.status,
        substanceVisible.response?.json,
      )
    );
  }

  const createDraftFail = await runPostCreateStage("createDraft", async () => {
    const payload = buildProductionVerificationCoshhAssessment({
      runId,
      coshhId: verificationCoshhId,
      assessmentId: verificationAssessmentId,
      companyFolderId,
      assessorName: result.accountEmail,
      todayKey,
      reviewDate,
    });
    let createResponse;
    try {
      createResponse = await requestWithTransientRetries(
        request,
        "POST",
        verificationAssessmentPath(companyFolderId, masterSheetId),
        { ...payload, companyFolderId, masterSheetId, verificationSource: PRODUCTION_VERIFICATION_COSHH_SOURCE },
        { stageKey: "createDraft", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
      ).then((item) => item.response);
    } catch (error) {
      if (isStageTimeoutError(error) || isTransientNetworkError(error)) {
        const polled = await pollAssessmentDetail(request, companyFolderId, masterSheetId, verificationAssessmentId, {
          stageKey: "createDraft",
          maxAttempts: options.listPollMaxAttempts || 10,
          intervalMs: options.listPollIntervalMs ?? 500,
        });
        if (polled.ok) {
          pass("createDraft");
          return null;
        }
      }
      throw error;
    }
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createDraft",
        `Create verification assessment returned HTTP ${createResponse.status}.`,
        "Inspect POST /api/companies/:id/coshh/verification/assessments.",
        createResponse.status,
        createResponse.json,
      );
    }
    if (Number(createResponse.json?.updatedRows ?? 0) <= 0 && !createResponse.json?.alreadyExists) {
      return fail(
        "createDraft",
        "Create assessment returned zero-row acknowledgement.",
        "Inspect COSHH assessment append acknowledgement from Sheets.",
        createResponse.status,
        createResponse.json,
      );
    }
    pass("createDraft");
    return null;
  });
  if (createDraftFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || createDraftFail;
  }

  const readbackFail = await runPostCreateStage("readback", async () => {
    const detail = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
      stageKey: "readback",
      maxAttempts: options.listPollMaxAttempts || 15,
      intervalMs: options.listPollIntervalMs ?? 500,
    });
    if (!detail.ok) {
      return fail(
        "readback",
        "Verification COSHH record was not visible on detail readback.",
        "Inspect COSHH detail after create and Sheets visibility delay.",
        detail.response?.status,
        detail.response?.json,
      );
    }
    const item = detail.item;
    if (trim(item.productCode) !== assessmentNumber) {
      return fail("readback", "Assessment number mismatch on register readback.", "Inspect verification substance payload.", 200, item);
    }
    if (!isVerificationCoshhRegister(item)) {
      return fail("readback", "Verification marker missing on register readback.", "Inspect description verification marker.", 200, item);
    }
    const assessmentsResponse = await request("GET", coshhAssessmentsPath(companyFolderId, verificationCoshhId, masterSheetId), undefined, {
      stageKey: "readback",
    });
    if (assessmentsResponse.status !== 200 || assessmentsResponse.json?.ok !== true) {
      return fail(
        "readback",
        `COSHH assessments list returned HTTP ${assessmentsResponse.status}.`,
        "Inspect GET /api/companies/:id/coshh/:coshhId/assessments.",
        assessmentsResponse.status,
        assessmentsResponse.json,
      );
    }
    const assessments = assessmentsFromListResponse(assessmentsResponse).filter((entry) => trim(entry.id) === verificationAssessmentId);
    if (assessments.length !== 1) {
      return fail(
        "readback",
        "Expected exactly one verification assessment on assessments readback.",
        "Inspect assessment list after create.",
        assessmentsResponse.status,
        { count: assessments.length },
      );
    }
    if (!isVerificationCoshhAssessment(assessments[0])) {
      return fail("readback", "Verification assessment marker missing on readback.", "Inspect assessment additionalActions marker.", 200, assessments[0]);
    }
    pass("readback");
    return null;
  });
  if (readbackFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || readbackFail;
  }

  const editFail = await runPostCreateStage("editAssessment", async () => {
    const editResponse = await request(
      "PATCH",
      verificationSubstancePatchPath(companyFolderId, verificationCoshhId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        primaryUse: "General surface cleaning (edited)",
        storageLocation: "Rugby (edited)",
      },
      { stageKey: "editAssessment" },
    );
    if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
      return fail(
        "editAssessment",
        `Edit substance returned HTTP ${editResponse.status}.`,
        "Inspect PATCH /api/companies/:id/coshh/verification/substance/:coshhId.",
        editResponse.status,
        editResponse.json,
      );
    }
    const polled = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
      stageKey: "editAssessment",
      maxAttempts: options.listPollMaxAttempts || 10,
      intervalMs: options.listPollIntervalMs ?? 500,
    });
    if (!polled.ok || !String(polled.item?.primaryUse || "").includes("(edited)")) {
      return fail("editAssessment", "Edited substance fields did not persist on readback.", "Inspect substance patch path.", 200, polled.item);
    }
    pass("editAssessment");
    return null;
  });
  if (editFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || editFail;
  }

  const hazardFail = await runPostCreateStage("hazardClassification", async () => {
    const patchResponse = await request(
      "PATCH",
      verificationSubstancePatchPath(companyFolderId, verificationCoshhId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        signalWord: "Warning",
        hazardStatements: `${PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION} (verified)`,
        precautionaryStatements: "Wear protective gloves and eye protection (verified).",
      },
      { stageKey: "hazardClassification" },
    );
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) {
      return fail(
        "hazardClassification",
        `Hazard classification patch returned HTTP ${patchResponse.status}.`,
        "Inspect PATCH /api/companies/:id/coshh/verification/substance/:coshhId.",
        patchResponse.status,
        patchResponse.json,
      );
    }
    const polled = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
      stageKey: "hazardClassification",
    });
    if (!polled.ok || !String(polled.item?.hazardStatements || "").includes("(verified)")) {
      return fail(
        "hazardClassification",
        "Hazard classification fields did not persist on readback.",
        "Inspect hazard classification patch path.",
        200,
        polled.item,
      );
    }
    pass("hazardClassification");
    return null;
  });
  if (hazardFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || hazardFail;
  }

  const ppeFail = await runPostCreateStage("ppeAndControls", async () => {
    const patchResponse = await request(
      "PATCH",
      verificationAssessmentPatchPath(companyFolderId, verificationAssessmentId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        existingControls: "Use in ventilated area (verified)",
        engineeringControls: "Local ventilation where required (verified)",
        ppeRequired: `${PRODUCTION_VERIFICATION_COSHH_PPE} (verified)`,
        storageControls: "Keep sealed in a cool, dry place (verified)",
      },
      { stageKey: "ppeAndControls" },
    );
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) {
      return fail(
        "ppeAndControls",
        `PPE and controls patch returned HTTP ${patchResponse.status}.`,
        "Inspect PATCH /api/companies/:id/coshh/verification/assessments/:assessmentId.",
        patchResponse.status,
        patchResponse.json,
      );
    }
    const polled = await pollAssessmentDetail(request, companyFolderId, masterSheetId, verificationAssessmentId, {
      stageKey: "ppeAndControls",
    });
    if (!polled.ok || !String(polled.item?.ppeRequired || "").includes("(verified)")) {
      return fail(
        "ppeAndControls",
        "PPE and controls fields did not persist on readback.",
        "Inspect assessment patch path.",
        200,
        polled.item,
      );
    }
    pass("ppeAndControls");
    return null;
  });
  if (ppeFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || ppeFail;
  }

  const sdsFail = await runPostCreateStage("sds", async () => {
    const polled = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
      stageKey: "sds",
    });
    if (!polled.ok) {
      return fail("sds", "Could not load COSHH register record for SDS verification.", "Inspect COSHH detail route.");
    }
    const item = polled.item;
    if (trim(item.sdsDocumentId) !== expectedSdsDocumentId) {
      return fail(
        "sds",
        "SDS document ID metadata mismatch on register.",
        "Inspect verification substance SDS metadata fields.",
        200,
        { expected: expectedSdsDocumentId, actual: item.sdsDocumentId },
      );
    }
    if (trim(item.sdsFileName) !== expectedSdsFileName) {
      return fail(
        "sds",
        "SDS file name metadata mismatch on register.",
        "Inspect verification substance SDS metadata fields.",
        200,
        { expected: expectedSdsFileName, actual: item.sdsFileName },
      );
    }
    if (!trim(item.sdsIssueDate) || !trim(item.sdsVersion)) {
      return fail(
        "sds",
        "SDS issue date or version metadata missing on register.",
        "Inspect verification substance SDS metadata fields.",
        200,
        item,
      );
    }
    pass("sds");
    return null;
  });
  if (sdsFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || sdsFail;
  }

  const saveDraftFail = await runPostCreateStage("saveDraft", async () => {
    const patchResponse = await request(
      "PATCH",
      verificationAssessmentPatchPath(companyFolderId, verificationAssessmentId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        activity: "General surface cleaning (draft saved)",
        status: "draft",
      },
      { stageKey: "saveDraft" },
    );
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) {
      return fail(
        "saveDraft",
        `Save draft returned HTTP ${patchResponse.status}.`,
        "Inspect PATCH /api/companies/:id/coshh/verification/assessments/:assessmentId.",
        patchResponse.status,
        patchResponse.json,
      );
    }
    const polled = await pollAssessmentDetail(request, companyFolderId, masterSheetId, verificationAssessmentId, {
      stageKey: "saveDraft",
    });
    if (!polled.ok || normalizeStatus(polled.item?.status) !== "draft") {
      return fail("saveDraft", "Assessment did not remain in draft status after save.", "Inspect assessment draft persistence.", 200, polled.item);
    }
    if (!String(polled.item?.activity || "").includes("(draft saved)")) {
      return fail("saveDraft", "Draft activity field did not persist on readback.", "Inspect assessment patch path.", 200, polled.item);
    }
    pass("saveDraft");
    return null;
  });
  if (saveDraftFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || saveDraftFail;
  }

  const submitFail = await runPostCreateStage("submit", async () => {
    const submitResponse = await requestWithTransientRetries(
      request,
      "POST",
      verificationAssessmentSubmitPath(companyFolderId, verificationAssessmentId, masterSheetId),
      { companyFolderId, masterSheetId },
      { stageKey: "submit", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
    ).then((item) => item.response);
    if (submitResponse.status !== 200 || submitResponse.json?.ok !== true) {
      return fail(
        "submit",
        `Submit assessment returned HTTP ${submitResponse.status}.`,
        "Inspect POST /api/companies/:id/coshh/verification/assessments/:id/submit.",
        submitResponse.status,
        submitResponse.json,
      );
    }
    const polled = await pollAssessmentDetail(request, companyFolderId, masterSheetId, verificationAssessmentId, {
      stageKey: "submit",
    });
    if (!polled.ok || !assessmentSubmittedMarker(polled.item?.additionalActions)) {
      return fail(
        "submit",
        "Submitted marker missing on assessment readback.",
        "Inspect submit additionalActions marker persistence.",
        submitResponse.status,
        polled.item,
      );
    }
    pass("submit");
    return null;
  });
  if (submitFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || submitFail;
  }

  const approverLoginFail = await runPostCreateStage("approverLogin", async () => {
    if (config.hasReviewerCredentials) {
      const reviewerConfig = {
        ...config,
        username: config.reviewerUsername,
        password: config.reviewerPassword,
        expectedEmail: config.reviewerExpectedEmail || config.expectedEmail,
      };
      const reviewerLoginResult = await performProductionSmokeLogin(reviewerConfig, timedTransport, {
        ...options,
        skipHealthCheck: true,
      });
      if (!reviewerLoginResult.ok) {
        return fail(
          "approverLogin",
          reviewerLoginResult.failureReason || "Reviewer login failed.",
          "Inspect BERT_SMOKE_COSHH_REVIEWER_* credentials and company permissions.",
          reviewerLoginResult.httpStatus,
          reviewerLoginResult.responseBody,
        );
      }
      result.approverEmail = reviewerLoginResult.accountEmail || config.reviewerExpectedEmail;
      approverRequest = timedTransport.request.bind(timedTransport);
      pass("approverLogin");
      return null;
    }
    skip("approverLogin", "Self-approval mode (Admin approver).");
    return null;
  });
  if (approverLoginFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || approverLoginFail;
  }

  const approveFail = await runPostCreateStage("approveActivate", async () => {
    const approveResponse = await requestWithTransientRetries(
      approverRequest,
      "POST",
      verificationAssessmentApprovePath(companyFolderId, verificationAssessmentId, masterSheetId),
      { companyFolderId, masterSheetId },
      { stageKey: "approveActivate", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
    ).then((item) => item.response);
    if (isSelfApprovalBlockedResponse(approveResponse)) {
      if (!config.hasReviewerCredentials) {
        return fail(
          "approverLogin",
          "Reviewer credentials are required because self-approval is blocked.",
          "Set BERT_SMOKE_COSHH_REVIEWER_USERNAME and BERT_SMOKE_COSHH_REVIEWER_PASSWORD for a separate approver account.",
          approveResponse.status,
          approveResponse.json,
        );
      }
      return fail(
        "approveActivate",
        "Self-approval is blocked for the current approver session.",
        "Inspect reviewer account approval permissions.",
        approveResponse.status,
        approveResponse.json,
      );
    }
    if (approveResponse.status !== 200 || approveResponse.json?.ok !== true) {
      return fail(
        "approveActivate",
        `Approve assessment returned HTTP ${approveResponse.status}.`,
        "Inspect POST /api/companies/:id/coshh/verification/assessments/:id/approve.",
        approveResponse.status,
        approveResponse.json,
      );
    }
    const polled = await pollAssessmentDetail(approverRequest, companyFolderId, masterSheetId, verificationAssessmentId, {
      stageKey: "approveActivate",
    });
    if (!polled.ok || normalizeStatus(polled.item?.status) !== "active") {
      return fail(
        "approveActivate",
        "Assessment was not active after approval.",
        "Inspect approval status transition.",
        approveResponse.status,
        polled.item,
      );
    }
    if (!trim(polled.item?.approvedAt)) {
      return fail("approveActivate", "Approval metadata missing after approve.", "Inspect assessment approval fields.", 200, polled.item);
    }
    if (!result.approverEmail && config.selfApprovalMode) {
      result.approverEmail = result.accountEmail;
    }
    pass("approveActivate");
    return null;
  });
  if (approveFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || approveFail;
  }

  const detailFail = await runPostCreateStage("detailVerification", async () => {
    const substanceDetail = await request("GET", coshhDetailPath(companyFolderId, verificationCoshhId, masterSheetId), undefined, {
      stageKey: "detailVerification",
    });
    assertResponseSafe(substanceDetail.json, "detail verification substance");
    if (!coshhAlreadyVisible(substanceDetail, verificationCoshhId)) {
      return fail(
        "detailVerification",
        "Verification COSHH record detail was not available after approval.",
        "Inspect GET /api/companies/:id/coshh/:coshhId after approval.",
        substanceDetail.status,
        substanceDetail.json,
      );
    }
    const substance = coshhDetailRecord(substanceDetail);
    if (trim(substance.productName) !== PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME) {
      return fail("detailVerification", "Product name mismatch on approved detail.", "Inspect substance persistence.", 200, substance);
    }
    if (!substance.approvedForUse) {
      return fail("detailVerification", "Register approvedForUse flag missing after approval.", "Inspect register approval sync.", 200, substance);
    }
    const assessmentDetail = await request(
      "GET",
      coshhAssessmentDetailPath(companyFolderId, verificationAssessmentId, masterSheetId),
      undefined,
      { stageKey: "detailVerification" },
    );
    assertResponseSafe(assessmentDetail.json, "detail verification assessment");
    if (!assessmentAlreadyVisible(assessmentDetail, verificationAssessmentId)) {
      return fail(
        "detailVerification",
        "Verification assessment detail was not available after approval.",
        "Inspect GET /api/companies/:id/coshh-assessments/:assessmentId.",
        assessmentDetail.status,
        assessmentDetail.json,
      );
    }
    const assessment = assessmentDetailRecord(assessmentDetail);
    if (!String(assessment.assessmentTitle || "").includes(assessmentNumber)) {
      return fail("detailVerification", "Assessment title mismatch on approved detail.", "Inspect assessment title persistence.", 200, assessment);
    }
    if (!isVerificationCoshhAssessment(assessment)) {
      return fail("detailVerification", "Verification marker missing on approved assessment detail.", "Inspect assessment markers.", 200, assessment);
    }
    pass("detailVerification");
    return null;
  });
  if (detailFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || detailFail;
  }

  const reviewFail = await runPostCreateStage("review", async () => {
    const reviewResponse = await request(
      "POST",
      verificationAssessmentReviewPath(companyFolderId, verificationAssessmentId, masterSheetId),
      { companyFolderId, masterSheetId, reviewDate },
      { stageKey: "review" },
    );
    if (reviewResponse.status !== 200 || reviewResponse.json?.ok !== true) {
      return fail(
        "review",
        `Review assessment returned HTTP ${reviewResponse.status}.`,
        "Inspect POST /api/companies/:id/coshh/verification/assessments/:id/review.",
        reviewResponse.status,
        reviewResponse.json,
      );
    }
    const polled = await pollAssessmentDetail(request, companyFolderId, masterSheetId, verificationAssessmentId, {
      stageKey: "review",
    });
    if (!polled.ok || !assessmentReviewedMarker(polled.item?.additionalActions)) {
      return fail(
        "review",
        "Reviewed marker missing on assessment readback.",
        "Inspect review additionalActions marker persistence.",
        reviewResponse.status,
        polled.item,
      );
    }
    if (trim(polled.item?.reviewDate) !== trim(reviewDate)) {
      return fail(
        "review",
        "Review date did not persist on assessment readback.",
        "Inspect review date propagation.",
        200,
        polled.item,
      );
    }
    const substance = await pollCoshhDetail(request, companyFolderId, masterSheetId, verificationCoshhId, {
      stageKey: "review",
    });
    if (!substance.ok || trim(substance.item?.reviewDate) !== trim(reviewDate)) {
      return fail(
        "review",
        "Review date did not propagate to register readback.",
        "Inspect register review date sync.",
        200,
        substance.item,
      );
    }
    if (!String(polled.item?.additionalActions || "").includes(PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY)) {
      return fail("review", "Review summary marker missing on assessment.", "Inspect review marker content.", 200, polled.item);
    }
    pass("review");
    return null;
  });
  if (reviewFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || reviewFail;
  }

  await runPostCreateStage("healthSafetyOverview", async () => {
    const overview = await request("GET", healthSafetyOverviewPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "healthSafetyOverview",
    });
    if (overview.status !== 200 || overview.json?.ok !== true) {
      return fail(
        "healthSafetyOverview",
        `Health & Safety overview returned HTTP ${overview.status}.`,
        "Inspect GET /api/companies/:id/health-safety/overview.",
        overview.status,
        overview.json,
      );
    }
    if (overviewMentionsVerificationCoshh(overview.json, verificationCoshhId)) {
      return fail(
        "healthSafetyOverview",
        "Verification COSHH record appears in operational H&S overview attention items.",
        "Ensure isOperationalCoshhRegister excludes verification rows.",
        overview.status,
        overview.json,
      );
    }
    if (baselineHealthMetrics) {
      const metrics = overview.json.metrics || {};
      const keys = ["coshhReviewsOverdue", "coshhReviewsDueSoon", "chemicalsMissingSds", "coshhAssessmentsDue"];
      for (const key of keys) {
        if (Number(metrics[key]) > Number(baselineHealthMetrics[key] || 0) + 1) {
          return fail(
            "healthSafetyOverview",
            `Operational H&S COSHH metric ${key} increased beyond baseline tolerance.`,
            "Filter verification COSHH records from health-safety overview metrics.",
            overview.status,
            { key, baseline: baselineHealthMetrics[key], current: metrics[key] },
          );
        }
      }
    }
    pass("healthSafetyOverview");
    return null;
  });

  await runPostCreateStage("dashboard", async () => {
    const listResponse = await request("GET", coshhListPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "dashboard",
    });
    if (listResponse.status !== 200 || listResponse.json?.ok !== true) {
      return fail(
        "dashboard",
        `COSHH register list returned HTTP ${listResponse.status}.`,
        "Inspect GET /api/companies/:id/coshh summary.",
        listResponse.status,
        listResponse.json,
      );
    }
    const items = coshhItemsFromListResponse(listResponse);
    const operationalSummary = operationalSummaryFromCoshh(items);
    if (baselineOperationalSummary) {
      for (const key of ["overdue", "reviewDue", "missingSds", "assessmentRequired"]) {
        if (Number(operationalSummary[key]) > Number(baselineOperationalSummary[key] || 0) + 1) {
          return fail(
            "dashboard",
            `Operational COSHH summary ${key} count increased beyond baseline tolerance.`,
            "Ensure verification COSHH records are excluded from operational summary counts.",
            listResponse.status,
            { key, baseline: baselineOperationalSummary[key], current: operationalSummary[key] },
          );
        }
      }
    }
    const verificationItem = findCoshhById(items, verificationCoshhId);
    if (verificationItem && !isVerificationCoshhRegister(verificationItem)) {
      return fail("dashboard", "Verification COSHH record missing marker in register.", "Inspect verification COSHH markers.");
    }
    pass("dashboard");
    return null;
  });

  const terminal = await finalizeMutationWorkflow();
  return terminal || result;
}
