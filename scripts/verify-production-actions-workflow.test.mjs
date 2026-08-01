#!/usr/bin/env node
/**
 * Unit tests for production Actions workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  formatActionsWorkflowReport,
  loadActionsWorkflowConfig,
  mergeActionUpdate,
  runProductionActionsWorkflowChecks,
} from "./lib/production-actions-workflow-core.mjs";
import {
  buildProductionVerificationAction,
  PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE,
  PRODUCTION_VERIFICATION_ACTION_TITLE,
} from "../shared/production-verification-action.mjs";

const baseConfig = loadActionsWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_ACTION_MUTATION: "1",
});

function successLoginJson() {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
      role: "Admin",
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

function customerAction() {
  return {
    id: "action-customer-1",
    companyId: baseConfig.companyFolderId,
    auditId: "aud-real",
    auditName: "Daily Safety Check",
    questionId: "q1",
    questionText: "Fix guard rail",
    status: "Open",
    assignedToUserId: "worker",
    assignedToName: "Worker",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dueDate: "2026-12-31",
  };
}

function createTransport(options = {}) {
  const cookies = new Map();
  let actions = options.initialActions ? [...options.initialActions] : [customerAction()];
  let loginAttempts = 0;
  let closeAttempts = 0;
  let dashboardOpenActions = options.dashboardOpenActions ?? 2;
  const runId = options.runId || 12345;

  const request = async (method, path, body) => {
    if (method === "GET" && path === "/api/health") {
      return {
        status: 200,
        json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" },
      };
    }
    if (method === "POST" && path === "/api/auth/company/login") {
      loginAttempts += 1;
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      if (options.reviewerLoginFails && loginAttempts > 1) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      const email =
        loginAttempts > 1 && options.reviewerExpectedEmail
          ? options.reviewerExpectedEmail
          : baseConfig.expectedEmail;
      return {
        status: 200,
        json: {
          ...successLoginJson(),
          user: { ...successLoginJson().user, email },
        },
      };
    }
    if (method === "GET" && path === "/api/auth/company/session") {
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: options.sessionRole || "Admin" },
          company: { companyFolderId: baseConfig.companyFolderId },
        },
      };
    }
    if (method === "GET" && path.includes("/actions")) {
      if (options.actionsResponse) {
        return options.actionsResponse();
      }
      return {
        status: options.actionsUnavailable ? 503 : 200,
        json: options.actionsUnavailable
          ? { ok: false, code: "ACTIONS_LOAD_FAILED" }
          : { ok: true, actions: [...actions], companyFolderId: baseConfig.companyFolderId },
      };
    }
    if (method === "POST" && path.includes("/actions/verification-cleanup") && !path.includes("/actions/bert-smoke-action-")) {
      if (options.staleCleanupResponse) {
        return options.staleCleanupResponse(body);
      }
      actions = actions.map((action) =>
        action.id?.startsWith("bert-smoke-action-")
          ? { ...action, status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS, closedAt: new Date().toISOString() }
          : action,
      );
      return { status: 200, json: { ok: true, cleanedCount: 1, cleanedActionIds: ["bert-smoke-action-old"] } };
    }
    if (method === "POST" && path.endsWith("/actions") && !path.includes("verification-cleanup")) {
      if (options.createResponse) {
        return options.createResponse(body);
      }
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "ACTIONS_SAVE_FAILED" } };
      }
      if (options.startFails && body?.actions?.some((action) => action.status === "In Progress")) {
        return { status: 409, json: { ok: false, code: "ACTIONS_SYNC_CONFLICT" } };
      }
      if (options.progressFails && body?.actions?.some((action) => String(action.comments || "").includes("progress update"))) {
        return { status: 500, json: { ok: false, code: "ACTIONS_SAVE_FAILED" } };
      }
      if (options.awaitingFails && body?.actions?.some((action) => action.status === "Awaiting Verification")) {
        return { status: 500, json: { ok: false, code: "ACTIONS_SAVE_FAILED" } };
      }
      if (options.selfVerifyBlocked && body?.actions?.some((action) => action.status === "Closed")) {
        closeAttempts += 1;
        if (closeAttempts === 1) {
          return { status: 403, json: { ok: false, code: "VERIFY_PERMISSION_DENIED" } };
        }
      }
      actions = Array.isArray(body?.actions) ? [...body.actions] : actions;
      return { status: 200, json: { ok: true, written: actions.length } };
    }
    if (method === "POST" && path.includes("/verification-cleanup")) {
      if (options.cleanupResponse) {
        return options.cleanupResponse(body);
      }
      if (options.cleanupFails) {
        return { status: 500, json: { ok: false, code: "VERIFICATION_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsNonVerification) {
        return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_ACTION" } };
      }
      const actionId = path.split("/").filter(Boolean).at(-2);
      actions = actions.map((action) =>
        action.id === actionId
          ? { ...action, status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS, closedAt: new Date().toISOString() }
          : action,
      );
      return { status: 200, json: { ok: true, actionId, cleaned: true, status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS } };
    }
    if (method === "GET" && path.includes("/dashboard/live")) {
      if (options.dashboardResponse) {
        return options.dashboardResponse();
      }
      if (options.dashboardFails) {
        return { status: 500, json: { ok: false } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          metrics: { openActions: dashboardOpenActions, overdueActions: 0 },
          actToday: options.dashboardIncludesVerification
            ? actions
                .filter((action) => action.id?.startsWith("bert-smoke-action-"))
                .map((action) => ({ id: `action-open-${action.id}`, type: "open-action" }))
            : [],
        },
      };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    getActions: () => actions,
    setDashboardOpenActions: (value) => {
      dashboardOpenActions = value;
    },
  };
}

test("successful complete workflow", async () => {
  const transport = createTransport();
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 12345 });
  assert.equal(result.ok, true);
  for (const key of ["authentication", "actionsApi", "baseline", "staleCleanup", "createAction", "cleanup"]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
  assert.equal(result.checks.search.status, "SKIP");
});

test("login failure", async () => {
  const transport = createTransport({ loginFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("actions endpoint unavailable", async () => {
  const transport = createTransport({ actionsUnavailable: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "actionsApi");
});

test("mutation disabled safe skip", async () => {
  const config = {
    ...baseConfig,
    allowActionMutation: false,
  };
  const transport = createTransport();
  const result = await runProductionActionsWorkflowChecks(config, transport);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createAction.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale verification cleanup", async () => {
  const stale = buildProductionVerificationAction({
    actionId: "bert-smoke-action-old",
    companyFolderId: baseConfig.companyFolderId,
    assigneeUserId: "mr.important",
    assigneeName: "Mr Important",
    createdByUserId: "mr.important",
    dueDate: "2026-12-31",
  });
  const transport = createTransport({ initialActions: [customerAction(), stale] });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 99999 });
  assert.equal(result.ok, true);
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("create failure", async () => {
  const transport = createTransport({ createFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createAction");
});

test("created action missing from list", async () => {
  let listCalls = 0;
  const transport = createTransport({
    actionsResponse: () => {
      listCalls += 1;
      return {
        status: 200,
        json: {
          ok: true,
          actions: [customerAction()],
        },
      };
    },
  });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "openAction");
  assert.ok(listCalls >= 2);
});

test("start transition failure", async () => {
  const transport = createTransport({ startFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "startAction");
});

test("progress update failure", async () => {
  const transport = createTransport({ progressFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "progressUpdate");
});

test("awaiting verification failure", async () => {
  const transport = createTransport({ awaitingFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "awaitingVerification");
});

test("reviewer login failure", async () => {
  const config = loadActionsWorkflowConfig({
    BERT_SMOKE_USERNAME: baseConfig.username,
    BERT_SMOKE_PASSWORD: baseConfig.password,
    BERT_SMOKE_COMPANY_FOLDER_ID: baseConfig.companyFolderId,
    BERT_SMOKE_MASTER_SHEET_ID: baseConfig.masterSheetId,
    BERT_SMOKE_ALLOW_ACTION_MUTATION: "1",
    BERT_SMOKE_REVIEWER_USERNAME: "reviewer.user",
    BERT_SMOKE_REVIEWER_PASSWORD: "reviewer-password",
    BERT_SMOKE_REVIEWER_EXPECTED_EMAIL: "bert.demo+reviewer.user@usebert.co.uk",
  });
  const transport = createTransport({ selfVerifyBlocked: true, reviewerLoginFails: true });
  const result = await runProductionActionsWorkflowChecks(config, transport, { runId: 6 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "verifyClose");
});

test("self-verification correctly blocked", async () => {
  const config = loadActionsWorkflowConfig({
    BERT_SMOKE_USERNAME: baseConfig.username,
    BERT_SMOKE_PASSWORD: baseConfig.password,
    BERT_SMOKE_COMPANY_FOLDER_ID: baseConfig.companyFolderId,
    BERT_SMOKE_MASTER_SHEET_ID: baseConfig.masterSheetId,
    BERT_SMOKE_ALLOW_ACTION_MUTATION: "1",
  });
  const transport = createTransport({ selfVerifyBlocked: true });
  const result = await runProductionActionsWorkflowChecks(config, transport, { runId: 7 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "verifyClose");
  assert.match(result.failureReason || "", /reviewer/i);
});

test("successful reviewer verification", async () => {
  const config = loadActionsWorkflowConfig({
    BERT_SMOKE_USERNAME: baseConfig.username,
    BERT_SMOKE_PASSWORD: baseConfig.password,
    BERT_SMOKE_COMPANY_FOLDER_ID: baseConfig.companyFolderId,
    BERT_SMOKE_MASTER_SHEET_ID: baseConfig.masterSheetId,
    BERT_SMOKE_ALLOW_ACTION_MUTATION: "1",
    BERT_SMOKE_REVIEWER_USERNAME: "reviewer.user",
    BERT_SMOKE_REVIEWER_PASSWORD: "reviewer-password",
    BERT_SMOKE_REVIEWER_EXPECTED_EMAIL: "bert.demo+reviewer.user@usebert.co.uk",
  });
  const transport = createTransport({
    selfVerifyBlocked: true,
    reviewerExpectedEmail: "bert.demo+reviewer.user@usebert.co.uk",
  });
  const result = await runProductionActionsWorkflowChecks(config, transport, { runId: 8 });
  assert.equal(result.ok, true);
  assert.equal(result.checks.verifyClose.status, "PASS");
});

test("dashboard verification failure", async () => {
  const transport = createTransport({ dashboardIncludesVerification: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 9 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("search skipped when unsupported", async () => {
  const transport = createTransport();
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 10 });
  assert.equal(result.checks.search.status, "SKIP");
});

test("cleanup success", async () => {
  const transport = createTransport();
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 11 });
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const transport = createTransport({ cleanupFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 12 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("non-verification action cleanup rejected", async () => {
  const transport = createTransport({
    cleanupResponse: () => ({ status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_ACTION" } }),
  });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 13 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("retry after partial workflow", async () => {
  const stale = buildProductionVerificationAction({
    actionId: "bert-smoke-action-partial",
    companyFolderId: baseConfig.companyFolderId,
    assigneeUserId: "mr.important",
    assigneeName: "Mr Important",
    createdByUserId: "mr.important",
    dueDate: "2026-12-31",
  });
  stale.status = "In Progress";
  const transport = createTransport({ initialActions: [customerAction(), stale] });
  const first = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 14 });
  assert.equal(first.checks.staleCleanup.status, "PASS");
  const second = await runProductionActionsWorkflowChecks(baseConfig, transport, { runId: 15 });
  assert.equal(second.ok, true);
});

test("secrets absent from formatted output", async () => {
  const transport = createTransport({ loginFails: true });
  const result = await runProductionActionsWorkflowChecks(baseConfig, transport);
  const report = formatActionsWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/i);
  assert.doesNotMatch(report, /signed-session-token/i);
  assert.doesNotMatch(report, /bert_company_session=/i);
});

test("mergeActionUpdate preserves customer actions", () => {
  const merged = mergeActionUpdate([customerAction()], {
    id: "bert-smoke-action-99",
    companyId: baseConfig.companyFolderId,
    auditId: PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE,
    auditName: PRODUCTION_VERIFICATION_ACTION_TITLE,
    status: "Open",
  });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "action-customer-1");
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 13);
});
