/**
 * Production LOLER workflow checks — shared by live verifier and unit tests.
 */
import {
  buildProductionVerificationLolerAssetId,
  buildProductionVerificationLolerCertReference,
  buildProductionVerificationLolerEquipment,
  buildProductionVerificationLolerEquipmentId,
  buildProductionVerificationLolerExamId,
  buildProductionVerificationLolerFailExamId,
  countLolerBaselines,
  expectedNextExaminationDueDate,
  findLolerEquipmentById,
  isActiveVerificationLolerEquipment,
  isOperationalLolerEquipment,
  isVerificationLolerEquipment,
  listActiveVerificationLolerEquipment,
  PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_NAME,
  PRODUCTION_VERIFICATION_LOLER_SOURCE,
} from "../../shared/production-verification-loler.mjs";
import { calculateNextExaminationDueDate, isOpenLolerScheduleStatus, summarizeLolerEquipment } from "../../shared/loler.mjs";
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

export const LOLER_VERIFIER_BUDGET_MS = 12 * 60 * 1000;

export const DEFAULT_LOLER_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  lolerApi: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createEquipment: 120_000,
  readback: 60_000,
  editEquipment: 120_000,
  dueCalculation: 60_000,
  createExamination: 120_000,
  recordPass: 120_000,
  passVerification: 60_000,
  defectFail: 120_000,
  restoreEquipment: 120_000,
  healthSafetyOverview: 60_000,
  dashboard: 60_000,
  notifications: 5_000,
  search: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "lolerApi",
  "baseline",
  "staleCleanup",
  "createEquipment",
  "readback",
  "editEquipment",
  "dueCalculation",
  "createExamination",
  "recordPass",
  "passVerification",
  "defectFail",
  "restoreEquipment",
  "healthSafetyOverview",
  "dashboard",
  "notifications",
  "search",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  lolerApi: "LOLER API",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createEquipment: "Create Equipment",
  readback: "Readback",
  editEquipment: "Edit Equipment",
  dueCalculation: "Due Calculation",
  createExamination: "Create Examination",
  recordPass: "Record Pass",
  passVerification: "Pass Verification",
  defectFail: "Defect / Fail",
  restoreEquipment: "Restore Equipment",
  healthSafetyOverview: "H&S Overview",
  dashboard: "Dashboard",
  notifications: "Notifications",
  search: "Search",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set([
  "staleCleanup",
  "createEquipment",
  "readback",
  "editEquipment",
  "dueCalculation",
  "createExamination",
  "recordPass",
  "passVerification",
  "defectFail",
  "restoreEquipment",
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

function equipmentListPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment`, masterSheetId);
}

function equipmentDetailPath(companyFolderId, equipmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment/${encodeURIComponent(equipmentId)}`,
    masterSheetId,
  );
}

function schedulesPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/loler/schedules`, masterSheetId);
}

function examinationsPath(companyFolderId, masterSheetId, equipmentId = "") {
  const base = withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/loler/examinations`, masterSheetId);
  return equipmentId ? `${base}&equipmentId=${encodeURIComponent(equipmentId)}` : base;
}

function healthSafetyOverviewPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/health-safety/overview`, masterSheetId);
}

function verificationEquipmentPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification/equipment`, masterSheetId);
}

function verificationEquipmentPatchPath(companyFolderId, equipmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification/equipment/${encodeURIComponent(equipmentId)}`,
    masterSheetId,
  );
}

function verificationPassPath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification/examinations/pass`,
    masterSheetId,
  );
}

function verificationFailPath(companyFolderId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification/examinations/fail`,
    masterSheetId,
  );
}

function verificationRestorePath(companyFolderId, equipmentId, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment/${encodeURIComponent(equipmentId)}/verification-restore`,
    masterSheetId,
  );
}

function equipmentFromListResponse(response) {
  return Array.isArray(response?.json?.equipment) ? response.json.equipment : [];
}

