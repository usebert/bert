#!/usr/bin/env node
/**
 * Server-side regression tests for production verification Actions markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupStaleVerificationActions,
  cleanupVerificationAction,
} from "../server/actions-service.mjs";
import {
  buildProductionVerificationAction,
  isActiveVerificationAction,
  isOperationalAction,
  isVerificationAction,
  listActiveVerificationActions,
  PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS,
} from "../shared/production-verification-action.mjs";
import { buildLiveDashboardFromSources } from "../shared/live-dashboard.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";

function customerRow() {
  return {
    "Action ID": "action-customer-1",
    "Company ID": companyFolderId,
    "Source Audit ID": "aud-real",
    "Source Audit Name": "Daily Safety Check",
    "Source Question ID": "q1",
    "Source Question Text": "Fix guard rail",
    Status: "Open",
    "Assigned To User ID": "worker",
    "Assigned To Name": "Worker",
    "Created At": "2026-01-01T00:00:00.000Z",
    "Updated At": "2026-01-01T00:00:00.000Z",
    "Due Date": "2026-12-31",
  };
}

function verificationRow(overrides = {}) {
  const action = buildProductionVerificationAction({
    actionId: "bert-smoke-action-test",
    companyFolderId,
    assigneeUserId: "mr.important",
    assigneeName: "Mr Important",
    createdByUserId: "mr.important",
    dueDate: "2026-12-31",
  });
  return {
    "Action ID": action.id,
    "Company ID": companyFolderId,
    "Source Audit ID": action.auditId,
    "Source Audit Name": action.auditName,
    "Source Question ID": action.questionId,
    "Source Question Text": action.questionText,
    "Source Answer": action.sourceAnswer,
    Status: action.status,
    "Assigned To User ID": action.assignedToUserId,
    "Assigned To Name": action.assignedToName,
    "Created By User ID": action.createdByUserId,
    "Created At": action.createdAt,
    "Updated At": action.updatedAt,
    "Due Date": action.dueDate,
    "Root Cause": action.rootCause,
    "Corrective Action": action.correctiveAction,
    "Risk Category": action.riskCategory,
    ...overrides,
  };
}

function createDeps(records) {
  let stored = [...records];
  return {
    resolveCompanyScheduleContext: async () => ({
      ok: true,
      companyFolderId,
      masterSheetId,
    }),
    readTabRecords: async () => ({ records: stored.map((record) => ({ ...record })) }),
    writeCompanyActions: async (_auth, _sheetId, _folderId, actions) => {
      stored = actions.map((action) => ({
        "Action ID": action.id,
        "Company ID": action.companyId,
        "Source Audit ID": action.auditId,
        "Source Audit Name": action.auditName,
        "Source Question ID": action.questionId,
        "Source Question Text": action.questionText,
        "Source Answer": action.sourceAnswer,
        Status: action.status,
        "Assigned To User ID": action.assignedToUserId,
        "Assigned To Name": action.assignedToName,
        "Created By User ID": action.createdByUserId,
        "Created At": action.createdAt,
        "Updated At": action.updatedAt,
        "Due Date": action.dueDate,
        "Closed At": action.closedAt || "",
        "Verified By User ID": action.verifiedByUserId || "",
        "Verification Notes": action.verificationNotes || "",
        Comments: action.comments || "",
        "Root Cause": action.rootCause || "",
        "Corrective Action": action.correctiveAction || "",
        "Risk Category": action.riskCategory || "",
      }));
      return { ok: true, written: stored.length };
    },
    getStored: () => stored,
  };
}

test("verification marker parsing", () => {
  assert.equal(isVerificationAction(verificationRow()), true);
  assert.equal(isVerificationAction(customerRow()), false);
  assert.equal(isActiveVerificationAction(verificationRow()), true);
  assert.equal(
    isActiveVerificationAction(verificationRow({ Status: PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS })),
    false,
  );
});

test("cleanup only affects verification actions", async () => {
  const deps = createDeps([customerRow(), verificationRow()]);
  const denied = await cleanupVerificationAction(null, deps, {
    actionId: "action-customer-1",
    companyFolderId,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_ACTION");
  assert.equal(deps.getStored().find((row) => row["Action ID"] === "action-customer-1")?.Status, "Open");
});

test("stale verification cleanup is idempotent", async () => {
  const deps = createDeps([customerRow(), verificationRow(), verificationRow({ "Action ID": "bert-smoke-action-old-2" })]);
  const first = await cleanupStaleVerificationActions(null, deps, { companyFolderId });
  assert.equal(first.ok, true);
  assert.equal(first.cleanedCount, 2);
  const second = await cleanupStaleVerificationActions(null, deps, { companyFolderId });
  assert.equal(second.ok, true);
  assert.equal(second.cleanedCount, 0);
  assert.equal(listActiveVerificationActions(deps.getStored().map((row) => ({ id: row["Action ID"], status: row.Status }))).length, 0);
});

test("dashboard excludes verification actions from operational metrics", () => {
  const payload = buildLiveDashboardFromSources(
    {
      actions: [customerRow(), verificationRow()],
      schedules: [],
      auditResults: [],
      auditFindings: [],
      incidents: [],
      ncrs: [],
      briefings: [],
      briefingRecipients: [],
      areas: [],
      sites: [],
    },
    {
      companyFolderId,
      now: new Date("2026-08-01T12:00:00.000Z"),
    },
  );
  assert.equal(payload.metrics.openActions, 1);
  assert.equal(isOperationalAction(verificationRow()), false);
});
