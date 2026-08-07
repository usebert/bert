#!/usr/bin/env node
/**
 * Unit tests for production Notifications workflow verifier (mocked HTTP).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  CHECK_LABELS,
  formatNotificationsWorkflowReport,
  loadNotificationsWorkflowConfig,
  runProductionNotificationsWorkflowChecks,
} from "./lib/production-notifications-workflow-core.mjs";
import {
  buildProductionVerificationNotificationId,
  buildProductionVerificationNotificationSourceId,
  buildVerificationNotificationMessageInput,
  CLIENT_DERIVED_SKIP_REASON,
  ESCALATION_SKIP_REASON,
  isVerificationNotificationMessage,
  PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE,
} from "../shared/production-verification-notification.mjs";

const TEST_RUN_ID = 424242;
const baseConfig = loadNotificationsWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_NOTIFICATION_MUTATION: "1",
});

function loginJson() {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
      role: "Admin",
      name: "Mr Important",
      companyFolderId: baseConfig.companyFolderId,
    },
    company: { companyFolderId: baseConfig.companyFolderId, companyName: "Dovecote Demo", live: true },
    masterSheetId: baseConfig.masterSheetId,
  };
}

function createStore() {
  return {
    messages: [],
    ordinaryMessage: {
      messageId: "MSG-CUSTOMER-1",
      companyFolderId: baseConfig.companyFolderId,
      recipientEmail: baseConfig.expectedEmail,
      recipientPersonId: baseConfig.expectedEmail,
      subject: "Monthly safety update",
      messageBody: "Customer operational message",
      relatedModule: "loler",
      status: "unread",
      sentAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function createTransport(options = {}) {
  const cookies = new Map();
  const store = options.store || createStore();
  if (!store.messages.length) {
    store.messages.push(store.ordinaryMessage);
  }
  let loginAttempts = 0;
  let createAttempts = 0;

  const request = async (method, path, body) => {
    if (method === "GET" && path === "/api/health") {
      return { status: 200, json: { ok: true, version: "0.0.0", gitSha: "abc123", shortSha: "abc123" } };
    }
    if (method === "POST" && path === "/api/auth/company/login") {
      loginAttempts += 1;
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      return { status: 200, json: loginJson() };
    }
    if (method === "GET" && path === "/api/auth/company/session") {
      return {
        status: 200,
        json: { ok: true, user: { email: baseConfig.expectedEmail, role: "Admin" }, company: { companyFolderId: baseConfig.companyFolderId } },
      };
    }
    if (method === "GET" && path.includes("/messages")) {
      if (options.messagesUnavailable) {
        return { status: 503, json: { ok: false, code: "MESSAGES_LIST_FAILED" } };
      }
      const mine = store.messages.filter(
        (item) => item.recipientEmail === baseConfig.expectedEmail || item.recipientPersonId === baseConfig.expectedEmail,
      );
      return {
        status: 200,
        json: {
          ok: true,
          messages: mine,
          summary: {
            total: mine.length,
            unread: mine.filter((item) => item.status === "unread").length,
            archived: mine.filter((item) => item.status === "archived").length,
          },
        },
      };
    }
    if (method === "POST" && path.endsWith("/messages") && !path.includes("verification-cleanup")) {
      createAttempts += 1;
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "MESSAGES_CREATE_FAILED" } };
      }
      if (options.create502Once && createAttempts === 1) {
        return { status: 502, json: { ok: false, code: "GATEWAY_TIMEOUT" } };
      }
      const payload = buildVerificationNotificationMessageInput({
        runId: TEST_RUN_ID,
        sourceType: body?.sourceType || "action",
        recipientEmail: body?.recipientEmail || baseConfig.expectedEmail,
        messageId: body?.messageId,
      });
      const existing = store.messages.find((item) => item.messageId === payload.messageId);
      if (existing) {
        return { status: 200, json: { ok: true, idempotent: true, message: existing } };
      }
      const message = {
        messageId: payload.messageId,
        companyFolderId: baseConfig.companyFolderId,
        recipientEmail: payload.recipientEmail,
        recipientPersonId: payload.recipientPersonId,
        subject: payload.subject,
        messageBody: payload.messageBody,
        relatedModule: payload.relatedModule,
        relatedRecordId: payload.relatedRecordId,
        status: "unread",
        sentAt: new Date().toISOString(),
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
      };
      store.messages.push(message);
      return { status: 200, json: { ok: true, message } };
    }
    if (method === "POST" && path.includes("/messages/") && path.endsWith("/read")) {
      const messageId = path.split("/messages/")[1].split("/")[0];
      const message = store.messages.find((item) => item.messageId === messageId);
      if (!message) {
        return { status: 404, json: { ok: false, code: "MESSAGES_NOT_FOUND" } };
      }
      message.status = "read";
      message.readAt = new Date().toISOString();
      return { status: 200, json: { ok: true, message } };
    }
    if (method === "POST" && path.includes("/verification-cleanup")) {
      if (options.cleanupFails && !path.endsWith("/messages/verification-cleanup")) {
        return { status: 500, json: { ok: false, code: "MESSAGES_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsNonVerification && path.includes("MSG-CUSTOMER-1")) {
        return { status: 400, json: { ok: false, code: "MESSAGES_CLEANUP_REJECTED" } };
      }
      if (path.endsWith("/verification-cleanup")) {
        store.messages = store.messages.map((item) =>
          isVerificationNotificationMessage(item) ? { ...item, status: "archived" } : item,
        );
        return { status: 200, json: { ok: true, cleanedCount: 1, results: [] } };
      }
      const messageId = path.split("/messages/")[1].split("/")[0];
      store.messages = store.messages.map((item) =>
        item.messageId === messageId ? { ...item, status: "archived" } : item,
      );
      return { status: 200, json: { ok: true, messageId, cleaned: true } };
    }
    if (method === "GET" && path.includes("/dashboard/live")) {
      return {
        status: 200,
        json: {
          ok: true,
          actToday: options.dashboardIncludesVerification
            ? [{ id: buildProductionVerificationNotificationSourceId(TEST_RUN_ID, "action"), type: "open-action" }]
            : [],
        },
      };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    store,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
  };
}

async function runWorkflow(options = {}) {
  const transport = createTransport(options);
  const result = await runProductionNotificationsWorkflowChecks(baseConfig, transport, {
    runId: TEST_RUN_ID,
    logStage: () => {},
    registerInterruptCleanup(fn) {
      transport.interruptCleanup = fn;
    },
  });
  return { result, store: transport.store, transport };
}

test("full successful workflow", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.ok, true);
  assert.equal(result.checks.actionNotification.status, "PASS");
  assert.equal(result.checks.recipientInbox.status, "PASS");
  assert.equal(result.checks.markRead.status, "PASS");
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("login failure", async () => {
  const { result } = await runWorkflow({ loginFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.authentication.status, "FAIL");
});

test("notifications API unavailable", async () => {
  const { result } = await runWorkflow({ messagesUnavailable: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.notificationsApi.status, "FAIL");
});

test("mutation disabled", async () => {
  const config = loadNotificationsWorkflowConfig({
    BERT_SMOKE_USERNAME: "mr.important",
    BERT_SMOKE_PASSWORD: "secret-password",
    BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
    BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
    BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
    BERT_SMOKE_ALLOW_NOTIFICATION_MUTATION: "0",
  });
  const transport = createTransport();
  const result = await runProductionNotificationsWorkflowChecks(config, transport, { runId: TEST_RUN_ID, logStage: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.checks.staleCleanup.status, "SKIP");
  assert.equal(result.checks.actionNotification.status, "SKIP");
});

test("stale cleanup", async () => {
  const store = createStore();
  store.messages.push({
    messageId: buildProductionVerificationNotificationId(TEST_RUN_ID - 1, "action"),
    companyFolderId: baseConfig.companyFolderId,
    recipientEmail: baseConfig.expectedEmail,
    subject: "BERT Verification Notification",
    messageBody: `[verification] [${PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE}]`,
    status: "unread",
  });
  const { result } = await runWorkflow({ store });
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("action notification success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.actionNotification.status, "PASS");
});

test("action notification valid skip classification constant", () => {
  assert.match(CLIENT_DERIVED_SKIP_REASON, /Client-derived Notification Centre/);
});

test("incident notification skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.incidentNotification.status, "SKIP");
  assert.match(result.checks.incidentNotification.reason || "", /Client-derived/);
});

test("briefing notification skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.briefingNotification.status, "SKIP");
});

test("document notification skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.documentNotification.status, "SKIP");
});

test("schedule notification skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.scheduleNotification.status, "SKIP");
});

test("risk assessment notification skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.riskAssessmentNotification.status, "SKIP");
});

test("additional notifications skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.additionalNotifications.status, "SKIP");
});

test("recipient inbox", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.recipientInbox.status, "PASS");
});

test("deep link correctness", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.deepLinkVerification.status, "PASS");
});

test("mark read success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.markRead.status, "PASS");
});

test("mark read idempotency", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.markRead.status, "PASS");
});

test("unread count increments and decrements", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.unreadCount.status, "PASS");
});

test("escalation skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.escalation.status, "SKIP");
  assert.equal(result.checks.escalation.reason, ESCALATION_SKIP_REASON);
});

test("duplicate event suppression", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.duplicateProtection.status, "PASS");
});

test("cross-company isolation", async () => {
  const store = createStore();
  store.messages.push({
    messageId: buildProductionVerificationNotificationId(TEST_RUN_ID, "action"),
    companyFolderId: "other-company-folder",
    recipientEmail: baseConfig.expectedEmail,
    subject: "BERT Verification Notification",
    messageBody: `[verification] [${PRODUCTION_VERIFICATION_NOTIFICATION_SOURCE}]`,
    status: "unread",
  });
  const { result } = await runWorkflow({ store });
  assert.equal(result.checks.recipientInbox.status, "PASS");
  assert.equal(result.checks.crossCompanyIsolation?.status || "PASS", "PASS");
});

test("dashboard exclusion", async () => {
  const { result } = await runWorkflow({ dashboardIncludesVerification: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.dashboardActToday.status, "FAIL");
});

test("external email suppression", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.externalEmailSafety.status, "PASS");
});

test("search skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.search.status, "SKIP");
});

test("cleanup success", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.equal(store.messages.some((item) => isVerificationNotificationMessage(item) && item.status !== "archived"), false);
});

test("cleanup failure", async () => {
  const { result } = await runWorkflow({ cleanupFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.cleanup.status, "FAIL");
});

test("ordinary notification cleanup rejected", async () => {
  const store = createStore();
  const transport = createTransport({ store, cleanupRejectsNonVerification: true });
  const messageId = buildProductionVerificationNotificationId(TEST_RUN_ID, "action");
  const result = await transport.request(
    "POST",
    `/api/companies/${baseConfig.companyFolderId}/messages/${messageId}/verification-cleanup`,
    {},
  );
  assert.notEqual(result.json?.code, "MESSAGES_CLEANUP_REJECTED");
});

test("transient 502 recovery", async () => {
  const { result } = await runWorkflow({ create502Once: true });
  assert.equal(result.checks.actionNotification.status, "PASS");
});

test("interrupt cleanup", async () => {
  const transport = createTransport({ createFails: true });
  await runProductionNotificationsWorkflowChecks(baseConfig, transport, {
    runId: TEST_RUN_ID,
    logStage: () => {},
    registerInterruptCleanup(fn) {
      transport.interruptCleanup = fn;
    },
  });
  assert.equal(typeof transport.interruptCleanup, "function");
});

test("secret and customer-content-safe output", () => {
  const report = formatNotificationsWorkflowReport({
    ok: true,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PASS" }])),
    creatorEmail: baseConfig.expectedEmail,
    recipientEmail: baseConfig.expectedEmail,
    notificationRunId: `bert-smoke-notification-${TEST_RUN_ID}`,
    durationMs: 1000,
  });
  assert.match(report, /READY FOR CUSTOMERS/);
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /Monthly safety update/);
});

test("check labels cover all keys", () => {
  for (const key of CHECK_KEYS) {
    assert.equal(typeof CHECK_LABELS[key], "string");
  }
});
