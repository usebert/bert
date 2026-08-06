#!/usr/bin/env node
/**
 * Unit tests for production Offline Sync workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import { createOfflineSyncStorageSimulator } from "./lib/offline-sync-storage-simulator.mjs";
import {
  CHECK_KEYS,
  formatOfflineSyncWorkflowReport,
  loadOfflineSyncWorkflowConfig,
  resolveOfflineBrowserProbeEnabled,
  runProductionOfflineSyncWorkflowChecks,
} from "./lib/production-offline-sync-workflow-core.mjs";
import {
  buildProductionOfflineRunId,
  isVerificationOfflineQueueItem,
  isVerificationOfflineRunId,
} from "../shared/production-verification-offline-sync.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
} from "../shared/production-verification-audit.mjs";

const baseConfig = loadOfflineSyncWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_OFFLINE_MUTATION: "1",
});

const TEST_RUN_ID = 424242;
const OFFLINE_RUN_ID = buildProductionOfflineRunId(TEST_RUN_ID);
const defaultRunOptions = { runId: TEST_RUN_ID, skipDuplicateProtection: true };

function verificationAssignedSchedule() {
  return {
    id: PRODUCTION_VERIFICATION_SCHEDULE_ID,
    scheduleName: "BERT Verification Audit",
    audits: [{ auditId: PRODUCTION_VERIFICATION_AUDIT_ID, auditName: "BERT Verification Audit" }],
    assignedUserEmails: [baseConfig.expectedEmail],
  };
}

function createTransport(options = {}) {
  const cookies = new Map();
  let auditResults = options.initialResults ? [...options.initialResults] : [];
  let completeCount = 0;
  let completeResponses = new Map();

  const request = async (method, path, body) => {
    const pathname = (path.split("?")[0] || path).replace(/\/$/, "");

    if (method === "GET" && pathname === "/api/health") {
      return { status: 200, json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" } };
    }
    if (method === "POST" && pathname === "/api/auth/company/login") {
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: "Admin", name: "Mr Important", companyFolderId: baseConfig.companyFolderId },
          company: { companyFolderId: baseConfig.companyFolderId, companyName: "Dovecote Demo", live: true },
          masterSheetId: baseConfig.masterSheetId,
        },
      };
    }
    if (method === "GET" && pathname === "/api/auth/company/session") {
      return {
        status: 200,
        json: { ok: true, user: { email: baseConfig.expectedEmail, role: "Admin" }, company: { companyFolderId: baseConfig.companyFolderId } },
      };
    }
    if (method === "GET" && pathname === "/api/me/assigned-checks") {
      if (options.assignedMissing) {
        return { status: 200, json: { ok: true, schedules: [] } };
      }
      return { status: 200, json: { ok: true, schedules: [verificationAssignedSchedule()] } };
    }
    if (method === "GET" && pathname.includes("/audit-results")) {
      return { status: 200, json: { ok: true, results: auditResults } };
    }
    if (method === "GET" && pathname.includes("/dashboard/live")) {
      return {
        status: 200,
        json: {
          ok: true,
          metrics: { completedChecks: options.dashboardCompletionCount ?? 2, pendingBriefings: 0 },
          actToday: options.dashboardIncludesVerification
            ? [{ id: `result-${OFFLINE_RUN_ID}`, type: "audit" }]
            : [],
        },
      };
    }
    if (method === "POST" && pathname.includes("/checks/") && pathname.endsWith("/complete")) {
      completeCount += 1;
      const localSubmissionId = body?.localSubmissionId;
      if (options.completeFails) {
        return { status: 500, json: { ok: false, code: "COMPLETE_FAILED" } };
      }
      if (completeResponses.has(localSubmissionId)) {
        return { status: 200, json: { ok: true, alreadyExists: true, duplicate: true, resultId: completeResponses.get(localSubmissionId) } };
      }
      const resultId = `result-${localSubmissionId}`;
      completeResponses.set(localSubmissionId, resultId);
      auditResults.push({
        "Result ID": resultId,
        "Schedule ID": PRODUCTION_VERIFICATION_SCHEDULE_ID,
        "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
        Status: "verification",
        "Local Submission ID": localSubmissionId,
        "Completed By": baseConfig.expectedEmail,
      });
      return { status: 200, json: { ok: true, resultId } };
    }
    if (method === "POST" && pathname.includes("/verification-cleanup")) {
      if (options.cleanupFails) {
        return { status: 500, json: { ok: false } };
      }
      const resultId = pathname.split("/").filter(Boolean).at(-2);
      auditResults = auditResults.map((row) =>
        row["Result ID"] === resultId ? { ...row, Status: "verification-cleaned" } : row,
      );
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    getCompleteCount: () => completeCount,
    getAuditResults: () => auditResults,
  };
}

function createOfflineClient(transport, options = {}) {
  return createOfflineSyncStorageSimulator({
    config: baseConfig,
    request: transport.request,
    runId: TEST_RUN_ID,
    offlineRunId: OFFLINE_RUN_ID,
    ...options,
  });
}

async function runWorkflow(transportOptions = {}, workflowOptions = {}) {
  const transport = createTransport(transportOptions);
  const offlineClient = createOfflineClient(transport, workflowOptions.offlineClientOptions);
  const result = await runProductionOfflineSyncWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    ...workflowOptions,
    offlineClient,
    logStage: () => {},
  });
  return { result, transport, offlineClient };
}

test("full successful offline workflow", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.ok, true);
  for (const key of [
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
    "cleanup",
  ]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
  assert.equal(result.checks.duplicateProtection.status, "SKIP");
  assert.equal(result.checks.notification.status, "SKIP");
  assert.match(formatOfflineSyncWorkflowReport(result), /READY FOR CUSTOMERS/);
  assert.equal(result.offlineRunId, OFFLINE_RUN_ID);
});

test("login failure", async () => {
  const { result } = await runWorkflow({ loginFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("offline capability unavailable", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport, { capabilityAvailable: false });
  const result = await runProductionOfflineSyncWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    offlineClient,
  });
  assert.equal(result.failedKey, "offlineCapability");
});

test("mutation disabled", async () => {
  const config = { ...baseConfig, allowOfflineMutation: false };
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  const result = await runProductionOfflineSyncWorkflowChecks(config, transport, {
    ...defaultRunOptions,
    offlineClient,
    logStage: () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.submitOffline.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale cleanup", async () => {
  const transport = createTransport({
    initialResults: [
      {
        "Result ID": "stale-result",
        "Schedule ID": PRODUCTION_VERIFICATION_SCHEDULE_ID,
        "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
        Status: "verification",
        "Local Submission ID": "bert-smoke-offline-99999",
      },
    ],
  });
  const offlineClient = createOfflineClient(transport);
  const result = await runProductionOfflineSyncWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    offlineClient,
  });
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("assigned check missing", async () => {
  const { result } = await runWorkflow({ assignedMissing: true });
  assert.equal(result.failedKey, "loadAssignedCheck");
});

test("template not cached", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport, { templateCached: false });
  const result = await runProductionOfflineSyncWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    offlineClient,
  });
  assert.equal(result.failedKey, "loadAssignedCheck");
});

test("offline start success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.startAuditOffline.status, "PASS");
});

test("draft save success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.saveDraftOffline.status, "PASS");
});

test("draft save survives reload", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.resumeDraftOffline.status, "PASS");
});

test("draft edit idempotent", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.editDraftOffline.status, "PASS");
});

test("offline submit queues once", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  offlineClient.setOffline(true);
  await offlineClient.loadAssignedCheckOnline();
  await offlineClient.saveDraftOffline();
  const first = await offlineClient.submitOffline();
  await assert.rejects(() => offlineClient.submitOffline(), /Duplicate queue item/);
  assert.ok(isVerificationOfflineQueueItem(first.queueItem));
});

test("no server write while offline", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  offlineClient.setOffline(true);
  await offlineClient.loadAssignedCheckOnline();
  await offlineClient.saveDraftOffline();
  await offlineClient.submitOffline();
  assert.equal(offlineClient.serverWriteCount, 0);
});

test("queue survives reload", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.offlineReload.status, "PASS");
});

test("reconnect triggers sync", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.restoreConnectivity.status, "PASS");
  assert.equal(result.checks.syncQueue.status, "PASS");
});

test("manual sync fallback", async () => {
  const { result } = await runWorkflow({}, { manualSyncFallback: true });
  assert.equal(result.checks.syncQueue.status, "PASS");
});

test("sync success", async () => {
  const { result, transport } = await runWorkflow();
  assert.equal(result.checks.syncQueue.status, "PASS");
  assert.equal(transport.getCompleteCount(), 1);
});

test("transient sync failure retry", async () => {
  const { result } = await runWorkflow({}, { transientSyncFailureOnce: true });
  assert.equal(result.checks.syncQueue.status, "PASS");
});

test("lost response recovery", async () => {
  const { result } = await runWorkflow({}, { skipDuplicateProtection: false });
  assert.equal(result.checks.duplicateProtection.status, "PASS");
});

test("duplicate server submission prevented", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  offlineClient.setOffline(true);
  await offlineClient.loadAssignedCheckOnline();
  await offlineClient.saveDraftOffline();
  const queued = await offlineClient.submitOffline();
  offlineClient.setOffline(false);
  offlineClient.duplicateProtectionMode = true;
  await offlineClient.syncQueue(true);
  const retry = await offlineClient.syncQueue(true);
  assert.equal(retry.alreadySynced || retry.duplicateRecovered || retry.ok, true);
  assert.equal(
    transport.getAuditResults().filter((row) => row["Local Submission ID"] === queued.submission.localSubmissionId).length,
    1,
  );
});

test("queue removal after success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.queueCleanup.status, "PASS");
});

test("draft cleanup after success", async () => {
  const { result, offlineClient } = await runWorkflow();
  assert.equal(result.checks.queueCleanup.status, "PASS");
  const state = offlineClient.getQueueState();
  assert.equal(Object.keys(state.workspaceState.drafts || {}).length, 0);
});

test("dashboard exclusion", async () => {
  const { result } = await runWorkflow({ dashboardIncludesVerification: true });
  assert.equal(result.failedKey, "dashboard");
});

test("cleanup success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const { result } = await runWorkflow({ cleanupFails: true });
  assert.equal(result.failedKey, "cleanup");
});

test("non-verification queue cleanup rejected", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  offlineClient.cleanupRejectsNonVerification = true;
  const denied = await offlineClient.cleanupNonVerificationQueueItem();
  assert.equal(denied.ok, false);
});

test("interrupt cleanup registers handler", async () => {
  let registered = false;
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  await runProductionOfflineSyncWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    offlineClient,
    registerInterruptCleanup(fn) {
      registered = typeof fn === "function";
    },
  });
  assert.equal(registered, true);
});

test("secrets/customer queue data absent from output", async () => {
  const { result } = await runWorkflow();
  const report = formatOfflineSyncWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /bert_company_session=/);
});

test("offline state does not leak into later tests", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  offlineClient.setOffline(true);
  offlineClient.setOffline(false);
  assert.equal(offlineClient.isOffline(), false);
});

test("browser back/reload state remains valid", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  offlineClient.setOffline(true);
  await offlineClient.saveDraftOffline();
  await offlineClient.submitOffline();
  const reloaded = await offlineClient.reloadWhileOffline();
  assert.ok(reloaded.queueItem);
  assert.equal(isVerificationOfflineRunId(reloaded.queueItem.localId), true);
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 20);
  assert.equal(CHECK_KEYS.includes("syncQueue"), true);
  assert.equal(CHECK_KEYS.includes("duplicateProtection"), true);
});

const requiredSmokeEnv = {
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
};

test("startup: config loads with all expected env vars", () => {
  const config = loadOfflineSyncWorkflowConfig({
    ...requiredSmokeEnv,
    BERT_SMOKE_ALLOW_OFFLINE_MUTATION: "1",
    BERT_SMOKE_APP_ORIGIN: "https://app.usebert.co.uk",
  });
  assert.equal(config.missing.length, 0);
  assert.equal(config.username, "mr.important");
  assert.equal(config.companyFolderId, "folder-abc");
  assert.equal(config.masterSheetId, "sheet-xyz");
  assert.equal(config.allowOfflineMutation, true);
  assert.equal(config.appOrigin, "https://app.usebert.co.uk");
});

test("startup: optional env vars may be undefined", () => {
  const config = loadOfflineSyncWorkflowConfig({ ...requiredSmokeEnv });
  assert.equal(config.missing.length, 0);
  assert.equal(config.allowOfflineMutation, false);
  assert.equal(config.appOrigin, "https://app.usebert.co.uk");
  assert.doesNotThrow(() => resolveOfflineBrowserProbeEnabled({}));
  assert.equal(resolveOfflineBrowserProbeEnabled({}), true);
});

test("startup: blank optional env strings are handled", () => {
  const config = loadOfflineSyncWorkflowConfig({
    ...requiredSmokeEnv,
    BERT_SMOKE_APP_ORIGIN: "   ",
    BERT_SMOKE_ALLOW_OFFLINE_MUTATION: "  ",
    BERT_SMOKE_OFFLINE_USE_BROWSER: "  ",
  });
  assert.equal(config.allowOfflineMutation, false);
  assert.equal(config.appOrigin, "https://app.usebert.co.uk");
  assert.equal(resolveOfflineBrowserProbeEnabled({ BERT_SMOKE_OFFLINE_USE_BROWSER: "  " }), true);
  assert.equal(resolveOfflineBrowserProbeEnabled({ BERT_SMOKE_OFFLINE_USE_BROWSER: "0" }), false);
});

test("startup: verifier reaches authentication without ReferenceError", async () => {
  const transport = createTransport();
  const offlineClient = createOfflineClient(transport);
  const result = await runProductionOfflineSyncWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    offlineClient,
  });
  assert.equal(result.checks.authentication?.status, "PASS");
  assert.doesNotThrow(() => formatOfflineSyncWorkflowReport(result));
});
