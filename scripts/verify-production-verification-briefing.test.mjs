#!/usr/bin/env node
/**
 * Server-side regression tests for production verification Briefing markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveDashboardFromSources } from "../shared/live-dashboard.mjs";
import {
  buildProductionVerificationBriefing,
  isActiveVerificationBriefing,
  isOperationalBriefing,
  isOperationalWorkbookBriefingRow,
  isVerificationBriefing,
  PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
} from "../shared/production-verification-briefing.mjs";
import {
  acknowledgeBriefing,
  assignVerificationBriefingRecipients,
  BRIEFINGS_TAB,
  BRIEFING_RECIPIENTS_TAB,
  cleanupVerificationBriefing,
  createDraftVerificationBriefing,
  publishVerificationBriefing,
  readBriefing,
  signBriefing,
} from "../server/briefings-service.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 424242;

const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
  name: "Mr Important",
};

function customerBriefingRow() {
  return {
    BriefingId: "briefing-customer-1",
    Title: "Weekly safety update",
    Type: "Safety",
    Status: "Sent",
    Priority: "Normal",
    Message: "Customer briefing for assembly team",
    VerificationSource: "",
    RequiresRead: "Yes",
    RequiresAcknowledgement: "Yes",
    RequiresSignature: "No",
    RequiresReply: "No",
    TargetMode: "users",
    TargetUserEmails: "worker@example.com",
    CreatedByEmail: "lead@example.com",
    CreatedByName: "Warehouse Lead",
    CreatedAt: "2026-01-15T09:30:00.000Z",
    SentAt: "2026-01-15T09:30:00.000Z",
    DueDate: "2026-12-31",
    RecipientCount: "1",
  };
}

function verificationBriefingRow(overrides = {}) {
  const briefing = buildProductionVerificationBriefing({
    runId,
    briefingId: `bert-smoke-briefing-${runId}`,
    createdByEmail: actor.email,
    createdByName: actor.name,
  });
  return {
    BriefingId: briefing.briefingId,
    Title: briefing.title,
    Type: briefing.type,
    Status: briefing.status,
    Priority: briefing.priority,
    Message: briefing.message,
    VerificationSource: briefing.verificationSource,
    RequiresRead: "Yes",
    RequiresAcknowledgement: "Yes",
    RequiresSignature: "Yes",
    RequiresReply: "No",
    TargetMode: "users",
    TargetUserEmails: "",
    CreatedByEmail: actor.email,
    CreatedByName: briefing.createdByName,
    CreatedAt: new Date().toISOString(),
    SentAt: "",
    DueDate: briefing.dueDate,
    RecipientCount: "0",
    ...overrides,
  };
}

function peopleRow(overrides = {}) {
  return {
    Email: actor.email,
    Name: actor.name,
    Role: "Admin",
    Status: "Active",
    ...overrides,
  };
}

function recipientRow(briefingId, overrides = {}) {
  return {
    BriefingId: briefingId,
    RecipientEmail: actor.email,
    RecipientName: actor.name,
    Role: "Admin",
    Area: "Production",
    Department: "Assembly",
    SentAt: new Date().toISOString(),
    Status: "New",
    Overdue: "No",
    ...overrides,
  };
}

function createBriefingDeps(initialRowsByTab = {}) {
  const rowsByTab = {
    [BRIEFINGS_TAB]: (initialRowsByTab[BRIEFINGS_TAB] || []).map((row) => ({ ...row })),
    [BRIEFING_RECIPIENTS_TAB]: (initialRowsByTab[BRIEFING_RECIPIENTS_TAB] || []).map((row) => ({ ...row })),
    People: (initialRowsByTab.People || [peopleRow()]).map((row) => ({ ...row })),
    Users: (initialRowsByTab.Users || []).map((row) => ({ ...row })),
  };

  return {
    rowsByTab,
    resolveCompanyScheduleContext: async () => ({
      ok: true,
      companyFolderId,
      companyId: companyFolderId,
      masterSheetId,
      alternateIds: [],
    }),
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => ({
      records: (rowsByTab[tabName] || []).map((row) => ({ ...row })),
    }),
    appendTabRows: async (_auth, _deps, _sheetId, tabName, _columns, newRows) => {
      rowsByTab[tabName].push(...newRows.map((row) => ({ ...row })));
      return { ok: true, updatedRows: newRows.length };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tabName, header, matchValue, patch) => {
      const records = rowsByTab[tabName] || [];
      const index = records.findIndex((row) => String(row[header] || row.BriefingId) === String(matchValue));
      if (index === -1) {
        return { ok: false, patched: 0, updatedRows: 0 };
      }
      rowsByTab[tabName][index] = { ...records[index], ...patch };
      return { ok: true, patched: 1, updatedRows: 1 };
    },
    writeTabRecords: async (_auth, _deps, _sheetId, tabName, _columns, records) => {
      rowsByTab[tabName] = records.map((row) => ({ ...row }));
      return { ok: true, written: records.length };
    },
    ensureTabColumns: async () => ({ ok: true }),
    getRows: (tabName) => rowsByTab[tabName] || [],
  };
}

function draftPayload(overrides = {}) {
  const briefing = buildProductionVerificationBriefing({
    runId,
    createdByEmail: actor.email,
    createdByName: actor.name,
    ...overrides,
  });
  return {
    briefingId: briefing.briefingId,
    title: briefing.title,
    message: briefing.message,
    dueDate: briefing.dueDate,
    requiresRead: briefing.requiresRead,
    requiresAcknowledgement: briefing.requiresAcknowledgement,
    requiresSignature: briefing.requiresSignature,
    targetUserEmails: briefing.targetUserEmails,
    ...overrides,
  };
}

async function createPublishedVerificationBriefing(deps, overrides = {}) {
  const payload = draftPayload(overrides);
  const created = await createDraftVerificationBriefing(null, deps, actor, companyFolderId, payload);
  assert.equal(created.ok, true);
  await assignVerificationBriefingRecipients(null, deps, actor, companyFolderId, payload.briefingId, {
    targetUserEmails: [actor.email],
  });
  const published = await publishVerificationBriefing(null, deps, actor, companyFolderId, payload.briefingId);
  assert.equal(published.ok, true);
  return payload.briefingId;
}

test("verification marker recognition", () => {
  const row = verificationBriefingRow();
  const mapped = {
    briefingId: row.BriefingId,
    title: row.Title,
    type: row.Type,
    message: row.Message,
    verificationSource: row.VerificationSource,
    status: row.Status,
  };
  assert.equal(isVerificationBriefing(mapped), true);
  assert.equal(isActiveVerificationBriefing(mapped), true);
  assert.equal(isOperationalBriefing(mapped), false);
  assert.equal(isOperationalWorkbookBriefingRow(row), false);
});

test("verification-only cleanup", async () => {
  const verification = verificationBriefingRow({ Status: "Sent", SentAt: "2026-07-01T12:00:00.000Z" });
  const deps = createBriefingDeps({
    [BRIEFINGS_TAB]: [customerBriefingRow(), verification],
    [BRIEFING_RECIPIENTS_TAB]: [recipientRow(verification.BriefingId)],
  });
  const result = await cleanupVerificationBriefing(
    null,
    deps,
    actor,
    companyFolderId,
    verification.BriefingId,
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, PRODUCTION_VERIFICATION_BRIEFING_CLEANED_STATUS);
  assert.equal(result.updatedRows, 2);
  assert.equal(deps.getRows(BRIEFING_RECIPIENTS_TAB).length, 0);
});

test("company scoping", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const denied = await createDraftVerificationBriefing(
    null,
    deps,
    { ...actor, companyFolderId: "folder-other" },
    companyFolderId,
    draftPayload(),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "BRIEFING_COMPANY_MISMATCH");
});

test("ordinary briefing cleanup rejection", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const denied = await cleanupVerificationBriefing(
    null,
    deps,
    actor,
    companyFolderId,
    "briefing-customer-1",
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.httpStatus, 403);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_BRIEFING");
});

test("recipient assignment idempotency", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const payload = draftPayload();
  const created = await createDraftVerificationBriefing(null, deps, actor, companyFolderId, payload);
  assert.equal(created.ok, true);
  const first = await assignVerificationBriefingRecipients(null, deps, actor, companyFolderId, payload.briefingId, {
    targetUserEmails: [actor.email],
  });
  deps.rowsByTab[BRIEFING_RECIPIENTS_TAB].push(recipientRow(payload.briefingId));
  const second = await assignVerificationBriefingRecipients(null, deps, actor, companyFolderId, payload.briefingId, {
    targetUserEmails: [actor.email],
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyAssigned, true);
  assert.equal(second.updatedRows, 0);
});

test("publish idempotency", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const briefingId = await createPublishedVerificationBriefing(deps);
  const second = await publishVerificationBriefing(null, deps, actor, companyFolderId, briefingId);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyPublished, true);
  assert.equal(second.updatedRows, 0);
});

test("read idempotency via applyRecipientAction", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const briefingId = await createPublishedVerificationBriefing(deps);
  const first = await readBriefing(null, deps, actor, companyFolderId, briefingId);
  const second = await readBriefing(null, deps, actor, companyFolderId, briefingId);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.unchanged, true);
  assert.ok(deps.getRows(BRIEFING_RECIPIENTS_TAB)[0].ReadAt);
});

test("acknowledgement idempotency", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const briefingId = await createPublishedVerificationBriefing(deps);
  await readBriefing(null, deps, actor, companyFolderId, briefingId);
  const first = await acknowledgeBriefing(null, deps, actor, companyFolderId, briefingId);
  const second = await acknowledgeBriefing(null, deps, actor, companyFolderId, briefingId);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.unchanged, true);
  assert.ok(deps.getRows(BRIEFING_RECIPIENTS_TAB)[0].AcknowledgedAt);
});

test("signature idempotency", async () => {
  const deps = createBriefingDeps({ [BRIEFINGS_TAB]: [customerBriefingRow()] });
  const briefingId = await createPublishedVerificationBriefing(deps);
  await readBriefing(null, deps, actor, companyFolderId, briefingId);
  await acknowledgeBriefing(null, deps, actor, companyFolderId, briefingId);
  const first = await signBriefing(null, deps, actor, companyFolderId, briefingId, {
    signatureName: PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
  });
  const second = await signBriefing(null, deps, actor, companyFolderId, briefingId, {
    signatureName: PRODUCTION_VERIFICATION_BRIEFING_SIGNATURE_NAME,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.unchanged, true);
  assert.ok(deps.getRows(BRIEFING_RECIPIENTS_TAB)[0].SignedAt);
});

test("operational dashboard exclusion (isOperationalBriefing)", () => {
  const customer = customerBriefingRow();
  const verification = verificationBriefingRow({ Status: "Sent", SentAt: "2026-07-01T12:00:00.000Z" });
  const payload = buildLiveDashboardFromSources(
    {
      briefings: [customer, verification],
      briefingRecipients: [
        {
          "Briefing ID": customer.BriefingId,
          "Recipient Email": "worker@example.com",
          "Recipient Name": "Worker",
          Status: "New",
        },
        {
          "Briefing ID": verification.BriefingId,
          "Recipient Email": actor.email,
          "Recipient Name": actor.name,
          Status: "New",
        },
      ],
      actions: [],
      schedules: [],
      auditResults: [],
      auditFindings: [],
      incidents: [],
      ncrs: [],
      areas: [],
      sites: [],
      syncLog: [],
    },
    {
      companyFolderId,
      alternateIds: [companyFolderId],
      actor: { role: "Admin", email: actor.email, companyId: companyFolderId },
      now: Date.parse("2026-07-03T12:00:00.000Z"),
    },
  );
  assert.equal(isOperationalBriefing({ briefingId: verification.BriefingId, verificationSource: verification.VerificationSource }), false);
  assert.equal(payload.metrics.pendingBriefings, 1);
  assert.equal(
    payload.actToday.some((item) => String(item.id || "").includes(verification.BriefingId)),
    false,
  );
});

test("zero-row acknowledgement failure", async () => {
  const verification = verificationBriefingRow({ Status: "Sent", SentAt: "2026-07-01T12:00:00.000Z" });
  const deps = createBriefingDeps({
    [BRIEFINGS_TAB]: [customerBriefingRow(), verification],
    [BRIEFING_RECIPIENTS_TAB]: [],
  });
  const denied = await acknowledgeBriefing(null, deps, actor, companyFolderId, verification.BriefingId);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "BRIEFING_RECIPIENT_NOT_FOUND");
});
