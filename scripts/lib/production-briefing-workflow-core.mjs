/**
 * Production Briefing workflow checks — shared by live verifier and unit tests.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  createFetchTransport,
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  buildProductionVerificationBriefing,
  buildProductionVerificationBriefingId,
  countBriefingBaselines,
  findBriefingById,
  isActiveVerificationBriefing,
  isOperationalBriefing,
  isVerificationBriefing,
  listActiveVerificationBriefings,
  PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
  PRODUCTION_VERIFICATION_BRIEFING_TITLE,
  PRODUCTION_VERIFICATION_BRIEFING_TYPE,
} from "../../shared/production-verification-briefing.mjs";
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

export { performProductionSmokeLogin, maskEmail };

export const BRIEFING_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_BRIEFING_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  briefingsApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createDraft: 120_000,
  readback: 60_000,
  editDraft: 120_000,
  recipientAssignment: 120_000,
  publish: 120_000,
  recipientLogin: 90_000,
  recipientTodo: 60_000,
  read: 120_000,
  acknowledge: 120_000,
  sign: 120_000,
  completion: 60_000,
  notification: 5_000,
  dashboard: 60_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "briefingsApi",
  "baseline",
  "staleCleanup",
  "createDraft",
  "readback",
  "editDraft",
  "recipientAssignment",
  "publish",
  "recipientLogin",
  "recipientTodo",
  "read",
  "acknowledge",
  "sign",
  "completion",
  "notification",
  "dashboard",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  briefingsApi: "Briefings API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createDraft: "Create Draft",
  readback: "Readback",
  editDraft: "Edit Draft",
  recipientAssignment: "Recipient Assignment",
  publish: "Publish",
  recipientLogin: "Recipient Login",
  recipientTodo: "Recipient Todo",
  read: "Read",
  acknowledge: "Acknowledge",
  sign: "Sign",
  completion: "Completion",
  notification: "Notification",
  dashboard: "Dashboard",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createDraft",
  "readback",
  "editDraft",
  "recipientAssignment",
  "publish",
  "recipientLogin",
  "recipientTodo",
  "read",
  "acknowledge",
  "sign",
  "completion",
  "notification",
  "dashboard",
  "search",
  "cleanup",
]);

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

function briefingsTrackerPath(companyFolderId) {
  return `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/tracker`;
}

function briefingsMinePath(companyFolderId) {
  return `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/mine`;
}

function briefingsTodoPath(companyFolderId, limit = 25) {
  return `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/todo?limit=${encodeURIComponent(String(limit))}`;
}

function briefingPath(companyFolderId, briefingId = "") {
  const base = `/api/companies/${encodeURIComponent(companyFolderId)}/briefings`;
  return briefingId ? `${base}/${encodeURIComponent(briefingId)}` : base;
}

function briefingActionPath(companyFolderId, briefingId, action) {
  return `${briefingPath(companyFolderId, briefingId)}/${action}`;
}

function dashboardPath(companyFolderId, masterSheetId, refresh = false) {
  const base = `/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live?masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
  return refresh ? `${base}&refresh=1` : base;
}

function trackerItems(response) {
  return Array.isArray(response?.json?.items) ? response.json.items : [];
}

function mineItems(response) {
  return Array.isArray(response?.json?.items) ? response.json.items : [];
}

function briefingAlreadyVisibleInTracker(trackerResponse, briefingId) {
  if (trackerResponse?.status !== 200 || trackerResponse?.json?.ok !== true) {
    return false;
  }
  return Boolean(findBriefingById(trackerItems(trackerResponse), briefingId));
}

function briefingAlreadyPublishedInTracker(trackerResponse, briefingId) {
  const briefing = findBriefingById(trackerItems(trackerResponse), briefingId);
  if (!briefing) {
    return false;
  }
  const status = normalizeStatus(briefing.status);
  return status === "sent" || status === "active" || status === "published";
}

function recipientItemForBriefing(items, briefingId, recipientEmail = "") {
  const targetId = trim(briefingId).toLowerCase();
  const targetEmail = trim(recipientEmail).toLowerCase();
  return (Array.isArray(items) ? items : []).find((item) => {
    const itemId = trim(item.briefingId || item.briefing?.briefingId).toLowerCase();
    if (itemId !== targetId) {
      return false;
    }
    if (!targetEmail) {
      return true;
    }
    const email = trim(item.recipientEmail || item.email).toLowerCase();
    return email === targetEmail;
  });
}

function recipientReadAlreadyApplied(item) {
  return Boolean(trim(item?.readAt));
}

function recipientAcknowledgedAlreadyApplied(item) {
  return Boolean(trim(item?.acknowledgedAt));
}

function recipientSignedAlreadyApplied(item) {
  return Boolean(trim(item?.signedAt));
}

function editAlreadyApplied(briefing) {
  return String(briefing?.title || "").includes(" (edited)");
}

async function recoverBriefingFromTracker(request, companyFolderId, briefingId, stageKey, predicate) {
  const tracker = await request("GET", briefingsTrackerPath(companyFolderId), undefined, { stageKey });
  if (tracker.status === 200 && predicate(tracker)) {
    return { response: tracker, recoveredFromTracker: true };
  }
  return null;
}

async function recoverRecipientFromMine(request, companyFolderId, briefingId, recipientEmail, stageKey, predicate) {
  const mine = await request("GET", briefingsMinePath(companyFolderId), undefined, { stageKey });
  if (mine.status !== 200 || mine.json?.ok !== true) {
    return null;
  }
  const item = recipientItemForBriefing(mineItems(mine), briefingId, recipientEmail);
  if (item && predicate(item)) {
    return { response: mine, item, recoveredFromMine: true };
  }
  return null;
}

async function postCreateDraftWithTransientRecovery(request, companyFolderId, body, briefingId, options = {}) {
  const path = briefingPath(companyFolderId);
  const stageKey = options.stageKey || "createDraft";
  const attempts = [];
  try {
    const retried = await requestWithTransientRetries(request, "POST", path, body, { stageKey, maxRetries: 2 });
    attempts.push(...(retried.attempts || []));
    const response = retried.response;
    if (response?.status === 200 && response?.json?.ok === true) {
      return { response, attempts, recovered: retried.retried === true };
    }
    if (isTransientWorkflowFailure(response)) {
      const recovered = await recoverBriefingFromTracker(
        request,
        companyFolderId,
        briefingId,
        stageKey,
        (tracker) => briefingAlreadyVisibleInTracker(tracker, briefingId),
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
      const recovered = await recoverBriefingFromTracker(
        request,
        companyFolderId,
        briefingId,
        stageKey,
        (tracker) => briefingAlreadyVisibleInTracker(tracker, briefingId),
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    throw error;
  }
}

async function postPublishWithTransientRecovery(request, companyFolderId, briefingId, options = {}) {
  const path = briefingActionPath(companyFolderId, briefingId, "publish");
  const stageKey = options.stageKey || "publish";
  const attempts = [];
  try {
    const retried = await requestWithTransientRetries(request, "POST", path, {}, { stageKey, maxRetries: 2 });
    attempts.push(...(retried.attempts || []));
    const response = retried.response;
    if (response?.status === 200 && response?.json?.ok === true) {
      return { response, attempts, recovered: retried.retried === true };
    }
    if (isTransientWorkflowFailure(response)) {
      const recovered = await recoverBriefingFromTracker(
        request,
        companyFolderId,
        briefingId,
        stageKey,
        (tracker) => briefingAlreadyPublishedInTracker(tracker, briefingId),
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
      const recovered = await recoverBriefingFromTracker(
        request,
        companyFolderId,
        briefingId,
        stageKey,
        (tracker) => briefingAlreadyPublishedInTracker(tracker, briefingId),
      );
      if (recovered) {
        return { ...recovered, attempts, recovered: true };
      }
    }
    throw error;
  }
}

async function postBriefingActionWithTransientRecovery(
  request,
  companyFolderId,
  briefingId,
  action,
  body,
  recipientEmail,
  options = {},
) {
  const path = briefingActionPath(companyFolderId, briefingId, action);
  const stageKey = options.stageKey || action;
  const recoverPredicate = options.recoverPredicate || (() => false);
  const attempts = [];
  try {
    const retried = await requestWithTransientRetries(request, "POST", path, body, { stageKey, maxRetries: 2 });
    attempts.push(...(retried.attempts || []));
    const response = retried.response;
    if (response?.status === 200 && response?.json?.ok === true) {
      return { response, attempts, recovered: retried.retried === true };
    }
    if (isTransientWorkflowFailure(response)) {
      const recovered = await recoverRecipientFromMine(
        request,
        companyFolderId,
        briefingId,
        recipientEmail,
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
      const recovered = await recoverRecipientFromMine(
        request,
        companyFolderId,
        briefingId,
        recipientEmail,
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

export function loadBriefingWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowBriefingMutation =
    trim(env.BERT_SMOKE_ALLOW_BRIEFING_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_BRIEFING_MUTATION).toLowerCase() === "true";
  const recipientUsername = trim(env.BERT_SMOKE_BRIEFING_RECIPIENT_USERNAME);
  const recipientPassword = trim(env.BERT_SMOKE_BRIEFING_RECIPIENT_PASSWORD);
  const recipientExpectedEmail = trim(env.BERT_SMOKE_BRIEFING_RECIPIENT_EXPECTED_EMAIL).toLowerCase();
  const hasRecipientCredentials = Boolean(recipientUsername && recipientPassword);
  return {
    ...base,
    allowBriefingMutation,
    recipientUsername,
    recipientPassword,
    recipientExpectedEmail,
    hasRecipientCredentials,
    selfRecipientMode: !hasRecipientCredentials,
    totalBudgetMs: BRIEFING_VERIFIER_BUDGET_MS,
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

export function formatBriefingWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Briefing Workflow",
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
  if (result.creatorEmail || result.accountEmail) {
    lines.push(`Creator: ${maskEmail(result.creatorEmail || result.accountEmail)}`);
  }
  if (result.recipientEmail) {
    lines.push(`Recipient: ${maskEmail(result.recipientEmail)}`);
  }
  if (result.briefingId) {
    lines.push(`Briefing ID: ${result.briefingId}`);
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

export async function fetchBriefingsTracker(request, companyFolderId, stageKey = "briefingsApi") {
  const response = await request("GET", briefingsTrackerPath(companyFolderId), undefined, { stageKey });
  assertResponseSafe(response.json, "briefings tracker");
  return response;
}

export async function pollBriefingTrackerForId(request, companyFolderId, briefingId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "readback";
  const attempts = [];
  let lastTrackerResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastTrackerResponse = await fetchBriefingsTracker(request, companyFolderId, stageKey);
    const matches = trackerItems(lastTrackerResponse).filter(
      (item) => trim(item.briefingId || item.id) === trim(briefingId),
    );
    attempts.push({
      attempt,
      status: lastTrackerResponse.status,
      itemCount: trackerItems(lastTrackerResponse).length,
      matchCount: matches.length,
    });
    if (matches.length === 1) {
      return { ok: true, matches, attempts, trackerResponse: lastTrackerResponse };
    }
  }
  return { ok: false, matches: [], attempts, trackerResponse: lastTrackerResponse };
}

export async function attemptVerificationBriefingCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationBriefingId = trim(context.verificationBriefingId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_BRIEFING_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({
      kind: "bulk",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (verificationBriefingId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/${encodeURIComponent(verificationBriefingId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_BRIEFING_STAGE_TIMEOUTS_MS.cleanup },
      );
      results.push({
        kind: "single",
        briefingId: verificationBriefingId,
        ok: single.json?.ok === true,
        status: single.status,
      });
    } catch (error) {
      results.push({
        kind: "single",
        briefingId: verificationBriefingId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: results.some((item) => item.ok) && (!verificationBriefingId || results.some((item) => item.kind === "single" && item.ok)),
    results,
  };
}

function briefingAppearsInDashboard(payload = {}, briefingId = "") {
  const id = trim(briefingId);
  if (!id) {
    return false;
  }
  const actToday = Array.isArray(payload.actToday) ? payload.actToday : [];
  return actToday.some((item) => {
    const itemId = trim(item?.id || "");
    return itemId.includes(id) || itemId.startsWith(`briefing-${id}`);
  });
}

function briefingAppearsInPendingBriefings(payload = {}, briefingId = "", recipientEmail = "") {
  const id = trim(briefingId);
  const email = trim(recipientEmail).toLowerCase();
  const pendingBriefings = Array.isArray(payload.pendingBriefings) ? payload.pendingBriefings : [];
  return pendingBriefings.some((item) => {
    const itemId = trim(item?.id || "");
    const matchesBriefing = itemId.includes(id) || itemId.startsWith(`briefing-${id}`);
    if (!matchesBriefing) {
      return false;
    }
    if (!email) {
      return true;
    }
    return trim(item?.owner || item?.subtitle || "").toLowerCase().includes(email);
  });
}

export async function runProductionBriefingWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId || Date.now();
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationBriefingId: "",
  };
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[briefing-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || BRIEFING_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_BRIEFING_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationBriefingCleanup(request, workflowContext));
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
  let trackerItemsCache = [];
  let createResponseSnapshot = null;
  let baselineDashboardPendingBriefings = null;
  let verificationBriefing = null;
  let mustRunCleanup = false;
  let deferredFailure = null;
  let recipientRequest = request;
  const recipientEmail = trim(config.recipientExpectedEmail || config.expectedEmail).toLowerCase();

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
      const cleanup = await attemptVerificationBriefingCleanup(request, workflowContext);
      if (!cleanup.ok) {
        return fail(
          "cleanup",
          "Verification cleanup did not succeed.",
          "Inspect POST /api/companies/:id/briefings/verification-cleanup and single-briefing cleanup.",
          500,
          cleanup,
        );
      }

      const trackerAfterCleanup = await fetchBriefingsTracker(request, companyFolderId, "cleanup");
      const remaining = listActiveVerificationBriefings(trackerItems(trackerAfterCleanup));
      if (remaining.length > 0) {
        return fail(
          "cleanup",
          `Active verification briefings remain after cleanup (${remaining.length}).`,
          "Inspect verification cleanup archive behaviour.",
          trackerAfterCleanup.status,
          { remainingIds: remaining.map((item) => trim(item.briefingId || item.id)) },
        );
      }
      const cleaned = findBriefingById(trackerItems(trackerAfterCleanup), verificationBriefingId);
      const cleanedStatus = normalizeIdentity(cleaned?.status || "");
      if (
        cleaned &&
        cleanedStatus !== PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS &&
        cleanedStatus !== "sent" &&
        cleanedStatus !== "closed"
      ) {
        return fail(
          "cleanup",
          `Verification briefing was not marked cleaned (status="${cleaned?.status}").`,
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
        skip("search", "Briefings search is client-cache only");
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
    result.creatorEmail = result.accountEmail;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const companyFolderId = trim(login.companyFolderId || config.companyFolderId);
  const masterSheetId = trim(login.masterSheetId || config.masterSheetId);
  const verificationBriefingId = buildProductionVerificationBriefingId(runId);
  result.briefingId = verificationBriefingId;
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;
  workflowContext.verificationBriefingId = verificationBriefingId;

  const briefingsApiFail = await runStage("briefingsApi", async () => {
    let trackerResponse;
    let mineResponse;
    try {
      trackerResponse = await fetchBriefingsTracker(request, companyFolderId, "briefingsApi");
      mineResponse = await request("GET", briefingsMinePath(companyFolderId), undefined, { stageKey: "briefingsApi" });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "briefingsApi",
        `Briefings API request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:companyFolderId/briefings/tracker and /briefings/mine.",
      );
    }
    if (trackerResponse.status !== 200 || trackerResponse.json?.ok !== true) {
      return fail(
        "briefingsApi",
        `Briefings tracker returned HTTP ${trackerResponse.status}.`,
        "Inspect folder-first Briefings tracker route and workbook tab access.",
        trackerResponse.status,
        trackerResponse.json,
      );
    }
    if (!Array.isArray(trackerResponse.json?.items)) {
      return fail(
        "briefingsApi",
        "Briefings tracker response is missing the items array.",
        "Inspect GET /api/companies/:companyFolderId/briefings/tracker response shape.",
        trackerResponse.status,
        trackerResponse.json,
      );
    }
    if (mineResponse.status !== 200 || mineResponse.json?.ok !== true) {
      return fail(
        "briefingsApi",
        `Briefings mine returned HTTP ${mineResponse.status}.`,
        "Inspect GET /api/companies/:companyFolderId/briefings/mine.",
        mineResponse.status,
        mineResponse.json,
      );
    }
    if (!Array.isArray(mineResponse.json?.items)) {
      return fail(
        "briefingsApi",
        "Briefings mine response is missing the items array.",
        "Inspect GET /api/companies/:companyFolderId/briefings/mine response shape.",
        mineResponse.status,
        mineResponse.json,
      );
    }
    trackerItemsCache = trackerItems(trackerResponse);
    pass("briefingsApi");
    return null;
  });
  if (briefingsApiFail) {
    return briefingsApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    result.baseline = countBriefingBaselines(trackerItemsCache);
    let dashboardResponse;
    try {
      dashboardResponse = await request("GET", dashboardPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "baseline",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "baseline",
        `Dashboard baseline request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/dashboard/live.",
      );
    }
    assertResponseSafe(dashboardResponse.json, "dashboard baseline");
    if (dashboardResponse.status !== 200 || dashboardResponse.json?.ok !== true) {
      return fail(
        "baseline",
        `Dashboard baseline returned HTTP ${dashboardResponse.status}.`,
        "Inspect live dashboard service for the smoke company.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    baselineDashboardPendingBriefings = Number(dashboardResponse.json?.metrics?.pendingBriefings);
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowBriefingMutation) {
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
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    let staleCleanup;
    try {
      staleCleanup = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/verification-cleanup`,
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
        "Inspect POST /api/companies/:id/briefings/verification-cleanup.",
      );
    }
    assertResponseSafe(staleCleanup.json, "stale cleanup");
    if (staleCleanup.status !== 200 || staleCleanup.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup rejected (HTTP ${staleCleanup.status}).`,
        "Inspect verification briefing marker matching and cleanup permissions.",
        staleCleanup.status,
        staleCleanup.json,
      );
    }

    const refreshed = await fetchBriefingsTracker(request, companyFolderId, "staleCleanup");
    if (refreshed.status === 200 && Array.isArray(refreshed.json?.items)) {
      trackerItemsCache = trackerItems(refreshed);
    }
    if (
      listActiveVerificationBriefings(trackerItemsCache).filter(
        (item) => trim(item.briefingId || item.id) !== verificationBriefingId,
      ).length > 0
    ) {
      return fail(
        "staleCleanup",
        "Active verification briefings remain after stale cleanup.",
        "Inspect cleanupStaleVerificationBriefings and verification marker matching.",
        staleCleanup.status,
        { activeCount: listActiveVerificationBriefings(trackerItemsCache).length },
      );
    }
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) {
    return staleCleanupFail;
  }

  const verificationPayload = buildProductionVerificationBriefing({
    runId,
    briefingId: verificationBriefingId,
    createdByEmail: login.accountEmail || config.expectedEmail,
    createdByName: login.user?.name || login.userName || config.username,
    requiresSignature: options.requiresSignature !== false,
  });
  verificationBriefing = verificationPayload;

  const createDraftFail = await runStage("createDraft", async () => {
    let createResult;
    try {
      createResult = await postCreateDraftWithTransientRecovery(
        request,
        companyFolderId,
        {
          ...verificationPayload,
          saveAsDraft: true,
        },
        verificationBriefingId,
        { stageKey: "createDraft" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "createDraft",
        `Create draft request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/briefings with saveAsDraft.",
      );
    }

    const createResponse = createResult.response;
    if (createResult.recoveredFromTracker) {
      createResponseSnapshot = {
        status: createResponse.status,
        json: {
          ok: true,
          briefingId: verificationBriefingId,
          alreadyExists: true,
          recoveredFromTracker: true,
        },
      };
    } else {
      createResponseSnapshot = createResponse;
    }

    assertResponseSafe(createResponseSnapshot.json, "create draft");
    if (createResponseSnapshot.status !== 200 || createResponseSnapshot.json?.ok !== true) {
      return fail(
        "createDraft",
        `Create draft rejected (HTTP ${createResponseSnapshot.status}).`,
        "Inspect Briefings draft write path and smoke creator fields.",
        createResponseSnapshot.status,
        createResponseSnapshot.json,
      );
    }
    const returnedId = trim(createResponseSnapshot.json?.briefingId || createResponseSnapshot.json?.briefing?.briefingId);
    if (returnedId && returnedId !== verificationBriefingId) {
      return fail(
        "createDraft",
        `Expected verification BriefingId ${verificationBriefingId}, got ${returnedId || "(missing)"}.`,
        "Inspect verification ID acceptance in createDraftVerificationBriefing.",
        createResponseSnapshot.status,
        createResponseSnapshot.json,
      );
    }
    pass("createDraft");
    mustRunCleanup = true;
    workflowContext.verificationBriefingId = verificationBriefingId;
    return null;
  });
  if (createDraftFail) {
    return createDraftFail;
  }

  const readbackFail = await runPostCreateStage("readback", async () => {
    const updatedRows = Number(createResponseSnapshot?.json?.updatedRows);
    if (Number.isFinite(updatedRows) && updatedRows <= 0 && !createResponseSnapshot?.json?.alreadyExists) {
      return fail(
        "readback",
        "Create draft returned zero updatedRows acknowledgement.",
        "Inspect Briefings append write path and Google row acknowledgement.",
        createResponseSnapshot.status,
        createResponseSnapshot.json,
      );
    }

    const trackerPolled = await pollBriefingTrackerForId(request, companyFolderId, verificationBriefingId, {
      stageKey: "readback",
      maxAttempts: Number(options.listPollMaxAttempts) || 15,
      intervalMs: Number(options.listPollIntervalMs) || 1000,
    });
    if (!trackerPolled.ok || trackerPolled.matches.length !== 1) {
      return fail(
        "readback",
        `Expected exactly one verification briefing in tracker, found ${trackerPolled.matches.length}.`,
        "Inspect Briefings tracker cache invalidation after create.",
        trackerPolled.trackerResponse?.status,
        { pollAttempts: trackerPolled.attempts },
      );
    }

    const created = trackerPolled.matches[0];
    if (normalizeStatus(created.status) !== "draft") {
      return fail("readback", `Expected Draft status, got "${created.status}".`, "Inspect created briefing defaults.");
    }
    if (normalizeIdentity(created.type) !== normalizeIdentity(PRODUCTION_VERIFICATION_BRIEFING_TYPE)) {
      return fail("readback", "Verification briefing type does not match Verification.", "Inspect briefing field mapping.");
    }
    if (!isVerificationBriefing(created)) {
      return fail("readback", "Verification marker missing on created briefing.", "Inspect verification marker fields.");
    }
    if (listActiveVerificationBriefings(trackerItems(trackerPolled.trackerResponse)).length !== 1) {
      return fail(
        "readback",
        "Expected exactly one active verification briefing after create.",
        "Inspect duplicate verification briefing prevention.",
        trackerPolled.trackerResponse?.status,
        { activeCount: listActiveVerificationBriefings(trackerItems(trackerPolled.trackerResponse)).length },
      );
    }
    trackerItemsCache = trackerItems(trackerPolled.trackerResponse);
    pass("readback");
    return null;
  });
  if (readbackFail) {
    return readbackFail;
  }

  const editDraftFail = await runPostCreateStage("editDraft", async () => {
    let editResponse;
    try {
      editResponse = await request(
        "PATCH",
        briefingPath(companyFolderId, verificationBriefingId),
        {
          title: `${PRODUCTION_VERIFICATION_BRIEFING_TITLE} (edited)`,
          masterSheetId,
        },
        { stageKey: "editDraft" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "editDraft",
        `Edit draft request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect PATCH /api/companies/:companyFolderId/briefings/:briefingId.",
      );
    }

    assertResponseSafe(editResponse.json, "edit draft");
    if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
      return fail(
        "editDraft",
        `Edit draft rejected (HTTP ${editResponse.status}).`,
        "Inspect Briefings patch route and field mapping.",
        editResponse.status,
        editResponse.json,
      );
    }
    const patchUpdatedRows = Number(editResponse.json?.updatedRows);
    if (Number.isFinite(patchUpdatedRows) && patchUpdatedRows <= 0 && !editResponse.json?.unchanged) {
      return fail(
        "editDraft",
        "Edit draft returned zero updatedRows acknowledgement.",
        "Inspect Briefings patch write path.",
        editResponse.status,
        editResponse.json,
      );
    }

    const trackerAfterEdit = await fetchBriefingsTracker(request, companyFolderId, "editDraft");
    const edited = findBriefingById(trackerItems(trackerAfterEdit), verificationBriefingId);
    if (!editAlreadyApplied(edited)) {
      return fail("editDraft", "Edited title did not persist.", "Inspect Briefings patch persistence.");
    }
    if (normalizeStatus(edited?.status) !== "draft") {
      return fail("editDraft", `Expected Draft status after edit, got "${edited?.status}".`, "Inspect edit status rules.");
    }
    pass("editDraft");
    return null;
  });
  if (editDraftFail) {
    return editDraftFail;
  }

  const recipientAssignmentFail = await runPostCreateStage("recipientAssignment", async () => {
    let assignResponse;
    try {
      assignResponse = await request(
        "POST",
        briefingActionPath(companyFolderId, verificationBriefingId, "recipients"),
        {
          targetUserEmails: [recipientEmail],
          masterSheetId,
        },
        { stageKey: "recipientAssignment" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "recipientAssignment",
        `Recipient assignment request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/briefings/:briefingId/recipients.",
      );
    }

    assertResponseSafe(assignResponse.json, "recipient assignment");
    if (assignResponse.status !== 200 || assignResponse.json?.ok !== true) {
      return fail(
        "recipientAssignment",
        `Recipient assignment rejected (HTTP ${assignResponse.status}).`,
        "Inspect Briefings recipient assignment route and People/Users tab resolution.",
        assignResponse.status,
        assignResponse.json,
      );
    }
    const trackerAfterAssign = await fetchBriefingsTracker(request, companyFolderId, "recipientAssignment");
    const assigned = findBriefingById(trackerItems(trackerAfterAssign), verificationBriefingId);
    const targetEmails = String(assigned?.targetUserEmails || "")
      .split(",")
      .map((entry) => trim(entry).toLowerCase())
      .filter(Boolean);
    if (!targetEmails.includes(recipientEmail)) {
      return fail(
        "recipientAssignment",
        `Recipient email ${recipientEmail} was not assigned to the verification briefing.`,
        "Inspect targetUserEmails persistence on draft briefings.",
        assignResponse.status,
        assigned,
      );
    }
    pass("recipientAssignment");
    return null;
  });
  if (recipientAssignmentFail) {
    return recipientAssignmentFail;
  }

  const publishFail = await runPostCreateStage("publish", async () => {
    let publishResult;
    try {
      publishResult = await postPublishWithTransientRecovery(request, companyFolderId, verificationBriefingId, {
        stageKey: "publish",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "publish",
        `Publish request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/briefings/:briefingId/publish.",
      );
    }

    const publishResponse = publishResult.response;
    if (!publishResult.recoveredFromTracker) {
      assertResponseSafe(publishResponse.json, "publish");
      if (publishResponse.status !== 200 || publishResponse.json?.ok !== true) {
        return fail(
          "publish",
          `Publish rejected (HTTP ${publishResponse.status}).`,
          "Inspect Briefings publish route and recipient row creation.",
          publishResponse.status,
          publishResponse.json,
        );
      }
    }

    const trackerAfterPublish = await fetchBriefingsTracker(request, companyFolderId, "publish");
    const published = findBriefingById(trackerItems(trackerAfterPublish), verificationBriefingId);
    const publishedStatus = normalizeStatus(published?.status);
    if (publishedStatus !== "sent" && publishedStatus !== "active" && publishedStatus !== "published") {
      return fail(
        "publish",
        `Expected Sent status after publish, got "${published?.status}".`,
        "Inspect publish status transition.",
        publishResponse.status,
        published,
      );
    }
    pass("publish");
    return null;
  });
  if (publishFail) {
    return publishFail;
  }

  const recipientLoginFail = await runPostCreateStage("recipientLogin", async () => {
    result.recipientEmail = recipientEmail;
    if (config.selfRecipientMode) {
      result.selfRecipientMode = true;
      recipientRequest = request;
      pass("recipientLogin");
      return null;
    }

    const rawRecipientTransport =
      typeof options.createRecipientTransport === "function"
        ? options.createRecipientTransport()
        : createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
    const wrappedRecipientTransport = wrapTransportWithTimeouts(rawRecipientTransport, {
      apiBase: config.apiBase,
      getStageKey: () => currentStageKey,
      getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
    });
    const recipientLoginResult = await performProductionSmokeLogin(
      {
        ...config,
        username: config.recipientUsername,
        password: config.recipientPassword,
        expectedEmail: config.recipientExpectedEmail || config.expectedEmail,
      },
      wrappedRecipientTransport,
      options,
    );
    if (!recipientLoginResult.ok) {
      return fail(
        "recipientLogin",
        recipientLoginResult.failureReason || "Recipient login failed.",
        recipientLoginResult.remediation || "Inspect BERT_SMOKE_BRIEFING_RECIPIENT_* credentials.",
        recipientLoginResult.httpStatus,
        recipientLoginResult.responseBody,
      );
    }
    recipientRequest = wrappedRecipientTransport.request.bind(wrappedRecipientTransport);
    result.recipientEmail = trim(recipientLoginResult.accountEmail) || recipientEmail;
    pass("recipientLogin");
    return null;
  });
  if (recipientLoginFail) {
    return recipientLoginFail;
  }

  const recipientTodoFail = await runPostCreateStage("recipientTodo", async () => {
    let todoResponse;
    try {
      todoResponse = await recipientRequest("GET", briefingsTodoPath(companyFolderId), undefined, {
        stageKey: "recipientTodo",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "recipientTodo",
        `Recipient to-do request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:companyFolderId/briefings/todo and /briefings/mine.",
      );
    }
    if (todoResponse.status !== 200 || todoResponse.json?.ok !== true) {
      return fail(
        "recipientTodo",
        `Recipient to-do returned HTTP ${todoResponse.status}.`,
        "Inspect recipient briefing visibility after publish.",
        todoResponse.status,
        todoResponse.json,
      );
    }

    let recipientItem = recipientItemForBriefing(mineItems(todoResponse), verificationBriefingId, recipientEmail);
    if (!recipientItem) {
      const mineResponse = await recipientRequest("GET", briefingsMinePath(companyFolderId), undefined, {
        stageKey: "recipientTodo",
      });
      if (mineResponse.status !== 200 || mineResponse.json?.ok !== true) {
        return fail(
          "recipientTodo",
          `Recipient mine returned HTTP ${mineResponse.status}.`,
          "Inspect GET /api/companies/:companyFolderId/briefings/mine.",
          mineResponse.status,
          mineResponse.json,
        );
      }
      recipientItem = recipientItemForBriefing(mineItems(mineResponse), verificationBriefingId, recipientEmail);
    }

    if (!recipientItem) {
      return fail(
        "recipientTodo",
        "Verification briefing was not visible on the recipient to-do list.",
        "Inspect recipient row creation during publish and recipient email matching.",
        todoResponse.status,
        { briefingId: verificationBriefingId, recipientEmail },
      );
    }
    if (recipientItem.needsAction !== true) {
      return fail(
        "recipientTodo",
        "Recipient to-do item does not require action before read/ack/sign.",
        "Inspect recipientNeedsAction for published verification briefings.",
        todoResponse.status,
        recipientItem,
      );
    }
    pass("recipientTodo");
    return null;
  });
  if (recipientTodoFail) {
    return recipientTodoFail;
  }

  const readFail = await runPostCreateStage("read", async () => {
    let readResult;
    try {
      readResult = await postBriefingActionWithTransientRecovery(
        recipientRequest,
        companyFolderId,
        verificationBriefingId,
        "read",
        {},
        recipientEmail,
        {
          stageKey: "read",
          recoverPredicate: recipientReadAlreadyApplied,
        },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "read",
        `Read request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/briefings/:briefingId/read.",
      );
    }

    const readResponse = readResult.response;
    if (!readResult.recoveredFromMine) {
      assertResponseSafe(readResponse.json, "read");
      if (readResponse.status !== 200 || readResponse.json?.ok !== true) {
        return fail(
          "read",
          `Read rejected (HTTP ${readResponse.status}).`,
          "Inspect Briefings read action route.",
          readResponse.status,
          readResponse.json,
        );
      }
    }

    const mineAfterRead = await recipientRequest("GET", briefingsMinePath(companyFolderId), undefined, { stageKey: "read" });
    const recipientItem = recipientItemForBriefing(mineItems(mineAfterRead), verificationBriefingId, recipientEmail);
    if (!recipientReadAlreadyApplied(recipientItem)) {
      return fail("read", "ReadAt was not recorded for the recipient.", "Inspect read action persistence.");
    }
    pass("read");
    return null;
  });
  if (readFail) {
    return readFail;
  }

  const acknowledgeFail = await runPostCreateStage("acknowledge", async () => {
    let acknowledgeResult;
    try {
      acknowledgeResult = await postBriefingActionWithTransientRecovery(
        recipientRequest,
        companyFolderId,
        verificationBriefingId,
        "acknowledge",
        {},
        recipientEmail,
        {
          stageKey: "acknowledge",
          recoverPredicate: recipientAcknowledgedAlreadyApplied,
        },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "acknowledge",
        `Acknowledge request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/briefings/:briefingId/acknowledge.",
      );
    }

    const acknowledgeResponse = acknowledgeResult.response;
    if (!acknowledgeResult.recoveredFromMine) {
      assertResponseSafe(acknowledgeResponse.json, "acknowledge");
      if (acknowledgeResponse.status !== 200 || acknowledgeResponse.json?.ok !== true) {
        return fail(
          "acknowledge",
          `Acknowledge rejected (HTTP ${acknowledgeResponse.status}).`,
          "Inspect Briefings acknowledge action route.",
          acknowledgeResponse.status,
          acknowledgeResponse.json,
        );
      }
    }

    const mineAfterAck = await recipientRequest("GET", briefingsMinePath(companyFolderId), undefined, {
      stageKey: "acknowledge",
    });
    const recipientItem = recipientItemForBriefing(mineItems(mineAfterAck), verificationBriefingId, recipientEmail);
    if (!recipientAcknowledgedAlreadyApplied(recipientItem)) {
      return fail("acknowledge", "AcknowledgedAt was not recorded for the recipient.", "Inspect acknowledge persistence.");
    }
    pass("acknowledge");
    return null;
  });
  if (acknowledgeFail) {
    return acknowledgeFail;
  }

  const signFail = await runPostCreateStage("sign", async () => {
    const requiresSignature = verificationBriefing?.requiresSignature !== false;
    if (!requiresSignature) {
      skip("sign", "Briefing does not require signature.");
      return null;
    }

    let signResult;
    try {
      signResult = await postBriefingActionWithTransientRecovery(
        recipientRequest,
        companyFolderId,
        verificationBriefingId,
        "sign",
        { signatureName: PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME },
        recipientEmail,
        {
          stageKey: "sign",
          recoverPredicate: recipientSignedAlreadyApplied,
        },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "sign",
        `Sign request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/briefings/:briefingId/sign.",
      );
    }

    const signResponse = signResult.response;
    if (!signResult.recoveredFromMine) {
      assertResponseSafe(signResponse.json, "sign");
      if (signResponse.status !== 200 || signResponse.json?.ok !== true) {
        return fail(
          "sign",
          `Sign rejected (HTTP ${signResponse.status}).`,
          "Inspect Briefings sign action route.",
          signResponse.status,
          signResponse.json,
        );
      }
    }

    const mineAfterSign = await recipientRequest("GET", briefingsMinePath(companyFolderId), undefined, { stageKey: "sign" });
    const recipientItem = recipientItemForBriefing(mineItems(mineAfterSign), verificationBriefingId, recipientEmail);
    if (!recipientSignedAlreadyApplied(recipientItem)) {
      return fail("sign", "SignedAt was not recorded for the recipient.", "Inspect sign persistence.");
    }
    pass("sign");
    return null;
  });
  if (signFail) {
    return signFail;
  }

  const completionFail = await runPostCreateStage("completion", async () => {
    const mineAfterCompletion = await recipientRequest("GET", briefingsMinePath(companyFolderId), undefined, {
      stageKey: "completion",
    });
    if (mineAfterCompletion.status !== 200 || mineAfterCompletion.json?.ok !== true) {
      return fail(
        "completion",
        `Recipient mine returned HTTP ${mineAfterCompletion.status} during completion check.`,
        "Inspect GET /api/companies/:companyFolderId/briefings/mine.",
        mineAfterCompletion.status,
        mineAfterCompletion.json,
      );
    }
    const recipientItem = recipientItemForBriefing(mineItems(mineAfterCompletion), verificationBriefingId, recipientEmail);
    if (!recipientItem) {
      return fail(
        "completion",
        "Recipient assignment missing during completion check.",
        "Inspect recipient row persistence.",
        mineAfterCompletion.status,
        { briefingId: verificationBriefingId, recipientEmail },
      );
    }
    if (recipientItem.needsAction === true) {
      return fail(
        "completion",
        "Recipient still needs action after read/acknowledge/sign.",
        "Inspect recipientNeedsAction completion rules.",
        mineAfterCompletion.status,
        recipientItem,
      );
    }

    const trackerAfterCompletion = await fetchBriefingsTracker(request, companyFolderId, "completion");
    const trackerBriefing = findBriefingById(trackerItems(trackerAfterCompletion), verificationBriefingId);
    if (!trackerBriefing) {
      return fail(
        "completion",
        "Verification briefing missing from tracker during completion check.",
        "Inspect tracker visibility after recipient completion.",
        trackerAfterCompletion.status,
        { briefingId: verificationBriefingId },
      );
    }
    const trackerRecipient = (Array.isArray(trackerBriefing.recipients) ? trackerBriefing.recipients : []).find(
      (entry) => trim(entry.recipientEmail).toLowerCase() === recipientEmail,
    );
    if (!trackerRecipient) {
      return fail(
        "completion",
        "Recipient row missing from tracker during completion check.",
        "Inspect tracker recipient enrichment.",
        trackerAfterCompletion.status,
        trackerBriefing,
      );
    }
    if (trackerRecipient.needsAction === true) {
      return fail(
        "completion",
        "Tracker still shows recipient needs action after completion.",
        "Inspect tracker recipient status aggregation.",
        trackerAfterCompletion.status,
        trackerRecipient,
      );
    }
    const recipientStatus = normalizeStatus(trackerRecipient.status);
    if (recipientStatus !== "complete" && recipientStatus !== "signed") {
      return fail(
        "completion",
        `Expected Complete/Signed tracker status, got "${trackerRecipient.status}".`,
        "Inspect computeRecipientStatus after sign-off.",
        trackerAfterCompletion.status,
        trackerRecipient,
      );
    }
    pass("completion");
    return null;
  });
  if (completionFail) {
    return completionFail;
  }

  const notificationFail = await runPostCreateStage("notification", async () => {
    skip("notification", "Briefings notifications are client-cache derived; no server notification API.");
    return null;
  });
  if (notificationFail) {
    return notificationFail;
  }

  const dashboardFail = await runPostCreateStage("dashboard", async () => {
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
    if (briefingAppearsInDashboard(dashboardResponse.json, verificationBriefingId)) {
      return fail(
        "dashboard",
        "Verification briefing still appears in dashboard Act Today operational items.",
        "Inspect live dashboard exclusion for verification briefings.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    if (briefingAppearsInPendingBriefings(dashboardResponse.json, verificationBriefingId, recipientEmail)) {
      return fail(
        "dashboard",
        "Verification briefing still appears in dashboard pendingBriefings.",
        "Inspect isOperationalBriefing exclusion for verification rows.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }

    const trackerAfterCompletion = await fetchBriefingsTracker(request, companyFolderId, "dashboard");
    const visibleVerification = findBriefingById(trackerItems(trackerAfterCompletion), verificationBriefingId);
    if (visibleVerification && isOperationalBriefing(visibleVerification)) {
      return fail(
        "dashboard",
        "Verification briefing is treated as operational in tracker data.",
        "Ensure isOperationalBriefing excludes verification rows from operational dashboard inputs.",
        trackerAfterCompletion.status,
        { briefingId: verificationBriefingId, status: visibleVerification.status },
      );
    }
    if (
      Number.isFinite(baselineDashboardPendingBriefings) &&
      Number.isFinite(dashboardResponse.json?.metrics?.pendingBriefings) &&
      dashboardResponse.json.metrics.pendingBriefings > baselineDashboardPendingBriefings
    ) {
      return fail(
        "dashboard",
        "Dashboard pendingBriefings increased after verification workflow.",
        "Inspect verification briefing exclusion from operational dashboard metrics.",
        dashboardResponse.status,
        {
          baselinePendingBriefings: baselineDashboardPendingBriefings,
          pendingBriefings: dashboardResponse.json.metrics.pendingBriefings,
        },
      );
    }
    pass("dashboard");
    return null;
  });
  if (dashboardFail) {
    return dashboardFail;
  }

  const terminalResult = await finalizeMutationWorkflow();
  if (terminalResult) {
    return terminalResult;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
}
