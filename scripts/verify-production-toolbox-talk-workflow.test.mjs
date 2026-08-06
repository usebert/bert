#!/usr/bin/env node
/**
 * Unit tests for production Toolbox Talk workflow verifier (Briefings Type extension).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createBriefingWorkflowMockTransport } from "./lib/production-briefing-workflow-mock-transport.mjs";
import {
  CHECK_KEYS,
  TOOLBOX_TALK_CHECK_LABELS,
  TOOLBOX_TALK_VERIFICATION_PROFILE,
  attemptVerificationBriefingCleanup,
  formatToolboxTalkWorkflowReport,
  loadToolboxTalkWorkflowConfig,
  runProductionToolboxTalkWorkflowChecks,
} from "./lib/production-toolbox-talk-workflow-core.mjs";
import {
  buildProductionVerificationToolboxTalk,
  buildProductionVerificationToolboxTalkId,
  PRODUCTION_VERIFICATION_TOOLBOX_TALK_TITLE,
  PRODUCTION_VERIFICATION_TOOLBOX_TALK_TYPE,
} from "../shared/production-verification-toolbox-talk.mjs";
import {
  isOperationalToolboxTalk,
  isVerificationBriefing,
  PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
} from "../shared/production-verification-briefing.mjs";

const baseConfig = loadToolboxTalkWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_TOOLBOX_TALK_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const defaultRunOptions = {
  runId: TEST_RUN_ID,
  listPollMaxAttempts: 5,
  listPollIntervalMs: 0,
};

function transportOptions(options = {}) {
  return {
    ...options,
    verificationProfile: TOOLBOX_TALK_VERIFICATION_PROFILE,
  };
}

function runToolbox(transportOptionsInput = {}, runOptions = defaultRunOptions) {
  return runProductionToolboxTalkWorkflowChecks(
    baseConfig,
    createBriefingWorkflowMockTransport(baseConfig, transportOptions(transportOptionsInput)),
    runOptions,
  );
}

test("full successful toolbox talk lifecycle", async () => {
  const result = await runToolbox();
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
  const report = formatToolboxTalkWorkflowReport(result);
  assert.match(report, /BERT Production Toolbox Talk Workflow/);
  assert.match(report, /Toolbox Talks API\s+PASS/);
  assert.match(report, /Talk ID: bert-smoke-toolbox-/);
  assert.match(report, /READY FOR CUSTOMERS/);
});

test("login failure", async () => {
  const result = await runToolbox({ loginFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("API unavailable", async () => {
  const result = await runToolbox({ briefingsUnavailable: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "briefingsApi");
});

test("mutation disabled", async () => {
  const config = { ...baseConfig, allowBriefingMutation: false, allowToolboxTalkMutation: false };
  const result = await runProductionToolboxTalkWorkflowChecks(
    config,
    createBriefingWorkflowMockTransport(baseConfig, transportOptions()),
    defaultRunOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale cleanup", async () => {
  const stale = buildProductionVerificationToolboxTalk({
    runId: 99999,
    briefingId: "bert-smoke-toolbox-99999",
    createdByEmail: baseConfig.expectedEmail,
  });
  const result = await runToolbox({
    initialBriefings: [
      {
        briefingId: "briefing-customer-1",
        title: "Weekly safety update",
        type: "Safety",
        status: "Sent",
        message: "Customer briefing",
        verificationSource: "",
        targetUserEmails: "worker@example.com",
        requiresRead: true,
        requiresAcknowledgement: true,
        requiresSignature: false,
        recipients: [],
      },
      {
        briefingId: stale.briefingId,
        title: stale.title,
        type: stale.type,
        status: "Draft",
        message: stale.message,
        verificationSource: stale.verificationSource,
        targetUserEmails: "",
        requiresRead: true,
        requiresAcknowledgement: true,
        requiresSignature: true,
        recipients: [],
      },
    ],
  });
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("create failure", async () => {
  const result = await runToolbox({ createFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createDraft");
});

test("create not visible", async () => {
  const result = await runToolbox({ createSuccessButNotVisible: true, listStaleUntilAttempt: 99 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "readback");
});

test("duplicate create", async () => {
  const existing = buildProductionVerificationToolboxTalk({
    runId: TEST_RUN_ID,
    createdByEmail: baseConfig.expectedEmail,
  });
  const result = await runToolbox({
    initialBriefings: [
      {
        briefingId: "briefing-customer-1",
        title: "Weekly safety update",
        type: "Safety",
        status: "Sent",
        message: "Customer briefing",
        verificationSource: "",
        targetUserEmails: "worker@example.com",
        requiresRead: true,
        requiresAcknowledgement: true,
        requiresSignature: false,
        recipients: [],
      },
      {
        briefingId: existing.briefingId,
        title: existing.title,
        type: existing.type,
        status: "Draft",
        message: existing.message,
        verificationSource: existing.verificationSource,
        targetUserEmails: "",
        requiresRead: true,
        requiresAcknowledgement: true,
        requiresSignature: true,
        recipients: [],
      },
    ],
  });
  assert.equal(result.checks.createDraft.status, "PASS");
  assert.equal(result.checks.readback.status, "PASS");
});

test("edit failure", async () => {
  const result = await runToolbox({ editFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editDraft");
});

test("missing recipient", async () => {
  const result = await runToolbox({ recipientMissing: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientAssignment");
});

test("duplicate recipient prevention", async () => {
  const runId = 33001;
  const existing = buildProductionVerificationToolboxTalk({
    runId,
    createdByEmail: baseConfig.expectedEmail,
  });
  const result = await runToolbox(
    {
      runId,
      initialBriefings: [
        {
          briefingId: "briefing-customer-1",
          title: "Weekly safety update",
          type: "Safety",
          status: "Sent",
          message: "Customer briefing",
          verificationSource: "",
          targetUserEmails: "worker@example.com",
          requiresRead: true,
          requiresAcknowledgement: true,
          requiresSignature: false,
          recipients: [],
        },
        {
          briefingId: existing.briefingId,
          title: existing.title,
          type: existing.type,
          status: "Draft",
          message: existing.message,
          verificationSource: existing.verificationSource,
          targetUserEmails: "other.recipient@example.com",
          requiresRead: true,
          requiresAcknowledgement: true,
          requiresSignature: true,
          recipients: [],
        },
      ],
      duplicateRecipients: true,
    },
    { ...defaultRunOptions, runId },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientAssignment");
});

test("broad assignment rejected", async () => {
  const result = await runToolbox({ broadRecipients: true }, { ...defaultRunOptions, runId: 33002 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientAssignment");
});

test("publish failure", async () => {
  const result = await runToolbox({ publishFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "publish");
});

test("repeated publish", async () => {
  const transport = createBriefingWorkflowMockTransport(baseConfig, transportOptions());
  const result = await runProductionToolboxTalkWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.publish.status, "PASS");
  assert.ok(transport.publishAttempts >= 1);
});

test("recipient login failure", async () => {
  const config = loadToolboxTalkWorkflowConfig({
    BERT_SMOKE_USERNAME: baseConfig.username,
    BERT_SMOKE_PASSWORD: baseConfig.password,
    BERT_SMOKE_COMPANY_FOLDER_ID: baseConfig.companyFolderId,
    BERT_SMOKE_MASTER_SHEET_ID: baseConfig.masterSheetId,
    BERT_SMOKE_EXPECTED_EMAIL: baseConfig.expectedEmail,
    BERT_SMOKE_ALLOW_TOOLBOX_TALK_MUTATION: "1",
    BERT_SMOKE_TOOLBOX_RECIPIENT_USERNAME: "recipient.user",
    BERT_SMOKE_TOOLBOX_RECIPIENT_PASSWORD: "recipient-password",
    BERT_SMOKE_TOOLBOX_RECIPIENT_EXPECTED_EMAIL: "bert.demo+recipient.user@usebert.co.uk",
  });
  const result = await runProductionToolboxTalkWorkflowChecks(
    config,
    createBriefingWorkflowMockTransport(
      config,
      transportOptions({
        recipientLoginFails: true,
        recipientExpectedEmail: config.recipientExpectedEmail,
      }),
    ),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientLogin");
});

test("to-do missing talk", async () => {
  const result = await runToolbox({ todoMissingBriefing: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recipientTodo");
});

test("read success", async () => {
  const result = await runToolbox();
  assert.equal(result.checks.read.status, "PASS");
});

test("repeated read idempotency", async () => {
  const transport = createBriefingWorkflowMockTransport(baseConfig, transportOptions());
  const result = await runProductionToolboxTalkWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.read.status, "PASS");
  assert.ok(transport.readAttempts >= 1);
});

test("acknowledgement success", async () => {
  const result = await runToolbox();
  assert.equal(result.checks.acknowledge.status, "PASS");
});

test("repeated acknowledgement idempotency", async () => {
  const transport = createBriefingWorkflowMockTransport(baseConfig, transportOptions());
  const result = await runProductionToolboxTalkWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.acknowledge.status, "PASS");
  assert.ok(transport.acknowledgeAttempts >= 1);
});

test("signature success", async () => {
  const result = await runToolbox();
  assert.equal(result.checks.sign.status, "PASS");
});

test("signature valid skip", async () => {
  const result = await runProductionToolboxTalkWorkflowChecks(
    baseConfig,
    createBriefingWorkflowMockTransport(baseConfig, transportOptions({ requiresSignature: false })),
    { ...defaultRunOptions, requiresSignature: false },
  );
  assert.equal(result.checks.sign.status, "SKIP");
});

test("completion count mismatch", async () => {
  const result = await runToolbox({ completionMismatch: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "completion");
});

test("dashboard exclusion", async () => {
  const result = await runToolbox({ dashboardIncludesVerification: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("cleanup success", async () => {
  const result = await runToolbox();
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const result = await runToolbox({ cleanupFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("ordinary cleanup rejected", async () => {
  const transport = createBriefingWorkflowMockTransport(baseConfig, transportOptions({ cleanupRejectsNonVerification: true }));
  const cleanup = await attemptVerificationBriefingCleanup(transport.request, {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationBriefingId: "briefing-customer-1",
  });
  const single = cleanup.results.find((item) => item.kind === "single");
  assert.equal(single?.ok, false);
});

test("transient 502 recovery", async () => {
  const result = await runToolbox({ create502Once: true });
  assert.equal(result.checks.createDraft.status, "PASS");
});

test("interrupt cleanup registers handler", async () => {
  let registered = false;
  await runProductionToolboxTalkWorkflowChecks(baseConfig, createBriefingWorkflowMockTransport(baseConfig, transportOptions()), {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registered = typeof fn === "function";
    },
  });
  assert.equal(registered, true);
});

test("secret-safe logs", async () => {
  const result = await runToolbox();
  const report = formatToolboxTalkWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /bert_company_session=/);
});

test("toolbox verification helpers", () => {
  const talk = buildProductionVerificationToolboxTalk({ runId: TEST_RUN_ID });
  assert.equal(isVerificationBriefing(talk), true);
  assert.equal(isOperationalToolboxTalk(talk), false);
  assert.equal(buildProductionVerificationToolboxTalkId(TEST_RUN_ID), `bert-smoke-toolbox-${TEST_RUN_ID}`);
  assert.equal(talk.type, PRODUCTION_VERIFICATION_TOOLBOX_TALK_TYPE);
  assert.match(PRODUCTION_VERIFICATION_TOOLBOX_TALK_TITLE, /BERT Verification Toolbox Talk/);
  const cleaned = { ...talk, status: PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS };
  assert.equal(isOperationalToolboxTalk(cleaned), false);
});

test("toolbox stage labels cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 19);
  assert.equal(TOOLBOX_TALK_CHECK_LABELS.briefingsApi, "Toolbox Talks API");
  assert.equal(TOOLBOX_TALK_CHECK_LABELS.recipientTodo, "Recipient To-Do");
  assert.equal(TOOLBOX_TALK_CHECK_LABELS.sign, "Sign / Attendance");
});
