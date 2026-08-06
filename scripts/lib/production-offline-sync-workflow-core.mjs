/**
 * Production Offline Sync workflow checks — assigned audit offline queue path.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  cleanupStaleVerificationResults,
  countVerificationAuditResults,
  flattenAssignedAudits,
  listActiveVerificationAuditResults,
  loadAuditWorkflowConfig,
  pickWorkflowTarget,
} from "./production-audit-workflow-core.mjs";
import {
  buildProductionOfflineRunId,
  isVerificationOfflineQueueItem,
  isVerificationOfflineRunId,
} from "../../shared/production-verification-offline-sync.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
} from "../../shared/production-verification-audit.mjs";
import {
  buildTimeoutFailureResult,
  createWorkflowDiagnostics,
  isStageTimeoutError,
  wrapTransportWithTimeouts,
} from "./production-workflow-diagnostics.mjs";
import { createOfflineSyncStorageSimulator } from "./offline-sync-storage-simulator.mjs";

export { performProductionSmokeLogin, maskEmail, createOfflineSyncStorageSimulator };

export const OFFLINE_SYNC_VERIFIER_BUDGET_MS = 15 * 60 * 1000;

export const DEFAULT_OFFLINE_SYNC_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  offlineCapability: 60_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  loadAssignedCheck: 90_000,
  goOffline: 30_000,
  startAuditOffline: 60_000,
  saveDraftOffline: 30_000,
  resumeDraftOffline: 30_000,
  editDraftOffline: 30_000,
  submitOffline: 30_000,
  offlineReload: 30_000,
  restoreConnectivity: 30_000,
  syncQueue: 180_000,
  serverResult: 120_000,
  queueCleanup: 60_000,
  dashboard: 60_000,
  duplicateProtection: 120_000,
  notification: 5_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "offlineCapability",
  "baseline",
  "staleCleanup",
  "loadAssignedCheck",
  "goOffline",
  "startAuditOffline",
  "saveDraftOffline",
  "resumeDraftOffline",
  "editDraftOffline",
  "submitOffline",
  "offlineReload",
  "restoreConnectivity",
  "syncQueue",
  "serverResult",
  "queueCleanup",
  "dashboard",
  "duplicateProtection",
  "notification",
  "cleanup",
];

export const CHECK_LABELS = Object.fromEntries(
  CHECK_KEYS.map((key) => [
    key,
    key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (char) => char.toUpperCase())
      .replace("Go Offline", "Go Offline")
      .replace("Offline Reload", "Offline Reload")
      .replace("Sync Queue", "Sync Queue")
      .replace("Server Result", "Server Result")
      .replace("Queue Cleanup", "Queue Cleanup")
      .replace("Duplicate Protection", "Duplicate Protection")
      .trim(),
  ]),
);

CHECK_LABELS.offlineCapability = "Offline Capability";
CHECK_LABELS.loadAssignedCheck = "Load Assigned Check";
CHECK_LABELS.goOffline = "Go Offline";
CHECK_LABELS.startAuditOffline = "Start Audit Offline";
CHECK_LABELS.saveDraftOffline = "Save Draft Offline";
CHECK_LABELS.resumeDraftOffline = "Resume Draft Offline";
CHECK_LABELS.editDraftOffline = "Edit Draft Offline";
CHECK_LABELS.submitOffline = "Submit Offline";
CHECK_LABELS.offlineReload = "Offline Reload";
CHECK_LABELS.restoreConnectivity = "Restore Connectivity";
CHECK_LABELS.syncQueue = "Sync Queue";
CHECK_LABELS.serverResult = "Server Result";
CHECK_LABELS.queueCleanup = "Queue Cleanup";
CHECK_LABELS.duplicateProtection = "Duplicate Protection";

const MUTATION_CHECK_KEYS = new Set(
  CHECK_KEYS.filter((key) => !["authentication", "offlineCapability", "baseline"].includes(key)),
);

const REPORT_LABEL_WIDTH = 28;

function trim(value) {
  return String(value ?? "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadOfflineSyncWorkflowConfig(env = process.env) {
  const auditConfig = loadAuditWorkflowConfig(env);
  const allowOfflineMutation =
    trim(env.BERT_SMOKE_ALLOW_OFFLINE_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_OFFLINE_MUTATION).toLowerCase() === "true";
  return {
    ...auditConfig,
    allowOfflineMutation,
    appOrigin: trim(env.BERT_SMOKE_APP_ORIGIN) || "https://app.usebert.co.uk",
    totalBudgetMs: OFFLINE_SYNC_VERIFIER_BUDGET_MS,
  };
}

export function logOfflineTiming(log, input = {}) {
  const payload = {
    operation: input.operation || "offline-sync",
    stage: input.stage || "",
    runId: input.runId || "",
    queueItemId: input.queueItemId || "",
    scheduleId: input.scheduleId || "",
    durationMs: input.durationMs ?? 0,
    totalMs: input.totalMs ?? 0,
  };
  log(`[offline-sync:timing] ${JSON.stringify(payload)}`);
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

export function formatOfflineSyncWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Offline Sync Workflow",
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
  if (result.appSha) {
    lines.push(`App SHA: ${result.appSha}`);
  }
  if (result.accountEmail) {
    lines.push(`Account: ${maskEmail(result.accountEmail)}`);
  }
  if (result.offlineRunId) {
    lines.push(`Offline Run ID: ${result.offlineRunId}`);
  }
  if (result.durationMs) {
    lines.push(`Duration: ${result.durationMs}ms`);
  }
  if (result.performance) {
    lines.push("");
    lines.push("Performance:");
    for (const [key, value] of Object.entries(result.performance)) {
      lines.push(`  ${key}: ${value}ms`);
    }
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

function extractResultField(record = {}, keys = []) {
  const normalizedKeys = keys.map((key) => trim(key).toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = trim(header).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      const text = trim(value);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

async function fetchAuditResults(request, companyFolderId, masterSheetId) {
  return request(
    "GET",
    `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results?masterSheetId=${encodeURIComponent(masterSheetId)}`,
  );
}

export async function runProductionOfflineSyncWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  const offlineRunId = buildProductionOfflineRunId(runId);
  const offlineClient =
    options.offlineClient ||
    createOfflineSyncStorageSimulator({
      config,
      request: transport.request.bind(transport),
      runId,
      offlineRunId,
    });
  offlineClient.offlineRunId = offlineRunId;

  let currentStageKey = "authentication";
  const diagnostics =
    options.diagnostics ||
    createWorkflowDiagnostics({
      log: options.logStage || ((line) => console.log(line)),
      prefix: "[offline-sync]",
      stageLabels: CHECK_LABELS,
      startedAt,
      totalBudgetMs: Number(config.totalBudgetMs) || OFFLINE_SYNC_VERIFIER_BUDGET_MS,
      stageTimeouts: DEFAULT_OFFLINE_SYNC_STAGE_TIMEOUTS_MS,
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
    offlineRunId,
    resultId: "",
  };
  let mustRunCleanup = false;
  let baselineVerificationResults = 0;
  let baselineDashboardCompletions = null;
  const performance = {};

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptVerificationCleanup(request, workflowContext, config));
  }

  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    offlineRunId,
    accountEmail: config.expectedEmail || "",
    durationMs: 0,
    performance,
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

  async function runStage(stageKey, fn) {
    currentStageKey = stageKey;
    diagnostics.beginStage(stageKey, CHECK_LABELS[stageKey]);
    const stageStarted = Date.now();
    try {
      const earlyExit = await fn();
      const failed = Boolean(earlyExit?.failedKey);
      diagnostics.endStage(stageKey, failed ? "FAIL" : "PASS", Date.now() - stageStarted);
      logOfflineTiming(options.logStage || console.log, {
        operation: "stage",
        stage: stageKey,
        runId: offlineRunId,
        durationMs: Date.now() - stageStarted,
        totalMs: Date.now() - startedAt,
      });
      return earlyExit;
    } catch (error) {
      diagnostics.endStage(stageKey, "FAIL", Date.now() - stageStarted);
      if (isStageTimeoutError(error)) {
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
          timeoutMeta.failureReason,
          timeoutMeta.remediation,
          timeoutMeta.httpStatus,
          { timeout: true },
          { timedOut: true },
        );
      }
      return fail(
        stageKey,
        `${CHECK_LABELS[stageKey]} failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect offline sync workflow stage logs.",
      );
    }
  }

  async function attemptVerificationCleanup(requestFn, context, cfg) {
    const companyFolderId = trim(context.companyFolderId);
    const masterSheetId = trim(context.masterSheetId);
    const results = [];
    try {
      await offlineClient.cleanupLocalVerification();
      results.push({ kind: "local", ok: true });
    } catch (error) {
      results.push({ kind: "local", ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    if (context.resultId && companyFolderId) {
      try {
        const cleanup = await requestFn(
          "POST",
          `/api/companies/${encodeURIComponent(companyFolderId)}/audit-results/${encodeURIComponent(context.resultId)}/verification-cleanup`,
          {
            companyFolderId,
            masterSheetId,
            localSubmissionId: context.offlineRunId,
          },
        );
        results.push({ kind: "server", ok: cleanup.status === 200 && cleanup.json?.ok === true, status: cleanup.status });
      } catch (error) {
        results.push({ kind: "server", ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    } else if (companyFolderId) {
      const stale = await cleanupStaleVerificationResults(requestFn, companyFolderId, masterSheetId, cfg);
      results.push({ kind: "stale", ok: stale.ok, cleanedCount: stale.cleanedCount });
    }
    return { ok: results.some((item) => item.ok), results };
  }

  const authFail = await runStage("authentication", async () => {
    const health = await request("GET", "/api/health");
    assertResponseSafe(health.json, "health");
    if (health.status !== 200 || health.json?.ok !== true) {
      return fail("authentication", `API health returned HTTP ${health.status}.`, "Wait for API readiness.", health.status, health.json);
    }
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    result.shortSha = trim(health.json?.shortSha);
    const login = await performProductionSmokeLogin(config, timedTransport, options);
    if (!login.ok) {
      return fail(
        "authentication",
        login.failureReason || "Production login failed.",
        login.remediation || "Inspect smoke credentials.",
        login.httpStatus,
        login.responseBody,
      );
    }
    result.accountEmail = login.accountEmail || config.expectedEmail;
    workflowContext.companyFolderId = trim(login.companyFolderId || config.companyFolderId);
    workflowContext.masterSheetId = trim(login.masterSheetId || config.masterSheetId);
    pass("authentication");
    return null;
  });
  if (authFail) {
    return authFail;
  }

  const capabilityFail = await runStage("offlineCapability", async () => {
    if (!offlineClient.capabilityAvailable) {
      return fail(
        "offlineCapability",
        "Offline capability is unavailable in the current client.",
        "Confirm IndexedDB queue stores and offline listeners are present in the production build.",
      );
    }
    if (!offlineClient.serviceWorkerRegistered && options.requireServiceWorker !== false) {
      return fail(
        "offlineCapability",
        "Service worker is not registered.",
        "Confirm production PWA service worker registration.",
      );
    }
    if (!offlineClient.onlineListenerRegistered) {
      return fail(
        "offlineCapability",
        "Online/offline listener is not registered.",
        "Inspect App.tsx navigator online/offline handlers.",
      );
    }
    pass("offlineCapability");
    return null;
  });
  if (capabilityFail) {
    return capabilityFail;
  }

  const baselineFail = await runStage("baseline", async () => {
    const localBaseline = offlineClient.getBaseline();
    const auditResults = await fetchAuditResults(request, workflowContext.companyFolderId, workflowContext.masterSheetId);
    if (auditResults.status !== 200 || auditResults.json?.ok !== true) {
      return fail(
        "baseline",
        `Audit results baseline returned HTTP ${auditResults.status}.`,
        "Inspect GET /api/companies/:id/audit-results.",
        auditResults.status,
        auditResults.json,
      );
    }
    const results = Array.isArray(auditResults.json?.results) ? auditResults.json.results : [];
    baselineVerificationResults = countVerificationAuditResults(results, config);
    const dashboard = await request(
      "GET",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/dashboard/live?masterSheetId=${encodeURIComponent(workflowContext.masterSheetId)}`,
    );
    if (dashboard.status === 200 && dashboard.json?.ok === true) {
      baselineDashboardCompletions = Number(dashboard.json?.metrics?.completedChecks);
    }
    result.baseline = { ...localBaseline, verificationAuditResults: baselineVerificationResults };
    pass("baseline");
    return null;
  });
  if (baselineFail) {
    return baselineFail;
  }

  if (!config.allowOfflineMutation) {
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

  const staleFail = await runStage("staleCleanup", async () => {
    await offlineClient.staleCleanupVerification();
    const staleServer = await cleanupStaleVerificationResults(
      request,
      workflowContext.companyFolderId,
      workflowContext.masterSheetId,
      config,
    );
    if (!staleServer.ok) {
      return fail("staleCleanup", "Stale verification audit result cleanup failed.", "Inspect verification cleanup routes.");
    }
    pass("staleCleanup");
    return null;
  });
  if (staleFail) {
    return staleFail;
  }

  const loadFail = await runStage("loadAssignedCheck", async () => {
    const loadStarted = Date.now();
    let assigned;
    try {
      assigned = await request("GET", "/api/me/assigned-checks");
    } catch (error) {
      return fail(
        "loadAssignedCheck",
        `Assigned checks request failed: ${error instanceof Error ? error.message : String(error)}`,
        "Inspect GET /api/me/assigned-checks.",
      );
    }
    if (assigned.status !== 200 || assigned.json?.ok !== true) {
      return fail(
        "loadAssignedCheck",
        `Assigned checks returned HTTP ${assigned.status}.`,
        "Ensure bert-sch-production-verification is assigned to the smoke account.",
        assigned.status,
        assigned.json,
      );
    }
    const schedules = Array.isArray(assigned.json?.schedules) ? assigned.json.schedules : [];
    const assignedRows = flattenAssignedAudits(schedules);
    const { submitTarget } = pickWorkflowTarget(assignedRows, config);
    if (!submitTarget) {
      return fail(
        "loadAssignedCheck",
        "Verification assigned check was not found.",
        "Run npm run ensure:production-verification-audit and confirm schedule assignment.",
        assigned.status,
        assigned.json,
      );
    }
    if (!offlineClient.templateCached) {
      return fail("loadAssignedCheck", "Audit template was not cached for offline use.", "Load assigned check online before going offline.");
    }
    await offlineClient.loadAssignedCheckOnline();
    performance.loadAssignedCheckMs = Date.now() - loadStarted;
    pass("loadAssignedCheck");
    return null;
  });
  if (loadFail) {
    return loadFail;
  }

  const goOfflineFail = await runStage("goOffline", async () => {
    offlineClient.setOffline(true);
    if (!offlineClient.isOffline()) {
      return fail("goOffline", "Client did not enter offline mode.", "Use real browser/network offline simulation.");
    }
    pass("goOffline");
    return null;
  });
  if (goOfflineFail) {
    return goOfflineFail;
  }

  const startFail = await runStage("startAuditOffline", async () => {
    const started = await offlineClient.startAuditOffline();
    if (!isVerificationOfflineRunId(started.offlineRunId)) {
      return fail("startAuditOffline", "Offline run ID marker is missing.", "Attach bert-smoke-offline-{runId} to offline workflow.");
    }
    if (offlineClient.serverWriteCount > 0) {
      return fail("startAuditOffline", "Server write occurred before offline start.", "Do not submit online before offline stages.");
    }
    pass("startAuditOffline");
    return null;
  });
  if (startFail) {
    return startFail;
  }

  const saveDraftFail = await runStage("saveDraftOffline", async () => {
    const saveStarted = Date.now();
    const draft = await offlineClient.saveDraftOffline();
    if (!draft?.draftId) {
      return fail("saveDraftOffline", "Draft was not saved locally.", "Inspect bert-workspace-state draft persistence.");
    }
    performance.draftSaveMs = Date.now() - saveStarted;
    pass("saveDraftOffline");
    return null;
  });
  if (saveDraftFail) {
    mustRunCleanup = true;
    const cleanupResult = await runStage("cleanup", async () => {
      const cleaned = await attemptVerificationCleanup(request, workflowContext, config);
      if (!cleaned.ok) {
        return fail("cleanup", "Verification cleanup failed after draft save failure.", "Run manual verification cleanup.");
      }
      pass("cleanup");
      return null;
    });
    return cleanupResult || saveDraftFail;
  }

  const resumeFail = await runStage("resumeDraftOffline", async () => {
    const draft = await offlineClient.resumeDraftOffline();
    if (!draft?.answers || Object.keys(draft.answers).length === 0) {
      return fail("resumeDraftOffline", "Draft answers were not restored.", "Inspect offline draft reload path.");
    }
    pass("resumeDraftOffline");
    return null;
  });
  if (resumeFail) {
    mustRunCleanup = true;
    await attemptVerificationCleanup(request, workflowContext, config);
    return resumeFail;
  }

  const editFail = await runStage("editDraftOffline", async () => {
    const edited = await offlineClient.editDraftOffline({
      answers: { "bert-verify-q1": "pass" },
      notes: { "bert-verify-q1": "Edited during offline verification." },
    });
    if (!edited?.updatedAt) {
      return fail("editDraftOffline", "Draft edit did not persist.", "Inspect offline draft update path.");
    }
    pass("editDraftOffline");
    return null;
  });
  if (editFail) {
    mustRunCleanup = true;
    await attemptVerificationCleanup(request, workflowContext, config);
    return editFail;
  }

  const submitFail = await runStage("submitOffline", async () => {
    const enqueueStarted = Date.now();
    const queued = await offlineClient.submitOffline();
    if (!queued?.queueItem || queued.queueItem.status !== "queued") {
      return fail("submitOffline", "Offline submission was not queued.", "Inspect submissionQueue enqueue path.");
    }
    if (!isVerificationOfflineQueueItem(queued.queueItem)) {
      return fail("submitOffline", "Queue item is missing verification marker.", "Attach production-offline-sync-workflow marker.");
    }
    if (offlineClient.serverWriteCount > 0) {
      return fail("submitOffline", "Server write occurred while offline.", "Queue submission must not call API while offline.");
    }
    performance.queueEnqueueMs = Date.now() - enqueueStarted;
    mustRunCleanup = true;
    pass("submitOffline");
    return null;
  });
  if (submitFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return submitFail;
  }

  const reloadFail = await runStage("offlineReload", async () => {
    const reloaded = await offlineClient.reloadWhileOffline();
    if (!reloaded?.queueItem) {
      return fail("offlineReload", "Queue item did not survive reload.", "Inspect IndexedDB queue persistence.");
    }
    pass("offlineReload");
    return null;
  });
  if (reloadFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return reloadFail;
  }

  const restoreFail = await runStage("restoreConnectivity", async () => {
    const reconnectStarted = Date.now();
    await offlineClient.restoreConnectivity();
    if (offlineClient.isOffline()) {
      return fail("restoreConnectivity", "Client remained offline after reconnect.", "Inspect online event handling.");
    }
    performance.reconnectDetectionMs = Date.now() - reconnectStarted;
    pass("restoreConnectivity");
    return null;
  });
  if (restoreFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return restoreFail;
  }

  const syncFail = await runStage("syncQueue", async () => {
    const syncStarted = Date.now();
    if (options.manualSyncFallback) {
      offlineClient.manualSyncRequired = true;
      const pending = await offlineClient.syncQueue(false);
      if (!pending?.skipped) {
        return fail("syncQueue", "Expected manual sync fallback to defer automatic sync.", "Inspect reconnect sync trigger.");
      }
      const manual = await offlineClient.syncQueue(true);
      if (!manual?.ok) {
        return fail("syncQueue", "Manual sync fallback failed.", "Inspect Sync Centre manual sync action.");
      }
    } else if (options.transientSyncFailureOnce) {
      offlineClient.transientSyncFailureOnce = true;
      try {
        await offlineClient.syncQueue(true);
        return fail("syncQueue", "Expected transient sync failure.", "Inspect retry handling.");
      } catch {
        const recovered = await offlineClient.syncQueue(true);
        if (!recovered?.ok) {
          return fail("syncQueue", "Transient sync failure did not recover.", "Inspect queue retry/backoff.");
        }
      }
    } else {
      const synced = await offlineClient.syncQueue(true);
      if (!synced?.ok) {
        return fail("syncQueue", "Queue sync did not complete.", "Inspect syncOfflineSubmissions replay path.");
      }
      workflowContext.resultId = trim(synced.resultId);
      result.submittedResultId = workflowContext.resultId;
    }
    performance.syncDurationMs = Date.now() - syncStarted;
    pass("syncQueue");
    return null;
  });
  if (syncFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return syncFail;
  }

  const serverFail = await runStage("serverResult", async () => {
    const verifyStarted = Date.now();
    const auditResults = await fetchAuditResults(request, workflowContext.companyFolderId, workflowContext.masterSheetId);
    if (auditResults.status !== 200 || auditResults.json?.ok !== true) {
      return fail("serverResult", `Audit results returned HTTP ${auditResults.status}.`, "Inspect audit results after sync.");
    }
    const results = Array.isArray(auditResults.json?.results) ? auditResults.json.results : [];
    const active = listActiveVerificationAuditResults(results, config).filter(
      (row) => extractResultField(row, ["local submission id", "localsubmissionid"]) === offlineRunId,
    );
    if (active.length !== 1) {
      return fail(
        "serverResult",
        `Expected exactly one verification result for ${offlineRunId}, found ${active.length}.`,
        "Inspect duplicate submission protection.",
        auditResults.status,
        { activeCount: active.length },
      );
    }
    const row = active[0];
    if (extractResultField(row, ["schedule id", "scheduleid"]) !== PRODUCTION_VERIFICATION_SCHEDULE_ID) {
      return fail("serverResult", "Verification result schedule ID mismatch.", "Inspect offline replay payload.");
    }
    if (extractResultField(row, ["audit id", "auditid"]) !== PRODUCTION_VERIFICATION_AUDIT_ID) {
      return fail("serverResult", "Verification result audit ID mismatch.", "Inspect offline replay payload.");
    }
    workflowContext.resultId = extractResultField(row, ["result id", "resultid", "id"]) || workflowContext.resultId;
    result.submittedResultId = workflowContext.resultId;
    performance.serverConfirmationMs = Date.now() - verifyStarted;
    pass("serverResult");
    return null;
  });
  if (serverFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return serverFail;
  }

  const queueCleanupFail = await runStage("queueCleanup", async () => {
    const state = offlineClient.getQueueState();
    const pendingVerification = state.items.filter((item) => isVerificationOfflineQueueItem(item));
    if (pendingVerification.length > 0) {
      return fail("queueCleanup", "Verification queue items remain after sync.", "Inspect queue removal after markSynced.");
    }
    if (state.submissions.some((item) => isVerificationOfflineRunId(item.localSubmissionId))) {
      return fail("queueCleanup", "Verification offline submissions remain after sync.", "Inspect offlineSubmissions cleanup.");
    }
    pass("queueCleanup");
    return null;
  });
  if (queueCleanupFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return queueCleanupFail;
  }

  const dashboardFail = await runStage("dashboard", async () => {
    const dashboard = await request(
      "GET",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/dashboard/live?masterSheetId=${encodeURIComponent(workflowContext.masterSheetId)}`,
    );
    if (dashboard.status !== 200 || dashboard.json?.ok !== true) {
      return fail("dashboard", `Dashboard returned HTTP ${dashboard.status}.`, "Inspect live dashboard.");
    }
    const actToday = Array.isArray(dashboard.json?.actToday) ? dashboard.json.actToday : [];
    if (actToday.some((item) => String(item?.id || "").includes(offlineRunId))) {
      return fail("dashboard", "Verification offline result appears in Act Today.", "Inspect operational exclusion.");
    }
    if (
      Number.isFinite(baselineDashboardCompletions) &&
      Number.isFinite(dashboard.json?.metrics?.completedChecks) &&
      dashboard.json.metrics.completedChecks > baselineDashboardCompletions + 1
    ) {
      return fail(
        "dashboard",
        "Dashboard completion count increased beyond verification allowance.",
        "Inspect isOperationalAuditResult exclusion.",
      );
    }
    pass("dashboard");
    return null;
  });
  if (dashboardFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return dashboardFail;
  }

  const duplicateFail = await runStage("duplicateProtection", async () => {
    if (options.skipDuplicateProtection !== false) {
      skip("duplicateProtection", "Covered by dedicated duplicate/idempotency unit test.");
      return null;
    }
    const dupStarted = Date.now();
    const secondSync = await offlineClient.syncQueue(true);
    if (!secondSync?.ok && !secondSync?.alreadySynced) {
      return fail("duplicateProtection", "Repeated sync did not resolve idempotently.", "Inspect queue processor idempotency.");
    }
    const auditResults = await fetchAuditResults(request, workflowContext.companyFolderId, workflowContext.masterSheetId);
    const results = Array.isArray(auditResults.json?.results) ? auditResults.json.results : [];
    const active = listActiveVerificationAuditResults(results, config).filter(
      (row) => extractResultField(row, ["local submission id", "localsubmissionid"]) === offlineRunId,
    );
    if (active.length !== 1) {
      return fail("duplicateProtection", `Duplicate protection failed — ${active.length} active results.`, "Inspect server idempotency.");
    }
    performance.duplicateProtectionMs = Date.now() - dupStarted;
    pass("duplicateProtection");
    return null;
  });
  if (duplicateFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return duplicateFail;
  }

  const notificationFail = await runStage("notification", async () => {
    skip("notification", "Offline sync notifications are client-cache derived; no server notification API.");
    return null;
  });
  if (notificationFail) {
    await attemptVerificationCleanup(request, workflowContext, config);
    return notificationFail;
  }

  const cleanupFail = await runStage("cleanup", async () => {
    const cleaned = await attemptVerificationCleanup(request, workflowContext, config);
    if (!cleaned.ok) {
      return fail("cleanup", "Verification cleanup failed.", "Run manual audit-results verification cleanup.", 0, cleaned);
    }
    const auditResults = await fetchAuditResults(request, workflowContext.companyFolderId, workflowContext.masterSheetId);
    const results = Array.isArray(auditResults.json?.results) ? auditResults.json.results : [];
    const remaining = listActiveVerificationAuditResults(results, config).filter(
      (row) => extractResultField(row, ["local submission id", "localsubmissionid"]) === offlineRunId,
    );
    if (remaining.length > 0) {
      return fail("cleanup", "Verification audit result remains after cleanup.", "Inspect verification cleanup route.");
    }
    pass("cleanup");
    return null;
  });
  if (cleanupFail) {
    return cleanupFail;
  }

  result.ok = true;
  result.durationMs = Date.now() - startedAt;
  result.performance = performance;
  return result;
}
