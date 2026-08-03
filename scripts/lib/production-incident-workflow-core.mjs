/**
 * Production Incident workflow checks — shared by live verifier and unit tests.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  buildProductionVerificationIncident,
  buildProductionVerificationIncidentId,
  countIncidentBaselines,
  findIncidentById,
  isActiveVerificationIncident,
  isOpenOperationalIncident,
  isOperationalIncident,
  isVerificationIncident,
  listActiveVerificationIncidents,
  PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_INCIDENT_DESCRIPTION,
  PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY,
  PRODUCTION_VERIFICATION_INCIDENT_RIDDOR_REASON,
  PRODUCTION_VERIFICATION_INCIDENT_TYPE,
} from "../../shared/production-verification-incident.mjs";
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

export { loadSmokeConfig, performProductionSmokeLogin, maskEmail };

export const INCIDENT_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_INCIDENT_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  incidentsApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createIncident: 120_000,
  readback: 60_000,
  editIncident: 120_000,
  evidence: 120_000,
  investigation: 120_000,
  riddorDecision: 120_000,
  correctiveAction: 120_000,
  statusProgression: 120_000,
  closeIncident: 120_000,
  detailVerification: 60_000,
  healthSafetyOverview: 60_000,
  dashboard: 60_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "incidentsApi",
  "baseline",
  "staleCleanup",
  "createIncident",
  "readback",
  "editIncident",
  "evidence",
  "investigation",
  "riddorDecision",
  "correctiveAction",
  "statusProgression",
  "closeIncident",
  "detailVerification",
  "healthSafetyOverview",
  "dashboard",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  incidentsApi: "Incidents API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createIncident: "Create Incident",
  readback: "Readback",
  editIncident: "Edit Incident",
  evidence: "Evidence",
  investigation: "Investigation",
  riddorDecision: "RIDDOR Decision",
  correctiveAction: "Corrective Action",
  statusProgression: "Status Progression",
  closeIncident: "Close Incident",
  detailVerification: "Detail Verification",
  healthSafetyOverview: "H&S Overview",
  dashboard: "Dashboard",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createIncident",
  "readback",
  "editIncident",
  "evidence",
  "investigation",
  "riddorDecision",
  "correctiveAction",
  "statusProgression",
  "closeIncident",
  "detailVerification",
  "healthSafetyOverview",
  "dashboard",
  "cleanup",
]);

const ALLOWED_INCIDENT_STATUS_TRANSITIONS = {
  Open: new Set(["Under Investigation", "Closed"]),
  "Under Investigation": new Set(["Closed"]),
  Closed: new Set([]),
};

const REPORT_LABEL_WIDTH = 24;

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeIdentity(value) {
  return trim(value).toLowerCase().replace(/\s+/g, " ");
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

function incidentsPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/incidents`, masterSheetId);
}

function incidentDetailPath(companyFolderId, incidentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}`,
    masterSheetId,
  );
}

function healthSafetyOverviewPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/health-safety/overview`, masterSheetId);
}

function dashboardPath(companyFolderId, masterSheetId, refresh = false) {
  const base = withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live`,
    masterSheetId,
  );
  return refresh ? `${base}&refresh=1` : base;
}

function isAllowedIncidentStatusTransition(fromStatus, toStatus) {
  const from = trim(fromStatus);
  const to = trim(toStatus);
  if (normalizeStatus(from) === normalizeStatus(to)) {
    return true;
  }
  const allowed = ALLOWED_INCIDENT_STATUS_TRANSITIONS[from];
  return Boolean(allowed?.has(to));
}

function incidentDetailRecord(response) {
  return response?.json?.incident || {};
}

function incidentAlreadyVisible(detailResponse, incidentId) {
  return detailResponse?.status === 200 && detailResponse?.json?.ok === true && trim(detailResponse?.json?.incidentId) === trim(incidentId);
}

function investigationAlreadyRecorded(detailResponse) {
  const incident = incidentDetailRecord(detailResponse);
  const notes = trim(incident.investigationNotes || incident.InvestigationNotes);
  const status = trim(incident.status || incident.Status);
  return (
    notes.includes(PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY) &&
    normalizeStatus(status) === "under investigation"
  );
}

function incidentAlreadyClosed(detailResponse) {
  const incident = incidentDetailRecord(detailResponse);
  return normalizeStatus(incident.status || incident.Status) === "closed";
}

function editAlreadyApplied(detailResponse) {
  const incident = incidentDetailRecord(detailResponse);
  return String(incident.description || incident.Description || "").includes("Updated during edit incident.");
}

async function recoverIncidentFromDetail(request, companyFolderId, masterSheetId, incidentId, stageKey, predicate) {
  const detail = await request("GET", incidentDetailPath(companyFolderId, incidentId, masterSheetId), undefined, { stageKey });
  if (detail.status === 200 && predicate(detail)) {
    return { response: detail, recoveredFromDetail: true };
  }
  return null;
}

async function postCreateWithTransientRecovery(request, companyFolderId, masterSheetId, body, incidentId, options = {}) {
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/incidents`;
  const stageKey = options.stageKey || "createIncident";
  const attempts = [];
  try {
    const retried = await requestWithTransientRetries(request, "POST", path, body, { stageKey, maxRetries: 2 });
    attempts.push(...(retried.attempts || []));
    const response = retried.response;
    if (response?.status === 200 && response?.json?.ok === true) {
      return { response, attempts, recovered: retried.retried === true };
    }
    if (isTransientWorkflowFailure(response)) {
      const recovered = await recoverIncidentFromDetail(
        request,
        companyFolderId,
        masterSheetId,
        incidentId,
        stageKey,
        (detail) => incidentAlreadyVisible(detail, incidentId),
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    return { response, attempts, recovered: false };
  } catch (error) {
    if (isStageTimeoutError(error)) {
      throw error;
    }
    if (isTransientNetworkError(error)) {
      const recovered = await recoverIncidentFromDetail(
        request,
        companyFolderId,
        masterSheetId,
        incidentId,
        stageKey,
        (detail) => incidentAlreadyVisible(detail, incidentId),
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    throw error;
  }
}

async function patchIncidentWithTransientRecovery(
  request,
  companyFolderId,
  masterSheetId,
  incidentId,
  body,
  options = {},
) {
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}`;
  const stageKey = options.stageKey || "editIncident";
  const recoverPredicate = options.recoverPredicate || (() => false);
  const attempts = [];
  try {
    const retried = await requestWithTransientRetries(request, "PATCH", path, body, { stageKey, maxRetries: 2 });
    attempts.push(...(retried.attempts || []));
    const response = retried.response;
    if (response?.status === 200 && response?.json?.ok === true) {
      return { response, attempts, recovered: retried.retried === true };
    }
    if (isTransientWorkflowFailure(response)) {
      const recovered = await recoverIncidentFromDetail(
        request,
        companyFolderId,
        masterSheetId,
        incidentId,
        stageKey,
        recoverPredicate,
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    return { response, attempts, recovered: false };
  } catch (error) {
    if (isStageTimeoutError(error)) {
      throw error;
    }
    if (isTransientNetworkError(error)) {
      const recovered = await recoverIncidentFromDetail(
        request,
        companyFolderId,
        masterSheetId,
        incidentId,
        stageKey,
        recoverPredicate,
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    throw error;
  }
}

async function postCloseWithTransientRecovery(request, companyFolderId, masterSheetId, incidentId, body, options = {}) {
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}/close`;
  const stageKey = options.stageKey || "closeIncident";
  const attempts = [];
  try {
    const retried = await requestWithTransientRetries(request, "POST", path, body, { stageKey, maxRetries: 2 });
    attempts.push(...(retried.attempts || []));
    const response = retried.response;
    if (response?.status === 200 && response?.json?.ok === true) {
      return { response, attempts, recovered: retried.retried === true };
    }
    if (isTransientWorkflowFailure(response)) {
      const recovered = await recoverIncidentFromDetail(
        request,
        companyFolderId,
        masterSheetId,
        incidentId,
        stageKey,
        incidentAlreadyClosed,
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    return { response, attempts, recovered: false };
  } catch (error) {
    if (isStageTimeoutError(error)) {
      throw error;
    }
    if (isTransientNetworkError(error)) {
      const recovered = await recoverIncidentFromDetail(
        request,
        companyFolderId,
        masterSheetId,
        incidentId,
        stageKey,
        incidentAlreadyClosed,
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    throw error;
  }
}

export function loadIncidentWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowIncidentMutation =
    trim(env.BERT_SMOKE_ALLOW_INCIDENT_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_INCIDENT_MUTATION).toLowerCase() === "true";
  const reviewerUsername = trim(env.BERT_SMOKE_INCIDENT_REVIEWER_USERNAME);
  const reviewerPassword = trim(env.BERT_SMOKE_INCIDENT_REVIEWER_PASSWORD);
  const reviewerExpectedEmail = trim(env.BERT_SMOKE_INCIDENT_REVIEWER_EXPECTED_EMAIL).toLowerCase();
  return {
    ...base,
    allowIncidentMutation,
    reviewerUsername,
    reviewerPassword,
    reviewerExpectedEmail,
    hasReviewerCredentials: Boolean(reviewerUsername && reviewerPassword),
    totalBudgetMs: INCIDENT_VERIFIER_BUDGET_MS,
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

export function formatIncidentWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Incident Workflow",
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
  if (result.incidentId) {
    lines.push(`Incident ID: ${result.incidentId}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
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

export async function fetchCompanyIncidents(request, companyFolderId, masterSheetId, stageKey = "incidentsApi") {
  const response = await request("GET", incidentsPath(companyFolderId, masterSheetId), undefined, { stageKey });
  assertResponseSafe(response.json, "incidents list");
  return response;
}

export async function pollIncidentDetailForId(request, companyFolderId, masterSheetId, incidentId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "readback";
  const attempts = [];
  let lastDetailResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastDetailResponse = await request(
      "GET",
      incidentDetailPath(companyFolderId, incidentId, masterSheetId),
      undefined,
      { stageKey },
    );
    assertResponseSafe(lastDetailResponse.json, "incident detail poll");
    const found = incidentAlreadyVisible(lastDetailResponse, incidentId);
    attempts.push({
      attempt,
      status: lastDetailResponse.status,
      ok: lastDetailResponse.json?.ok === true,
      found,
      returnedStatus: trim(lastDetailResponse.json?.incident?.status) || null,
    });
    if (found) {
      return { ok: true, detailResponse: lastDetailResponse, attempts };
    }
  }
  return { ok: false, detailResponse: lastDetailResponse, attempts };
}

export async function pollIncidentListForId(request, companyFolderId, masterSheetId, incidentId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "readback";
  const attempts = [];
  let matches = [];
  let lastListResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastListResponse = await fetchCompanyIncidents(request, companyFolderId, masterSheetId, stageKey);
    const incidents = Array.isArray(lastListResponse.json?.incidents) ? lastListResponse.json.incidents : [];
    matches = incidents.filter((item) => trim(item.incidentId || item.id) === trim(incidentId));
    attempts.push({
      attempt,
      status: lastListResponse.status,
      itemCount: incidents.length,
      matchCount: matches.length,
    });
    if (matches.length === 1) {
      return { ok: true, matches, attempts, listResponse: lastListResponse };
    }
  }
  return { ok: false, matches, attempts, listResponse: lastListResponse };
}

export async function attemptVerificationIncidentCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationIncidentId = trim(context.verificationIncidentId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_INCIDENT_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({
      kind: "bulk",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (verificationIncidentId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(verificationIncidentId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_INCIDENT_STAGE_TIMEOUTS_MS.cleanup },
      );
      results.push({
        kind: "single",
        incidentId: verificationIncidentId,
        ok: single.json?.ok === true,
        status: single.status,
      });
    } catch (error) {
      results.push({
        kind: "single",
        incidentId: verificationIncidentId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: results.some((item) => item.ok) && (!verificationIncidentId || results.some((item) => item.kind === "single" && item.ok)), results };
}

function overviewMentionsVerificationIncident(payload, incidentId) {
  const id = trim(incidentId);
  if (!id) {
    return false;
  }
  const attention = Array.isArray(payload?.attention) ? payload.attention : [];
  if (attention.some((item) => trim(item?.recordId) === id || String(item?.id || "").includes(id))) {
    return true;
  }
  const incidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
  return incidents.some((item) => trim(item?.id || item?.incidentId) === id);
}

function incidentAppearsInDashboard(payload = {}, incidentId = "") {
  const id = trim(incidentId);
  if (!id) {
    return false;
  }
  const actToday = Array.isArray(payload.actToday) ? payload.actToday : [];
  return actToday.some((item) => {
    const itemId = trim(item?.id || "");
    return itemId.includes(id) || itemId === `incident-${id}`;
  });
}

export async function runProductionIncidentWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationIncidentId: "",
  };
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[incident-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || INCIDENT_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_INCIDENT_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationIncidentCleanup(request, workflowContext));
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

  let login = null;
  let incidents = [];
  let createResponseSnapshot = null;
  let baselineOverviewOpenIncidents = null;
  let mustRunCleanup = false;
  let deferredFailure = null;

  const fail = (key, reason, remediation = "", httpStatus = 0, responseBody = null, extra = {}) => {
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    result.checks[key] = { status: "FAIL" };
    Object.assign(result, extra);
    if (!mustRunCleanup || key === "cleanup") {
      for (const checkKey of CHECK_KEYS) {
        if (result.checks[checkKey].status === "PENDING") {
          result.checks[checkKey] = { status: "SKIP" };
        }
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

  async function runPostCreateStage(stageKey, fn) {
    if (deferredFailure) {
      skip(stageKey, `Skipped after ${deferredFailure.failedStage} failure.`);
      return null;
    }
    const stageResult = await runStage(stageKey, fn);
    if (stageResult?.failedKey) {
      if (mustRunCleanup) {
        if (!deferredFailure) {
          deferredFailure = {
            failedKey: stageResult.failedKey,
            failedStage: stageResult.failedStage,
            failureReason: stageResult.failureReason,
            remediation: stageResult.remediation,
            httpStatus: stageResult.httpStatus,
            safeResponseBody: stageResult.safeResponseBody,
          };
        }
        return null;
      }
      return stageResult;
    }
    return null;
  }

  async function runMandatoryCleanupStage() {
    const cleanupResult = await runStage("cleanup", async () => {
      const cleanup = await attemptVerificationIncidentCleanup(request, workflowContext);
      if (!cleanup.ok) {
        return fail(
          "cleanup",
          "Verification cleanup did not succeed.",
          "Inspect POST /api/companies/:id/incidents/verification-cleanup and single-incident cleanup.",
          500,
          cleanup,
        );
      }

      const listAfterCleanup = await fetchCompanyIncidents(request, companyFolderId, masterSheetId, "cleanup");
      const remaining = listActiveVerificationIncidents(listAfterCleanup.json?.incidents || []);
      if (remaining.length > 0) {
        return fail(
          "cleanup",
          `Active verification incidents remain after cleanup (${remaining.length}).`,
          "Inspect verification cleanup archive behaviour.",
          listAfterCleanup.status,
          { remainingIds: remaining.map((item) => trim(item.incidentId || item.id)) },
        );
      }
      const cleaned = findIncidentById(listAfterCleanup.json?.incidents || [], verificationIncidentId);
      const cleanedStatus = normalizeIdentity(cleaned?.status || "");
      if (
        cleaned &&
        cleanedStatus !== PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS &&
        cleanedStatus !== "closed"
      ) {
        return fail(
          "cleanup",
          `Verification incident was not marked cleaned (status="${cleaned?.status}").`,
          "Inspect verification-cleaned status handling.",
          cleanup.results?.find((item) => item.kind === "single")?.status,
          cleaned,
        );
      }
      pass("cleanup");
      return null;
    });
    return cleanupResult;
  }

  async function finalizeMutationWorkflow() {
    if (!deferredFailure) {
      const searchSkipped = await runStage("search", async () => {
        skip("search", "Global search is built client-side from cached workbook data; no safe server-side search API exists.");
        return null;
      });
      if (searchSkipped) {
        return searchSkipped;
      }
    } else if (result.checks.search.status === "PENDING") {
      await runStage("search", async () => {
        skip("search", `Skipped after ${deferredFailure.failedStage} failure.`);
        return null;
      });
    }

    if (mustRunCleanup) {
      const cleanupResult = await runMandatoryCleanupStage();
      if (deferredFailure) {
        if (cleanupResult?.failedKey) {
          deferredFailure.cleanupAlsoFailed = true;
          deferredFailure.cleanupFailureReason = cleanupResult.failureReason;
        }
        return {
          ...result,
          ...deferredFailure,
          checks: { ...result.checks },
          durationMs: Date.now() - startedAt,
        };
      }
      if (cleanupResult) {
        return cleanupResult;
      }
    } else if (result.checks.cleanup.status === "PENDING") {
      skip("cleanup");
    }

    return null;
  }

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
  const verificationIncidentId = buildProductionVerificationIncidentId(runId);
  result.incidentId = verificationIncidentId;
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;
  workflowContext.verificationIncidentId = verificationIncidentId;

  const incidentsApiFail = await runStage("incidentsApi", async () => {
    let listResponse;
    try {
      listResponse = await fetchCompanyIncidents(request, companyFolderId, masterSheetId, "incidentsApi");
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "incidentsApi",
        `Incidents list request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:companyFolderId/incidents.",
      );
    }
    if (listResponse.status !== 200 || listResponse.json?.ok !== true) {
      return fail(
        "incidentsApi",
        `Incidents API returned HTTP ${listResponse.status}.`,
        "Inspect folder-first Incidents read route and workbook tab access.",
        listResponse.status,
        listResponse.json,
      );
    }
    if (!Array.isArray(listResponse.json?.incidents)) {
      return fail(
        "incidentsApi",
        "Incidents API response is missing the incidents array.",
        "Inspect GET /api/companies/:companyFolderId/incidents response shape.",
        listResponse.status,
        listResponse.json,
      );
    }
    incidents = listResponse.json.incidents;
    pass("incidentsApi");
    return null;
  });
  if (incidentsApiFail) {
    return incidentsApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    result.baseline = countIncidentBaselines(incidents);
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
    baselineOverviewOpenIncidents = Number(overviewResponse.json?.metrics?.openIncidents);
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowIncidentMutation) {
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
        `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/verification-cleanup`,
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
        "Inspect POST /api/companies/:id/incidents/verification-cleanup.",
      );
    }
    assertResponseSafe(staleCleanup.json, "stale cleanup");
    if (staleCleanup.status !== 200 || staleCleanup.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup rejected (HTTP ${staleCleanup.status}).`,
        "Inspect verification incident marker matching and cleanup permissions.",
        staleCleanup.status,
        staleCleanup.json,
      );
    }

    const refreshed = await fetchCompanyIncidents(request, companyFolderId, masterSheetId, "staleCleanup");
    if (refreshed.status === 200 && Array.isArray(refreshed.json?.incidents)) {
      incidents = refreshed.json.incidents;
    }
    if (listActiveVerificationIncidents(incidents).filter((item) => trim(item.incidentId || item.id) !== verificationIncidentId).length > 0) {
      return fail(
        "staleCleanup",
        "Active verification incidents remain after stale cleanup.",
        "Inspect cleanupStaleVerificationIncidents and verification marker matching.",
        staleCleanup.status,
        { activeCount: listActiveVerificationIncidents(incidents).length },
      );
    }
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) {
    return staleCleanupFail;
  }

  const verificationPayload = buildProductionVerificationIncident({
    runId,
    incidentId: verificationIncidentId,
    reporterName: login.user?.name || login.userName || config.username,
    reporterEmail: login.accountEmail || config.expectedEmail,
  });

  const createIncidentFail = await runStage("createIncident", async () => {
    let createResult;
    try {
      createResult = await postCreateWithTransientRecovery(
        request,
        companyFolderId,
        masterSheetId,
        {
          ...verificationPayload,
          companyFolderId,
          masterSheetId,
        },
        verificationIncidentId,
        { stageKey: "createIncident" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "createIncident",
        `Create incident request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/incidents.",
      );
    }

    const createResponse = createResult.response;
    if (createResult.recoveredFromDetail) {
      createResponseSnapshot = {
        status: createResponse.status,
        json: {
          ok: true,
          incidentId: verificationIncidentId,
          alreadyExists: true,
          recoveredFromDetail: true,
        },
      };
    } else {
      createResponseSnapshot = createResponse;
    }

    assertResponseSafe(createResponseSnapshot.json, "create incident");
    if (createResponseSnapshot.status !== 200 || createResponseSnapshot.json?.ok !== true) {
      return fail(
        "createIncident",
        `Create incident rejected (HTTP ${createResponseSnapshot.status}).`,
        "Inspect Incidents write path and smoke reporter fields.",
        createResponseSnapshot.status,
        createResponseSnapshot.json,
      );
    }
    const returnedId = trim(createResponseSnapshot.json?.incidentId || createResponseSnapshot.json?.incident?.incidentId);
    if (returnedId && returnedId !== verificationIncidentId) {
      return fail(
        "createIncident",
        `Expected verification IncidentId ${verificationIncidentId}, got ${returnedId || "(missing)"}.`,
        "Inspect verification ID acceptance in submitCompanyIncident.",
        createResponseSnapshot.status,
        createResponseSnapshot.json,
      );
    }
    pass("createIncident");
    mustRunCleanup = true;
    workflowContext.verificationIncidentId = verificationIncidentId;
    return null;
  });
  if (createIncidentFail) {
    return createIncidentFail;
  }

  const readbackFail = await runPostCreateStage("readback", async () => {
    const updatedRows = Number(createResponseSnapshot?.json?.updatedRows);
    if (Number.isFinite(updatedRows) && updatedRows <= 0 && !createResponseSnapshot?.json?.alreadyExists) {
      return fail(
        "readback",
        "Create incident returned zero updatedRows acknowledgement.",
        "Inspect Incidents append write path and Google row acknowledgement.",
        createResponseSnapshot.status,
        createResponseSnapshot.json,
      );
    }

    const detailPolled = await pollIncidentDetailForId(request, companyFolderId, masterSheetId, verificationIncidentId, {
      stageKey: "readback",
      maxAttempts: Number(options.listPollMaxAttempts) || 15,
      intervalMs: Number(options.listPollIntervalMs) || 1000,
    });
    if (!detailPolled.ok) {
      return fail(
        "readback",
        "Created verification incident was not retrievable from the detail endpoint.",
        "Inspect create write path and GET /api/companies/:id/incidents/:incidentId.",
        detailPolled.detailResponse?.status,
        { pollAttempts: detailPolled.attempts },
      );
    }

    const listPolled = await pollIncidentListForId(request, companyFolderId, masterSheetId, verificationIncidentId, {
      stageKey: "readback",
      maxAttempts: Number(options.listPollMaxAttempts) || 15,
      intervalMs: Number(options.listPollIntervalMs) || 1000,
    });
    if (!listPolled.ok || listPolled.matches.length !== 1) {
      return fail(
        "readback",
        `Expected exactly one verification incident in list, found ${listPolled.matches.length}.`,
        "Inspect Incidents list cache invalidation after create.",
        listPolled.listResponse?.status,
        { pollAttempts: listPolled.attempts },
      );
    }

    const created = listPolled.matches[0];
    if (normalizeStatus(created.status) !== "open") {
      return fail("readback", `Expected Open status, got "${created.status}".`, "Inspect created incident defaults.");
    }
    if (normalizeIdentity(created.incidentType || created.type) !== normalizeIdentity(PRODUCTION_VERIFICATION_INCIDENT_TYPE)) {
      return fail("readback", "Verification incident type does not match Near Miss.", "Inspect incident field mapping.");
    }
    if (listActiveVerificationIncidents(listPolled.listResponse?.json?.incidents || []).length !== 1) {
      return fail(
        "readback",
        "Expected exactly one active verification incident after create.",
        "Inspect duplicate verification incident prevention.",
        listPolled.listResponse?.status,
        { activeCount: listActiveVerificationIncidents(listPolled.listResponse?.json?.incidents || []).length },
      );
    }
    pass("readback");
    return null;
  });
  if (readbackFail) {
    return readbackFail;
  }

  const editIncidentFail = await runPostCreateStage("editIncident", async () => {
    let editResult;
    try {
      editResult = await patchIncidentWithTransientRecovery(
        request,
        companyFolderId,
        masterSheetId,
        verificationIncidentId,
        {
          description: `${PRODUCTION_VERIFICATION_INCIDENT_DESCRIPTION} Updated during edit incident.`,
          location: "Verification area — bay 2",
          immediateAction: "Area inspected; no operational action required.",
          masterSheetId,
        },
        {
          stageKey: "editIncident",
          recoverPredicate: editAlreadyApplied,
        },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "editIncident",
        `Edit incident request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect PATCH /api/companies/:companyFolderId/incidents/:incidentId.",
      );
    }

    const editResponse = editResult.response;
    if (!editResult.recoveredFromDetail) {
      assertResponseSafe(editResponse.json, "edit incident");
      if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
        return fail(
          "editIncident",
          `Edit incident rejected (HTTP ${editResponse.status}).`,
          "Inspect Incidents patch route and field mapping.",
          editResponse.status,
          editResponse.json,
        );
      }
      const patchUpdatedRows = Number(editResponse.json?.updatedRows);
      if (Number.isFinite(patchUpdatedRows) && patchUpdatedRows <= 0 && !editResponse.json?.unchanged) {
        return fail(
          "editIncident",
          "Edit incident returned zero updatedRows acknowledgement.",
          "Inspect Incidents patch write path.",
          editResponse.status,
          editResponse.json,
        );
      }
    }

    const afterEdit = await request(
      "GET",
      incidentDetailPath(companyFolderId, verificationIncidentId, masterSheetId),
      undefined,
      { stageKey: "editIncident" },
    );
    const incident = incidentDetailRecord(afterEdit);
    if (!String(incident.description || "").includes("Updated during edit incident.")) {
      return fail("editIncident", "Edited description did not persist.", "Inspect Incidents patch persistence.");
    }
    if (normalizeStatus(incident.status) !== "open") {
      return fail("editIncident", `Expected Open status after edit, got "${incident.status}".`, "Inspect edit status rules.");
    }
    pass("editIncident");
    return null;
  });
  if (editIncidentFail) {
    return editIncidentFail;
  }

  await runPostCreateStage("evidence", async () => {
    skip(
      "evidence",
      "No safe isolated evidence cleanup path exists; evidence upload would leave verification artefacts in Drive.",
    );
    return null;
  });

  await runPostCreateStage("investigation", async () => {
    let investigationResult;
    try {
      investigationResult = await patchIncidentWithTransientRecovery(
        request,
        companyFolderId,
        masterSheetId,
        verificationIncidentId,
        {
          investigationNotes: PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY,
          rootCause: "Other",
          status: "Under Investigation",
          masterSheetId,
        },
        {
          stageKey: "investigation",
          recoverPredicate: investigationAlreadyRecorded,
        },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "investigation",
        `Investigation update failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect PATCH /api/companies/:companyFolderId/incidents/:incidentId investigation fields.",
      );
    }

    const investigationResponse = investigationResult.response;
    if (!investigationResult.recoveredFromDetail) {
      assertResponseSafe(investigationResponse.json, "investigation");
      if (investigationResponse.status !== 200 || investigationResponse.json?.ok !== true) {
        return fail(
          "investigation",
          `Investigation update rejected (HTTP ${investigationResponse.status}).`,
          "Inspect Incidents investigation patch and status transition rules.",
          investigationResponse.status,
          investigationResponse.json,
        );
      }
    }

    const afterInvestigation = await request(
      "GET",
      incidentDetailPath(companyFolderId, verificationIncidentId, masterSheetId),
      undefined,
      { stageKey: "investigation" },
    );
    const incident = incidentDetailRecord(afterInvestigation);
    if (normalizeStatus(incident.status) !== "under investigation") {
      return fail(
        "investigation",
        `Expected Under Investigation status, got "${incident.status}".`,
        "Inspect investigation status transition.",
        afterInvestigation.status,
        incident,
      );
    }
    if (!trim(incident.investigationNotes || "").includes(PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY)) {
      return fail("investigation", "Investigation notes did not persist.", "Inspect investigationNotes field mapping.");
    }
    if (normalizeIdentity(incident.rootCause) !== "other") {
      return fail("investigation", `Expected root cause Other, got "${incident.rootCause}".`, "Inspect rootCause mapping.");
    }
    pass("investigation");
    return null;
  });

  await runPostCreateStage("riddorDecision", async () => {
    let riddorResponse;
    try {
      riddorResponse = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(verificationIncidentId)}/riddor-assessment`,
        {
          furtherInformationRequired: false,
          supportingReason: PRODUCTION_VERIFICATION_INCIDENT_RIDDOR_REASON,
          confirmedDecisionStatus: "not_reportable",
          masterSheetId,
        },
        { stageKey: "riddorDecision" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "riddorDecision",
        `RIDDOR assessment request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/incidents/:incidentId/riddor-assessment.",
      );
    }
    assertResponseSafe(riddorResponse.json, "riddor assessment");
    if (riddorResponse.status !== 200 || riddorResponse.json?.ok !== true) {
      return fail(
        "riddorDecision",
        `RIDDOR assessment rejected (HTTP ${riddorResponse.status}).`,
        "Inspect incident RIDDOR assessment route and permissions.",
        riddorResponse.status,
        riddorResponse.json,
      );
    }
    const item = riddorResponse.json?.item || {};
    if (trim(item.decisionStatus) !== "not_reportable") {
      return fail(
        "riddorDecision",
        `Expected not_reportable decision, got "${item.decisionStatus || "(missing)"}".`,
        "Inspect RIDDOR decision persistence.",
        riddorResponse.status,
        riddorResponse.json,
      );
    }
    if (trim(item.submissionReference)) {
      return fail(
        "riddorDecision",
        "RIDDOR assessment generated a submission reference for a verification near miss.",
        "Ensure verification RIDDOR assessments do not create external submission references.",
        riddorResponse.status,
        riddorResponse.json,
      );
    }
    pass("riddorDecision");
    return null;
  });

  await runPostCreateStage("correctiveAction", async () => {
    skip(
      "correctiveAction",
      "No safe isolated linked corrective Action API exists for incident verification without touching the Actions workflow gate.",
    );
    return null;
  });

  await runPostCreateStage("statusProgression", async () => {
    const detail = await request(
      "GET",
      incidentDetailPath(companyFolderId, verificationIncidentId, masterSheetId),
      undefined,
      { stageKey: "statusProgression" },
    );
    if (detail.status !== 200 || detail.json?.ok !== true) {
      return fail(
        "statusProgression",
        `Status progression detail read returned HTTP ${detail.status}.`,
        "Inspect GET /api/companies/:id/incidents/:incidentId.",
        detail.status,
        detail.json,
      );
    }
    const incident = incidentDetailRecord(detail);
    if (normalizeStatus(incident.status) !== "under investigation") {
      return fail(
        "statusProgression",
        `Expected Under Investigation before close, got "${incident.status}".`,
        "Inspect investigation status transition.",
        detail.status,
        incident,
      );
    }
    if (isAllowedIncidentStatusTransition("Open", "Awaiting Closure")) {
      return fail(
        "statusProgression",
        "Awaiting Closure is incorrectly allowed from Open.",
        "Production incident transitions must not include unsupported Awaiting Closure.",
        detail.status,
        { allowedFromOpen: [...ALLOWED_INCIDENT_STATUS_TRANSITIONS.Open] },
      );
    }
    if (isAllowedIncidentStatusTransition("Under Investigation", "Awaiting Closure")) {
      return fail(
        "statusProgression",
        "Awaiting Closure is incorrectly allowed from Under Investigation.",
        "Production uses Open → Under Investigation → Closed; Awaiting Closure is not supported.",
        detail.status,
        { allowedFromUnderInvestigation: [...ALLOWED_INCIDENT_STATUS_TRANSITIONS["Under Investigation"]] },
      );
    }
    if (!isAllowedIncidentStatusTransition("Under Investigation", "Closed")) {
      return fail(
        "statusProgression",
        "Under Investigation is not ready for close — Closed transition is blocked.",
        "Inspect ALLOWED_INCIDENT_STATUS_TRANSITIONS for Under Investigation.",
        detail.status,
        incident,
      );
    }
    result.statusProgressionNotes =
      "Validated Open → Under Investigation → Closed; Awaiting Closure is not a supported production transition.";
    pass("statusProgression");
    return null;
  });

  await runPostCreateStage("closeIncident", async () => {
    let closeResult;
    try {
      closeResult = await postCloseWithTransientRecovery(
        request,
        companyFolderId,
        masterSheetId,
        verificationIncidentId,
        { masterSheetId },
        { stageKey: "closeIncident" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "closeIncident",
        `Close incident request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/incidents/:incidentId/close.",
      );
    }

    const closeResponse = closeResult.response;
    if (!closeResult.recoveredFromDetail) {
      assertResponseSafe(closeResponse.json, "close incident");
      if (closeResponse.status !== 200 || closeResponse.json?.ok !== true) {
        return fail(
          "closeIncident",
          `Close incident rejected (HTTP ${closeResponse.status}).`,
          "Inspect Incidents close route and closure validation.",
          closeResponse.status,
          closeResponse.json,
        );
      }
    }

    const afterClose = await request(
      "GET",
      incidentDetailPath(companyFolderId, verificationIncidentId, masterSheetId),
      undefined,
      { stageKey: "closeIncident" },
    );
    const closed = incidentDetailRecord(afterClose);
    if (normalizeStatus(closed.status) !== "closed") {
      return fail("closeIncident", `Expected Closed status, got "${closed.status}".`, "Inspect close persistence.");
    }
    if (!trim(closed.closedAt)) {
      return fail("closeIncident", "ClosedAt was not recorded.", "Inspect close timestamp persistence.");
    }

    let repeatClose;
    try {
      repeatClose = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(verificationIncidentId)}/close`,
        { masterSheetId },
        { stageKey: "closeIncident" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail("closeIncident", `Repeated close failed: ${error instanceof Error ? error.message : String(error)}`, "Inspect close idempotency.");
    }
    if (repeatClose.status !== 200 || repeatClose.json?.ok !== true) {
      return fail(
        "closeIncident",
        `Repeated close returned HTTP ${repeatClose.status}.`,
        "Inspect close idempotency handling.",
        repeatClose.status,
        repeatClose.json,
      );
    }
    if (!repeatClose.json?.alreadyClosed && normalizeStatus(repeatClose.json?.incident?.status) !== "closed") {
      return fail("closeIncident", "Repeated close did not return a safe alreadyClosed response.", "Inspect close idempotency.");
    }
    pass("closeIncident");
    return null;
  });

  await runPostCreateStage("detailVerification", async () => {
    const detail = await request(
      "GET",
      incidentDetailPath(companyFolderId, verificationIncidentId, masterSheetId),
      undefined,
      { stageKey: "detailVerification" },
    );
    if (detail.status !== 200 || detail.json?.ok !== true) {
      return fail(
        "detailVerification",
        `Detail verification returned HTTP ${detail.status}.`,
        "Inspect closed incident detail route.",
        detail.status,
        detail.json,
      );
    }
    const incident = incidentDetailRecord(detail);
    if (trim(incident.incidentId || detail.json?.incidentId) !== verificationIncidentId) {
      return fail("detailVerification", "IncidentId mismatch on detail.", "Inspect detail identity mapping.");
    }
    if (normalizeIdentity(incident.incidentType || incident.type) !== normalizeIdentity(PRODUCTION_VERIFICATION_INCIDENT_TYPE)) {
      return fail("detailVerification", "IncidentType mismatch on closed detail.", "Inspect detail field mapping.");
    }
    if (normalizeStatus(incident.status) !== "closed") {
      return fail("detailVerification", `Expected Closed on detail, got "${incident.status}".`, "Inspect close detail readback.");
    }
    if (!trim(incident.investigationNotes || "").includes(PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY)) {
      return fail("detailVerification", "Investigation metadata missing on closed detail.", "Inspect investigation persistence.");
    }
    if (!isVerificationIncident(incident)) {
      return fail("detailVerification", "Verification marker missing on closed detail.", "Inspect verification marker fields.");
    }
    pass("detailVerification");
    return null;
  });

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
    if (!overview.json?.metrics || typeof overview.json.metrics !== "object") {
      return fail(
        "healthSafetyOverview",
        "Overview metrics missing.",
        "Inspect buildHealthSafetyOverviewPayload.",
        overview.status,
        overview.json,
      );
    }
    if (overviewMentionsVerificationIncident(overview.json, verificationIncidentId)) {
      return fail(
        "healthSafetyOverview",
        "Verification incident appears in operational H&S overview attention items.",
        "Ensure isOperationalIncident excludes active verification rows.",
        overview.status,
        overview.json,
      );
    }
    const operationalOverviewIncidents = (overview.json?.incidents || []).filter((item) => isOperationalIncident(item));
    if (operationalOverviewIncidents.some((item) => trim(item.id || item.incidentId) === verificationIncidentId)) {
      return fail(
        "healthSafetyOverview",
        "Verification incident still included in operational overview incident list.",
        "Filter verification incidents from operational overview payloads.",
        overview.status,
        overview.json,
      );
    }
    pass("healthSafetyOverview");
    return null;
  });

  await runPostCreateStage("dashboard", async () => {
    let dashboardResponse;
    try {
      dashboardResponse = await request("GET", dashboardPath(companyFolderId, masterSheetId, true), undefined, {
        stageKey: "dashboard",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "dashboard",
        `Dashboard verification request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/dashboard/live.",
      );
    }
    assertResponseSafe(dashboardResponse.json, "dashboard after workflow");
    if (dashboardResponse.status !== 200 || dashboardResponse.json?.ok !== true) {
      return fail(
        "dashboard",
        `Dashboard verification returned HTTP ${dashboardResponse.status}.`,
        "Inspect live dashboard aggregation.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    if (incidentAppearsInDashboard(dashboardResponse.json, verificationIncidentId)) {
      return fail(
        "dashboard",
        "Verification incident still appears in dashboard Act Today operational items.",
        "Inspect live dashboard exclusion for verification incidents.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    const listAfterClose = await fetchCompanyIncidents(request, companyFolderId, masterSheetId, "dashboard");
    const visibleVerification = findIncidentById(listAfterClose.json?.incidents || [], verificationIncidentId);
    if (visibleVerification) {
      const closedStatus = normalizeStatus(visibleVerification.status);
      if (closedStatus !== "closed" && closedStatus !== PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS) {
        return fail(
          "dashboard",
          `Verification incident in register has unexpected status "${visibleVerification.status}".`,
          "Inspect incident close persistence before dashboard verification.",
          listAfterClose.status,
          { incidentId: verificationIncidentId, status: visibleVerification.status },
        );
      }
      if (isOpenOperationalIncident(visibleVerification)) {
        return fail(
          "dashboard",
          "Open verification incident remains in the operational register view.",
          "Closed verification incidents may remain in the register but must not be operational.",
          listAfterClose.status,
          { incidentId: verificationIncidentId, status: visibleVerification.status },
        );
      }
    }
    if (
      Number.isFinite(baselineOverviewOpenIncidents) &&
      Number.isFinite(dashboardResponse.json?.metrics?.currentIncidents) &&
      dashboardResponse.json.metrics.currentIncidents > baselineOverviewOpenIncidents
    ) {
      return fail(
        "dashboard",
        "Dashboard currentIncidents increased after verification workflow.",
        "Inspect verification incident exclusion from operational dashboard metrics.",
        dashboardResponse.status,
        {
          baselineOpenIncidents: baselineOverviewOpenIncidents,
          currentIncidents: dashboardResponse.json.metrics.currentIncidents,
        },
      );
    }
    pass("dashboard");
    return null;
  });

  const terminalResult = await finalizeMutationWorkflow();
  if (terminalResult) {
    return terminalResult;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
}
