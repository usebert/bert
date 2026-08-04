/**
 * Production Schedules workflow checks — shared by live verifier and unit tests.
 */
import { PRODUCTION_VERIFICATION_AUDIT_ID, PRODUCTION_VERIFICATION_AUDIT_NAME } from "../../shared/production-verification-audit.mjs";
import {
  assignedCheckForSchedule,
  buildProductionVerificationSchedule,
  buildProductionVerificationScheduleId,
  countScheduleBaselines,
  findScheduleById,
  isOperationalAssignedCheck,
  isOperationalSchedule,
  isWorkflowVerificationSchedule,
  listActiveWorkflowVerificationSchedules,
  PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
  PRODUCTION_VERIFICATION_SCHEDULE_TITLE,
} from "../../shared/production-verification-schedule.mjs";
import { enrichSchedulesWithDueOccurrence, resolveScheduleDueOccurrence } from "../../shared/schedule-due.mjs";
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

export const SCHEDULES_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_SCHEDULES_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  schedulesApi: 60_000,
  baseline: 60_000,
  templateAvailability: 60_000,
  staleCleanup: 120_000,
  createSchedule: 120_000,
  readback: 60_000,
  assignedCheck: 60_000,
  editSchedule: 120_000,
  pauseDeactivate: 120_000,
  reactivate: 120_000,
  recurrence: 60_000,
  dashboard: 60_000,
  notifications: 5_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "schedulesApi",
  "baseline",
  "templateAvailability",
  "staleCleanup",
  "createSchedule",
  "readback",
  "assignedCheck",
  "editSchedule",
  "pauseDeactivate",
  "reactivate",
  "recurrence",
  "dashboard",
  "notifications",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  schedulesApi: "Schedules API",
  baseline: "Baseline",
  templateAvailability: "Template Availability",
  staleCleanup: "Stale Cleanup",
  createSchedule: "Create Schedule",
  readback: "Readback",
  assignedCheck: "Assigned Check",
  editSchedule: "Edit Schedule",
  pauseDeactivate: "Pause / Deactivate",
  reactivate: "Reactivate",
  recurrence: "Recurrence",
  dashboard: "Dashboard",
  notifications: "Notifications",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createSchedule",
  "readback",
  "assignedCheck",
  "editSchedule",
  "pauseDeactivate",
  "reactivate",
  "recurrence",
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

function schedulesListPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/schedules`, masterSheetId);
}

function assignedChecksPath(masterSheetId) {
  return withMasterSheet("/api/me/assigned-checks", masterSheetId);
}

function dashboardPath(companyFolderId, masterSheetId, refresh = false) {
  const base = withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/dashboard/live`, masterSheetId);
  return refresh ? `${base}&refresh=1` : base;
}

function verificationSchedulePath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/schedules/verification`, masterSheetId);
}

function verificationSchedulePatchPath(companyFolderId, scheduleId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/schedules/${encodeURIComponent(scheduleId)}/verification`,
    masterSheetId,
  );
}

function verificationSchedulePausePath(companyFolderId, scheduleId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/schedules/${encodeURIComponent(scheduleId)}/pause`,
    masterSheetId,
  );
}

function verificationScheduleReactivatePath(companyFolderId, scheduleId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/schedules/${encodeURIComponent(scheduleId)}/reactivate`,
    masterSheetId,
  );
}

function schedulesFromListResponse(response) {
  return Array.isArray(response?.json?.schedules) ? response.json.schedules : [];
}

function assignedChecksFromResponse(response) {
  return Array.isArray(response?.json?.schedules) ? response.json.schedules : [];
}

