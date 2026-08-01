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

export { loadSmokeConfig, performProductionSmokeLogin, maskEmail };

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

export async function fetchCompanyActions(request, companyFolderId, masterSheetId) {
  const response = await request("GET", actionsPath(companyFolderId, masterSheetId));
  assertResponseSafe(response.json, "actions list");
  return response;
}

export async function saveCompanyActions(request, companyFolderId, masterSheetId, actions) {
  return request("POST", `/api/companies/${encodeURIComponent(companyFolderId)}/actions`, {
    companyFolderId,
    masterSheetId,
    actions,
  });
}

export async function runProductionActionsWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const request = transport.request.bind(transport);
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

  const fail = (key, reason, remediation = "", httpStatus = 0, responseBody = null) => {
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    for (const checkKey of CHECK_KEYS) {
      if (result.checks[checkKey].status === "PENDING") {
        result.checks[checkKey] = { status: "SKIP" };
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  };

  let health;
  try {
    health = await request("GET", "/api/health");
  } catch (error) {
    return fail(
      "authentication",
      `API health request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Confirm the production API is reachable.",
    );
  }
  result.apiVersion = trim(health.json?.version);
  result.apiSha = trim(health.json?.gitSha || health.json?.sha);
  result.shortSha = trim(health.json?.shortSha);

  const login = await performProductionSmokeLogin(config, transport, options);
  if (!login.ok) {
    return fail(
      "authentication",
      login.failureReason || "Production login failed.",
      login.remediation || "Inspect smoke credentials and company session enrichment.",
      login.httpStatus,
      login.responseBody,
    );
  }
  result.accountEmail = login.accountEmail || config.expectedEmail;
  pass("authentication");

  const companyFolderId = trim(login.companyFolderId || config.companyFolderId);
  const masterSheetId = trim(login.masterSheetId || config.masterSheetId);
  const runId = options.runId || Date.now();
  const verificationActionId = buildProductionVerificationActionId(runId);
  result.actionId = verificationActionId;

  let actionsResponse;
  try {
    actionsResponse = await fetchCompanyActions(request, companyFolderId, masterSheetId);
  } catch (error) {
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
  pass("actionsApi");

  let actions = actionsResponse.json.actions;
  const baseline = countActionBaselines(actions);
  result.baseline = baseline;

  let dashboardBaseline;
  try {
    dashboardBaseline = await request("GET", dashboardPath(companyFolderId, masterSheetId));
  } catch (error) {
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

  if (!config.allowActionMutation) {
    result.mutationSkipped = true;
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key);
    }
    skip("search", "Global search is client-side only; server-side search adapter unavailable.");
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  let staleCleanup;
  try {
    staleCleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/actions/verification-cleanup`,
      { companyFolderId, masterSheetId },
    );
  } catch (error) {
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
  pass("staleCleanup");

  const refreshedAfterCleanup = await fetchCompanyActions(request, companyFolderId, masterSheetId);
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
    createResponse = await saveCompanyActions(request, companyFolderId, masterSheetId, createPayload);
  } catch (error) {
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

  const afterCreate = await fetchCompanyActions(request, companyFolderId, masterSheetId);
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
  pass("openAction");

  let workingActions = afterCreate.json.actions;
  let workingAction = { ...created, status: "In Progress", updatedAt: new Date().toISOString() };
  let saveResponse = await saveCompanyActions(
    request,
    companyFolderId,
    masterSheetId,
    mergeActionUpdate(workingActions, workingAction),
  );
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
  const afterStart = await fetchCompanyActions(request, companyFolderId, masterSheetId);
  const started = findActionById(afterStart.json?.actions || [], verificationActionId);
  if (trim(started?.status) !== "In Progress") {
    return fail("startAction", `Expected In Progress status, got "${started?.status}".`, "Inspect status write mapping.");
  }
  pass("startAction");
  workingActions = afterStart.json.actions;

  const existingComments = trim(started?.comments || "");
  const progressNote = existingComments.includes(PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE)
    ? existingComments
    : [existingComments, PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE].filter(Boolean).join("\n");
  workingAction = {
    ...started,
    comments: progressNote,
    updatedAt: new Date().toISOString(),
  };
  saveResponse = await saveCompanyActions(
    request,
    companyFolderId,
    masterSheetId,
    mergeActionUpdate(workingActions, workingAction),
  );
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
  const afterProgress = await fetchCompanyActions(request, companyFolderId, masterSheetId);
  const progressed = findActionById(afterProgress.json?.actions || [], verificationActionId);
  if (!trim(progressed?.comments || "").includes(PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE)) {
    return fail(
      "progressUpdate",
      "Progress note was not persisted on the verification action.",
      "Inspect Actions comments field mapping.",
      afterProgress.status,
      progressed,
    );
  }
  pass("progressUpdate");
  workingActions = afterProgress.json.actions;

  workingAction = {
    ...progressed,
    status: "Awaiting Verification",
    updatedAt: new Date().toISOString(),
  };
  saveResponse = await saveCompanyActions(
    request,
    companyFolderId,
    masterSheetId,
    mergeActionUpdate(workingActions, workingAction),
  );
  if (saveResponse.status !== 200 || saveResponse.json?.ok !== true) {
    return fail(
      "awaitingVerification",
      `Awaiting Verification transition rejected (HTTP ${saveResponse.status}).`,
      "Inspect Actions status transition rules.",
      saveResponse.status,
      saveResponse.json,
    );
  }
  const afterAwaiting = await fetchCompanyActions(request, companyFolderId, masterSheetId);
  const awaiting = findActionById(afterAwaiting.json?.actions || [], verificationActionId);
  if (trim(awaiting?.status) !== "Awaiting Verification") {
    return fail(
      "awaitingVerification",
      `Expected Awaiting Verification status, got "${awaiting?.status}".`,
      "Inspect status persistence.",
      afterAwaiting.status,
      awaiting,
    );
  }
  pass("awaitingVerification");
  workingActions = afterAwaiting.json.actions;

  const closeWithCurrentSession = async () => {
    const closedAction = {
      ...awaiting,
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
    );
  };

  let closeResponse = await closeWithCurrentSession();
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
      transport,
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
  const afterClose = await fetchCompanyActions(request, companyFolderId, masterSheetId);
  const closed = findActionById(afterClose.json?.actions || [], verificationActionId);
  if (trim(closed?.status) !== "Closed") {
    return fail("verifyClose", `Expected Closed status, got "${closed?.status}".`, "Inspect close persistence.");
  }
  pass("verifyClose");

  let dashboardAfterCreate;
  try {
    dashboardAfterCreate = await request("GET", dashboardPath(companyFolderId, masterSheetId, true));
  } catch (error) {
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

  skip(
    "search",
    "Global search is built client-side from cached workbook data; no safe server-side search API exists.",
  );

  let cleanup;
  try {
    cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/actions/${encodeURIComponent(verificationActionId)}/verification-cleanup`,
      { companyFolderId, masterSheetId },
    );
  } catch (error) {
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

  const afterCleanup = await fetchCompanyActions(request, companyFolderId, masterSheetId);
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
