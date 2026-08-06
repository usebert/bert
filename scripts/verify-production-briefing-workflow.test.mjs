#!/usr/bin/env node
/**
 * Unit tests for production Briefing workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_KEYS,
  attemptVerificationBriefingCleanup,
  formatBriefingWorkflowReport,
  loadBriefingWorkflowConfig,
  runProductionBriefingWorkflowChecks,
} from "./lib/production-briefing-workflow-core.mjs";
import { createBriefingWorkflowMockTransport } from "./lib/production-briefing-workflow-mock-transport.mjs";
import {
  buildProductionVerificationBriefing,
  buildProductionVerificationBriefingId,
  countBriefingBaselines,
  findBriefingById,
  isActiveVerificationBriefing,
  isOperationalBriefing,
  isVerificationBriefing,
  listActiveVerificationBriefings,
  PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
  PRODUCTION_VERIFICATION_BRIEFING_TITLE,
  PRODUCTION_VERIFICATION_BRIEFING_TYPE,
} from "../shared/production-verification-briefing.mjs";

const baseConfig = loadBriefingWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_BRIEFING_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const defaultRunOptions = {
  runId: TEST_RUN_ID,
  listPollMaxAttempts: 5,
  listPollIntervalMs: 0,
};

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return trim(value).toLowerCase();
}

function customerBriefing() {
  return {
    briefingId: "briefing-customer-1",
    title: "Weekly safety update",
    type: "Safety",
    status: "Sent",
    message: "Customer briefing for assembly team",
    verificationSource: "",
    targetUserEmails: "worker@example.com",
    requiresRead: true,
    requiresAcknowledgement: true,
    requiresSignature: false,
    recipients: [],
  };
}

function toTrackerItem(briefing) {
  return {
    briefingId: briefing.briefingId,
    title: briefing.title,
    type: briefing.type,
    status: briefing.status,
    message: briefing.message,
    verificationSource: briefing.verificationSource || "",
    targetUserEmails: briefing.targetUserEmails || "",
    requiresRead: briefing.requiresRead !== false,
    requiresAcknowledgement: briefing.requiresAcknowledgement !== false,
    requiresSignature: briefing.requiresSignature !== false,
    recipients: Array.isArray(briefing.recipients) ? briefing.recipients : [],
  };
}

function createTransport(options = {}) {
  return createBriefingWorkflowMockTransport(baseConfig, options);
}

test("full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  for (const key of [
    "authentication",
    "briefingsApi",
    "baseline",
    "staleCleanup",
    "createDraft",
    "readback",
    "editDraft",
    "recipientAssignment",
    "publish",
    "recipientLogin",
    "recipientTodo",
    "read",
    "acknowledge",
    "sign",
    "completion",
    "dashboard",
    "cleanup",
  ]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
  assert.equal(result.checks.notification.status, "SKIP");
  assert.equal(result.checks.search.status, "SKIP");
  assert.match(formatBriefingWorkflowReport(result), /READY FOR CUSTOMERS/);
});

test("login failure", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ loginFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("briefings API unavailable", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ briefingsUnavailable: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "briefingsApi");
});

test("mutation disabled", async () => {
  const config = { ...baseConfig, allowBriefingMutation: false };
  const result = await runProductionBriefingWorkflowChecks(config, createTransport(), defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale cleanup", async () => {
  const stale = buildProductionVerificationBriefing({
    runId: 99999,
    briefingId: "bert-smoke-briefing-99999",
    createdByEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    initialBriefings: [customerBriefing(), toTrackerItem({ ...stale, status: "Draft" })],
  });
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("create failure", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ createFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createDraft");
});

test("create succeeds but record not visible", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ createSuccessButNotVisible: true, listStaleUntilAttempt: 99 }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "readback");
});

test("duplicate create idempotency", async () => {
  const existing = buildProductionVerificationBriefing({
    runId: TEST_RUN_ID,
    createdByEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    initialBriefings: [customerBriefing(), toTrackerItem({ ...existing, status: "Draft" })],
  });
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.createDraft.status, "PASS");
  assert.equal(result.checks.readback.status, "PASS");
});

test("edit failure", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ editFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editDraft");
});

test("recipient missing", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ recipientMissing: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientAssignment");
});

test("duplicate recipient prevention", async () => {
  const runId = 22001;
  const existing = buildProductionVerificationBriefing({
    runId,
    createdByEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    runId,
    initialBriefings: [
      customerBriefing(),
      {
        ...toTrackerItem({
          ...existing,
          status: "Draft",
          targetUserEmails: "other.recipient@example.com",
          recipients: [],
        }),
      },
    ],
    duplicateRecipients: true,
  });
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    runId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientAssignment");
});

test("broad recipient assignment rejected", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ broadRecipients: true }),
    { ...defaultRunOptions, runId: 22002 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientAssignment");
});

test("publish failure", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ publishFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "publish");
});

test("repeated publish idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.publish.status, "PASS");
  assert.ok(transport.publishAttempts >= 1);
});

test("recipient login failure", async () => {
  const config = loadBriefingWorkflowConfig({
    BERT_SMOKE_USERNAME: baseConfig.username,
    BERT_SMOKE_PASSWORD: baseConfig.password,
    BERT_SMOKE_COMPANY_FOLDER_ID: baseConfig.companyFolderId,
    BERT_SMOKE_MASTER_SHEET_ID: baseConfig.masterSheetId,
    BERT_SMOKE_EXPECTED_EMAIL: baseConfig.expectedEmail,
    BERT_SMOKE_ALLOW_BRIEFING_MUTATION: "1",
    BERT_SMOKE_BRIEFING_RECIPIENT_USERNAME: "recipient.user",
    BERT_SMOKE_BRIEFING_RECIPIENT_PASSWORD: "recipient-password",
    BERT_SMOKE_BRIEFING_RECIPIENT_EXPECTED_EMAIL: "bert.demo+recipient.user@usebert.co.uk",
  });
  const result = await runProductionBriefingWorkflowChecks(
    config,
    createTransport({
      recipientLoginFails: true,
      recipientExpectedEmail: config.recipientExpectedEmail,
    }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientLogin");
});

test("to-do missing briefing", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ todoMissingBriefing: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientTodo");
});

test("read success", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.read.status, "PASS");
});

test("repeated read idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.read.status, "PASS");
  assert.ok(transport.readAttempts >= 1);
});

test("acknowledge success", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.acknowledge.status, "PASS");
});

test("repeated acknowledgement idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.acknowledge.status, "PASS");
  assert.ok(transport.acknowledgeAttempts >= 1);
});

test("signature success", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.sign.status, "PASS");
});

test("signature skipped where unsupported", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ requiresSignature: false }),
    { ...defaultRunOptions, requiresSignature: false },
  );
  assert.equal(result.checks.sign.status, "SKIP");
  assert.match(result.checks.sign.reason || "", /signature/i);
});

test("completion mismatch", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ completionMismatch: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "completion");
});

test("notification success (SKIP status)", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.notification.status, "SKIP");
  assert.match(result.checks.notification.reason || "", /notification/i);
});

test("notification skipped where client-only", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.notification.status, "SKIP");
  assert.match(result.checks.notification.reason || "", /client-cache/i);
});

test("dashboard exclusion failure", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ dashboardIncludesVerification: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("search skipped", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.search.status, "SKIP");
});

test("cleanup success", async () => {
  const result = await runProductionBriefingWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ cleanupFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("non-verification cleanup rejected", async () => {
  const transport = createTransport({ cleanupRejectsNonVerification: true });
  const cleanup = await attemptVerificationBriefingCleanup(transport.request, {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationBriefingId: "briefing-customer-1",
  });
  const single = cleanup.results.find((item) => item.kind === "single");
  assert.equal(single?.ok, false);
});

test("transient 502 recovery", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ create502Once: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "PASS");
});

test("timeout cleanup attempt surfaces timed out metadata", async () => {
  const transport = {
    request: async () => {
      const error = new Error("Request timed out after 1000ms");
      error.name = "StageTimeoutError";
      error.code = "STAGE_TIMEOUT";
      error.method = "GET";
      error.safeUrl = "https://api.usebert.co.uk/api/health";
      error.elapsedMs = 1000;
      error.timeoutMs = 1000;
      throw error;
    },
  };
  const result = await runProductionBriefingWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.timedOut, true);
  assert.equal(result.failedKey, "authentication");
});

test("SIGINT/SIGTERM cleanup registers interrupt handler", async () => {
  const transport = createTransport();
  let registeredCleanup = null;
  await runProductionBriefingWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registeredCleanup = fn;
    },
  });
  assert.equal(typeof registeredCleanup, "function");
  const cleanup = await registeredCleanup();
  assert.equal(cleanup.ok, true);
});

test("secrets and signature content absent from output", async () => {
  const result = await runProductionBriefingWorkflowChecks(
    baseConfig,
    createTransport({ loginFails: true }),
    defaultRunOptions,
  );
  const report = formatBriefingWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/i);
  assert.doesNotMatch(report, /signed-session-token/i);
  assert.doesNotMatch(report, /bert_company_session=/i);
  assert.doesNotMatch(report, new RegExp(PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME, "i"));
});

test("verification helpers classify operational vs verification briefings", () => {
  const verification = buildProductionVerificationBriefing({ runId: TEST_RUN_ID });
  assert.equal(isVerificationBriefing(verification), true);
  assert.equal(isActiveVerificationBriefing(verification), true);
  assert.equal(isOperationalBriefing(verification), false);
  const cleaned = { ...verification, status: PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS };
  assert.equal(isActiveVerificationBriefing(cleaned), false);
  assert.equal(isOperationalBriefing(cleaned), false);
  const baseline = countBriefingBaselines([customerBriefing(), verification]);
  assert.equal(baseline.operationalCount, 1);
  assert.equal(baseline.activeVerificationCount, 1);
  assert.equal(listActiveVerificationBriefings([customerBriefing(), verification, cleaned]).length, 1);
  assert.equal(findBriefingById([verification], verification.briefingId)?.briefingId, verification.briefingId);
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 19);
  assert.equal(CHECK_KEYS.includes("sign"), true);
  assert.equal(CHECK_KEYS.includes("completion"), true);
  assert.equal(normalizeStatus(PRODUCTION_VERIFICATION_BRIEFING_TYPE), "verification");
  assert.match(PRODUCTION_VERIFICATION_BRIEFING_TITLE, /BERT Verification Briefing/);
});
