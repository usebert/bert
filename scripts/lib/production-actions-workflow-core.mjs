/**
 * Production Actions workflow checks — shared by live verifier and unit tests.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  buildProductionVerificationAction,
  buildProductionVerificationActionId,
  countActionBaselines,
  isActiveVerificationAction,
  isVerificationAction,
  listActiveVerificationActions,
  PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_ACTION_DESCRIPTION,
  PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE,
  PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE,
  PRODUCTION_VERIFICATION_ACTION_TITLE,
} from "../../shared/production-verification-action.mjs";
import {
  buildTimeoutFailureResult,
  createWorkflowDiagnostics,
  DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS,
  isStageTimeoutError,
  TOTAL_VERIFIER_BUDGET_MS,
  wrapTransportWithTimeouts,
} from "./production-workflow-diagnostics.mjs";

export { loadSmokeConfig, performProductionSmokeLogin, maskEmail };
export {
  DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS as ACTIONS_STAGE_TIMEOUTS_MS,
  TOTAL_VERIFIER_BUDGET_MS as ACTIONS_VERIFIER_BUDGET_MS,
};

export const CHECK_KEYS = [
  "authentication",
  "actionsApi",
  "baseline",
  "staleCleanup",
  "createAction",
  "openAction",
  "startAction",
  "progressUpdate",
  "awaitingVerification",
  "verifyClose",
  "dashboard",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  actionsApi: "Actions API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createAction: "Create Action",
  openAction: "Open Action",
  startAction: "Start Action",
  progressUpdate: "Progress Update",
  awaitingVerification: "Awaiting Verification",
  verifyClose: "Verify / Close",
  dashboard: "Dashboard",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createAction",
  "openAction",
  "startAction",
  "progressUpdate",
  "awaitingVerification",
  "verifyClose",
  "dashboard",
  "cleanup",
]);

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeIdentity(value) {
  return trim(value).toLowerCase().replace(/\s+/g, " ");
}

export function loadActionsWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowActionMutation =
    trim(env.BERT_SMOKE_ALLOW_ACTION_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_ACTION_MUTATION).toLowerCase() === "true";
  const reviewerUsername = trim(env.BERT_SMOKE_REVIEWER_USERNAME);
  const reviewerPassword = trim(env.BERT_SMOKE_REVIEWER_PASSWORD);
  const reviewerExpectedEmail = trim(env.BERT_SMOKE_REVIEWER_EXPECTED_EMAIL).toLowerCase();
  return {
    ...base,
    allowActionMutation,
    reviewerUsername,
    reviewerPassword,
    reviewerExpectedEmail,
    hasReviewerCredentials: Boolean(reviewerUsername && reviewerPassword),
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

export function formatActionsWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Actions Workflow",
    "==========================================",
    "",
  ];

  for (const key of CHECK_KEYS) {
    const status = result.checks[key]?.status || "FAIL";
    const label = CHECK_LABELS[key];
    lines.push(`${label.padEnd(22)} ${status}`);
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
  if (result.actionId) {
    lines.push(`Action ID: ${result.actionId}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
  }
  lines.push("");

  if (result.timedOut) {
    lines.push("");
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

function assertResponseSafe(json, label) {
  assertNoPasswordHash(json, label);
  const raw = JSON.stringify(json || {});
  if (/scrypt\$|argon2\$|bcrypt\$/i.test(raw)) {
    throw new Error(`${label} appears to expose a password hash`);
  }
  if (/bert_company_session=/.test(raw)) {
    throw new Error(`${label} appears to expose a session cookie value`);
  }
}

function actionsPath(companyFolderId, masterSheetId) {
  return `/api/companies/${encodeURIComponent(companyFolderId)}/actions?masterSheetId=${encodeURIComponent(masterSheetId)}`;
}

function dashboardPath(companyFolderId, masterSheetId, refresh = false) {
  const suffix = refresh ? "&refresh=1" : "";
  return `/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live?masterSheetId=${encodeURIComponent(masterSheetId)}${suffix}`;
}

export function mergeActionUpdate(actions, updated) {
  const id = trim(updated.id);
  const list = Array.isArray(actions) ? [...actions] : [];
  const index = list.findIndex((action) => trim(action.id) === id);
  const stamp = trim(updated.updatedAt) || new Date().toISOString();
  const next = { ...updated, updatedAt: stamp };
  if (index >= 0) {
    list[index] = { ...list[index], ...next };
    return list;
  }
  return [...list, next];
}

export function findActionById(actions, actionId) {
  const id = trim(actionId);
  return (Array.isArray(actions) ? actions : []).find((action) => trim(action.id) === id) || null;
}

export function dashboardOpenActionsCount(payload = {}) {
  const metrics = payload.metrics || {};
  const candidates = [metrics.openActions, metrics.overdueActions];
  let total = 0;
  let found = false;
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      total += parsed;
      found = true;
    }
  }
  return found ? total : null;
}

export function actionAppearsInDashboard(payload = {}, actionId = "") {
  const id = trim(actionId);
  if (!id) {
    return false;
  }
  const actToday = Array.isArray(payload.actToday) ? payload.actToday : [];
  return actToday.some((item) => {
    const itemId = trim(item?.id || "");
    return itemId.includes(id) || itemId === `action-open-${id}` || itemId === `action-overdue-${id}`;
  });
}

export async function fetchCompanyActions(request, companyFolderId, masterSheetId, stageKey = "actionsApi") {
  const response = await request("GET", actionsPath(companyFolderId, masterSheetId), undefined, { stageKey });
  assertResponseSafe(response.json, "actions list");
  return response;
}

export async function saveCompanyActions(request, companyFolderId, masterSheetId, actions, stageKey = "createAction") {
  return request(
    "POST",
    `/api/companies/${encodeURIComponent(companyFolderId)}/actions`,
    {
      companyFolderId,
      masterSheetId,
      actions,
    },
    { stageKey },
  );
}

export async function attemptVerificationActionsCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationActionId = trim(context.verificationActionId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/actions/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({
      kind: "bulk",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (verificationActionId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/actions/${encodeURIComponent(verificationActionId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS.cleanup },
      );
      results.push({
        kind: "single",
        actionId: verificationActionId,
        ok: single.json?.ok === true,
        status: single.status,
      });
    } catch (error) {
      results.push({
        kind: "single",
        actionId: verificationActionId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: results.some((item) => item.ok), results };
}

export async function runProductionActionsWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationActionId: "",
  };
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || TOTAL_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => {
      return attemptVerificationActionsCleanup(request, workflowContext);
    });
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
  const verificationActionId = buildProductionVerificationActionId(runId);
  result.actionId = verificationActionId;
  workflowContext.companyFolderId = companyFolderId;
  workflowContext.masterSheetId = masterSheetId;
  workflowContext.verificationActionId = verificationActionId;

  let actions = [];

  const actionsApiFail = await runStage("actionsApi", async () => {
    let actionsResponse;
    try {
      actionsResponse = await fetchCompanyActions(request, companyFolderId, masterSheetId, "actionsApi");
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "actionsApi",
        `Actions list request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:companyFolderId/actions.",
      );
    }
    if (actionsResponse.status !== 200 || actionsResponse.json?.ok !== true) {
      return fail(
        "actionsApi",
        `Actions API returned HTTP ${actionsResponse.status}.`,
        "Inspect folder-first Actions read route and workbook Actions tab access.",
        actionsResponse.status,
        actionsResponse.json,
      );
    }
    if (!Array.isArray(actionsResponse.json?.actions)) {
      return fail(
        "actionsApi",
        "Actions API response is missing the actions array.",
        "Inspect GET /api/companies/:companyFolderId/actions response shape.",
        actionsResponse.status,
        actionsResponse.json,
      );
    }
    actions = actionsResponse.json.actions;
    pass("actionsApi");
    return null;
  });
  if (actionsApiFail) {
    return actionsApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    result.baseline = countActionBaselines(actions);
    let dashboardBaseline;
    try {
      dashboardBaseline = await request("GET", dashboardPath(companyFolderId, masterSheetId), undefined, {
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
    assertResponseSafe(dashboardBaseline.json, "dashboard baseline");
    if (dashboardBaseline.status !== 200 || dashboardBaseline.json?.ok !== true) {
      return fail(
        "baseline",
        `Dashboard baseline returned HTTP ${dashboardBaseline.status}.`,
        "Inspect live dashboard service for the smoke company.",
        dashboardBaseline.status,
        dashboardBaseline.json,
      );
    }
    result.dashboardBaselineOpenActions = dashboardOpenActionsCount(dashboardBaseline.json);
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowActionMutation) {
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
        `/api/companies/${encodeURIComponent(companyFolderId)}/actions/verification-cleanup`,
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
        "Inspect POST /api/companies/:id/actions/verification-cleanup.",
      );
    }
    assertResponseSafe(staleCleanup.json, "stale cleanup");
    if (staleCleanup.status !== 200 || staleCleanup.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup rejected (HTTP ${staleCleanup.status}).`,
        "Inspect verification action marker matching and cleanup permissions.",
        staleCleanup.status,
        staleCleanup.json,
      );
    }

    const refreshedAfterCleanup = await fetchCompanyActions(request, companyFolderId, masterSheetId, "staleCleanup");
    if (refreshedAfterCleanup.status === 200 && Array.isArray(refreshedAfterCleanup.json?.actions)) {
      actions = refreshedAfterCleanup.json.actions;
    }
    if (listActiveVerificationActions(actions).length > 0) {
      return fail(
        "staleCleanup",
        "Active verification actions remain after stale cleanup.",
        "Inspect cleanupStaleVerificationActions and verification marker matching.",
        staleCleanup.status,
        { activeCount: listActiveVerificationActions(actions).length },
      );
    }
    pass("staleCleanup");
    return null;
  });
  if (staleCleanupFail) {
    return staleCleanupFail;
  }

  const createActionFail = await runStage("createAction", async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    const dueDateIso = dueDate.toISOString().slice(0, 10);
    const verificationAction = buildProductionVerificationAction({
      actionId: verificationActionId,
      companyFolderId,
      assigneeUserId: config.username,
      assigneeName: login.user?.name || config.username,
      createdByUserId: config.username,
      dueDate: dueDateIso,
    });

    const createPayload = [...actions, verificationAction];
    let createResponse;
    try {
      createResponse = await saveCompanyActions(
        request,
        companyFolderId,
        masterSheetId,
        createPayload,
        "createAction",
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "createAction",
        `Create action request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/actions.",
      );
    }
    assertResponseSafe(createResponse.json, "create action");
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createAction",
        `Create action rejected (HTTP ${createResponse.status}).`,
        "Inspect Actions write path and smoke assignee fields.",
        createResponse.status,
        createResponse.json,
      );
    }
    pass("createAction");
    return null;
  });
  if (createActionFail) {
    return createActionFail;
  }

  let afterCreateSnapshot = null;
  let createdSnapshot = null;
  const openActionFail = await runStage("openAction", async () => {
    const afterCreate = await fetchCompanyActions(request, companyFolderId, masterSheetId, "openAction");
    const created = findActionById(afterCreate.json?.actions || [], verificationActionId);
    if (!created) {
      return fail(
        "openAction",
        "Created verification action does not appear in the Actions list.",
        "Inspect Actions tab write and GET list mapping.",
        afterCreate.status,
        afterCreate.json,
      );
    }
    if (normalizeIdentity(created.auditName) !== normalizeIdentity(PRODUCTION_VERIFICATION_ACTION_TITLE)) {
      return fail("openAction", "Verification action title does not match expected marker.", "Inspect action field mapping.");
    }
    if (trim(created.status) !== "Open") {
      return fail("openAction", `Expected Open status, got "${created.status}".`, "Inspect created action defaults.");
    }
    if (trim(created.auditId) !== PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE) {
      return fail("openAction", "Verification action source reference mismatch.", "Inspect verification action builder.");
    }
    if (listActiveVerificationActions(afterCreate.json?.actions || []).length !== 1) {
      return fail(
        "openAction",
        "Expected exactly one active verification action after create.",
        "Inspect duplicate verification action prevention.",
        afterCreate.status,
        { activeCount: listActiveVerificationActions(afterCreate.json?.actions || []).length },
      );
    }
    afterCreateSnapshot = afterCreate;
    createdSnapshot = created;
    pass("openAction");
    return null;
  });
  if (openActionFail) {
    return openActionFail;
  }
  let workingActions = afterCreateSnapshot.json.actions;
  let workingAction = { ...createdSnapshot, status: "In Progress", updatedAt: new Date().toISOString() };

  let startedSnapshot = null;
  const startActionFail = await runStage("startAction", async () => {
    let saveResponse;
    try {
      saveResponse = await saveCompanyActions(
        request,
        companyFolderId,
        masterSheetId,
        mergeActionUpdate(workingActions, workingAction),
        "startAction",
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "startAction",
        `Start action request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/actions.",
      );
    }
    assertResponseSafe(saveResponse.json, "start action");
    if (saveResponse.status !== 200 || saveResponse.json?.ok !== true) {
      return fail(
        "startAction",
        `Start action transition rejected (HTTP ${saveResponse.status}).`,
        "Inspect Actions status persistence.",
        saveResponse.status,
        saveResponse.json,
      );
    }
    const afterStart = await fetchCompanyActions(request, companyFolderId, masterSheetId, "startAction");
    startedSnapshot = findActionById(afterStart.json?.actions || [], verificationActionId);
    if (trim(startedSnapshot?.status) !== "In Progress") {
      return fail("startAction", `Expected In Progress status, got "${startedSnapshot?.status}".`, "Inspect status write mapping.");
    }
    workingActions = afterStart.json.actions;
    pass("startAction");
    return null;
  });
  if (startActionFail) {
    return startActionFail;
  }

  let progressedSnapshot = null;
  const progressUpdateFail = await runStage("progressUpdate", async () => {
    const existingComments = trim(startedSnapshot?.comments || "");
    const progressNote = existingComments.includes(PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE)
      ? existingComments
      : [existingComments, PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE].filter(Boolean).join("\n");
    workingAction = {
      ...startedSnapshot,
      comments: progressNote,
      updatedAt: new Date().toISOString(),
    };
    let saveResponse;
    try {
      saveResponse = await saveCompanyActions(
        request,
        companyFolderId,
        masterSheetId,
        mergeActionUpdate(workingActions, workingAction),
        "progressUpdate",
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "progressUpdate",
        `Progress update request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/actions.",
      );
    }
    assertResponseSafe(saveResponse.json, "progress update");
    if (saveResponse.status !== 200 || saveResponse.json?.ok !== true) {
      return fail(
        "progressUpdate",
        `Progress update rejected (HTTP ${saveResponse.status}).`,
        "Inspect Actions comments persistence.",
        saveResponse.status,
        saveResponse.json,
      );
    }
    const afterProgress = await fetchCompanyActions(request, companyFolderId, masterSheetId, "progressUpdate");
    progressedSnapshot = findActionById(afterProgress.json?.actions || [], verificationActionId);
    if (!trim(progressedSnapshot?.comments || "").includes(PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE)) {
      return fail(
        "progressUpdate",
        "Progress note was not persisted on the verification action.",
        "Inspect Actions comments field mapping.",
        afterProgress.status,
        progressedSnapshot,
      );
    }
    workingActions = afterProgress.json.actions;
    pass("progressUpdate");
    return null;
  });
  if (progressUpdateFail) {
    return progressUpdateFail;
  }

  let awaitingSnapshot = null;
  const awaitingVerificationFail = await runStage("awaitingVerification", async () => {
    workingAction = {
      ...progressedSnapshot,
      status: "Awaiting Verification",
      updatedAt: new Date().toISOString(),
    };
    let saveResponse;
    try {
      saveResponse = await saveCompanyActions(
        request,
        companyFolderId,
        masterSheetId,
        mergeActionUpdate(workingActions, workingAction),
        "awaitingVerification",
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "awaitingVerification",
        `Awaiting Verification request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/actions.",
      );
    }
    if (saveResponse.status !== 200 || saveResponse.json?.ok !== true) {
      return fail(
        "awaitingVerification",
        `Awaiting Verification transition rejected (HTTP ${saveResponse.status}).`,
        "Inspect Actions status transition rules.",
        saveResponse.status,
        saveResponse.json,
      );
    }
    const afterAwaiting = await fetchCompanyActions(request, companyFolderId, masterSheetId, "awaitingVerification");
    awaitingSnapshot = findActionById(afterAwaiting.json?.actions || [], verificationActionId);
    if (trim(awaitingSnapshot?.status) !== "Awaiting Verification") {
      return fail(
        "awaitingVerification",
        `Expected Awaiting Verification status, got "${awaitingSnapshot?.status}".`,
        "Inspect status persistence.",
        afterAwaiting.status,
        awaitingSnapshot,
      );
    }
    workingActions = afterAwaiting.json.actions;
    pass("awaitingVerification");
    return null;
  });
  if (awaitingVerificationFail) {
    return awaitingVerificationFail;
  }

  const verifyCloseFail = await runStage("verifyClose", async () => {
    const closeWithCurrentSession = async () => {
      const closedAction = {
        ...awaitingSnapshot,
        status: "Closed",
        closedAt: new Date().toISOString(),
        verifiedByUserId: config.username,
        verificationNotes: "Production verification action closed by smoke workflow.",
        updatedAt: new Date().toISOString(),
      };
      return saveCompanyActions(
        request,
        companyFolderId,
        masterSheetId,
        mergeActionUpdate(workingActions, closedAction),
        "verifyClose",
      );
    };

    let closeResponse;
    try {
      closeResponse = await closeWithCurrentSession();
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "verifyClose",
        `Verify/close request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:companyFolderId/actions.",
      );
    }
    if (
      (closeResponse.status === 403 || closeResponse.json?.code === "VERIFY_PERMISSION_DENIED") &&
      config.hasReviewerCredentials
    ) {
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
          "verifyClose",
          reviewerLogin.failureReason || "Reviewer login failed.",
          reviewerLogin.remediation || "Provide a reviewer smoke account with canVerifyActions.",
          reviewerLogin.httpStatus,
          reviewerLogin.responseBody,
        );
      }
      closeResponse = await closeWithCurrentSession();
    }

    assertResponseSafe(closeResponse.json, "verify close");
    if (closeResponse.status !== 200 || closeResponse.json?.ok !== true) {
      if (closeResponse.status === 403) {
        return fail(
          "verifyClose",
          "Smoke account cannot verify/close its own action and no reviewer credentials were supplied.",
          "Set BERT_SMOKE_REVIEWER_USERNAME and BERT_SMOKE_REVIEWER_PASSWORD for a user with canVerifyActions.",
          closeResponse.status,
          closeResponse.json,
        );
      }
      return fail(
        "verifyClose",
        `Verify/close rejected (HTTP ${closeResponse.status}).`,
        "Inspect Actions close transition and verifier permissions.",
        closeResponse.status,
        closeResponse.json,
      );
    }
    const afterClose = await fetchCompanyActions(request, companyFolderId, masterSheetId, "verifyClose");
    const closed = findActionById(afterClose.json?.actions || [], verificationActionId);
    if (trim(closed?.status) !== "Closed") {
      return fail("verifyClose", `Expected Closed status, got "${closed?.status}".`, "Inspect close persistence.");
    }
    pass("verifyClose");
    return null;
  });
  if (verifyCloseFail) {
    return verifyCloseFail;
  }

  const dashboardFail = await runStage("dashboard", async () => {
    let dashboardAfterCreate;
    try {
      dashboardAfterCreate = await request("GET", dashboardPath(companyFolderId, masterSheetId, true), undefined, {
        stageKey: "dashboard",
      });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "dashboard",
        `Dashboard verification request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect live dashboard after action workflow.",
      );
    }
    assertResponseSafe(dashboardAfterCreate.json, "dashboard after workflow");
    if (dashboardAfterCreate.status !== 200 || dashboardAfterCreate.json?.ok !== true) {
      return fail(
        "dashboard",
        `Dashboard verification returned HTTP ${dashboardAfterCreate.status}.`,
        "Inspect live dashboard aggregation.",
        dashboardAfterCreate.status,
        dashboardAfterCreate.json,
      );
    }
    if (actionAppearsInDashboard(dashboardAfterCreate.json, verificationActionId)) {
      return fail(
        "dashboard",
        "Closed verification action still appears in dashboard Act Today items.",
        "Inspect live dashboard exclusion for verification actions.",
        dashboardAfterCreate.status,
        dashboardAfterCreate.json,
      );
    }
    const openAfterClose = dashboardOpenActionsCount(dashboardAfterCreate.json);
    if (
      result.dashboardBaselineOpenActions !== null &&
      openAfterClose !== null &&
      openAfterClose > result.dashboardBaselineOpenActions
    ) {
      return fail(
        "dashboard",
        "Dashboard open action count increased after verification workflow despite cleanup-oriented closure.",
        "Inspect verification action exclusion from operational dashboard metrics.",
        dashboardAfterCreate.status,
        { before: result.dashboardBaselineOpenActions, after: openAfterClose },
      );
    }
    pass("dashboard");
    return null;
  });
  if (dashboardFail) {
    return dashboardFail;
  }

  const searchSkipped = await runStage("search", async () => {
    skip(
      "search",
      "Global search is built client-side from cached workbook data; no safe server-side search API exists.",
    );
    return null;
  });
  if (searchSkipped) {
    return searchSkipped;
  }

  const cleanupFail = await runStage("cleanup", async () => {
    let cleanup;
    try {
      cleanup = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/actions/${encodeURIComponent(verificationActionId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup" },
      );
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "cleanup",
        `Verification cleanup request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect POST /api/companies/:id/actions/:actionId/verification-cleanup.",
      );
    }
    assertResponseSafe(cleanup.json, "cleanup");
    if (cleanup.status !== 200 || cleanup.json?.ok !== true) {
      return fail(
        "cleanup",
        `Verification cleanup rejected (HTTP ${cleanup.status}).`,
        "Inspect verification cleanup permissions and marker guards.",
        cleanup.status,
        cleanup.json,
      );
    }

    const afterCleanup = await fetchCompanyActions(request, companyFolderId, masterSheetId, "cleanup");
    const cleaned = findActionById(afterCleanup.json?.actions || [], verificationActionId);
    const cleanedStatus = normalizeIdentity(cleaned?.status || "");
    if (listActiveVerificationActions(afterCleanup.json?.actions || []).length > 0) {
      return fail(
        "cleanup",
        "Active verification actions remain after cleanup.",
        "Inspect cleanupVerificationAction status patch.",
        cleanup.status,
        { activeCount: listActiveVerificationActions(afterCleanup.json?.actions || []).length },
      );
    }
    if (cleaned && cleanedStatus !== PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS && cleanedStatus !== "closed") {
      return fail(
        "cleanup",
        `Verification action was not marked cleaned (status="${cleaned?.status}").`,
        "Inspect verification-cleaned status handling.",
        cleanup.status,
        cleaned,
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

export function isVerificationActionRecord(action = {}) {
  return isVerificationAction(action);
}

export function isActiveVerificationActionRecord(action = {}) {
  return isActiveVerificationAction(action);
}
