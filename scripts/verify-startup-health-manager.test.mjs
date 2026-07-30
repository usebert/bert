#!/usr/bin/env node
/**
 * Unit tests for startup health manager (mocked dependencies — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_STATUS,
  OVERALL_STATUS,
  analyzeAuthIndexIntegrity,
  analyzeRegistryIntegrity,
  buildSystemHealthApiPayload,
  createStartupHealthService,
  deriveOverallStatus,
  formatStartupVerificationReport,
  runStartupHealthChecks,
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
    requiredEnv: {
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "https://api.example.com/callback",
      GOOGLE_SHARED_DRIVE_ID: "drive",
    },
    googleOAuthStore: {
      sessionsDirConfigured: true,
      hasTokens: () => true,
      readSession: () => ({
        tokens: { refresh_token: "refresh", access_token: "access", expiry_date: Date.now() + 60_000 },
        profile: { email: "ops@example.com" },
      }),
    },
    resolveGoogleSheetsProbeWorkbookId: () => "sheet-1",
    google: {},
    readCanonicalCompanyWorkspaceRegistryMap: async () => ({
      map: new Map([
        [
          "company-1",
          {
            companyId: "company-1",
            rootFolderId: "folder-1",
            masterSheetId: "sheet-1",
            status: "Live",
            registryStatus: "Live",
          },
        ],
      ]),
    }),
    getCompanyWorkspaceRegistryDeps: () => ({}),
    authIndexApi: {
      getAuthIndexSnapshot: () => ({
        emailCount: 1,
        usernameCount: 1,
        ambiguousUsernameCount: 0,
        empty: false,
      }),
      readAllEntries: () => [
        {
          email: "user@example.com",
          status: "ACTIVE",
          companyFolderId: "folder-1",
          masterSheetId: "sheet-1",
        },
      ],
    },
    getCompanyUsersDeps: () => ({
      getTabValues: async () => [["Email", "Name"]],
      resolveUsersTab: async () => ({ tabTitle: "Users" }),
    }),
    evaluateProductionEnvironment: () => ({ blockingIssues: [], warnings: [] }),
    sessionStoreWritable: () => true,
    sessionDir: "/tmp/bert-test-session",
    sessionSecret: "x".repeat(32),
    uploadDir: "/tmp/bert-test-session/uploads",
    isBackgroundProcessorRunning: () => true,
    isNotificationServiceReady: () => true,
    isOfflineQueueProcessorReady: () => false,
    apiDiagnostics: {
      routesLoaded: true,
      middlewareInitialised: true,
      sessionMiddlewareActive: true,
    },
    ...overrides,
  };
}

test("healthy startup", async () => {
  const result = await runStartupHealthChecks(healthyGoogleDeps());
  assert.equal(result.status, OVERALL_STATUS.HEALTHY);
  assert.equal(result.checks.length, 8);
  assert.ok(result.checks.every((check) => check.status === CHECK_STATUS.PASS || check.status === CHECK_STATUS.WARNING));
});

test("Google failure invalid_grant", async () => {
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      probeGoogleSheetsWorkbookMetadata: async () => ({
        ok: false,
        reason: "invalid_grant",
        message: "Token revoked.",
      }),
    }),
  );
  assert.equal(result.status, OVERALL_STATUS.FAILED);
  assert.equal(result.checks.find((check) => check.name === "Google")?.status, CHECK_STATUS.FAIL);
});

test("registry failure duplicate company IDs", async () => {
  const map = new Map([
    ["a", { companyId: "dup", masterSheetId: "sheet-a", status: "Live", registryStatus: "Live", rootFolderId: "f1" }],
    ["b", { companyId: "dup", masterSheetId: "sheet-b", status: "Live", registryStatus: "Live", rootFolderId: "f2" }],
  ]);
  const integrity = analyzeRegistryIntegrity(map);
  assert.equal(integrity.duplicateCompanyIds.length, 1);
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      readCanonicalCompanyWorkspaceRegistryMap: async () => ({ map }),
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "Registry")?.status, CHECK_STATUS.FAIL);
});

test("workbook unavailable", async () => {
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      probeGoogleSheetsWorkbookMetadata: async () => ({ ok: false, reason: "not_found" }),
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "Workbook")?.status, CHECK_STATUS.FAIL);
});

test("duplicate usernames in auth index", async () => {
  const integrity = analyzeAuthIndexIntegrity({
    getAuthIndexSnapshot: () => ({
      emailCount: 1,
      usernameCount: 2,
      ambiguousUsernameCount: 2,
      empty: false,
    }),
    readAllEntries: () => [
      { email: "a@example.com", status: "ACTIVE", companyFolderId: "f1", masterSheetId: "s1" },
    ],
    readStore: () => ({
      byUsername: {
        joe: { ambiguous: true, candidates: [{ email: "a@example.com" }, { email: "b@example.com" }] },
      },
    }),
  });
  assert.equal(integrity.ambiguousUsernameCount, 1);
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      authIndexApi: {
        getAuthIndexSnapshot: () => ({
          emailCount: 2,
          usernameCount: 1,
          ambiguousUsernameCount: 1,
          empty: false,
        }),
        readAllEntries: () => [
          { email: "a@example.com", status: "ACTIVE", companyFolderId: "f1", masterSheetId: "s1" },
        ],
      },
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "Auth Index")?.status, CHECK_STATUS.FAIL);
});

test("duplicate company IDs helper", () => {
  const map = new Map([
    ["1", { companyId: "same", masterSheetId: "wb-1", status: "Draft" }],
    ["2", { companyId: "same", masterSheetId: "wb-2", status: "Draft" }],
  ]);
  const integrity = analyzeRegistryIntegrity(map);
  assert.deepEqual(integrity.duplicateCompanyIds, ["same"]);
});

test("missing env vars degrade configuration", async () => {
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      evaluateProductionEnvironment: () => ({
        blockingIssues: [],
        warnings: ["BERT_SESSIONS_DIR is not set."],
      }),
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "Configuration")?.status, CHECK_STATUS.WARNING);
  assert.equal(result.status, OVERALL_STATUS.DEGRADED);
});

test("scheduler unavailable", async () => {
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      isBackgroundProcessorRunning: () => false,
      isNotificationServiceReady: () => false,
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "Background Jobs")?.status, CHECK_STATUS.FAIL);
});

test("cache failure when session dir missing", async () => {
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      sessionDir: "",
      sessionStoreWritable: () => false,
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "Cache")?.status, CHECK_STATUS.FAIL);
});

test("API middleware missing", async () => {
  const result = await runStartupHealthChecks(
    healthyGoogleDeps({
      apiDiagnostics: {
        routesLoaded: true,
        middlewareInitialised: false,
        sessionMiddlewareActive: false,
      },
      sessionSecret: "",
    }),
  );
  assert.equal(result.checks.find((check) => check.name === "API")?.status, CHECK_STATUS.FAIL);
});

test("deriveOverallStatus rules", () => {
  assert.equal(
    deriveOverallStatus([{ status: CHECK_STATUS.PASS, critical: true }]),
    OVERALL_STATUS.HEALTHY,
  );
  assert.equal(
    deriveOverallStatus([{ status: CHECK_STATUS.WARNING, critical: false }]),
    OVERALL_STATUS.DEGRADED,
  );
  assert.equal(
    deriveOverallStatus([{ status: CHECK_STATUS.FAIL, critical: true }]),
    OVERALL_STATUS.FAILED,
  );
});

test("startup report and API payload omit secrets", () => {
  const result = {
    status: OVERALL_STATUS.HEALTHY,
    startedAt: Date.now(),
    checks: [{ name: "Google", status: CHECK_STATUS.PASS, durationMs: 1, message: "ok" }],
  };
  const report = formatStartupVerificationReport(result);
  assert.match(report, /HEALTHY/);
  const payload = buildSystemHealthApiPayload(result, {
    apiVersion: "1.0.0",
    apiSha: "abc123",
    uptimeSeconds: 10,
  });
  assert.equal(payload.apiSha, "abc123");
  assert.ok(!JSON.stringify(payload).includes("refresh_token"));
});

test("createStartupHealthService stores snapshot", async () => {
  const service = createStartupHealthService(healthyGoogleDeps());
  assert.equal(service.getSnapshot(), null);
  const result = await service.runChecks();
  assert.equal(service.getSnapshot(), result);
});
