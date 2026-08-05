/**
 * Production Risk Register workflow checks — shared by live verifier and unit tests.
 */
import { calculateRiskScore, getRiskBand } from "../../shared/risk-assessments.mjs";
import {
  buildProductionVerificationExistingControl,
  buildProductionVerificationFurtherControl,
  buildProductionVerificationRiskRegister,
  buildProductionVerificationRiskRegisterControlId,
  buildProductionVerificationRiskRegisterId,
  buildProductionVerificationRiskRegisterReference,
  countRiskRegisterBaselines,
  defaultVerificationRiskReviewDate,
  findRiskRegisterById,
  isOperationalRiskRegisterItem,
  isVerificationRiskRegisterItem,
  listActiveVerificationRiskRegisterItems,
  PRODUCTION_VERIFICATION_RISK_REGISTER_CAUSE,
  PRODUCTION_VERIFICATION_RISK_REGISTER_CONSEQUENCE,
  PRODUCTION_VERIFICATION_RISK_REGISTER_EXISTING_CONTROL,
  PRODUCTION_VERIFICATION_RISK_REGISTER_FURTHER_CONTROL,
  PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_IMPACT,
  PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_LIKELIHOOD,
  PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_IMPACT,
  PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_LIKELIHOOD,
  PRODUCTION_VERIFICATION_RISK_REGISTER_REVIEW_SUMMARY,
  PRODUCTION_VERIFICATION_RISK_REGISTER_SOURCE,
  PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE,
  riskApprovedMarker,
  riskReviewedMarker,
  riskSubmittedMarker,
} from "../../shared/production-verification-risk-register.mjs";
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

export const RISK_REGISTER_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_RISK_REGISTER_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  riskRegisterApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createDraft: 120_000,
  readback: 60_000,
  editRisk: 120_000,
  causesConsequences: 120_000,
  existingControls: 120_000,
  initialRisk: 60_000,
  furtherControls: 120_000,
  residualRisk: 60_000,
  saveDraft: 120_000,
  submit: 120_000,
  approverLogin: 90_000,
  approveActivate: 120_000,
  detailVerification: 60_000,
  review: 120_000,
  dashboardOverview: 60_000,
  notifications: 5_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "riskRegisterApi",
  "baseline",
  "staleCleanup",
  "createDraft",
  "readback",
  "editRisk",
  "causesConsequences",
  "existingControls",
  "initialRisk",
  "furtherControls",
  "residualRisk",
  "saveDraft",
  "submit",
  "approverLogin",
  "approveActivate",
  "detailVerification",
  "review",
  "dashboardOverview",
  "notifications",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  riskRegisterApi: "Risk Register API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createDraft: "Create Draft",
  readback: "Readback",
  editRisk: "Edit Risk",
  causesConsequences: "Causes / Consequences",
  existingControls: "Existing Controls",
  initialRisk: "Initial Risk",
  furtherControls: "Further Controls",
  residualRisk: "Residual Risk",
  saveDraft: "Save Draft",
  submit: "Submit",
  approverLogin: "Approver Login",
  approveActivate: "Approve / Activate",
  detailVerification: "Detail Verification",
  review: "Review",
  dashboardOverview: "Dashboard / Overview",
  notifications: "Notifications",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set(CHECK_KEYS.filter((key) => !["authentication", "riskRegisterApi", "baseline", "notifications", "search"].includes(key)));
const REPORT_LABEL_WIDTH = 24;

function trim(value) { return String(value ?? "").trim(); }
function normalizeStatus(value) { return trim(value).toLowerCase(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function withMasterSheet(pathname, masterSheetId) {
  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function riskListPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risks`, masterSheetId);
}

function riskRegisterAliasPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register`, masterSheetId);
}

function riskDetailPath(companyFolderId, riskId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risks/${encodeURIComponent(riskId)}`, masterSheetId);
}

function healthSafetyOverviewPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/health-safety/overview`, masterSheetId);
}

function verificationCreatePath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification`, masterSheetId);
}

function verificationPatchPath(companyFolderId, riskId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification/${encodeURIComponent(riskId)}`, masterSheetId);
}

function verificationControlPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification/controls`, masterSheetId);
}

function verificationSubmitPath(companyFolderId, riskId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification/${encodeURIComponent(riskId)}/submit`, masterSheetId);
}

function verificationApprovePath(companyFolderId, riskId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification/${encodeURIComponent(riskId)}/approve`, masterSheetId);
}

function verificationReviewPath(companyFolderId, riskId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification/${encodeURIComponent(riskId)}/review`, masterSheetId);
}

function riskItemsFromListResponse(response) {
  return Array.isArray(response?.json?.items) ? response.json.items : [];
}

function riskDetailRecord(response) {
  return response?.json?.item || {};
}

function riskControlsFromDetail(response) {
  return Array.isArray(response?.json?.controls) ? response.json.controls : [];
}

