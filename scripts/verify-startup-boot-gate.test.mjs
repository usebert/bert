#!/usr/bin/env node
/**
 * Boot gate and Phase 2.1 tests — mocked listen/exit, no production calls.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicHealthPayload,
  executeBootSequence,
  hasCriticalFailure,
  publicHealthStatusCode,
} from "../server/startup-boot-gate.mjs";
import {
  CHECK_STATUS,
  OVERALL_STATUS,
  createStartupHealthService,
  runCriticalBootChecks,
  runDeferredReadinessChecks,
} from "../server/startup-health-manager.mjs";

function healthyGoogleDeps(overrides = {}) {
  const probeOk = async () => ({ ok: true, spreadsheetId: "sheet-1" });
  return {
    envConfigured: () => true,
    getAuthedClient: () => ({}),
    buildGoogleCredentialDiagnostics: () => ({
      tokenStore: { hasRefreshToken: true, hasAccessToken: true },
      warnings: [],
    }),
    probeGoogleSheetsWorkbookMetadata: probeOk,
    resolveUsersTab: async () => ({ tabTitle: "Users" }),
    requiredEnv: {},
    googleOAuthStore: { hasTokens: () => true, readSession: () => ({ tokens: { refresh_token: "x" } }) },
    resolveGoogleSheetsProbeWorkbookId: () => "sheet-1",
    readCanonicalCompanyWorkspaceRegistryMap: async () => ({
      map: new Map([
        [
          "c1",
          {
            companyId: "c1",
            rootFolderId: "f1",
            masterSheetId: "sheet-1",
            status: "Live",
            registryStatus: "Live",
          },
        ],
      ]),
    }),
    getCompanyWorkspaceRegistryDeps: () => ({}),
    authIndexApi: {
      getAuthIndexSnapshot: () => ({ emailCount: 1, usernameCount: 1, ambiguousUsernameCount: 0, empty: false }),
      readAllEntries: () => [
        { email: "u@example.com", status: "ACTIVE", companyFolderId: "f1", masterSheetId: "sheet-1" },
      ],
    },
    getCompanyUsersDeps: () => ({ getTabValues: async () => [["Email"]] }),
    evaluateProductionEnvironment: () => ({ blockingIssues: [], warnings: [] }),
    sessionStoreWritable: () => true,
    sessionDir: "/tmp/bert-boot-gate",
    sessionSecret: "x".repeat(32),
    uploadDir: "/tmp/bert-boot-gate/uploads",
    apiDiagnostics: { routesLoaded: true, middlewareInitialised: true, sessionMiddlewareActive: true },
    isBackgroundProcessorRunning: () => true,
    isNotificationServiceReady: () => false,
    ...overrides,
  };
}

test("healthy critical checks call listen exactly once", async () => {
  let listenCount = 0;
  let backgroundCount = 0;
  const exitCodes = [];
  const boot = await executeBootSequence({
    runCriticalBootChecks: async () => runCriticalBootChecks(healthyGoogleDeps()),
    listen: (cb) => {
      listenCount += 1;
      cb();
    },
    startBackgroundServices: () => {
      backgroundCount += 1;
    },
    runDeferredReadinessChecks: async () =>
      runDeferredReadinessChecks(healthyGoogleDeps(), { registryMap: new Map() }),
    exit: (code) => exitCodes.push(code),
  });
  assert.equal(boot.listened, true);
  assert.equal(listenCount, 1);
  assert.equal(backgroundCount, 1);
  assert.equal(exitCodes.length, 0);
  assert.equal(boot.readiness.status, OVERALL_STATUS.DEGRADED);
});

test("degraded optional state still calls listen", async () => {
  let listened = false;
  const boot = await executeBootSequence({
    runCriticalBootChecks: async () =>
      runCriticalBootChecks(
        healthyGoogleDeps({
          evaluateProductionEnvironment: () => ({
            blockingIssues: [],
            warnings: ["BERT_SESSIONS_DIR is not set."],
          }),
        }),
      ),
    listen: (cb) => {
      listened = true;
      cb();
    },
    startBackgroundServices: () => {},
    runDeferredReadinessChecks: async () => runDeferredReadinessChecks(healthyGoogleDeps()),
    exit: () => {},
  });
  assert.equal(listened, true);
  assert.notEqual(boot.readiness.status, OVERALL_STATUS.FAILED);
});

test("Google invalid_grant prevents listen", async () => {
  let listenCount = 0;
  const exitCodes = [];
  await executeBootSequence({
    runCriticalBootChecks: async () =>
      runCriticalBootChecks(
        healthyGoogleDeps({
          probeGoogleSheetsWorkbookMetadata: async () => ({ ok: false, reason: "invalid_grant" }),
        }),
      ),
    listen: () => {
      listenCount += 1;
    },
    startBackgroundServices: () => {},
    runDeferredReadinessChecks: async () => ({ status: OVERALL_STATUS.HEALTHY, checks: [] }),
    exit: (code) => exitCodes.push(code),
  });
  assert.equal(listenCount, 0);
  assert.deepEqual(exitCodes, [1]);
});

test("registry failure prevents listen", async () => {
  let listenCount = 0;
  const exitCodes = [];
  const map = new Map([
    ["a", { companyId: "dup", masterSheetId: "s1", status: "Live", registryStatus: "Live", rootFolderId: "f1" }],
    ["b", { companyId: "dup", masterSheetId: "s2", status: "Live", registryStatus: "Live", rootFolderId: "f2" }],
  ]);
  await executeBootSequence({
    runCriticalBootChecks: async () =>
      runCriticalBootChecks(
        healthyGoogleDeps({
          readCanonicalCompanyWorkspaceRegistryMap: async () => ({ map }),
        }),
      ),
    listen: () => {
      listenCount += 1;
    },
    startBackgroundServices: () => {},
    runDeferredReadinessChecks: async () => ({ status: OVERALL_STATUS.HEALTHY, checks: [] }),
    exit: (code) => {
      exitCodes.push(code);
    },
  });
  assert.equal(listenCount, 0);
  assert.deepEqual(exitCodes, [1]);
});

test("auth index failure prevents listen", async () => {
  let listenCount = 0;
  await executeBootSequence({
    runCriticalBootChecks: async () =>
      runCriticalBootChecks(
        healthyGoogleDeps({
          authIndexApi: {
            getAuthIndexSnapshot: () => ({ emailCount: 1, usernameCount: 1, ambiguousUsernameCount: 1, empty: false }),
            readAllEntries: () => [
              { email: "a@example.com", status: "ACTIVE", companyFolderId: "f1", masterSheetId: "s1" },
            ],
          },
        }),
      ),
    listen: () => {
      listenCount += 1;
    },
    startBackgroundServices: () => {},
    runDeferredReadinessChecks: async () => ({ status: OVERALL_STATUS.HEALTHY, checks: [] }),
    exit: () => {},
  });
  assert.equal(listenCount, 0);
});

test("cache failure prevents listen", async () => {
  let listenCount = 0;
  await executeBootSequence({
    runCriticalBootChecks: async () =>
      runCriticalBootChecks(
        healthyGoogleDeps({
          sessionDir: "",
          sessionStoreWritable: () => false,
        }),
      ),
    listen: () => {
      listenCount += 1;
    },
    startBackgroundServices: () => {},
    runDeferredReadinessChecks: async () => ({ status: OVERALL_STATUS.HEALTHY, checks: [] }),
    exit: () => {},
  });
  assert.equal(listenCount, 0);
});

test("critical check timeout prevents listen", async () => {
  let listenCount = 0;
  const result = await runCriticalBootChecks(
    healthyGoogleDeps({
      criticalBudgetMs: 50,
      readCanonicalCompanyWorkspaceRegistryMap: () => new Promise(() => {}),
    }),
  );
  assert.equal(result.bootBlocked, true);
  assert.match(result.failureReason || "", /timed out/i);
  await executeBootSequence({
    runCriticalBootChecks: async () => result,
    listen: () => {
      listenCount += 1;
    },
    startBackgroundServices: () => {},
    runDeferredReadinessChecks: async () => ({ status: OVERALL_STATUS.HEALTHY, checks: [] }),
    exit: () => {},
  });
  assert.equal(listenCount, 0);
});

test("/api/health is 503 while booting and 200 when ready", () => {
  const base = { service: "bert-api", version: "0.0.0", shortSha: "abc1234", gitSha: "abc1234" };
  const booting = buildPublicHealthPayload(base, {
    phase: "booting",
    acceptingTraffic: false,
    status: OVERALL_STATUS.FAILED,
  });
  assert.equal(publicHealthStatusCode(booting), 503);
  assert.equal(booting.ok, false);
  const ready = buildPublicHealthPayload(base, {
    phase: "ready",
    acceptingTraffic: true,
    status: OVERALL_STATUS.HEALTHY,
  });
  assert.equal(publicHealthStatusCode(ready), 200);
  assert.equal(ready.ok, true);
  assert.equal(ready.shortSha, "abc1234");
});

test("deferred optional warning produces DEGRADED without shutting down", async () => {
  const deferred = await runDeferredReadinessChecks(
    healthyGoogleDeps({
      isBackgroundProcessorRunning: () => false,
      isNotificationServiceReady: () => false,
    }),
  );
  assert.equal(deferred.status, OVERALL_STATUS.DEGRADED);
  assert.ok(deferred.checks.every((check) => check.status !== CHECK_STATUS.FAIL));
});

test("no duplicate background service startup", async () => {
  let backgroundCount = 0;
  await executeBootSequence({
    runCriticalBootChecks: async () => runCriticalBootChecks(healthyGoogleDeps()),
    listen: (cb) => cb(),
    startBackgroundServices: () => {
      backgroundCount += 1;
    },
    runDeferredReadinessChecks: async () => runDeferredReadinessChecks(healthyGoogleDeps()),
    exit: () => {},
  });
  assert.equal(backgroundCount, 1);
});

test("startup service tracks readiness after deferred checks", async () => {
  const service = createStartupHealthService(healthyGoogleDeps());
  const critical = await service.runCriticalBootChecks();
  assert.equal(critical.bootBlocked, false);
  assert.equal(service.isAcceptingTraffic(), false);
  await service.runDeferredReadinessChecks({
    isBackgroundProcessorRunning: () => true,
    isNotificationServiceReady: () => false,
  });
  service.markReady(OVERALL_STATUS.DEGRADED);
  assert.equal(service.isAcceptingTraffic(), true);
  assert.ok(!JSON.stringify(service.getSnapshot()).includes("refresh_token"));
});

test("hasCriticalFailure helper", () => {
  assert.equal(hasCriticalFailure([{ status: CHECK_STATUS.FAIL, critical: true }]), true);
  assert.equal(hasCriticalFailure([{ status: CHECK_STATUS.WARNING, critical: false }]), false);
});
