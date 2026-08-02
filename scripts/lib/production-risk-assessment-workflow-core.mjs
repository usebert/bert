/**
 * Production Risk Assessment workflow checks — shared by live verifier and unit tests.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  buildProductionVerificationHazard,
  buildProductionVerificationRiskAssessment,
  buildProductionVerificationRiskAssessmentId,
  countRiskAssessmentBaselines,
  isActiveVerificationRiskAssessment,
  isVerificationRiskAssessment,
  PRODUCTION_VERIFICATION_RA_DESCRIPTION,
  PRODUCTION_VERIFICATION_RA_REVIEW_SUMMARY,
  PRODUCTION_VERIFICATION_RA_TITLE,
} from "../../shared/production-verification-risk-assessment.mjs";
import {
  buildTimeoutFailureResult,
  createWorkflowDiagnostics,
  isStageTimeoutError,
  wrapTransportWithTimeouts,
} from "./production-workflow-diagnostics.mjs";

export { loadSmokeConfig, performProductionSmokeLogin, maskEmail };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const RA_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_RA_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  riskAssessmentsApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createDraft: 120_000,
  addHazards: 120_000,
  saveDraft: 120_000,
  resumeDraft: 60_000,
  editHazard: 120_000,
  submit: 120_000,
  approve: 120_000,
  detailVerification: 60_000,
  healthSafetyOverview: 60_000,
  search: 5_000,
  review: 120_000,
  newVersion: 120_000,
  dashboard: 60_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "riskAssessmentsApi",
  "baseline",
  "staleCleanup",
  "createDraft",
  "addHazards",
  "saveDraft",
  "resumeDraft",
  "editHazard",
  "submit",
  "approve",
  "detailVerification",
  "healthSafetyOverview",
  "search",
  "review",
  "newVersion",
  "dashboard",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  riskAssessmentsApi: "Risk Assessments API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createDraft: "Create Draft",
  addHazards: "Add Hazards",
  saveDraft: "Save Draft",
  resumeDraft: "Resume Draft",
  editHazard: "Edit Hazard",
  submit: "Submit",
  approve: "Approve / Activate",
  detailVerification: "Detail Verification",
  healthSafetyOverview: "H&S Overview",
  search: "Search",
  review: "Review",
  newVersion: "New Version",
  dashboard: "Dashboard",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createDraft",
  "addHazards",
  "saveDraft",
  "resumeDraft",
  "editHazard",
  "submit",
  "approve",
  "detailVerification",
  "healthSafetyOverview",
  "review",
  "newVersion",
  "dashboard",
  "cleanup",
]);

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeIdentity(value) {
  return trim(value).toLowerCase().replace(/\s+/g, " ");
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function riskAssessmentsPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments`, masterSheetId);
}

function riskAssessmentDetailPath(companyFolderId, riskAssessmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}`,
    masterSheetId,
  );
}

function healthSafetyOverviewPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/health-safety/overview`, masterSheetId);
}

function futureReviewDate(days = 365) {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function loadRiskAssessmentWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowRiskAssessmentMutation =
    trim(env.BERT_SMOKE_ALLOW_RISK_ASSESSMENT_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_RISK_ASSESSMENT_MUTATION).toLowerCase() === "true";
  const reviewerUsername = trim(env.BERT_SMOKE_RISK_ASSESSMENT_REVIEWER_USERNAME);
  const reviewerPassword = trim(env.BERT_SMOKE_RISK_ASSESSMENT_REVIEWER_PASSWORD);
  const reviewerExpectedEmail = trim(env.BERT_SMOKE_RISK_ASSESSMENT_REVIEWER_EXPECTED_EMAIL).toLowerCase();
  return {
    ...base,
    allowRiskAssessmentMutation,
    reviewerUsername,
    reviewerPassword,
    reviewerExpectedEmail,
    hasReviewerCredentials: Boolean(reviewerUsername && reviewerPassword),
    totalBudgetMs: RA_VERIFIER_BUDGET_MS,
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
      return val;
    });
  } catch {
    return "[unserializable response]";
  }
}

function assertResponseSafe(json, label = "response") {
  assertNoPasswordHash(json, label);
}

export function formatRiskAssessmentWorkflowReport(result) {
  const lines = [
    "==============================================",
    "BERT Production Risk Assessment Workflow",
    "==============================================",
    "",
  ];

  for (const key of CHECK_KEYS) {
    const check = result.checks[key] || { status: "FAIL" };
    const status = check.status === "SKIP" ? "SKIP" : check.status || "FAIL";
    lines.push(`${CHECK_LABELS[key].padEnd(27)} ${status}`);
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
  if (result.riskAssessmentId) {
    lines.push(`Assessment ID: ${result.riskAssessmentId}`);
  }
  if (result.assessmentVersion) {
    lines.push(`Version: ${result.assessmentVersion}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
  }
  if (result.createDraftDiagnostics) {
    lines.push("");
    lines.push("Create draft diagnostics:");
    lines.push(JSON.stringify(result.createDraftDiagnostics));
  }
  lines.push("");

  if (result.timedOut) {
    lines.push("Timed out:");
    lines.push(`Stage: ${result.failedStage || result.failedKey || "unknown"}`);
    if (result.timeoutMethod && result.timeoutSafeUrl) {
      lines.push(`Request: ${result.timeoutMethod} ${result.timeoutSafeUrl}`);
    }
    if (result.timeoutElapsedMs) {
      lines.push(`Elapsed: ${result.timeoutElapsedMs}ms`);
    }
    if (result.timeoutMs) {
      lines.push(`Timeout limit: ${result.timeoutMs}ms`);
    }
    lines.push("");
  }

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

export async function fetchCompanyRiskAssessments(request, companyFolderId, masterSheetId, stageKey = "riskAssessmentsApi") {
  const response = await request("GET", riskAssessmentsPath(companyFolderId, masterSheetId), undefined, { stageKey });
  assertResponseSafe(response.json, "risk assessments list");
  return response;
}

export async function pollRiskAssessmentListForId(request, companyFolderId, masterSheetId, riskAssessmentId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "createDraft";
  const attempts = [];
  let matches = [];
  let lastListResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastListResponse = await fetchCompanyRiskAssessments(request, companyFolderId, masterSheetId, stageKey);
    matches = (lastListResponse.json?.items || []).filter((item) => trim(item.id) === trim(riskAssessmentId));
    attempts.push({
      attempt,
      status: lastListResponse.status,
      itemCount: Array.isArray(lastListResponse.json?.items) ? lastListResponse.json.items.length : 0,
      matchCount: matches.length,
    });
    if (matches.length === 1) {
      return { ok: true, matches, attempts, listResponse: lastListResponse };
    }
  }
  return { ok: false, matches, attempts, listResponse: lastListResponse };
}

export async function pollRiskAssessmentDetailForId(request, companyFolderId, masterSheetId, riskAssessmentId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "createDraft";
  const attempts = [];
  let lastDetailResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastDetailResponse = await request(
      "GET",
      riskAssessmentDetailPath(companyFolderId, riskAssessmentId, masterSheetId),
      undefined,
      { stageKey },
    );
    assertResponseSafe(lastDetailResponse.json, "create draft detail poll");
    const found = lastDetailResponse.json?.ok === true && trim(lastDetailResponse.json?.item?.id) === trim(riskAssessmentId);
    attempts.push({
      attempt,
      status: lastDetailResponse.status,
      ok: lastDetailResponse.json?.ok === true,
      found,
      returnedStatus: trim(lastDetailResponse.json?.item?.status) || null,
    });
    if (found) {
      return { ok: true, detailResponse: lastDetailResponse, attempts };
    }
  }
  return { ok: false, detailResponse: lastDetailResponse, attempts };
}

export async function attemptVerificationRiskAssessmentCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const riskAssessmentId = trim(context.riskAssessmentId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_RA_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({
      kind: "bulk",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (riskAssessmentId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_RA_STAGE_TIMEOUTS_MS.cleanup },
      );
      results.push({
        kind: "single",
        riskAssessmentId,
        ok: single.json?.ok === true,
        status: single.status,
      });
    } catch (error) {
      results.push({
        kind: "single",
        riskAssessmentId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: results.some((item) => item.ok), results };
}

function overviewMentionsVerificationAssessment(payload, riskAssessmentId) {
  const id = trim(riskAssessmentId);
  if (!id) {
    return false;
  }
  const attention = Array.isArray(payload?.attention) ? payload.attention : [];
  return attention.some((item) => trim(item?.recordId) === id || String(item?.id || "").includes(id));
}

export async function runProductionRiskAssessmentWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    riskAssessmentId: "",
  };
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[risk-assessment-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || RA_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_RA_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationRiskAssessmentCleanup(request, workflowContext));
  }

  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    accountEmail: config.expectedEmail || "",
    durationMs: 0,
  };

  const pass = (key, status = "PASS") => {
    result.checks[key] = { status };
  };

  const skip = (key, reason = "SKIPPED") => {
    result.checks[key] = { status: "SKIP", reason };
  };

  const fail = (key, reason, remediation = "", httpStatus = 0, responseBody = null, extra = {}) => {
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    result.checks[key] = { status: "FAIL" };
    Object.assign(result, extra);
    for (const checkKey of CHECK_KEYS) {
      if (result.checks[checkKey].status === "PENDING") {
        result.checks[checkKey] = { status: "SKIP" };
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  };

  const failFromTimeout = (stageKey, error, stageDurationMs) => {
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
        totalElapsedMs: diagnostics.elapsedMs(),
      },
      {
        timedOut: true,
        timeoutMethod: error.method,
        timeoutSafeUrl: error.safeUrl,
        timeoutElapsedMs: error.elapsedMs,
        timeoutMs: error.timeoutMs,
      },
    );
  };

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
        diagnostics.endStage(stageKey, status, Date.now() - stageStarted);
      }
      return null;
    } catch (error) {
      if (isStageTimeoutError(error)) {
        return failFromTimeout(stageKey, error, Date.now() - stageStarted);
      }
      if (error?.code === "VERIFIER_BUDGET_EXCEEDED") {
        diagnostics.failStage(stageKey, "TIMEOUT", Date.now() - stageStarted);
        return fail(
          stageKey,
          error.message,
          "Reduce workflow scope or increase the verifier total budget if appropriate.",
          408,
          { budgetExceeded: true, elapsedMs: diagnostics.elapsedMs() },
        );
      }
      diagnostics.failStage(stageKey, "FAIL", Date.now() - stageStarted);
      return fail(stageKey, error instanceof Error ? error.message : String(error));
    }
  }

  let login = null;
  let assessments = [];
  let hazardOneId = "";
  let hazardTwoId = "";
  let baselineOverview = null;

  const authFail = await runStage("authentication", async () => {
    let health;
    try {
      health = await request("GET", "/api/health", undefined, { stageKey: "authentication" });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "authentication",
        `API health request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Confirm the production API is reachable.",
      );
    }
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    result.shortSha = trim(health.json?.shortSha);

    const loginResult = await performProductionSmokeLogin(config, timedTransport, options);
    if (!loginResult.ok) {
      return fail(
        "authentication",
        loginResult.failureReason || "Production login failed.",
        loginResult.remediation || "Inspect smoke credentials and company session enrichment.",
        loginResult.httpStatus,
        loginResult.responseBody,
      );
    }
    login = loginResult;
    result.accountEmail = login.accountEmail || config.expectedEmail;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const companyFolderId = trim(login.companyFolderId || config.companyFolderId);
  const masterSheetId = trim(login.masterSheetId || config.masterSheetId);
  const runId = options.runId || Date.now();
  const riskAssessmentId = buildProductionVerificationRiskAssessmentId(runId);
  hazardOneId = buildProductionVerificationHazard(runId, 1).id;
  hazardTwoId = buildProductionVerificationHazard(runId, 2).id;
  result.riskAssessmentId = riskAssessmentId;
  result.assessmentVersion = "1.0";
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;
  workflowContext.riskAssessmentId = riskAssessmentId;

  const apiFail = await runStage("riskAssessmentsApi", async () => {
    let listResponse;
    try {
      listResponse = await fetchCompanyRiskAssessments(request, companyFolderId, masterSheetId, "riskAssessmentsApi");
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "riskAssessmentsApi",
        `Risk Assessments list request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:companyFolderId/risk-assessments.",
      );
    }
    if (listResponse.status !== 200 || listResponse.json?.ok !== true) {
      return fail(
        "riskAssessmentsApi",
        `Risk Assessments API returned HTTP ${listResponse.status}.`,
        "Inspect folder-first Risk Assessments read route and workbook tab access.",
        listResponse.status,
        listResponse.json,
      );
    }
    if (!Array.isArray(listResponse.json?.items)) {
      return fail(
        "riskAssessmentsApi",
        "Risk Assessments API response is missing the items array.",
        "Inspect GET /api/companies/:companyFolderId/risk-assessments response shape.",
        listResponse.status,
        listResponse.json,
      );
    }
    assessments = listResponse.json.items;
    pass("riskAssessmentsApi");
    return null;
  });
  if (apiFail) {
    return apiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    result.baseline = countRiskAssessmentBaselines(assessments);
    let overviewResponse;
    try {
      overviewResponse = await request("GET", healthSafetyOverviewPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "baseline",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "baseline",
        `Health & Safety overview baseline request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/health-safety/overview.",
      );
    }
    assertResponseSafe(overviewResponse.json, "overview baseline");
    if (overviewResponse.status !== 200 || overviewResponse.json?.ok !== true) {
      return fail(
        "baseline",
        `Health & Safety overview baseline returned HTTP ${overviewResponse.status}.`,
        "Inspect health-safety overview service for the smoke company.",
        overviewResponse.status,
        overviewResponse.json,
      );
    }
    baselineOverview = overviewResponse.json;
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowRiskAssessmentMutation) {
    result.mutationSkipped = true;
    for (const key of MUTATION_CHECK_KEYS) {
      const skipped = await runStage(key, async () => {
        skip(key);
        return null;
      });
      if (skipped) {
        return skipped;
      }
    }
    const searchSkipped = await runStage("search", async () => {
      skip("search", "Global search is client-side only; server-side search adapter unavailable.");
      return null;
    });
    if (searchSkipped) {
      return searchSkipped;
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    let staleCleanup;
    try {
      staleCleanup = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "staleCleanup" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "staleCleanup",
        `Stale verification cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/risk-assessments/verification-cleanup.",
      );
    }
    assertResponseSafe(staleCleanup.json, "stale cleanup");
    if (staleCleanup.status !== 200 || staleCleanup.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup rejected (HTTP ${staleCleanup.status}).`,
        "Inspect verification risk assessment marker matching and cleanup permissions.",
        staleCleanup.status,
        staleCleanup.json,
      );
    }
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) {
    return staleCleanupFail;
  }

  const verificationPayload = buildProductionVerificationRiskAssessment({
    runId,
    companyFolderId,
    ownerUserId: login.userId || config.username,
    ownerName: login.userName || config.username,
    assessorUserId: login.userId || config.username,
    assessorName: login.userName || config.username,
  });

  const createDraftFail = await runStage("createDraft", async () => {
    let createResponse;
    try {
      createResponse = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments`,
        {
          ...verificationPayload,
          masterSheetId,
        },
        { stageKey: "createDraft" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "createDraft",
        `Create draft request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/risk-assessments.",
      );
    }
    assertResponseSafe(createResponse.json, "create draft");
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createDraft",
        `Create draft returned HTTP ${createResponse.status}.`,
        "Inspect risk assessment create route and workbook write permissions.",
        createResponse.status,
        createResponse.json,
      );
    }
    const createdId = trim(createResponse.json?.item?.id);
    const createDiagnostics = {
      createHttpStatus: createResponse.status,
      returnedAssessmentId: createdId || null,
      returnedStatus: trim(createResponse.json?.item?.status) || null,
      verificationMarker: isVerificationRiskAssessment(createResponse.json?.item || {}) ? "verification" : null,
      detailLookup: null,
      listPollAttempts: [],
    };
    if (createdId !== riskAssessmentId) {
      result.createDraftDiagnostics = createDiagnostics;
      return fail(
        "createDraft",
        `Expected verification RiskAssessmentId ${riskAssessmentId}, got ${createdId || "(missing)"}.`,
        "Inspect verification ID acceptance in createCompanyRiskAssessment.",
        createResponse.status,
        createDiagnostics,
      );
    }

    let detailResponse;
    const detailPolled = await pollRiskAssessmentDetailForId(request, companyFolderId, masterSheetId, riskAssessmentId, {
      stageKey: "createDraft",
      maxAttempts: Number(options.listPollMaxAttempts) || 15,
      intervalMs: Number(options.listPollIntervalMs) || 1000,
    });
    detailResponse = detailPolled.detailResponse;
    createDiagnostics.detailLookup = {
      status: detailResponse?.status,
      ok: detailPolled.ok,
      found: detailPolled.ok,
      returnedStatus: trim(detailResponse?.json?.item?.status) || null,
      pollAttempts: detailPolled.attempts,
    };
    if (!detailPolled.ok) {
      result.createDraftDiagnostics = createDiagnostics;
      return fail(
        "createDraft",
        "Created verification assessment was not retrievable from the detail endpoint.",
        "Inspect create write path and detail route lookup.",
        detailResponse?.status,
        createDiagnostics,
      );
    }

    const polled = await pollRiskAssessmentListForId(request, companyFolderId, masterSheetId, riskAssessmentId, {
      stageKey: "createDraft",
      maxAttempts: Number(options.listPollMaxAttempts) || 15,
      intervalMs: Number(options.listPollIntervalMs) || 1000,
    });
    createDiagnostics.listPollAttempts = polled.attempts;
    result.createDraftDiagnostics = createDiagnostics;
    const matches = polled.matches;
    if (!polled.ok || matches.length !== 1) {
      return fail(
        "createDraft",
        `Expected exactly one verification assessment in list, found ${matches.length}.`,
        "Inspect Risk Assessment list cache invalidation after create and workbook row visibility.",
        polled.listResponse?.status,
        createDiagnostics,
      );
    }
    if (trim(matches[0].status) !== "Draft") {
      return fail("createDraft", `Expected Draft status, got ${matches[0].status}.`, "Inspect create draft status.");
    }
    pass("createDraft");
    return null;
  });
  if (createDraftFail) {
    return createDraftFail;
  }

  const addHazardsFail = await runStage("addHazards", async () => {
    for (const [index, hazard] of [
      buildProductionVerificationHazard(runId, 1),
      buildProductionVerificationHazard(runId, 2),
    ].entries()) {
      let hazardResponse;
      try {
        hazardResponse = await request(
          "POST",
          `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/hazards`,
          { ...hazard, masterSheetId },
          { stageKey: "addHazards" },
        );
      } catch (error) {
        if (isStageTimeoutError(error)) {
          throw error;
        }
        return fail(
          "addHazards",
          `Add hazard ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
          "Inspect POST /api/companies/:id/risk-assessments/:id/hazards.",
        );
      }
      assertResponseSafe(hazardResponse.json, `add hazard ${index + 1}`);
      if (hazardResponse.status !== 200 || hazardResponse.json?.ok !== true) {
        return fail(
          "addHazards",
          `Add hazard ${index + 1} returned HTTP ${hazardResponse.status}.`,
          "Inspect hazard create route and risk score recalculation.",
          hazardResponse.status,
          hazardResponse.json,
        );
      }
    }

    const detail = await request(
      "GET",
      riskAssessmentDetailPath(companyFolderId, riskAssessmentId, masterSheetId),
      undefined,
      { stageKey: "addHazards" },
    );
    const hazards = detail.json?.hazards || [];
    if (hazards.length !== 2) {
      return fail("addHazards", `Expected 2 hazards, found ${hazards.length}.`, "Inspect hazard persistence.");
    }
    const ids = new Set(hazards.map((item) => item.id));
    if (ids.size !== 2) {
      return fail("addHazards", "Duplicate hazard IDs detected after create.", "Inspect hazard deduplication.");
    }
    const hazardOne = hazards.find((item) => item.id === hazardOneId);
    const hazardTwo = hazards.find((item) => item.id === hazardTwoId);
    if (!hazardOne || !hazardTwo) {
      return fail("addHazards", "Verification hazard IDs were not preserved.", "Inspect hazard ID acceptance.");
    }
    if (Number(hazardOne.initialRiskScore) !== 6 || Number(hazardOne.residualRiskScore) !== 2) {
      return fail(
        "addHazards",
        `Hazard 1 scores unexpected (initial ${hazardOne.initialRiskScore}, residual ${hazardOne.residualRiskScore}).`,
        "Inspect server-side risk score calculation.",
      );
    }
    if (Number(hazardTwo.initialRiskScore) !== 9 || Number(hazardTwo.residualRiskScore) !== 4) {
      return fail(
        "addHazards",
        `Hazard 2 scores unexpected (initial ${hazardTwo.initialRiskScore}, residual ${hazardTwo.residualRiskScore}).`,
        "Inspect server-side risk score calculation.",
      );
    }
    pass("addHazards");
    return null;
  });
  if (addHazardsFail) {
    return addHazardsFail;
  }

  const saveDraftFail = await runStage("saveDraft", async () => {
    let saveResponse;
    try {
      saveResponse = await request(
        "PATCH",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}`,
        {
          description: `${PRODUCTION_VERIFICATION_RA_DESCRIPTION} Updated during save draft.`,
          masterSheetId,
        },
        { stageKey: "saveDraft" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "saveDraft",
        `Save draft request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect PATCH /api/companies/:id/risk-assessments/:id.",
      );
    }
    assertResponseSafe(saveResponse.json, "save draft");
    if (saveResponse.status !== 200 || saveResponse.json?.ok !== true) {
      return fail(
        "saveDraft",
        `Save draft returned HTTP ${saveResponse.status}.`,
        "Inspect assessment patch route.",
        saveResponse.status,
        saveResponse.json,
      );
    }

    let hazardPatch;
    try {
      hazardPatch = await request(
        "PATCH",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessment-hazards/${encodeURIComponent(hazardOneId)}`,
        {
          existingControls: "Work area kept clear and inspected",
          masterSheetId,
        },
        { stageKey: "saveDraft" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "saveDraft",
        `Hazard save failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect PATCH /api/companies/:id/risk-assessment-hazards/:hazardId.",
      );
    }
    if (hazardPatch.status !== 200 || hazardPatch.json?.ok !== true) {
      return fail(
        "saveDraft",
        `Hazard save returned HTTP ${hazardPatch.status}.`,
        "Inspect hazard patch route.",
        hazardPatch.status,
        hazardPatch.json,
      );
    }
    if (trim(saveResponse.json?.item?.status) !== "Draft" || trim(saveResponse.json?.item?.version) !== "1.0") {
      return fail("saveDraft", "Assessment status or version changed unexpectedly during save.", "Inspect draft save rules.");
    }
    pass("saveDraft");
    return null;
  });
  if (saveDraftFail) {
    return saveDraftFail;
  }

  const resumeDraftFail = await runStage("resumeDraft", async () => {
    const detail = await request(
      "GET",
      riskAssessmentDetailPath(companyFolderId, riskAssessmentId, masterSheetId),
      undefined,
      { stageKey: "resumeDraft" },
    );
    if (detail.status !== 200 || detail.json?.ok !== true) {
      return fail(
        "resumeDraft",
        `Detail reload returned HTTP ${detail.status}.`,
        "Inspect GET /api/companies/:id/risk-assessments/:id.",
        detail.status,
        detail.json,
      );
    }
    const item = detail.json.item || {};
    if (trim(item.title) !== PRODUCTION_VERIFICATION_RA_TITLE) {
      return fail("resumeDraft", "Title mismatch after resume.", "Inspect assessment detail mapping.");
    }
    if (!String(item.description || "").includes("Updated during save draft")) {
      return fail("resumeDraft", "Updated description did not persist.", "Inspect assessment patch persistence.");
    }
    const hazards = detail.json.hazards || [];
    if (hazards.length !== 2) {
      return fail("resumeDraft", `Expected 2 hazards on resume, found ${hazards.length}.`, "Inspect hazard list.");
    }
    const hazardOne = hazards.find((entry) => entry.id === hazardOneId);
    if (!hazardOne || !String(hazardOne.existingControls || "").includes("inspected")) {
      return fail("resumeDraft", "Updated hazard controls did not persist.", "Inspect hazard patch persistence.");
    }
    if ((detail.json.links || []).length > 0) {
      return fail("resumeDraft", "Unexpected customer-linked records found.", "Verification assessment must stay unlinked.");
    }
    if (!isVerificationRiskAssessment(item)) {
      return fail("resumeDraft", "Verification marker missing after resume.", "Inspect verification marker fields.");
    }
    pass("resumeDraft");
    return null;
  });
  if (resumeDraftFail) {
    return resumeDraftFail;
  }

  const editHazardFail = await runStage("editHazard", async () => {
    const before = await request(
      "GET",
      riskAssessmentDetailPath(companyFolderId, riskAssessmentId, masterSheetId),
      undefined,
      { stageKey: "editHazard" },
    );
    const hazardTwoBefore = (before.json?.hazards || []).find((item) => item.id === hazardTwoId);
    const beforeUpdatedAt = trim(hazardTwoBefore?.updatedAt);

    let editResponse;
    try {
      editResponse = await request(
        "PATCH",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessment-hazards/${encodeURIComponent(hazardTwoId)}`,
        {
          additionalControls: "Use two-person lift for awkward loads and team briefing",
          residualLikelihood: 1,
          masterSheetId,
        },
        { stageKey: "editHazard" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "editHazard",
        `Edit hazard request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect hazard patch route.",
      );
    }
    if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
      return fail(
        "editHazard",
        `Edit hazard returned HTTP ${editResponse.status}.`,
        "Inspect hazard patch validation.",
        editResponse.status,
        editResponse.json,
      );
    }
    const edited = editResponse.json.item || {};
    if (trim(edited.id) !== hazardTwoId) {
      return fail("editHazard", "Hazard ID changed after edit.", "Inspect hazard patch identity rules.");
    }
    if (Number(edited.residualRiskScore) !== 2) {
      return fail(
        "editHazard",
        `Residual score not recalculated (expected 2, got ${edited.residualRiskScore}).`,
        "Inspect hazard score recalculation.",
      );
    }
    if (beforeUpdatedAt && trim(edited.updatedAt) === beforeUpdatedAt) {
      return fail("editHazard", "Updated timestamp did not change after edit.", "Inspect hazard updatedAt patch.");
    }
    pass("editHazard");
    return null;
  });
  if (editHazardFail) {
    return editHazardFail;
  }

  const submitFail = await runStage("submit", async () => {
    let submitResponse;
    try {
      submitResponse = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/submit`,
        { masterSheetId },
        { stageKey: "submit" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "submit",
        `Submit request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/risk-assessments/:id/submit.",
      );
    }
    assertResponseSafe(submitResponse.json, "submit");
    if (submitResponse.status !== 200 || submitResponse.json?.ok !== true) {
      return fail(
        "submit",
        `Submit returned HTTP ${submitResponse.status}.`,
        "Inspect submit validation and hazard requirements.",
        submitResponse.status,
        submitResponse.json,
      );
    }
    if (trim(submitResponse.json?.item?.status) !== "Submitted") {
      return fail("submit", `Expected Submitted status, got ${submitResponse.json?.item?.status}.`, "Inspect submit status transition.");
    }
    if (!trim(submitResponse.json?.item?.submittedAt) || !trim(submitResponse.json?.item?.submittedBy)) {
      return fail("submit", "SubmittedAt/SubmittedBy not recorded.", "Inspect submit metadata persistence.");
    }

    let repeatSubmit;
    try {
      repeatSubmit = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/submit`,
        { masterSheetId },
        { stageKey: "submit" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail("submit", `Repeated submit failed: ${error instanceof Error ? error.message : String(error)}`, "Inspect submit idempotency.");
    }
    if (repeatSubmit.status !== 200 || repeatSubmit.json?.ok !== true) {
      return fail(
        "submit",
        `Repeated submit returned HTTP ${repeatSubmit.status}.`,
        "Inspect submit idempotency handling.",
        repeatSubmit.status,
        repeatSubmit.json,
      );
    }
    if (repeatSubmit.json?.alreadySubmitted !== true && trim(repeatSubmit.json?.item?.status) !== "Submitted") {
      return fail("submit", "Repeated submit did not return a safe already-submitted response.", "Inspect submit idempotency.");
    }
    pass("submit");
    return null;
  });
  if (submitFail) {
    return submitFail;
  }

  const approveFail = await runStage("approve", async () => {
    let approveResponse;
    try {
      approveResponse = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/approve`,
        { activateNow: true, masterSheetId },
        { stageKey: "approve" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "approve",
        `Approve request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/risk-assessments/:id/approve.",
      );
    }

    if (approveResponse.status === 403 && /own submission/i.test(String(approveResponse.json?.error || approveResponse.json?.message || ""))) {
      if (!config.hasReviewerCredentials) {
        return fail(
          "approve",
          "Reviewer credentials are required because self-approval is blocked.",
          "Set BERT_SMOKE_RISK_ASSESSMENT_REVIEWER_USERNAME/PASSWORD/EXPECTED_EMAIL.",
          403,
          approveResponse.json,
        );
      }
      const reviewerLogin = await performProductionSmokeLogin(
        {
          ...config,
          username: config.reviewerUsername,
          password: config.reviewerPassword,
          expectedEmail: config.reviewerExpectedEmail || config.expectedEmail,
        },
        timedTransport,
        options,
      );
      if (!reviewerLogin.ok) {
        return fail(
          "approve",
          reviewerLogin.failureReason || "Reviewer login failed.",
          reviewerLogin.remediation || "Provide a reviewer smoke account that can approve risk assessments.",
          reviewerLogin.httpStatus,
          reviewerLogin.responseBody,
        );
      }
      approveResponse = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/approve`,
        { activateNow: true, masterSheetId },
        { stageKey: "approve" },
      );
    }

    assertResponseSafe(approveResponse.json, "approve");
    if (approveResponse.status !== 200 || approveResponse.json?.ok !== true) {
      return fail(
        "approve",
        `Approve returned HTTP ${approveResponse.status}.`,
        "Inspect approval permissions and activateNow behaviour.",
        approveResponse.status,
        approveResponse.json,
      );
    }
    const status = trim(approveResponse.json?.item?.status);
    if (status !== "Active" && status !== "Approved") {
      return fail("approve", `Expected Active/Approved status, got ${status}.`, "Inspect approval lifecycle.");
    }
    if (!trim(approveResponse.json?.item?.approvedAt) || !trim(approveResponse.json?.item?.approvedBy)) {
      return fail("approve", "ApprovedAt/ApprovedBy not recorded.", "Inspect approval metadata.");
    }
    if (trim(approveResponse.json?.item?.version) !== "1.0") {
      return fail("approve", "Version changed unexpectedly during approval.", "Inspect version rules on approval.");
    }
    pass("approve");
    return null;
  });
  if (approveFail) {
    return approveFail;
  }

  const detailFail = await runStage("detailVerification", async () => {
    const detail = await request(
      "GET",
      riskAssessmentDetailPath(companyFolderId, riskAssessmentId, masterSheetId),
      undefined,
      { stageKey: "detailVerification" },
    );
    if (detail.status !== 200 || detail.json?.ok !== true) {
      return fail(
        "detailVerification",
        `Detail verification returned HTTP ${detail.status}.`,
        "Inspect approved assessment detail route.",
        detail.status,
        detail.json,
      );
    }
    const item = detail.json.item || {};
    if (trim(item.title) !== PRODUCTION_VERIFICATION_RA_TITLE) {
      return fail("detailVerification", "Title mismatch on approved detail.", "Inspect detail mapping.");
    }
    if ((detail.json.hazards || []).length !== 2) {
      return fail("detailVerification", "Expected two hazards on approved detail.", "Inspect hazard persistence.");
    }
    if ((detail.json.links || []).length > 0) {
      return fail("detailVerification", "Unexpected links on verification assessment.", "Verification must stay unlinked.");
    }
    if (!trim(item.approvedAt) || !trim(item.approvedBy)) {
      return fail("detailVerification", "Approval metadata missing on detail.", "Inspect approval fields.");
    }
    pass("detailVerification");
    return null;
  });
  if (detailFail) {
    return detailFail;
  }

  const overviewFail = await runStage("healthSafetyOverview", async () => {
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
    if (!overview.json?.metrics || typeof overview.json.metrics !== "object") {
      return fail(
        "healthSafetyOverview",
        "Overview metrics missing.",
        "Inspect buildHealthSafetyOverviewPayload.",
        overview.status,
        overview.json,
      );
    }
    if (overviewMentionsVerificationAssessment(overview.json, riskAssessmentId)) {
      return fail(
        "healthSafetyOverview",
        "Verification assessment appears in operational attention items.",
        "Ensure isOperationalRiskAssessment excludes active verification rows.",
        overview.status,
        overview.json,
      );
    }
    pass("healthSafetyOverview");
    return null;
  });
  if (overviewFail) {
    return overviewFail;
  }

  const searchSkipped = await runStage("search", async () => {
    skip("search", "Global search is client-side only; server-side search adapter unavailable.");
    return null;
  });
  if (searchSkipped) {
    return searchSkipped;
  }

  const reviewFail = await runStage("review", async () => {
    const nextReviewDate = futureReviewDate(180);
    let reviewResponse;
    try {
      reviewResponse = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/review`,
        {
          reviewType: "manual",
          outcome: "no_change",
          summary: PRODUCTION_VERIFICATION_RA_REVIEW_SUMMARY,
          nextReviewDate,
          masterSheetId,
        },
        { stageKey: "review" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "review",
        `Review request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/risk-assessments/:id/review.",
      );
    }
    if (reviewResponse.status !== 200 || reviewResponse.json?.ok !== true) {
      return fail(
        "review",
        `Review returned HTTP ${reviewResponse.status}.`,
        "Inspect review workflow permissions and validation.",
        reviewResponse.status,
        reviewResponse.json,
      );
    }
    const item = reviewResponse.json.item || {};
    if (trim(item.status) !== "Active" && trim(item.status) !== "Review Due") {
      return fail("review", `Expected Active after no-change review, got ${item.status}.`, "Inspect review outcome handling.");
    }
    if (trim(item.version) !== "1.0") {
      return fail("review", "Version changed unexpectedly during no-change review.", "Inspect review version rules.");
    }
    const reviews = reviewResponse.json.reviews || [];
    if (!reviews.some((entry) => String(entry.summary || "").includes("Production smoke verification review"))) {
      return fail("review", "Review history missing the new verification review.", "Inspect review persistence.");
    }
    pass("review");
    return null;
  });
  if (reviewFail) {
    return reviewFail;
  }

  const newVersionSkipped = await runStage("newVersion", async () => {
    skip(
      "newVersion",
      "Safe multi-version verification cleanup is not implemented for Phase 3.3; major version workflow skipped.",
    );
    return null;
  });
  if (newVersionSkipped) {
    return newVersionSkipped;
  }

  const dashboardFail = await runStage("dashboard", async () => {
    const overview = await request("GET", healthSafetyOverviewPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "dashboard",
    });
    if (overview.status !== 200 || overview.json?.ok !== true) {
      return fail(
        "dashboard",
        `Dashboard/overview check returned HTTP ${overview.status}.`,
        "Inspect health-safety overview metrics.",
        overview.status,
        overview.json,
      );
    }
    if (overviewMentionsVerificationAssessment(overview.json, riskAssessmentId)) {
      return fail(
        "dashboard",
        "Verification assessment still appears in operational dashboard attention items.",
        "Ensure verification rows are excluded from operational metrics.",
        overview.status,
        overview.json,
      );
    }
    const activeVerification = (overview.json?.riskAssessments || []).filter((item) =>
      isActiveVerificationRiskAssessment(item),
    );
    if (activeVerification.length > 0 && activeVerification.some((item) => item.id === riskAssessmentId)) {
      return fail(
        "dashboard",
        "Active verification assessment still included in overview risk assessment list.",
        "Filter verification assessments from operational overview payloads.",
        overview.status,
        overview.json,
      );
    }
    pass("dashboard");
    return null;
  });
  if (dashboardFail) {
    return dashboardFail;
  }

  const cleanupFail = await runStage("cleanup", async () => {
    const cleanup = await attemptVerificationRiskAssessmentCleanup(request, workflowContext);
    if (!cleanup.ok) {
      return fail(
        "cleanup",
        "Verification cleanup did not succeed.",
        "Inspect POST /api/companies/:id/risk-assessments/verification-cleanup and single-assessment cleanup.",
        500,
        cleanup,
      );
    }

    const listAfterCleanup = await fetchCompanyRiskAssessments(request, companyFolderId, masterSheetId, "cleanup");
    const remaining = (listAfterCleanup.json?.items || []).filter((item) => isActiveVerificationRiskAssessment(item));
    if (remaining.length > 0) {
      return fail(
        "cleanup",
        `Active verification risk assessments remain after cleanup (${remaining.length}).`,
        "Inspect verification cleanup archive behaviour.",
        listAfterCleanup.status,
        { remainingIds: remaining.map((item) => item.id) },
      );
    }
    pass("cleanup");
    return null;
  });
  if (cleanupFail) {
    return cleanupFail;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
}