function riskAlreadyVisible(detailResponse, riskId) {
  return detailResponse?.status === 200 && detailResponse?.json?.ok === true && trim(riskDetailRecord(detailResponse).id) === trim(riskId);
}

function operationalSummaryFromRisks(items = []) {
  const operational = items.filter((item) => isOperationalRiskRegisterItem(item) && normalizeStatus(item.status) !== "archived");
  return {
    highCritical: operational.filter((item) => Number(item.residualRiskScore) >= 10).length,
    reviewDue: operational.filter((item) => item.status === "Review Due").length,
    overdue: operational.filter((item) => item.status === "Overdue").length,
    draft: operational.filter((item) => item.status === "Draft").length,
    active: operational.filter((item) => ["Active", "Open"].includes(item.status)).length,
  };
}

function overviewMentionsVerificationRisk(overview = {}, riskId = "") {
  const target = trim(riskId).toLowerCase();
  const attention = Array.isArray(overview.attentionItems) ? overview.attentionItems : [];
  return attention.some((item) => {
    const recordId = trim(item.recordId).toLowerCase();
    const id = trim(item.id).toLowerCase();
    return recordId === target || id.includes(target);
  });
}

export function loadRiskRegisterWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowRiskRegisterMutation =
    trim(env.BERT_SMOKE_ALLOW_RISK_REGISTER_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_RISK_REGISTER_MUTATION).toLowerCase() === "true";
  const reviewerUsername = trim(env.BERT_SMOKE_RISK_REGISTER_REVIEWER_USERNAME);
  const reviewerPassword = trim(env.BERT_SMOKE_RISK_REGISTER_REVIEWER_PASSWORD);
  const reviewerExpectedEmail = trim(env.BERT_SMOKE_RISK_REGISTER_REVIEWER_EXPECTED_EMAIL).toLowerCase();
  const hasReviewerCredentials = Boolean(reviewerUsername && reviewerPassword);
  return {
    ...base,
    allowRiskRegisterMutation,
    reviewerUsername,
    reviewerPassword,
    reviewerExpectedEmail,
    hasReviewerCredentials,
    selfApprovalMode: !hasReviewerCredentials,
    totalBudgetMs: RISK_REGISTER_VERIFIER_BUDGET_MS,
  };
}

export function redactSafeResponseBody(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  try {
    return JSON.stringify(value, (key, val) => {
      if (/password|token|cookie|hash|secret/i.test(key)) return "***";
      if (typeof val === "string" && /bert_company_session=|bert_master_session=/i.test(val)) return "***";
      if (typeof val === "string" && val.length > 500) return `${val.slice(0, 500)}…`;
      return val;
    });
  } catch {
    return "(unserializable)";
  }
}

export function formatRiskRegisterWorkflowReport(result) {
  const lines = ["==========================================", "BERT Production Risk Register Workflow", "==========================================", ""];
  for (const key of CHECK_KEYS) {
    const check = result.checks[key] || { status: "FAIL" };
    const status = check.status === "SKIP" ? "SKIP" : check.status || "FAIL";
    lines.push(`${CHECK_LABELS[key].padEnd(REPORT_LABEL_WIDTH)} ${status}`);
  }
  lines.push("");
  if (result.apiVersion) lines.push(`API Version: ${result.apiVersion}`);
  if (result.apiSha) lines.push(`API SHA: ${result.apiSha}`);
  if (result.accountEmail) lines.push(`Account: ${maskEmail(result.accountEmail)}`);
  if (result.approverEmail) lines.push(`Approver: ${maskEmail(result.approverEmail)}`);
  else if (result.selfApprovalMode && result.checks.authentication?.status === "PASS") lines.push("Approver: self");
  if (result.riskId) lines.push(`Risk ID: ${result.riskId}`);
  if (result.riskReference) lines.push(`Risk Reference: ${result.riskReference}`);
  if (result.durationMs) lines.push(`Duration: ${result.durationMs}ms`);
  lines.push("");
  if (result.ok) {
    lines.push("RESULT", "READY FOR CUSTOMERS");
  } else {
    lines.push("RESULT", "FAILED", "", "Failed stage:", result.failedStage || CHECK_LABELS[result.failedKey] || "Unknown", "");
    if (result.httpStatus) lines.push(`HTTP status: ${result.httpStatus}`);
    lines.push("", "Safe response body:", result.safeResponseBody || "(none)", "", "Likely cause:", result.failureReason || "Unknown failure");
    if (result.remediation) lines.push("", "Suggested remediation:", result.remediation);
  }
  return lines.join("\n");
}

export async function attemptVerificationRiskRegisterCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationRiskId = trim(context.verificationRiskId);
  if (!companyFolderId) return { ok: false, reason: "missing_company_folder_id", results: [] };
  const results = [];
  try {
    const bulk = await request("POST", `/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification-cleanup`, { companyFolderId, masterSheetId }, { stageKey: "cleanup", timeoutMs: DEFAULT_RISK_REGISTER_STAGE_TIMEOUTS_MS.cleanup });
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({ kind: "bulk", ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  if (verificationRiskId) {
    try {
      const single = await request("POST", `/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/${encodeURIComponent(verificationRiskId)}/verification-cleanup`, { companyFolderId, masterSheetId }, { stageKey: "cleanup", timeoutMs: DEFAULT_RISK_REGISTER_STAGE_TIMEOUTS_MS.cleanup });
      results.push({ kind: "single", riskId: verificationRiskId, ok: single.status === 200 && single.json?.ok === true, status: single.status });
    } catch (error) {
      results.push({ kind: "single", riskId: verificationRiskId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: results.every((item) => item.ok), results };
}

async function pollRiskDetail(request, companyFolderId, masterSheetId, riskId, options = {}) {
  const maxAttempts = options.maxAttempts || 10;
  const intervalMs = options.intervalMs ?? 500;
  let lastResponse;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResponse = await request("GET", riskDetailPath(companyFolderId, riskId, masterSheetId), undefined, { stageKey: options.stageKey || "readback" });
    if (riskAlreadyVisible(lastResponse, riskId)) return { ok: true, response: lastResponse, item: riskDetailRecord(lastResponse), controls: riskControlsFromDetail(lastResponse) };
    if (intervalMs > 0 && attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  return { ok: false, response: lastResponse };
}

export function residualRiskScoresConfirmed(
  item = {},
  expectedResidualLikelihood = PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_LIKELIHOOD,
  expectedResidualImpact = PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_IMPACT,
) {
  const expectedResidual = calculateRiskScore(expectedResidualLikelihood, expectedResidualImpact);
  const expectedBand = getRiskBand(expectedResidual).label;
  const initialScore = Number(item.initialRiskScore);
  const residualScore = Number(item.residualRiskScore);
  if (Number(item.residualLikelihood) !== expectedResidualLikelihood) return false;
  if (Number(item.residualImpact) !== expectedResidualImpact) return false;
  if (residualScore !== expectedResidual) return false;
  if (trim(item.residualRiskBand) !== expectedBand) return false;
  if (!Number.isFinite(initialScore) || !Number.isFinite(residualScore)) return false;
  return residualScore < initialScore;
}

function assertResponseSafe(json, label) { assertNoPasswordHash(JSON.stringify(json || {}), label); }

export async function runProductionRiskRegisterWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  const todayKey = getUkTodayKey();
  let currentStageKey = "authentication";
  const diagnostics = options.diagnostics || createWorkflowDiagnostics({ log: options.logStage || (() => {}), prefix: "[risk-register-workflow]", stageLabels: CHECK_LABELS, startedAt, totalBudgetMs: Number(config.totalBudgetMs) || RISK_REGISTER_VERIFIER_BUDGET_MS, stageTimeouts: { ...DEFAULT_RISK_REGISTER_STAGE_TIMEOUTS_MS, ...(options.stageTimeouts || {}) } });
  const timedTransport = wrapTransportWithTimeouts(transport, { apiBase: config.apiBase, getStageKey: () => currentStageKey, getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey) });
  let request = timedTransport.request.bind(timedTransport);
  let approverRequest = request;
  const workflowContext = { companyFolderId: "", masterSheetId: "", verificationRiskId: "" };
  if (typeof options.registerInterruptCleanup === "function") options.registerInterruptCleanup(async () => attemptVerificationRiskRegisterCleanup(request, workflowContext));
  const result = { ok: false, checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])), runId, durationMs: 0, accountEmail: config.expectedEmail || "", selfApprovalMode: config.selfApprovalMode };
  let riskListCache = [];
  let baselineOperationalSummary = null;
  let baselineHealthMetrics = null;
  let mustRunCleanup = false;
  let deferredFailure = null;
  const pass = (key, status = "PASS") => { result.checks[key] = { status }; };
  const skip = (key, reason) => { result.checks[key] = { status: "SKIP", reason }; };
  const fail = (failedKey, failureReason, remediation, httpStatus, responseBody, extra = {}) => {
    result.failedKey = failedKey;
    result.failedStage = CHECK_LABELS[failedKey] || failedKey;
    result.failureReason = failureReason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    result.checks[failedKey] = { status: "FAIL", failureReason };
    Object.assign(result, extra);
    if (!mustRunCleanup || failedKey === "cleanup") for (const checkKey of CHECK_KEYS) if (result.checks[checkKey].status === "PENDING") result.checks[checkKey] = { status: "SKIP" };
    result.durationMs = Date.now() - startedAt;
    return result;
  };
  const failFromTimeout = (stageKey, error, stageDurationMs) => {
    diagnostics.failStage(stageKey, "TIMEOUT", stageDurationMs);
    const timeoutMeta = buildTimeoutFailureResult({ stageKey, stageLabel: CHECK_LABELS[stageKey], method: error.method, safeUrl: error.safeUrl, elapsedMs: error.elapsedMs, timeoutMs: error.timeoutMs, totalElapsedMs: diagnostics.elapsedMs() });
    return fail(stageKey, `${timeoutMeta.failureReason} (${error.method} ${error.safeUrl}, elapsed ${error.elapsedMs}ms).`, timeoutMeta.remediation, timeoutMeta.httpStatus, { timeout: true, stage: CHECK_LABELS[stageKey], method: error.method, safeUrl: error.safeUrl, elapsedMs: error.elapsedMs, timeoutMs: error.timeoutMs });
  };
  async function runStage(stageKey, fn) {
    currentStageKey = stageKey;
    diagnostics.beginStage(stageKey, CHECK_LABELS[stageKey]);
    const stageStarted = Date.now();
    try {
      const earlyExit = await fn();
      if (earlyExit?.failedKey) { diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted); return earlyExit; }
      const status = result.checks[stageKey]?.status || "PASS";
      if (status === "SKIP") diagnostics.endStage(stageKey, "SKIP", Date.now() - stageStarted);
      else if (status === "FAIL") diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      else { pass(stageKey, status === "PENDING" ? "PASS" : status); diagnostics.endStage(stageKey, status === "PENDING" ? "PASS" : status, Date.now() - stageStarted); }
      return null;
    } catch (error) {
      if (isStageTimeoutError(error)) return failFromTimeout(stageKey, error, Date.now() - stageStarted);
      diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      return fail(stageKey, error instanceof Error ? error.message : String(error), "Inspect server logs for this stage.");
    }
  }
  async function runPostCreateStage(key, fn) { const stageResult = await runStage(key, fn); if (stageResult) deferredFailure = stageResult; return stageResult; }
  async function finalizeMutationWorkflow() {
    const cleanupResult = await runStage("cleanup", async () => {
      const cleanup = await attemptVerificationRiskRegisterCleanup(request, workflowContext);
      if (!cleanup.ok) return fail("cleanup", "Verification Risk Register cleanup did not succeed.", "Inspect risk-register verification cleanup routes.", 500, cleanup);
      const listAfter = await request("GET", riskListPath(workflowContext.companyFolderId, workflowContext.masterSheetId), undefined, { stageKey: "cleanup" });
      const remaining = listActiveVerificationRiskRegisterItems(riskItemsFromListResponse(listAfter));
      if (remaining.length > 0) return fail("cleanup", "Active verification risks remain after cleanup.", "Inspect verification risk cleanup archive path.", listAfter.status, { remainingCount: remaining.length });
      pass("cleanup");
      return null;
    });
    if (cleanupResult?.failedKey) return cleanupResult;
    if (deferredFailure) return fail(deferredFailure.failedKey, deferredFailure.failureReason, deferredFailure.remediation, deferredFailure.httpStatus, deferredFailure.safeResponseBody);
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const companyFolderId = trim(config.companyFolderId);
  const masterSheetId = trim(config.masterSheetId);
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;
  const verificationRiskId = buildProductionVerificationRiskRegisterId(runId);
  const verificationRiskReference = buildProductionVerificationRiskRegisterReference(runId);
  const existingControlId = buildProductionVerificationRiskRegisterControlId(runId, "existing");
  const furtherControlId = buildProductionVerificationRiskRegisterControlId(runId, "further");
  const reviewDate = defaultVerificationRiskReviewDate(todayKey);
  result.riskId = verificationRiskId;
  result.riskReference = verificationRiskReference;
  workflowContext.verificationRiskId = verificationRiskId;

  const authFail = await runStage("authentication", async () => {
    const health = await request("GET", "/api/health", undefined, { stageKey: "authentication" });
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    const loginResult = await performProductionSmokeLogin(config, timedTransport);
    if (!loginResult.ok) return fail("authentication", loginResult.failureReason || "Production login failed.", loginResult.remediation || "Inspect smoke credentials.", loginResult.httpStatus, loginResult.responseBody);
    result.accountEmail = loginResult.accountEmail || config.expectedEmail;
    pass("authentication");
    return null;
  });
  if (authFail) return authFail;

  const apiFail = await runStage("riskRegisterApi", async () => {
    let listResponse;
    let aliasResponse;
    try {
      listResponse = await requestWithTransientRetries(request, "GET", riskListPath(companyFolderId, masterSheetId), undefined, { stageKey: "riskRegisterApi", maxRetries: 2 }).then((item) => item.response);
      aliasResponse = await request("GET", riskRegisterAliasPath(companyFolderId, masterSheetId), undefined, { stageKey: "riskRegisterApi" });
    } catch (error) {
      return fail("riskRegisterApi", `Risk Register API request failed: ${error instanceof Error ? error.message : String(error)}`, "Inspect GET /api/companies/:id/risks.");
    }
    if (listResponse.status !== 200 || listResponse.json?.ok !== true || !Array.isArray(listResponse.json?.items)) return fail("riskRegisterApi", `Risk Register list returned HTTP ${listResponse.status}.`, "Inspect Risk Register list route.", listResponse.status, listResponse.json);
    if (aliasResponse.status !== 200 || aliasResponse.json?.ok !== true) return fail("riskRegisterApi", `Risk Register alias returned HTTP ${aliasResponse.status}.`, "Inspect GET /api/companies/:id/risk-register.", aliasResponse.status, aliasResponse.json);
    riskListCache = riskItemsFromListResponse(listResponse);
    pass("riskRegisterApi");
    return null;
  });
  if (apiFail) return apiFail;

  await runStage("baseline", async () => {
    result.baseline = countRiskRegisterBaselines(riskListCache, todayKey);
    baselineOperationalSummary = operationalSummaryFromRisks(riskListCache);
    try {
      const overviewResponse = await request("GET", healthSafetyOverviewPath(companyFolderId, masterSheetId), undefined, { stageKey: "baseline" });
      if (overviewResponse.status === 200 && overviewResponse.json?.ok === true) baselineHealthMetrics = overviewResponse.json.metrics || {};
    } catch { /* optional */ }
    pass("baseline");
    return null;
  });

  skip("notifications", "Risk Register notifications are client/background derived; no safe server notification API.");
  skip("search", "Risk Register search is client-side only.");

  if (!config.allowRiskRegisterMutation) {
    for (const key of MUTATION_CHECK_KEYS) skip(key, "BERT_SMOKE_ALLOW_RISK_REGISTER_MUTATION is not enabled.");
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    const cleanupResponse = await request("POST", `/api/companies/${encodeURIComponent(companyFolderId)}/risk-register/verification-cleanup`, { companyFolderId, masterSheetId, keepRiskId: verificationRiskId }, { stageKey: "staleCleanup" });
    if (cleanupResponse.status !== 200 || cleanupResponse.json?.ok !== true) return fail("staleCleanup", `Stale verification cleanup returned HTTP ${cleanupResponse.status}.`, "Inspect POST /api/companies/:id/risk-register/verification-cleanup.", cleanupResponse.status, cleanupResponse.json);
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) return staleCleanupFail;

  const createDraftFail = await runStage("createDraft", async () => {
    const payload = buildProductionVerificationRiskRegister({ runId, riskId: verificationRiskId, companyFolderId, ownerName: result.accountEmail, todayKey, reviewDate });
    let createResponse;
    try {
      createResponse = await requestWithTransientRetries(request, "POST", verificationCreatePath(companyFolderId, masterSheetId), { ...payload, companyFolderId, masterSheetId, verificationSource: PRODUCTION_VERIFICATION_RISK_REGISTER_SOURCE }, { stageKey: "createDraft", maxRetries: 2, shouldRetry: isTransientWorkflowFailure }).then((item) => item.response);
    } catch (error) {
      if (isStageTimeoutError(error) || isTransientNetworkError(error)) {
        const polled = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "createDraft", maxAttempts: options.listPollMaxAttempts || 10, intervalMs: options.listPollIntervalMs ?? 500 });
        if (polled.ok) { mustRunCleanup = true; pass("createDraft"); return null; }
      }
      throw error;
    }
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) return fail("createDraft", `Create verification risk returned HTTP ${createResponse.status}.`, "Inspect POST /api/companies/:id/risk-register/verification.", createResponse.status, createResponse.json);
    if (Number(createResponse.json?.updatedRows ?? 0) <= 0 && !createResponse.json?.alreadyExists) return fail("createDraft", "Create risk returned zero-row acknowledgement.", "Inspect RiskRegister append acknowledgement.", createResponse.status, createResponse.json);
    mustRunCleanup = true;
    pass("createDraft");
    return null;
  });
  if (createDraftFail) { const terminal = mustRunCleanup ? await finalizeMutationWorkflow() : null; return terminal || createDraftFail; }

  const substanceVisible = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "createDraft", maxAttempts: options.listPollMaxAttempts || 20, intervalMs: options.listPollIntervalMs ?? 1000 });
  if (!substanceVisible.ok) {
    deferredFailure = { failedKey: "createDraft", failureReason: "Verification risk not visible before subsequent stages.", remediation: "Inspect Risk Register read-after-write after create.", httpStatus: substanceVisible.response?.status, safeResponseBody: redactSafeResponseBody(substanceVisible.response?.json) };
    return finalizeMutationWorkflow();
  }

  const stageRunner = async (key, fn) => { const stageFail = await runPostCreateStage(key, fn); if (stageFail) { const terminal = await finalizeMutationWorkflow(); return terminal || stageFail; } return null; };

  const readbackTerminal = await stageRunner("readback", async () => {
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "readback", maxAttempts: options.listPollMaxAttempts || 15, intervalMs: options.listPollIntervalMs ?? 500 });
    if (!detail.ok) return fail("readback", "Verification risk was not visible on detail readback.", "Inspect Risk Register detail after create.", detail.response?.status, detail.response?.json);
    const item = detail.item;
    if (trim(item.riskReference) !== verificationRiskReference) return fail("readback", "Risk reference mismatch on readback.", "Inspect verification risk payload.", 200, item);
    if (!isVerificationRiskRegisterItem(item)) return fail("readback", "Verification marker missing on readback.", "Inspect description verification marker.", 200, item);
    pass("readback");
    return null;
  });
  if (readbackTerminal) return readbackTerminal;

  const editRiskTerminal = await stageRunner("editRisk", async () => {
    const patchResponse = await request("PATCH", verificationPatchPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId, description: `${PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE}. Updated during verification.`, ownerName: result.accountEmail, siteId: "Rugby Updated", reviewDate }, { stageKey: "editRisk" });
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) return fail("editRisk", `Edit risk returned HTTP ${patchResponse.status}.`, "Inspect PATCH verification risk route.", patchResponse.status, patchResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "editRisk" });
    if (!detail.ok || normalizeStatus(detail.item.status) !== "draft") return fail("editRisk", "Edited risk not in Draft status.", "Inspect risk status after patch.", 200, detail.item);
    pass("editRisk");
    return null;
  });
  if (editRiskTerminal) return editRiskTerminal;

  const causesTerminal = await stageRunner("causesConsequences", async () => {
    const patchResponse = await request("PATCH", verificationPatchPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId, cause: PRODUCTION_VERIFICATION_RISK_REGISTER_CAUSE, consequence: PRODUCTION_VERIFICATION_RISK_REGISTER_CONSEQUENCE }, { stageKey: "causesConsequences" });
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) return fail("causesConsequences", `Cause/consequence patch returned HTTP ${patchResponse.status}.`, "Inspect verification risk patch.", patchResponse.status, patchResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "causesConsequences" });
    if (trim(detail.item?.cause) !== PRODUCTION_VERIFICATION_RISK_REGISTER_CAUSE || trim(detail.item?.consequence) !== PRODUCTION_VERIFICATION_RISK_REGISTER_CONSEQUENCE) return fail("causesConsequences", "Cause/consequence values did not persist.", "Inspect risk cause/consequence fields.", 200, detail.item);
    pass("causesConsequences");
    return null;
  });
  if (causesTerminal) return causesTerminal;

  const existingControlsTerminal = await stageRunner("existingControls", async () => {
    const payload = buildProductionVerificationExistingControl({ runId, riskId: verificationRiskId, companyFolderId, controlId: existingControlId });
    const createResponse = await request("POST", verificationControlPath(companyFolderId, masterSheetId), { ...payload, companyFolderId, masterSheetId }, { stageKey: "existingControls" });
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) return fail("existingControls", `Existing control create returned HTTP ${createResponse.status}.`, "Inspect verification control route.", createResponse.status, createResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "existingControls" });
    const controls = detail.controls || [];
    if (!controls.some((control) => trim(control.id) === existingControlId && trim(control.description) === PRODUCTION_VERIFICATION_RISK_REGISTER_EXISTING_CONTROL)) return fail("existingControls", "Existing control not visible on detail.", "Inspect RiskRegisterControls tab.", 200, controls);
    pass("existingControls");
    return null;
  });
  if (existingControlsTerminal) return existingControlsTerminal;

  const initialRiskTerminal = await stageRunner("initialRisk", async () => {
    const patchResponse = await request("PATCH", verificationPatchPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId, initialLikelihood: PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_LIKELIHOOD, initialImpact: PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_IMPACT }, { stageKey: "initialRisk" });
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) return fail("initialRisk", `Initial risk patch returned HTTP ${patchResponse.status}.`, "Inspect risk scoring patch.", patchResponse.status, patchResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "initialRisk" });
    const expectedScore = calculateRiskScore(PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_LIKELIHOOD, PRODUCTION_VERIFICATION_RISK_REGISTER_INITIAL_IMPACT);
    const expectedBand = getRiskBand(expectedScore).label;
    if (Number(detail.item.initialRiskScore) !== expectedScore || trim(detail.item.initialRiskBand) !== expectedBand) return fail("initialRisk", "Initial risk score/band mismatch.", "Inspect shared calculateRiskScore/getRiskBand usage.", 200, detail.item);
    pass("initialRisk");
    return null;
  });
  if (initialRiskTerminal) return initialRiskTerminal;

  const furtherControlsTerminal = await stageRunner("furtherControls", async () => {
    const payload = buildProductionVerificationFurtherControl({ runId, riskId: verificationRiskId, companyFolderId, controlId: furtherControlId, ownerName: result.accountEmail, dueDate: reviewDate });
    const createResponse = await request("POST", verificationControlPath(companyFolderId, masterSheetId), { ...payload, companyFolderId, masterSheetId }, { stageKey: "furtherControls" });
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) return fail("furtherControls", `Further control create returned HTTP ${createResponse.status}.`, "Inspect verification control route.", createResponse.status, createResponse.json);
    const createdControl = createResponse.json?.item;
    if (trim(createdControl?.id) === furtherControlId) {
      pass("furtherControls");
      return null;
    }
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "furtherControls", maxAttempts: options.listPollMaxAttempts || 3, intervalMs: options.listPollIntervalMs ?? 500 });
    if (!detail.controls?.some((control) => trim(control.id) === furtherControlId)) return fail("furtherControls", "Further control not visible on detail.", "Inspect RiskRegisterControls tab.", 200, detail.controls);
    pass("furtherControls");
    return null;
  });
  if (furtherControlsTerminal) return furtherControlsTerminal;

  const residualRiskTerminal = await stageRunner("residualRisk", async () => {
    const patchResponse = await request("PATCH", verificationPatchPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId, residualLikelihood: PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_LIKELIHOOD, residualImpact: PRODUCTION_VERIFICATION_RISK_REGISTER_RESIDUAL_IMPACT }, { stageKey: "residualRisk" });
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true) return fail("residualRisk", `Residual risk patch returned HTTP ${patchResponse.status}.`, "Inspect risk scoring patch.", patchResponse.status, patchResponse.json);
    const patchItem = patchResponse.json?.item;
    if (patchItem && residualRiskScoresConfirmed(patchItem)) {
      pass("residualRisk");
      return null;
    }
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "residualRisk", maxAttempts: options.listPollMaxAttempts || 3, intervalMs: options.listPollIntervalMs ?? 500 });
    if (!detail.ok || !residualRiskScoresConfirmed(detail.item)) return fail("residualRisk", "Residual risk score invalid or not lower than initial.", "Inspect residual scoring.", detail.response?.status, detail.item || detail.response?.json);
    pass("residualRisk");
    return null;
  });
  if (residualRiskTerminal) return residualRiskTerminal;

  const saveDraftTerminal = await stageRunner("saveDraft", async () => {
    const patchResponse = await request("PATCH", verificationPatchPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId, department: "Verification Updated" }, { stageKey: "saveDraft" });
    const controlPatch = await request("POST", verificationControlPath(companyFolderId, masterSheetId), { controlId: existingControlId, riskId: verificationRiskId, companyFolderId, masterSheetId, controlType: "existing", description: PRODUCTION_VERIFICATION_RISK_REGISTER_EXISTING_CONTROL }, { stageKey: "saveDraft" });
    if (patchResponse.status !== 200 || patchResponse.json?.ok !== true || controlPatch.status !== 200 || controlPatch.json?.ok !== true) return fail("saveDraft", "Save draft patch failed.", "Inspect draft save idempotency.", patchResponse.status, patchResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "saveDraft" });
    if (normalizeStatus(detail.item.status) !== "draft") return fail("saveDraft", "Risk status changed during save draft.", "Ensure save draft preserves Draft status.", 200, detail.item);
    pass("saveDraft");
    return null;
  });
  if (saveDraftTerminal) return saveDraftTerminal;

  const submitTerminal = await stageRunner("submit", async () => {
    const submitResponse = await request("POST", verificationSubmitPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId }, { stageKey: "submit" });
    if (submitResponse.status !== 200 || submitResponse.json?.ok !== true) return fail("submit", `Submit returned HTTP ${submitResponse.status}.`, "Inspect verification submit route.", submitResponse.status, submitResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "submit" });
    if (!riskSubmittedMarker(detail.item.notes) && normalizeStatus(detail.item.status) !== "submitted") return fail("submit", "Submitted marker/status missing after submit.", "Inspect submit markers.", 200, detail.item);
    pass("submit");
    return null;
  });
  if (submitTerminal) return submitTerminal;

  if (config.hasReviewerCredentials) {
    const approverFail = await runPostCreateStage("approverLogin", async () => {
      const reviewerConfig = { ...config, username: config.reviewerUsername, password: config.reviewerPassword, expectedEmail: config.reviewerExpectedEmail || config.expectedEmail };
      const reviewerTransport = createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
      const loginResult = await performProductionSmokeLogin(reviewerConfig, reviewerTransport);
      if (!loginResult.ok) return fail("approverLogin", loginResult.failureReason || "Reviewer login failed.", loginResult.remediation || "Inspect reviewer credentials.", loginResult.httpStatus, loginResult.responseBody);
      approverRequest = wrapTransportWithTimeouts(reviewerTransport, { apiBase: config.apiBase, getStageKey: () => currentStageKey, getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey) }).request.bind(wrapTransportWithTimeouts(reviewerTransport, { apiBase: config.apiBase, getStageKey: () => currentStageKey, getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey) }));
      result.approverEmail = loginResult.accountEmail || config.reviewerExpectedEmail;
      pass("approverLogin");
      return null;
    });
    if (approverFail) { const terminal = await finalizeMutationWorkflow(); return terminal || approverFail; }
  } else {
    skip("approverLogin", "Admin self-approval mode for smoke account.");
  }

  const approveTerminal = await stageRunner("approveActivate", async () => {
    const approveRequest = config.hasReviewerCredentials ? approverRequest : request;
    const approveResponse = await approveRequest("POST", verificationApprovePath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId }, { stageKey: "approveActivate" });
    if (approveResponse.status !== 200 || approveResponse.json?.ok !== true) return fail("approveActivate", `Approve returned HTTP ${approveResponse.status}.`, "Inspect verification approve route.", approveResponse.status, approveResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "approveActivate" });
    if (!riskApprovedMarker(detail.item.notes) && normalizeStatus(detail.item.status) !== "active") return fail("approveActivate", "Approval marker/status missing after approve.", "Inspect approve markers.", 200, detail.item);
    pass("approveActivate");
    return null;
  });
  if (approveTerminal) return approveTerminal;

  const detailTerminal = await stageRunner("detailVerification", async () => {
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "detailVerification" });
    if (!detail.ok) return fail("detailVerification", "Final detail verification failed.", "Inspect approved risk detail.", detail.response?.status, detail.response?.json);
    const item = detail.item;
    if (trim(item.riskReference) !== verificationRiskReference || trim(item.title) !== PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE) return fail("detailVerification", "Final detail field mismatch.", "Inspect approved risk fields.", 200, item);
    if ((detail.controls || []).length < 2) return fail("detailVerification", "Expected verification controls missing on detail.", "Inspect controls linkage.", 200, detail.controls);
    pass("detailVerification");
    return null;
  });
  if (detailTerminal) return detailTerminal;

  const reviewTerminal = await stageRunner("review", async () => {
    const reviewResponse = await request("POST", verificationReviewPath(companyFolderId, verificationRiskId, masterSheetId), { companyFolderId, masterSheetId, outcome: "no_change", summary: PRODUCTION_VERIFICATION_RISK_REGISTER_REVIEW_SUMMARY, reviewDate }, { stageKey: "review" });
    if (reviewResponse.status !== 200 || reviewResponse.json?.ok !== true) return fail("review", `Review returned HTTP ${reviewResponse.status}.`, "Inspect verification review route.", reviewResponse.status, reviewResponse.json);
    const detail = await pollRiskDetail(request, companyFolderId, masterSheetId, verificationRiskId, { stageKey: "review" });
    if (!riskReviewedMarker(detail.item.notes)) return fail("review", "Review marker missing after review.", "Inspect review markers.", 200, detail.item);
    pass("review");
    return null;
  });
  if (reviewTerminal) return reviewTerminal;

  await runPostCreateStage("dashboardOverview", async () => {
    const overview = await request("GET", healthSafetyOverviewPath(companyFolderId, masterSheetId), undefined, { stageKey: "dashboardOverview" });
    if (overview.status !== 200 || overview.json?.ok !== true) return fail("dashboardOverview", `Overview returned HTTP ${overview.status}.`, "Inspect health-safety overview.", overview.status, overview.json);
    if (overviewMentionsVerificationRisk(overview.json, verificationRiskId)) return fail("dashboardOverview", "Verification risk appears in operational overview attention items.", "Ensure isOperationalRiskRegisterItem excludes verification rows.", overview.status, overview.json);
    const listResponse = await request("GET", riskListPath(companyFolderId, masterSheetId), undefined, { stageKey: "dashboardOverview" });
    const operationalSummary = operationalSummaryFromRisks(riskItemsFromListResponse(listResponse));
    if (baselineOperationalSummary) {
      for (const key of ["highCritical", "reviewDue", "overdue"]) {
        if (Number(operationalSummary[key]) > Number(baselineOperationalSummary[key] || 0) + 1) return fail("dashboardOverview", `Operational Risk Register metric ${key} increased beyond baseline tolerance.`, "Filter verification risks from operational counts.", listResponse.status, { key, baseline: baselineOperationalSummary[key], current: operationalSummary[key] });
      }
    }
    if (baselineHealthMetrics) {
      for (const key of ["highCriticalRiskRegisterItems", "riskRegisterReviewDue", "riskRegisterOverdue"]) {
        if (Number(overview.json.metrics?.[key] || 0) > Number(baselineHealthMetrics[key] || 0) + 1) return fail("dashboardOverview", `H&S overview metric ${key} increased beyond baseline tolerance.`, "Filter verification risks from overview metrics.", overview.status, { key, baseline: baselineHealthMetrics[key], current: overview.json.metrics?.[key] });
      }
    }
    const verificationItem = findRiskRegisterById(riskItemsFromListResponse(listResponse), verificationRiskId);
    if (verificationItem && !isVerificationRiskRegisterItem(verificationItem)) return fail("dashboardOverview", "Verification risk missing marker in register list.", "Inspect verification risk markers.");
    pass("dashboardOverview");
    return null;
  });

  const terminal = await finalizeMutationWorkflow();
  return terminal || result;
}
