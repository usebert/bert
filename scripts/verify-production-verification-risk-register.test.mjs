#!/usr/bin/env node
/**
 * Server-side regression tests for production verification Risk Register markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RISK_REGISTER_CONTROLS_TAB,
  RISK_REGISTER_CONTROLS_TAB_COLUMNS,
  RISK_REGISTER_REVIEWS_TAB,
  RISK_REGISTER_REVIEWS_TAB_COLUMNS,
  RISK_REGISTER_TAB,
  RISK_REGISTER_TAB_COLUMNS,
  mapRiskRegisterControlRecord,
  mapRiskRegisterRecord,
} from "../shared/risk-register.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";
import {
  buildProductionVerificationExistingControl,
  buildProductionVerificationRiskRegister,
  buildProductionVerificationRiskRegisterControlId,
  buildProductionVerificationRiskRegisterId,
  buildProductionVerificationRiskRegisterReference,
  isActiveVerificationRiskRegisterItem,
  isOperationalRiskRegisterItem,
  isVerificationRiskRegisterControlId,
  isVerificationRiskRegisterItem,
  PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER,
  riskSubmittedMarker,
} from "../shared/production-verification-risk-register.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  approveVerificationRiskRegisterItem,
  cleanupStaleVerificationRiskRegister,
  cleanupVerificationRiskRegisterItem,
  createVerificationRiskRegisterItem,
  patchVerificationRiskRegisterItem,
  reviewVerificationRiskRegisterItem,
  submitVerificationRiskRegisterItem,
  upsertVerificationRiskRegisterControl,
} from "../server/risk-register-verification-service.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 626262;
const todayKey = getUkTodayKey();
const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
  name: "Mr Important",
};

function customerRiskRow() {
  return {
    RiskId: "risk-customer-1",
    CompanyFolderId: companyFolderId,
    RiskReference: "RISK-001",
    Title: "Industrial supply disruption",
    Description: "Customer risk",
    Category: "Operational",
    Department: "Operations",
    SiteId: "Site A",
    OwnerName: "Customer Owner",
    Status: "Active",
    ReviewDate: "2027-01-01",
    InitialLikelihood: "2",
    InitialImpact: "3",
    InitialRiskScore: "6",
    InitialRiskBand: "Moderate",
    ResidualLikelihood: "1",
    ResidualImpact: "2",
    ResidualRiskScore: "2",
    ResidualRiskBand: "Low",
    CreatedAt: "2026-01-01T00:00:00.000Z",
    CreatedBy: actor.email,
    UpdatedAt: "2026-01-01T00:00:00.000Z",
    UpdatedBy: actor.email,
  };
}

function createRiskDeps(initialRisks = [customerRiskRow()], initialControls = []) {
  const tabs = new Map();
  const tabKey = (tab) => tab;
  const ensure = (tab, headers, seed = []) => {
    if (!tabs.has(tabKey(tab))) {
      tabs.set(tabKey(tab), { headers: [...headers], rows: seed.map((row) => ({ ...row })) });
    }
    return tabs.get(tabKey(tab));
  };
  const deps = {
    ensureTabColumns: async (_auth, _deps, _sheetId, tab, headers) => {
      ensure(tab, headers);
      return { ok: true };
    },
    readTabRecords: async (_auth, _deps, _sheetId, tab, options = {}) => {
      const entry = ensure(tab, options.expectedHeaders || []);
      return { ok: true, records: entry.rows.map((row) => ({ ...row })) };
    },
    appendTabRows: async (_auth, _deps, _sheetId, tab, headers, rowObjects = []) => {
      const entry = ensure(tab, headers);
      for (const row of rowObjects) {
        const normalized = {};
        for (const header of headers) normalized[header] = String(row[header] ?? "");
        entry.rows.push(normalized);
      }
      return { ok: true, written: rowObjects.length };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tab, matchHeader, matchValue, updates = {}) => {
      const entry = ensure(tab, []);
      const row = entry.rows.find((candidate) => String(candidate[matchHeader] || "").trim() === String(matchValue).trim());
      if (!row) throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
      Object.assign(row, updates);
      return { ok: true, patched: 1 };
    },
    getRiskRows() {
      return [...(tabs.get(tabKey(RISK_REGISTER_TAB))?.rows || [])];
    },
    getControlRows() {
      return [...(tabs.get(tabKey(RISK_REGISTER_CONTROLS_TAB))?.rows || [])];
    },
  };
  ensure(RISK_REGISTER_TAB, RISK_REGISTER_TAB_COLUMNS, initialRisks);
  ensure(RISK_REGISTER_CONTROLS_TAB, RISK_REGISTER_CONTROLS_TAB_COLUMNS, initialControls);
  ensure(RISK_REGISTER_REVIEWS_TAB, RISK_REGISTER_REVIEWS_TAB_COLUMNS, []);
  return deps;
}

function riskPayload(overrides = {}) {
  return buildProductionVerificationRiskRegister({
    runId,
    riskId: buildProductionVerificationRiskRegisterId(runId),
    companyFolderId,
    ownerName: actor.email,
    todayKey,
    ...overrides,
  });
}

test("verification marker recognition", () => {
  const payload = riskPayload();
  const mapped = mapRiskRegisterRecord({
    RiskId: payload.riskId,
    RiskReference: payload.riskReference,
    Title: payload.title,
    Description: payload.description,
    Notes: payload.notes,
  });
  assert.equal(isVerificationRiskRegisterItem(mapped), true);
  assert.equal(isActiveVerificationRiskRegisterItem(mapped), true);
  assert.equal(isOperationalRiskRegisterItem(mapped), false);
});

test("verification-only cleanup", async () => {
  const payload = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  const cleaned = await cleanupVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, { masterSheetId });
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.cleaned, true);
  const remaining = deps.getRiskRows().filter((row) => isActiveVerificationRiskRegisterItem(mapRiskRegisterRecord(row)));
  assert.equal(remaining.length, 0);
  assert.equal(deps.getRiskRows().some((row) => row.RiskId === "risk-customer-1"), true);
});

test("ordinary risk cleanup rejection", async () => {
  const deps = createRiskDeps([customerRiskRow()]);
  const denied = await cleanupVerificationRiskRegisterItem(null, deps, actor, companyFolderId, "risk-customer-1", { masterSheetId });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_RISK");
});

test("create idempotency", async () => {
  const payload = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  const again = await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyExists, true);
  assert.equal(deps.getRiskRows().filter((row) => row.RiskId === payload.riskId).length, 1);
});

test("control idempotency", async () => {
  const payload = riskPayload();
  const control = buildProductionVerificationExistingControl({
    runId,
    riskId: payload.riskId,
    companyFolderId,
    controlId: buildProductionVerificationRiskRegisterControlId(runId, "existing"),
  });
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  await upsertVerificationRiskRegisterControl(null, deps, actor, companyFolderId, { ...control, masterSheetId });
  const again = await upsertVerificationRiskRegisterControl(null, deps, actor, companyFolderId, { ...control, masterSheetId });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyExists, true);
  assert.equal(deps.getControlRows().filter((row) => row.ControlId === control.controlId).length, 1);
});

test("submit and approve idempotency", async () => {
  const payload = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  const submitInput = { masterSheetId };
  const firstSubmit = await submitVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, submitInput);
  assert.equal(firstSubmit.ok, true);
  const secondSubmit = await submitVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, submitInput);
  assert.equal(secondSubmit.ok, true);
  assert.equal(secondSubmit.alreadySubmitted, true);
  const firstApprove = await approveVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, submitInput);
  assert.equal(firstApprove.ok, true);
  const secondApprove = await approveVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, submitInput);
  assert.equal(secondApprove.ok, true);
  assert.equal(secondApprove.alreadyApproved, true);
});

test("review idempotency", async () => {
  const payload = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  await submitVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, { masterSheetId });
  await approveVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, { masterSheetId });
  const first = await reviewVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, {
    masterSheetId,
    reviewDate: "2027-06-01",
  });
  assert.equal(first.ok, true);
  const second = await reviewVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, {
    masterSheetId,
    reviewDate: "2027-06-01",
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyReviewed, true);
});

test("patch persists cause and scores", async () => {
  const payload = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  const patched = await patchVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, {
    masterSheetId,
    cause: "Updated cause",
    initialLikelihood: 3,
    initialImpact: 3,
  });
  assert.equal(patched.ok, true);
  const row = deps.getRiskRows().find((item) => item.RiskId === payload.riskId);
  assert.equal(row.Cause, "Updated cause");
  assert.equal(row.InitialRiskScore, "9");
});

test("operational overview exclusion", () => {
  const customer = mapRiskRegisterRecord(customerRiskRow());
  const verification = mapRiskRegisterRecord({
    RiskId: buildProductionVerificationRiskRegisterId(runId),
    RiskReference: buildProductionVerificationRiskRegisterReference(runId),
    Title: "BERT Verification Business Risk",
    Description: PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER,
    Notes: PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER,
    ResidualRiskScore: "12",
    Status: "Active",
    ReviewDate: todayKey,
  });
  const metrics = buildHealthSafetyMetrics({
    todayKey,
    riskRegister: [customer, verification],
    incidents: [],
    riddor: [],
    coshh: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [],
  });
  const verificationOnly = buildHealthSafetyMetrics({
    todayKey,
    riskRegister: [verification],
    incidents: [],
    riddor: [],
    coshh: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [],
  });
  assert.equal(metrics.highCriticalRiskRegisterItems, verificationOnly.highCriticalRiskRegisterItems);
});

test("stale cleanup", async () => {
  const stale = riskPayload({ runId: runId - 1, riskId: buildProductionVerificationRiskRegisterId(runId - 1) });
  const current = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...stale, masterSheetId });
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...current, masterSheetId });
  const result = await cleanupStaleVerificationRiskRegister(null, deps, actor, companyFolderId, {
    masterSheetId,
    keepRiskId: current.riskId,
  });
  assert.equal(result.ok, true);
  assert.equal(deps.getRiskRows().some((row) => row.RiskId === stale.riskId && !row.ArchivedAt), false);
});

test("submit requires draft status", async () => {
  const payload = riskPayload();
  const deps = createRiskDeps([customerRiskRow()]);
  await createVerificationRiskRegisterItem(null, deps, actor, companyFolderId, { ...payload, masterSheetId });
  await submitVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, { masterSheetId });
  const row = deps.getRiskRows().find((item) => item.RiskId === payload.riskId);
  row.Status = "Active";
  row.Notes = PRODUCTION_VERIFICATION_RISK_REGISTER_NOTES_MARKER;
  const denied = await submitVerificationRiskRegisterItem(null, deps, actor, companyFolderId, payload.riskId, { masterSheetId });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "RISK_REGISTER_NOT_DRAFT");
});

test("control operational filter after cleanup marker", () => {
  const control = mapRiskRegisterControlRecord({
    ControlId: buildProductionVerificationRiskRegisterControlId(runId, "existing"),
    RiskId: buildProductionVerificationRiskRegisterId(runId),
    Description: "control",
    Status: "verification-cleaned",
    ArchivedAt: new Date().toISOString(),
  });
  assert.equal(isVerificationRiskRegisterControlId(control.id), true);
});
