#!/usr/bin/env node
/**
 * Unit tests for production audit workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  createDraftStore,
  formatAuditWorkflowReport,
  isSafeVerificationSchedule,
  loadAuditWorkflowConfig,
  runProductionAuditWorkflowChecks,
} from "./lib/production-audit-workflow-core.mjs";

const baseConfig = loadAuditWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_EXPECTED_ROLE: "Admin",
});

function successLoginJson() {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
      role: baseConfig.expectedRole,
      name: "Mr Important",
      companyFolderId: baseConfig.companyFolderId,
    },
    company: {
      companyFolderId: baseConfig.companyFolderId,
      companyName: "Dovecote Demo",
      live: true,
    },
    masterSheetId: baseConfig.masterSheetId,
  };
}

function assignedSchedule(overrides = {}) {
  return {
    id: overrides.id || "sch-daily",
    scheduleName: overrides.scheduleName || "Daily Yard Safety Check",
    audits: overrides.audits || [{ auditId: "aud-1", auditName: "Daily Yard Safety Check" }],
    assignedUserEmails: [baseConfig.expectedEmail],
    ...overrides,
  };
}

function verificationSchedule() {
  return assignedSchedule({
    id: "sch-verification",
    scheduleName: "BERT Verification Audit",
    audits: [{ auditId: "aud-verify", auditName: "BERT Verification Audit" }],
  });
}

function createHappyTransport(options = {}) {
  const cookies = new Map();
  let dashboardCompletionCount = options.dashboardCompletionCount ?? 3;

  const request = async (method, path, body) => {
    if (method === "GET" && path === "/api/health") {
      return {
        status: 200,
        json: {
          ok: true,
          version: "2026.07.01",
          gitSha: "abc123def456",
          shortSha: "abc123d",
        },
      };
    }
    if (method === "POST" && path === "/api/auth/company/login") {
      if (options.loginFails) {
        return {
          status: 401,
          json: { ok: false, blocker: "invalid_credentials", code: "INVALID_CREDENTIALS" },
        };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      return { status: 200, json: successLoginJson() };
    }
    if (method === "GET" && path === "/api/auth/company/session") {
      if (options.loginFails) {
        return { status: 401, json: { ok: false } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: baseConfig.expectedRole },
          company: { companyFolderId: baseConfig.companyFolderId },
        },
      };
    }
    if (method === "GET" && path === "/api/me/assigned-checks") {
      if (options.assignedChecksResponse) {
        return options.assignedChecksResponse();
      }
      const schedules = options.schedules || [assignedSchedule()];
      return {
        status: 200,
        json: {
          ok: true,
          companyFolderId: baseConfig.companyFolderId,
          masterSheetId: baseConfig.masterSheetId,
          schedules,
        },
      };
    }
    if (method === "GET" && path.includes("/google-forms")) {
      if (options.formsResponse) {
        return options.formsResponse();
      }
      return {
        status: 200,
        json: {
          ok: true,
          forms: [
            {
              id: "aud-1",
              name: "Daily Yard Safety Check",
              questions: [{ id: "q1", text: "Area safe?", fieldType: "Pass / Fail" }],
            },
          ],
        },
      };
    }
    if (method === "POST" && path.includes("/checks/") && path.endsWith("/complete")) {
      if (options.submitResponse) {
        return options.submitResponse(body);
      }
      return {
        status: 200,
        json: { ok: true, resultId: "result-smoke-1", scheduleId: "sch-verification" },
      };
    }
    if (method === "GET" && path.includes("/audit-results")) {
      if (options.auditResultsResponse) {
        return options.auditResultsResponse();
      }
      return {
        status: 200,
        json: {
          ok: true,
          results: [{ id: "result-smoke-1", resultId: "result-smoke-1", auditName: "BERT Verification Audit" }],
        },
      };
    }
    if (method === "GET" && path.includes("/dashboard/live")) {
      if (options.dashboardResponse) {
        return options.dashboardResponse();
      }
      if (path.includes("refresh=1")) {
        dashboardCompletionCount += 1;
      }
      return {
        status: 200,
        json: {
          ok: true,
          metrics: { completedChecksToday: dashboardCompletionCount },
        },
      };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
  };
}

test("login failure blocks workflow", async () => {
  const transport = createHappyTransport({ loginFails: true });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
  assert.equal(result.checks.authentication.status, "FAIL");
});

test("no assigned audits fails with clear stage", async () => {
  const transport = createHappyTransport({
    schedules: [],
  });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "assignedAudits");
  assert.match(result.failureReason, /No assigned audits/i);
});

test("audit load failure blocks open audit", async () => {
  const transport = createHappyTransport({
    formsResponse: () => ({ status: 500, json: { ok: false, error: "Drive unavailable" } }),
  });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "openAudit");
});

test("draft save failure is reported", async () => {
  const transport = createHappyTransport();
  const draftStore = createDraftStore();
  draftStore.save = () => {
    throw new Error("Draft persistence failed");
  };
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport, { draftStore });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "saveDraft");
});

test("draft reload failure is reported", async () => {
  const transport = createHappyTransport();
  const draftStore = createDraftStore();
  const originalLoad = draftStore.load.bind(draftStore);
  draftStore.load = () => {
    originalLoad("missing");
    return null;
  };
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport, { draftStore });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "resumeDraft");
});

test("edit failure is reported", async () => {
  const transport = createHappyTransport();
  const draftStore = createDraftStore();
  draftStore.update = () => {
    throw new Error("Draft edit failed");
  };
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport, { draftStore });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editDraft");
});

test("submit failure is reported when verification schedule exists", async () => {
  const transport = createHappyTransport({
    schedules: [assignedSchedule(), verificationSchedule()],
    submitResponse: () => ({ status: 500, json: { ok: false, code: "CHECK_SUBMIT_FAILED" } }),
  });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "submit");
});

test("dashboard mismatch fails after submit", async () => {
  const transport = createHappyTransport({
    schedules: [assignedSchedule(), verificationSchedule()],
    dashboardResponse: () => {
      if (transport.__dashboardCall === undefined) {
        transport.__dashboardCall = 0;
      }
      transport.__dashboardCall += 1;
      const count = transport.__dashboardCall === 1 ? 5 : 2;
      return { status: 200, json: { ok: true, metrics: { completedChecksToday: count } } };
    },
  });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("successful workflow passes all draft stages and skips submit without verification audit", async () => {
  const transport = createHappyTransport();
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, true);
  assert.equal(result.checks.authentication.status, "PASS");
  assert.equal(result.checks.saveDraft.status, "PASS");
  assert.equal(result.checks.resumeDraft.status, "PASS");
  assert.equal(result.checks.editDraft.status, "PASS");
  assert.equal(result.checks.submit.status, "SKIPPED");
  assert.equal(result.submissionSkipped, true);
});

test("skipped submission when only non-verification schedules exist", async () => {
  const transport = createHappyTransport({
    schedules: [assignedSchedule({ scheduleName: "Customer Production Check" })],
  });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, true);
  assert.equal(result.checks.submit.status, "SKIPPED");
  assert.equal(result.checks.auditResults.status, "SKIPPED");
  assert.equal(result.checks.dashboard.status, "SKIPPED");
});

test("cleanup removes ephemeral draft after workflow", async () => {
  const draftStore = createDraftStore();
  const transport = createHappyTransport();
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport, { draftStore });
  assert.equal(result.ok, true);
  assert.equal(result.cleanupDraftRemoved, true);
  assert.equal(draftStore.size(), 0);
});

test("successful workflow with verification schedule submits and validates results", async () => {
  const transport = createHappyTransport({
    schedules: [assignedSchedule(), verificationSchedule()],
  });
  const result = await runProductionAuditWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, true);
  assert.equal(result.checks.submit.status, "PASS");
  assert.equal(result.checks.auditResults.status, "PASS");
  assert.equal(result.checks.dashboard.status, "PASS");
});

test("isSafeVerificationSchedule matches explicit id and name patterns", () => {
  assert.equal(isSafeVerificationSchedule({ id: "sch-1" }, { verificationScheduleId: "sch-1" }), true);
  assert.equal(isSafeVerificationSchedule({ scheduleName: "BERT Verification Audit" }, {}), true);
  assert.equal(isSafeVerificationSchedule({ scheduleName: "Customer daily check" }, {}), false);
});

test("report formatter includes all stages and secret-safe failure details", () => {
  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: key === "openAudit" ? "FAIL" : "SKIP" }])),
    failedKey: "openAudit",
    failedStage: "Open Audit",
    failureReason: "Could not load templates",
    remediation: "Check Google Forms folder",
    httpStatus: 500,
    safeResponseBody: '{"error":"Drive unavailable"}',
    apiVersion: "2026.07.01",
    apiSha: "abc123",
    accountEmail: "bert.demo+mr.important@usebert.co.uk",
    durationMs: 1200,
  };
  const report = formatAuditWorkflowReport(result);
  assert.match(report, /BERT Production Audit Workflow/);
  assert.match(report, /Open Audit\s+FAIL/);
  assert.match(report, /RESULT/);
  assert.match(report, /FAILED/);
  assert.doesNotMatch(report, /secret-password/i);
});