export function loadSchedulesWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowScheduleMutation =
    trim(env.BERT_SMOKE_ALLOW_SCHEDULE_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_SCHEDULE_MUTATION).toLowerCase() === "true";
  return {
    ...base,
    allowScheduleMutation,
    totalBudgetMs: SCHEDULES_VERIFIER_BUDGET_MS,
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
      if (typeof val === "string" && val.includes("@") && !/bert\.demo\+|usebert\.co\.uk/i.test(val)) {
        return "***@***";
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

export function formatSchedulesWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Schedules Workflow",
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
  if (result.scheduleId && result.checks.authentication?.status === "PASS") {
    lines.push(`Schedule ID: ${result.scheduleId}`);
    lines.push(`Template ID: ${PRODUCTION_VERIFICATION_AUDIT_ID}`);
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

export async function attemptVerificationScheduleCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationScheduleId = trim(context.verificationScheduleId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/schedules/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_SCHEDULES_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({ kind: "bulk", ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  if (verificationScheduleId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/schedules/${encodeURIComponent(verificationScheduleId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_SCHEDULES_STAGE_TIMEOUTS_MS.cleanup },
      );
      results.push({
        kind: "single",
        scheduleId: verificationScheduleId,
        ok: single.json?.ok === true,
        status: single.status,
      });
    } catch (error) {
      results.push({
        kind: "single",
        scheduleId: verificationScheduleId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok:
      results.some((item) => item.ok) &&
      (!verificationScheduleId || results.some((item) => item.kind === "single" && item.ok)),
    results,
  };
}

async function pollScheduleListForId(request, companyFolderId, masterSheetId, scheduleId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "readback";
  let lastResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastResponse = await request("GET", schedulesListPath(companyFolderId, masterSheetId), undefined, { stageKey });
    const matches = schedulesFromListResponse(lastResponse).filter(
      (item) => trim(item.id || item.scheduleId) === trim(scheduleId),
    );
    if (matches.length === 1) {
      return { ok: true, schedule: matches[0], response: lastResponse };
    }
  }
  return { ok: false, response: lastResponse };
}

async function pollAssignedCheckForId(request, masterSheetId, scheduleId, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 15;
  const intervalMs = Number(options.intervalMs) || 1000;
  const stageKey = options.stageKey || "assignedCheck";
  let lastResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }
    lastResponse = await request("GET", assignedChecksPath(masterSheetId), undefined, { stageKey });
    const matches = assignedCheckForSchedule(assignedChecksFromResponse(lastResponse), scheduleId);
    if (matches.length === 1) {
      return { ok: true, check: matches[0], response: lastResponse };
    }
  }
  return { ok: false, response: lastResponse };
}

function scheduleAppearsInDashboard(payload = {}, scheduleId = "") {
  const id = trim(scheduleId);
  const actToday = Array.isArray(payload.actToday) ? payload.actToday : [];
  return actToday.some((item) => {
    const itemId = trim(item?.id || "");
    return itemId.includes(id) || itemId === `schedule-${id}`;
  });
}

function templateIsUsable(template = {}) {
  const id = trim(template.id || template.auditId || template.formId);
  const status = normalizeStatus(template.status);
  const questions = Array.isArray(template.questions) ? template.questions : [];
  return id === PRODUCTION_VERIFICATION_AUDIT_ID && status !== "archived" && questions.length > 0;
}

export async function runProductionSchedulesWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId || Date.now();
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationScheduleId: "",
  };
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[schedules-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || SCHEDULES_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_SCHEDULES_STAGE_TIMEOUTS_MS,
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationScheduleCleanup(request, workflowContext));
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

  let mustRunCleanup = false;
  let deferredFailure = null;
  let baselineDashboardDueToday = null;
  let schedulesListCache = [];

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
          deferredFailure = { ...stageResult };
        }
        return null;
      }
      return stageResult;
    }
    return null;
  }

  async function finalizeMutationWorkflow() {
    if (!mustRunCleanup) {
      return null;
    }
    const cleanupResult = await runStage("cleanup", async () => {
      const cleanup = await attemptVerificationScheduleCleanup(request, workflowContext);
      if (!cleanup.ok) {
        return fail(
          "cleanup",
          "Verification schedule cleanup did not succeed.",
          "Inspect POST /api/companies/:id/schedules/verification-cleanup and single-schedule cleanup.",
          500,
          cleanup,
        );
      }
      const listAfter = await request(
        "GET",
        schedulesListPath(workflowContext.companyFolderId, workflowContext.masterSheetId),
        undefined,
        { stageKey: "cleanup" },
      );
      const remaining = listActiveWorkflowVerificationSchedules(schedulesFromListResponse(listAfter));
      if (remaining.length > 0) {
        return fail(
          "cleanup",
          "Active verification schedules remain after cleanup.",
          "Inspect verification schedule cleanup merge path.",
          listAfter.status,
          { remainingCount: remaining.length },
        );
      }
      const assignedAfter = await request("GET", assignedChecksPath(workflowContext.masterSheetId), undefined, {
        stageKey: "cleanup",
      });
      const assignedMatches = assignedCheckForSchedule(
        assignedChecksFromResponse(assignedAfter),
        workflowContext.verificationScheduleId,
      );
      if (assignedMatches.length > 0) {
        return fail(
          "cleanup",
          "Actionable assigned verification check remains after cleanup.",
          "Inspect assigned-check filtering after cleanup.",
          assignedAfter.status,
          { assignedCount: assignedMatches.length },
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
    let health;
    try {
      health = await request("GET", "/api/health", undefined, { stageKey: "authentication" });
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail("authentication", `API health request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
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
    result.accountEmail = loginResult.accountEmail || config.expectedEmail;
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const schedulesApiFail = await runStage("schedulesApi", async () => {
    let schedulesResponse;
    let assignedResponse;
    try {
      [schedulesResponse, assignedResponse] = await Promise.all([
        requestWithTransientRetries(request, "GET", schedulesListPath(companyFolderId, masterSheetId), undefined, {
          stageKey: "schedulesApi",
          maxRetries: 2,
        }).then((item) => item.response),
        requestWithTransientRetries(request, "GET", assignedChecksPath(masterSheetId), undefined, {
          stageKey: "schedulesApi",
          maxRetries: 2,
        }).then((item) => item.response),
      ]);
    } catch (error) {
      if (isStageTimeoutError(error)) {
        throw error;
      }
      return fail(
        "schedulesApi",
        `Schedules API request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/schedules and GET /api/me/assigned-checks.",
      );
    }
    if (schedulesResponse.status !== 200 || schedulesResponse.json?.ok !== true) {
      return fail(
        "schedulesApi",
        `Schedules list returned HTTP ${schedulesResponse.status}.`,
        "Inspect folder-first schedule list route.",
        schedulesResponse.status,
        schedulesResponse.json,
      );
    }
    if (!Array.isArray(schedulesResponse.json?.schedules)) {
      return fail("schedulesApi", "Schedules list response is missing schedules array.", "Inspect schedules list shape.");
    }
    if (assignedResponse.status !== 200 || assignedResponse.json?.ok !== true) {
      return fail(
        "schedulesApi",
        `Assigned checks returned HTTP ${assignedResponse.status}.`,
        "Inspect GET /api/me/assigned-checks.",
        assignedResponse.status,
        assignedResponse.json,
      );
    }
    if (!Array.isArray(assignedResponse.json?.schedules)) {
      return fail("schedulesApi", "Assigned checks response is missing schedules array.", "Inspect assigned-checks shape.");
    }
    schedulesListCache = schedulesFromListResponse(schedulesResponse);
    pass("schedulesApi");
    return null;
  });
  if (schedulesApiFail) {
    return schedulesApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    const assignedResponse = await request("GET", assignedChecksPath(masterSheetId), undefined, { stageKey: "baseline" });
    const baseline = countScheduleBaselines(schedulesListCache, assignedChecksFromResponse(assignedResponse));
    result.baseline = baseline;
    try {
      const dashboardResponse = await request("GET", dashboardPath(companyFolderId, masterSheetId), undefined, {
        stageKey: "baseline",
      });
      if (dashboardResponse.status === 200 && dashboardResponse.json?.ok === true) {
        baselineDashboardDueToday = Number(dashboardResponse.json?.metrics?.todayDue);
      }
    } catch {
      /* dashboard baseline is optional */
    }
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  const templateFail = await runStage("templateAvailability", async () => {
    const templatesResponse = await request(
      "GET",
      `/api/audits/templates?masterSheetId=${encodeURIComponent(masterSheetId)}`,
      undefined,
      { stageKey: "templateAvailability" },
    );
    assertResponseSafe(templatesResponse.json, "audit templates");
    const templates = Array.isArray(templatesResponse.json?.templates) ? templatesResponse.json.templates : [];
    const match = templates.find((item) => trim(item.id || item.auditId) === PRODUCTION_VERIFICATION_AUDIT_ID);
    if (!match) {
      return fail(
        "templateAvailability",
        `Verification template ${PRODUCTION_VERIFICATION_AUDIT_ID} is missing.`,
        "Run npm run ensure:production-verification-audit to provision bert-verify-audit-v1.",
        templatesResponse.status,
        { templateCount: templates.length },
      );
    }
    if (!templateIsUsable(match)) {
      return fail(
        "templateAvailability",
        "Verification template exists but is not active or has no questions.",
        "Run npm run ensure:production-verification-audit and confirm template status/questions.",
        templatesResponse.status,
        match,
      );
    }
    pass("templateAvailability");
    return null;
  });
  if (templateFail) {
    return templateFail;
  }

  if (!config.allowScheduleMutation) {
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key, "BERT_SMOKE_ALLOW_SCHEDULE_MUTATION is not enabled.");
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const verificationScheduleId = buildProductionVerificationScheduleId(runId);
  result.scheduleId = verificationScheduleId;
  workflowContext.verificationScheduleId = verificationScheduleId;

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    const cleanupResponse = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/schedules/verification-cleanup`,
      { companyFolderId, masterSheetId, keepScheduleId: verificationScheduleId },
      { stageKey: "staleCleanup" },
    );
    if (cleanupResponse.status !== 200 || cleanupResponse.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup returned HTTP ${cleanupResponse.status}.`,
        "Inspect POST /api/companies/:id/schedules/verification-cleanup.",
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

  const createFail = await runStage("createSchedule", async () => {
    const payload = buildProductionVerificationSchedule({
      runId,
      scheduleId: verificationScheduleId,
      companyFolderId,
      createdByEmail: result.accountEmail,
      assignedEmail: config.expectedEmail,
    });
    let createResponse;
    try {
      createResponse = await requestWithTransientRetries(
        request,
        "POST",
        verificationSchedulePath(companyFolderId, masterSheetId),
        {
          ...payload,
          companyFolderId,
          masterSheetId,
          templateId: PRODUCTION_VERIFICATION_AUDIT_ID,
          verificationSource: PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
        },
        { stageKey: "createSchedule", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
      ).then((item) => item.response);
    } catch (error) {
      if (isStageTimeoutError(error) || isTransientNetworkError(error)) {
        const polled = await pollScheduleListForId(request, companyFolderId, masterSheetId, verificationScheduleId, {
          stageKey: "createSchedule",
          maxAttempts: options.listPollMaxAttempts || 5,
          intervalMs: options.listPollIntervalMs ?? 1000,
        });
        if (polled.ok) {
          mustRunCleanup = true;
          pass("createSchedule");
          return null;
        }
      }
      throw error;
    }
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createSchedule",
        `Create verification schedule returned HTTP ${createResponse.status}.`,
        "Inspect POST /api/companies/:id/schedules/verification merge write path.",
        createResponse.status,
        createResponse.json,
      );
    }
    if (Number(createResponse.json?.updatedRows ?? createResponse.json?.written ?? 0) <= 0 && !createResponse.json?.alreadyExists) {
      return fail(
        "createSchedule",
        "Create schedule returned zero-row acknowledgement.",
        "Inspect schedule write acknowledgement from Sheets.",
        createResponse.status,
        createResponse.json,
      );
    }
    mustRunCleanup = true;
    pass("createSchedule");
    return null;
  });
  if (createFail) {
    if (mustRunCleanup) {
      const terminal = await finalizeMutationWorkflow();
      return terminal || createFail;
    }
    return createFail;
  }

  const readbackFail = await runPostCreateStage("readback", async () => {
    const polled = await pollScheduleListForId(request, companyFolderId, masterSheetId, verificationScheduleId, {
      stageKey: "readback",
      maxAttempts: options.listPollMaxAttempts || 15,
      intervalMs: options.listPollIntervalMs ?? 1000,
    });
    if (!polled.ok) {
      return fail(
        "readback",
        "Verification schedule was not visible on management list readback.",
        "Inspect schedule list after create and Google Sheets visibility delay.",
        polled.response?.status,
        polled.response?.json,
      );
    }
    const schedule = polled.schedule;
    if (trim(schedule.scheduleName) !== PRODUCTION_VERIFICATION_SCHEDULE_TITLE) {
      return fail("readback", "Schedule name mismatch on readback.", "Inspect verification schedule payload.", 200, schedule);
    }
    const audit = (schedule.audits || [])[0] || {};
    if (trim(audit.auditId) !== PRODUCTION_VERIFICATION_AUDIT_ID) {
      return fail("readback", "Template ID mismatch on readback.", "Inspect verification schedule audits.", 200, schedule);
    }
    pass("readback");
    return null;
  });
  if (readbackFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || readbackFail;
  }

  const assignedFail = await runPostCreateStage("assignedCheck", async () => {
    const polled = await pollAssignedCheckForId(request, masterSheetId, verificationScheduleId, {
      stageKey: "assignedCheck",
      maxAttempts: options.listPollMaxAttempts || 15,
      intervalMs: options.listPollIntervalMs ?? 1000,
    });
    if (!polled.ok) {
      return fail(
        "assignedCheck",
        "Verification schedule does not appear exactly once in assigned checks.",
        "Inspect GET /api/me/assigned-checks assignment expansion.",
        polled.response?.status,
        polled.response?.json,
      );
    }
    const check = polled.check;
    const audit = (check.audits || [])[0] || {};
    if (trim(audit.auditId) !== PRODUCTION_VERIFICATION_AUDIT_ID) {
      return fail("assignedCheck", "Assigned check template ID mismatch.", "Inspect assigned-check audit mapping.", 200, check);
    }
    pass("assignedCheck");
    return null;
  });
  if (assignedFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || assignedFail;
  }

  const editFail = await runPostCreateStage("editSchedule", async () => {
    const editResponse = await request(
      "PATCH",
      verificationSchedulePatchPath(companyFolderId, verificationScheduleId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        scheduleName: `${PRODUCTION_VERIFICATION_SCHEDULE_TITLE} (edited)`,
        description: "Edited by production schedules workflow verifier.",
      },
      { stageKey: "editSchedule" },
    );
    if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
      return fail(
        "editSchedule",
        `Edit schedule returned HTTP ${editResponse.status}.`,
        "Inspect PATCH /api/companies/:id/schedules/:scheduleId/verification.",
        editResponse.status,
        editResponse.json,
      );
    }
    const polled = await pollScheduleListForId(request, companyFolderId, masterSheetId, verificationScheduleId, {
      stageKey: "editSchedule",
      maxAttempts: options.listPollMaxAttempts || 10,
      intervalMs: options.listPollIntervalMs ?? 500,
    });
    if (!polled.ok || !String(polled.schedule?.scheduleName || "").includes("(edited)")) {
      return fail("editSchedule", "Edited schedule name did not persist on readback.", "Inspect schedule patch merge.", 200, polled.schedule);
    }
    pass("editSchedule");
    return null;
  });
  if (editFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || editFail;
  }

  const pauseFail = await runPostCreateStage("pauseDeactivate", async () => {
    const pauseResponse = await request(
      "POST",
      verificationSchedulePausePath(companyFolderId, verificationScheduleId, masterSheetId),
      { companyFolderId, masterSheetId },
      { stageKey: "pauseDeactivate" },
    );
    if (pauseResponse.status !== 200 || pauseResponse.json?.ok !== true) {
      return fail(
        "pauseDeactivate",
        `Pause schedule returned HTTP ${pauseResponse.status}.`,
        "Inspect POST /api/companies/:id/schedules/:scheduleId/pause.",
        pauseResponse.status,
        pauseResponse.json,
      );
    }
    const assignedAfterPause = await request("GET", assignedChecksPath(masterSheetId), undefined, {
      stageKey: "pauseDeactivate",
    });
    const matches = assignedCheckForSchedule(assignedChecksFromResponse(assignedAfterPause), verificationScheduleId);
    if (matches.length > 0) {
      return fail(
        "pauseDeactivate",
        "Paused verification schedule still appears as an actionable assigned check.",
        "Inspect isActiveMyCheckScheduleStatus pause filtering.",
        assignedAfterPause.status,
        { assignedCount: matches.length },
      );
    }
    const listAfterPause = await pollScheduleListForId(request, companyFolderId, masterSheetId, verificationScheduleId, {
      stageKey: "pauseDeactivate",
      maxAttempts: 5,
      intervalMs: options.listPollIntervalMs ?? 500,
    });
    if (!listAfterPause.ok) {
      return fail("pauseDeactivate", "Paused schedule missing from management list.", "Inspect pause merge write.", 200);
    }
    pass("pauseDeactivate");
    return null;
  });
  if (pauseFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || pauseFail;
  }

  const reactivateFail = await runPostCreateStage("reactivate", async () => {
    const reactivateResponse = await request(
      "POST",
      verificationScheduleReactivatePath(companyFolderId, verificationScheduleId, masterSheetId),
      { companyFolderId, masterSheetId },
      { stageKey: "reactivate" },
    );
    if (reactivateResponse.status !== 200 || reactivateResponse.json?.ok !== true) {
      return fail(
        "reactivate",
        `Reactivate schedule returned HTTP ${reactivateResponse.status}.`,
        "Inspect POST /api/companies/:id/schedules/:scheduleId/reactivate.",
        reactivateResponse.status,
        reactivateResponse.json,
      );
    }
    const polled = await pollAssignedCheckForId(request, masterSheetId, verificationScheduleId, {
      stageKey: "reactivate",
      maxAttempts: options.listPollMaxAttempts || 15,
      intervalMs: options.listPollIntervalMs ?? 1000,
    });
    if (!polled.ok) {
      return fail(
        "reactivate",
        "Reactivated verification schedule missing from assigned checks.",
        "Inspect reactivate status and assigned-check filtering.",
        polled.response?.status,
        polled.response?.json,
      );
    }
    pass("reactivate");
    return null;
  });
  if (reactivateFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || reactivateFail;
  }

  const recurrenceFail = await runPostCreateStage("recurrence", async () => {
    const listResponse = await request("GET", schedulesListPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "recurrence",
    });
    const schedule = findScheduleById(schedulesFromListResponse(listResponse), verificationScheduleId);
    if (!schedule) {
      return fail("recurrence", "Verification schedule missing for recurrence check.", "Inspect schedule list.", listResponse.status);
    }
    const enriched = enrichSchedulesWithDueOccurrence([schedule], new Date())[0];
    const audit = (enriched.audits || [])[0] || {};
    const due = resolveScheduleDueOccurrence(
      {
        startDate: schedule.startDate,
        frequency: audit.frequency,
        liveTime: audit.liveTime,
        completionHours: audit.completionHours,
        nextDueAt: enriched.nextDueAt,
      },
      new Date(),
    );
    if (!due.nextDueAt) {
      return fail("recurrence", "Recurrence calculation did not produce nextDueAt.", "Inspect shared/schedule-due.mjs.", 200, due);
    }
    if (normalizeStatus(audit.frequency) !== "daily") {
      return fail("recurrence", "Expected Daily frequency on verification schedule.", "Inspect verification schedule payload.", 200, audit);
    }
    pass("recurrence");
    return null;
  });
  if (recurrenceFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || recurrenceFail;
  }

  const dashboardFail = await runPostCreateStage("dashboard", async () => {
    const dashboardResponse = await request("GET", dashboardPath(companyFolderId, masterSheetId, true), undefined, {
      stageKey: "dashboard",
    });
    if (dashboardResponse.status !== 200 || dashboardResponse.json?.ok !== true) {
      return fail(
        "dashboard",
        `Dashboard verification returned HTTP ${dashboardResponse.status}.`,
        "Inspect GET /api/companies/:id/dashboard/live.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    if (scheduleAppearsInDashboard(dashboardResponse.json, verificationScheduleId)) {
      return fail(
        "dashboard",
        "Verification schedule still appears in dashboard Act Today operational items.",
        "Inspect isOperationalSchedule exclusion in live dashboard.",
        dashboardResponse.status,
        dashboardResponse.json,
      );
    }
    const listResponse = await request("GET", schedulesListPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "dashboard",
    });
    const visible = findScheduleById(schedulesFromListResponse(listResponse), verificationScheduleId);
    if (visible && isOperationalSchedule(visible)) {
      return fail(
        "dashboard",
        "Verification schedule is treated as operational in schedule data.",
        "Ensure isOperationalSchedule excludes workflow verification schedules.",
        listResponse.status,
        visible,
      );
    }
    if (
      Number.isFinite(baselineDashboardDueToday) &&
      Number.isFinite(dashboardResponse.json?.metrics?.todayDue) &&
      dashboardResponse.json.metrics.todayDue > baselineDashboardDueToday &&
      scheduleAppearsInDashboard(dashboardResponse.json, verificationScheduleId)
    ) {
      return fail(
        "dashboard",
        "Dashboard todayDue increased because verification schedule remains in operational metrics.",
        "Inspect verification schedule exclusion from dashboard due counts.",
        dashboardResponse.status,
        {
          baselineTodayDue: baselineDashboardDueToday,
          todayDue: dashboardResponse.json.metrics.todayDue,
        },
      );
    }
    pass("dashboard");
    return null;
  });
  if (dashboardFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || dashboardFail;
  }

  const notificationFail = await runPostCreateStage("notifications", async () => {
    skip("notifications", "Schedule notifications are client-cache/background-job derived; no safe server notification API.");
    return null;
  });
  if (notificationFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || notificationFail;
  }

  const searchFail = await runPostCreateStage("search", async () => {
    skip("search", "Schedules search is client-side only.");
    return null;
  });
  if (searchFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || searchFail;
  }

  const terminalResult = await finalizeMutationWorkflow();
  if (terminalResult) {
    return terminalResult;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  return result;
}