function schedulesFromResponse(response) {
  return Array.isArray(response?.json?.schedules) ? response.json.schedules : [];
}

function examinationsFromResponse(response) {
  return Array.isArray(response?.json?.examinations) ? response.json.examinations : [];
}

export function loadLolerWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowLolerMutation =
    trim(env.BERT_SMOKE_ALLOW_LOLER_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_LOLER_MUTATION).toLowerCase() === "true";
  return {
    ...base,
    allowLolerMutation,
    totalBudgetMs: LOLER_VERIFIER_BUDGET_MS,
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

export function formatLolerWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production LOLER Workflow",
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
  if (result.equipmentId) {
    lines.push(`Equipment ID: ${result.equipmentId}`);
  }
  if (result.assetReference) {
    lines.push(`Asset Reference: ${result.assetReference}`);
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

export async function attemptVerificationLolerCleanup(request, context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  const verificationEquipmentId = trim(context.verificationEquipmentId);
  if (!companyFolderId) {
    return { ok: false, reason: "missing_company_folder_id", results: [] };
  }

  const results = [];
  try {
    const bulk = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification-cleanup`,
      { companyFolderId, masterSheetId },
      { stageKey: "cleanup", timeoutMs: DEFAULT_LOLER_STAGE_TIMEOUTS_MS.cleanup },
    );
    results.push({ kind: "bulk", ok: bulk.json?.ok === true, status: bulk.status });
  } catch (error) {
    results.push({ kind: "bulk", ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  if (verificationEquipmentId) {
    try {
      const single = await request(
        "POST",
        `/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment/${encodeURIComponent(verificationEquipmentId)}/verification-cleanup`,
        { companyFolderId, masterSheetId },
        { stageKey: "cleanup", timeoutMs: DEFAULT_LOLER_STAGE_TIMEOUTS_MS.cleanup },
      );
      const singleOk = single.status === 200 && single.json?.ok === true;
      results.push({
        kind: "single",
        equipmentId: verificationEquipmentId,
        ok: singleOk,
        status: single.status,
        rejected: single.status === 403,
      });
    } catch (error) {
      results.push({
        kind: "single",
        equipmentId: verificationEquipmentId,
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

function operationalSummaryFromEquipment(equipment = [], todayKey = getUkTodayKey()) {
  const operational = equipment.filter((item) => isOperationalLolerEquipment(item));
  return summarizeLolerEquipment(operational, todayKey);
}

function overviewMentionsVerificationEquipment(overview = {}, equipmentId = "") {
  const target = trim(equipmentId).toLowerCase();
  const attention = Array.isArray(overview.attentionItems) ? overview.attentionItems : [];
  return attention.some((item) => {
    const recordId = trim(item.recordId).toLowerCase();
    const id = trim(item.id).toLowerCase();
    return recordId === target || id.includes(target);
  });
}

async function pollEquipmentDetail(request, companyFolderId, masterSheetId, equipmentId, options = {}) {
  const maxAttempts = options.maxAttempts || 10;
  const intervalMs = options.intervalMs ?? 500;
  let lastResponse;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResponse = await request("GET", equipmentDetailPath(companyFolderId, equipmentId, masterSheetId), undefined, {
      stageKey: options.stageKey || "readback",
    });
    if (lastResponse.status === 200 && lastResponse.json?.ok === true && trim(lastResponse.json?.equipment?.id) === trim(equipmentId)) {
      return { ok: true, response: lastResponse, equipment: lastResponse.json.equipment };
    }
    if (intervalMs > 0 && attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  return { ok: false, response: lastResponse };
}

export async function runProductionLolerWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  const todayKey = getUkTodayKey();
  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || (() => {}),
      prefix: "[loler-workflow]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || LOLER_VERIFIER_BUDGET_MS,
      stageTimeouts: { ...DEFAULT_LOLER_STAGE_TIMEOUTS_MS, ...(options.stageTimeouts || {}) },
    });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const request = timedTransport.request.bind(timedTransport);

  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    verificationEquipmentId: "",
    verificationExamId: "",
    verificationFailExamId: "",
  };

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationLolerCleanup(request, workflowContext));
  }

  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    runId,
    durationMs: 0,
    accountEmail: config.expectedEmail || "",
  };

  let equipmentListCache = [];
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
      const cleanup = await attemptVerificationLolerCleanup(request, workflowContext);
      if (!cleanup.ok) {
        return fail(
          "cleanup",
          "Verification LOLER cleanup did not succeed.",
          "Inspect POST /api/companies/:id/loler/verification-cleanup and single-equipment cleanup.",
          500,
          cleanup,
        );
      }
      const listAfter = await request("GET", equipmentListPath(workflowContext.companyFolderId, workflowContext.masterSheetId), undefined, {
        stageKey: "cleanup",
      });
      const remaining = listActiveVerificationLolerEquipment(equipmentFromListResponse(listAfter));
      if (remaining.length > 0) {
        return fail(
          "cleanup",
          "Active verification equipment remains after cleanup.",
          "Inspect verification LOLER cleanup archive path.",
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

  const lolerApiFail = await runStage("lolerApi", async () => {
    let equipmentResponse;
    let schedulesResponse;
    let examinationsResponse;
    try {
      [equipmentResponse, schedulesResponse, examinationsResponse] = await Promise.all([
        requestWithTransientRetries(request, "GET", equipmentListPath(companyFolderId, masterSheetId), undefined, {
          stageKey: "lolerApi",
          maxRetries: 2,
        }).then((item) => item.response),
        requestWithTransientRetries(request, "GET", schedulesPath(companyFolderId, masterSheetId), undefined, {
          stageKey: "lolerApi",
          maxRetries: 2,
        }).then((item) => item.response),
        requestWithTransientRetries(request, "GET", examinationsPath(companyFolderId, masterSheetId), undefined, {
          stageKey: "lolerApi",
          maxRetries: 2,
        }).then((item) => item.response),
      ]);
    } catch (error) {
      return fail(
        "lolerApi",
        `LOLER API request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/companies/:id/loler/equipment, schedules, and examinations.",
      );
    }
    for (const [label, response, key] of [
      ["equipment", equipmentResponse, "equipment"],
      ["schedules", schedulesResponse, "schedules"],
      ["examinations", examinationsResponse, "examinations"],
    ]) {
      if (response.status !== 200 || response.json?.ok !== true) {
        return fail(
          "lolerApi",
          `LOLER ${label} list returned HTTP ${response.status}.`,
          "Inspect LOLER list routes and company workbook tabs.",
          response.status,
          response.json,
        );
      }
      if (!Array.isArray(response.json?.[key])) {
        return fail("lolerApi", `LOLER ${label} response is missing ${key} array.`, "Inspect LOLER list response shape.");
      }
    }
    equipmentListCache = equipmentFromListResponse(equipmentResponse);
    pass("lolerApi");
    return null;
  });
  if (lolerApiFail) {
    return lolerApiFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    const schedulesResponse = await request("GET", schedulesPath(companyFolderId, masterSheetId), undefined, { stageKey: "baseline" });
    const examinationsResponse = await request("GET", examinationsPath(companyFolderId, masterSheetId), undefined, { stageKey: "baseline" });
    const baseline = countLolerBaselines(
      equipmentListCache,
      schedulesFromResponse(schedulesResponse),
      examinationsFromResponse(examinationsResponse),
      todayKey,
    );
    result.baseline = baseline;
    baselineOperationalSummary = operationalSummaryFromEquipment(equipmentListCache, todayKey);
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

  skip("notifications", "LOLER notifications are client/background derived; no safe server notification API.");
  skip("search", "LOLER register search is client-side only.");

  if (!config.allowLolerMutation) {
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key, "BERT_SMOKE_ALLOW_LOLER_MUTATION is not enabled.");
    }
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const verificationEquipmentId = buildProductionVerificationLolerEquipmentId(runId);
  const verificationAssetId = buildProductionVerificationLolerAssetId(runId);
  const verificationExamId = buildProductionVerificationLolerExamId(runId);
  const verificationFailExamId = buildProductionVerificationLolerFailExamId(runId);
  const certReference = buildProductionVerificationLolerCertReference(runId);
  result.equipmentId = verificationEquipmentId;
  result.assetReference = verificationAssetId;
  workflowContext.verificationEquipmentId = verificationEquipmentId;
  workflowContext.verificationExamId = verificationExamId;
  workflowContext.verificationFailExamId = verificationFailExamId;

  const staleCleanupFail = await runStage("staleCleanup", async () => {
    const cleanupResponse = await request(
      "POST",
      `/api/companies/${encodeURIComponent(companyFolderId)}/loler/verification-cleanup`,
      { companyFolderId, masterSheetId, keepEquipmentId: verificationEquipmentId },
      { stageKey: "staleCleanup" },
    );
    if (cleanupResponse.status !== 200 || cleanupResponse.json?.ok !== true) {
      return fail(
        "staleCleanup",
        `Stale verification cleanup returned HTTP ${cleanupResponse.status}.`,
        "Inspect POST /api/companies/:id/loler/verification-cleanup.",
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

  const createFail = await runStage("createEquipment", async () => {
    const payload = buildProductionVerificationLolerEquipment({
      runId,
      equipmentId: verificationEquipmentId,
      assetId: verificationAssetId,
      assignedEmail: config.expectedEmail,
    });
    let createResponse;
    try {
      createResponse = await requestWithTransientRetries(
        request,
        "POST",
        verificationEquipmentPath(companyFolderId, masterSheetId),
        { ...payload, companyFolderId, masterSheetId, verificationSource: PRODUCTION_VERIFICATION_LOLER_SOURCE },
        { stageKey: "createEquipment", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
      ).then((item) => item.response);
    } catch (error) {
      if (isStageTimeoutError(error) || isTransientNetworkError(error)) {
        const polled = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
          stageKey: "createEquipment",
          maxAttempts: options.listPollMaxAttempts || 10,
          intervalMs: options.listPollIntervalMs ?? 500,
        });
        if (polled.ok) {
          mustRunCleanup = true;
          pass("createEquipment");
          return null;
        }
      }
      throw error;
    }
    if (createResponse.status !== 200 || createResponse.json?.ok !== true) {
      return fail(
        "createEquipment",
        `Create verification equipment returned HTTP ${createResponse.status}.`,
        "Inspect POST /api/companies/:id/loler/verification/equipment.",
        createResponse.status,
        createResponse.json,
      );
    }
    if (Number(createResponse.json?.updatedRows ?? 0) <= 0 && !createResponse.json?.alreadyExists) {
      return fail(
        "createEquipment",
        "Create equipment returned zero-row acknowledgement.",
        "Inspect LOLER equipment append acknowledgement from Sheets.",
        createResponse.status,
        createResponse.json,
      );
    }
    mustRunCleanup = true;
    pass("createEquipment");
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
    const polled = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "readback",
      maxAttempts: options.listPollMaxAttempts || 15,
      intervalMs: options.listPollIntervalMs ?? 500,
    });
    if (!polled.ok) {
      return fail(
        "readback",
        "Verification equipment was not visible on detail readback.",
        "Inspect equipment list/detail after create and Sheets visibility delay.",
        polled.response?.status,
        polled.response?.json,
      );
    }
    const equipment = polled.equipment;
    if (trim(equipment.assetId) !== verificationAssetId) {
      return fail("readback", "Asset reference mismatch on readback.", "Inspect verification equipment payload.", 200, equipment);
    }
    if (!isVerificationLolerEquipment(equipment)) {
      return fail("readback", "Verification marker missing on readback.", "Inspect Notes verification marker.", 200, equipment);
    }
    pass("readback");
    return null;
  });
  if (readbackFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || readbackFail;
  }

  const editFail = await runPostCreateStage("editEquipment", async () => {
    const editResponse = await request(
      "PATCH",
      verificationEquipmentPatchPath(companyFolderId, verificationEquipmentId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        siteName: "Rugby (edited)",
        ownerDepartment: "Verification (edited)",
        model: "Verification Sling (edited)",
      },
      { stageKey: "editEquipment" },
    );
    if (editResponse.status !== 200 || editResponse.json?.ok !== true) {
      return fail(
        "editEquipment",
        `Edit equipment returned HTTP ${editResponse.status}.`,
        "Inspect PATCH /api/companies/:id/loler/verification/equipment/:equipmentId.",
        editResponse.status,
        editResponse.json,
      );
    }
    const polled = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "editEquipment",
      maxAttempts: options.listPollMaxAttempts || 10,
      intervalMs: options.listPollIntervalMs ?? 500,
    });
    if (!polled.ok || !String(polled.equipment?.siteName || "").includes("(edited)")) {
      return fail("editEquipment", "Edited equipment fields did not persist on readback.", "Inspect equipment patch path.", 200, polled.equipment);
    }
    if (normalizeStatus(polled.equipment.status) !== "active") {
      return fail("editEquipment", "Equipment status changed unexpectedly after edit.", "Inspect equipment edit validation.", 200, polled.equipment);
    }
    pass("editEquipment");
    return null;
  });
  if (editFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || editFail;
  }

  const dueFail = await runPostCreateStage("dueCalculation", async () => {
    const polled = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "dueCalculation",
    });
    if (!polled.ok) {
      return fail("dueCalculation", "Could not load equipment for due calculation.", "Inspect equipment detail route.");
    }
    const equipment = polled.equipment;
    const expectedDue = calculateNextExaminationDueDate({
      lastExaminationDate: equipment.lastExaminationDate,
      examinationIntervalMonths: equipment.examinationIntervalMonths,
      nextExaminationDueDate: equipment.nextExaminationDueDate,
    });
    if (trim(equipment.nextExaminationDueDate) !== trim(expectedDue)) {
      return fail(
        "dueCalculation",
        "Next examination due date does not match shared LOLER date logic.",
        "Inspect calculateNextExaminationDueDate and equipment create defaults.",
        200,
        { expectedDue, actual: equipment.nextExaminationDueDate },
      );
    }
    const schedulesResponse = await request("GET", schedulesPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "dueCalculation",
    });
    const openForEquipment = schedulesFromResponse(schedulesResponse).filter(
      (item) => trim(item.equipmentId) === verificationEquipmentId && isOpenLolerScheduleStatus(item.scheduleStatus),
    );
    if (openForEquipment.length !== 1) {
      return fail(
        "dueCalculation",
        `Expected exactly one open LOLER schedule; found ${openForEquipment.length}.`,
        "Inspect syncOpenLolerSchedule after equipment create.",
        schedulesResponse.status,
        { openCount: openForEquipment.length },
      );
    }
    pass("dueCalculation");
    return null;
  });
  if (dueFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || dueFail;
  }

  const createExamFail = await runPostCreateStage("createExamination", async () => {
    const schedulesResponse = await request("GET", schedulesPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "createExamination",
    });
    const openSchedule = schedulesFromResponse(schedulesResponse).find(
      (item) => trim(item.equipmentId) === verificationEquipmentId && isOpenLolerScheduleStatus(item.scheduleStatus),
    );
    if (!openSchedule) {
      return fail(
        "createExamination",
        "No open due examination schedule exists for verification equipment.",
        "Inspect LOLER schedule sync after equipment create.",
        schedulesResponse.status,
        schedulesResponse.json,
      );
    }
    pass("createExamination");
    return null;
  });
  if (createExamFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || createExamFail;
  }

  const recordPassFail = await runPostCreateStage("recordPass", async () => {
    const polled = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "recordPass",
    });
    const equipment = polled.equipment || {};
    const passResponse = await requestWithTransientRetries(
      request,
      "POST",
      verificationPassPath(companyFolderId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        equipmentId: verificationEquipmentId,
        examinationId: verificationExamId,
        examinationDate: todayKey,
        examinerEmail: config.expectedEmail,
        examinerName: "Smoke Verifier",
        observations: `Satisfactory. Certificate ref ${certReference}.`,
        defectsFound: "None",
        nextExaminationDueDate: expectedNextExaminationDueDate(equipment, todayKey, todayKey),
      },
      { stageKey: "recordPass", maxRetries: 2, shouldRetry: isTransientWorkflowFailure },
    ).then((item) => item.response);
    if (passResponse.status !== 200 || passResponse.json?.ok !== true) {
      return fail(
        "recordPass",
        `Record PASS examination returned HTTP ${passResponse.status}.`,
        "Inspect POST /api/companies/:id/loler/verification/examinations/pass.",
        passResponse.status,
        passResponse.json,
      );
    }
    pass("recordPass");
    return null;
  });
  if (recordPassFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || recordPassFail;
  }

  const passVerifyFail = await runPostCreateStage("passVerification", async () => {
    const examsResponse = await request("GET", examinationsPath(companyFolderId, masterSheetId, verificationEquipmentId), undefined, {
      stageKey: "passVerification",
    });
    const exams = examinationsFromResponse(examsResponse).filter((item) => trim(item.examinationId) === verificationExamId);
    if (exams.length !== 1) {
      return fail(
        "passVerification",
        "Expected exactly one PASS examination on history readback.",
        "Inspect examination history after PASS completion.",
        examsResponse.status,
        { count: exams.length },
      );
    }
    const exam = exams[0];
    if (normalizeStatus(exam.examinationResult) !== "passed") {
      return fail("passVerification", "PASS examination result mismatch.", "Inspect examination result persistence.", 200, exam);
    }
    const detail = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "passVerification",
    });
    if (!detail.ok) {
      return fail("passVerification", "Could not reload equipment after PASS.", "Inspect equipment detail after examination.");
    }
    const equipment = detail.equipment;
    const expectedDue = expectedNextExaminationDueDate(
      equipment,
      equipment.lastExaminationDate || todayKey,
      todayKey,
    );
    if (trim(equipment.nextExaminationDueDate) !== trim(expectedDue)) {
      return fail(
        "passVerification",
        "Next examination due date did not advance correctly after PASS.",
        "Inspect examination completion date recalculation.",
        200,
        { expectedDue, actual: equipment.nextExaminationDueDate },
      );
    }
    if (normalizeStatus(equipment.status) !== "active") {
      return fail("passVerification", "Equipment status changed unexpectedly after PASS.", "Inspect PASS lifecycle rules.", 200, equipment);
    }
    pass("passVerification");
    return null;
  });
  if (passVerifyFail) {
    const terminal = await finalizeMutationWorkflow();
    return terminal || passVerifyFail;
  }

  await runPostCreateStage("defectFail", async () => {
    const failResponse = await request(
      "POST",
      verificationFailPath(companyFolderId, masterSheetId),
      {
        companyFolderId,
        masterSheetId,
        equipmentId: verificationEquipmentId,
        examinationId: verificationFailExamId,
        examinationDate: todayKey,
        examinerEmail: config.expectedEmail,
        examinerName: "Smoke Verifier",
        markOutOfService: true,
      },
      { stageKey: "defectFail" },
    );
    if (failResponse.status !== 200 || failResponse.json?.ok !== true) {
      skip("defectFail", "Isolated FAIL workflow is not safely supported on this deployment.");
      skip("restoreEquipment", "Restore skipped because FAIL workflow did not run.");
      return null;
    }
    const detail = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "defectFail",
    });
    if (!detail.ok || normalizeStatus(detail.equipment?.status) !== "out_of_service") {
      return fail(
        "defectFail",
        "FAIL examination did not mark verification equipment out of service.",
        "Inspect failed examination lifecycle rules.",
        failResponse.status,
        detail.equipment,
      );
    }
    pass("defectFail");
    return null;
  });

  await runPostCreateStage("restoreEquipment", async () => {
    if (result.checks.defectFail?.status !== "PASS") {
      return null;
    }
    const restoreResponse = await request(
      "POST",
      verificationRestorePath(companyFolderId, verificationEquipmentId, masterSheetId),
      { companyFolderId, masterSheetId },
      { stageKey: "restoreEquipment" },
    );
    if (restoreResponse.status !== 200 || restoreResponse.json?.ok !== true) {
      skip("restoreEquipment", "Restore route is not available on this deployment.");
      return null;
    }
    const detail = await pollEquipmentDetail(request, companyFolderId, masterSheetId, verificationEquipmentId, {
      stageKey: "restoreEquipment",
    });
    if (!detail.ok || normalizeStatus(detail.equipment?.status) !== "active") {
      return fail(
        "restoreEquipment",
        "Verification equipment was not returned to active service.",
        "Inspect return-to-service route for verification equipment.",
        restoreResponse.status,
        detail.equipment,
      );
    }
    pass("restoreEquipment");
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
    if (overviewMentionsVerificationEquipment(overview.json, verificationEquipmentId)) {
      return fail(
        "healthSafetyOverview",
        "Verification equipment appears in operational H&S overview attention items.",
        "Ensure isOperationalLolerEquipment excludes verification rows.",
        overview.status,
        overview.json,
      );
    }
    if (baselineHealthMetrics) {
      const metrics = overview.json.metrics || {};
      const keys = ["equipmentInspectionsOverdue", "equipmentInspectionsDueSoon", "equipmentOutOfService"];
      for (const key of keys) {
        if (Number(metrics[key]) > Number(baselineHealthMetrics[key] || 0) + 1) {
          return fail(
            "healthSafetyOverview",
            `Operational H&S LOLER metric ${key} increased beyond baseline tolerance.`,
            "Filter verification equipment from health-safety overview metrics.",
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
    const listResponse = await request("GET", equipmentListPath(companyFolderId, masterSheetId), undefined, {
      stageKey: "dashboard",
    });
    if (listResponse.status !== 200 || listResponse.json?.ok !== true) {
      return fail(
        "dashboard",
        `LOLER equipment list returned HTTP ${listResponse.status}.`,
        "Inspect GET /api/companies/:id/loler/equipment summary.",
        listResponse.status,
        listResponse.json,
      );
    }
    const equipment = equipmentFromListResponse(listResponse);
    const operationalSummary = operationalSummaryFromEquipment(equipment, todayKey);
    if (baselineOperationalSummary) {
      for (const key of ["overdue", "dueSoon", "outOfService"]) {
        if (Number(operationalSummary[key]) > Number(baselineOperationalSummary[key] || 0) + 1) {
          return fail(
            "dashboard",
            `Operational LOLER summary ${key} count increased beyond baseline tolerance.`,
            "Ensure verification equipment is excluded from operational LOLER summary counts.",
            listResponse.status,
            { key, baseline: baselineOperationalSummary[key], current: operationalSummary[key] },
          );
        }
      }
    }
    const verificationItem = findLolerEquipmentById(equipment, verificationEquipmentId);
    if (verificationItem && !isVerificationLolerEquipment(verificationItem)) {
      return fail("dashboard", "Verification equipment missing marker in register.", "Inspect verification equipment markers.");
    }
    pass("dashboard");
    return null;
  });

  const terminal = await finalizeMutationWorkflow();
  return terminal || result;
}
