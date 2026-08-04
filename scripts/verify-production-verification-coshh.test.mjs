#!/usr/bin/env node
/**
 * Server-side regression tests for production verification COSHH markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COSHH_ASSESSMENTS_TAB,
  COSHH_ASSESSMENTS_TAB_COLUMNS,
  COSHH_REGISTER_TAB,
  COSHH_REGISTER_TAB_COLUMNS,
  mapCoshhAssessmentRecord,
  mapCoshhRegisterRecord,
} from "../shared/health-safety.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";
import {
  assessmentSubmittedMarker,
  buildProductionVerificationCoshhAssessment,
  buildProductionVerificationCoshhAssessmentId,
  buildProductionVerificationCoshhAssessmentNumber,
  buildProductionVerificationCoshhId,
  buildProductionVerificationCoshhSubstance,
  isActiveVerificationCoshhRegister,
  isOperationalCoshhAssessment,
  isOperationalCoshhRegister,
  isVerificationCoshhAssessment,
  isVerificationCoshhRegister,
  PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER,
} from "../shared/production-verification-coshh.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  approveVerificationCoshhAssessment,
  cleanupStaleVerificationCoshh,
  cleanupVerificationCoshh,
  createVerificationCoshhAssessment,
  createVerificationCoshhSubstance,
  patchVerificationCoshhAssessment,
  reviewVerificationCoshhAssessment,
  submitVerificationCoshhAssessment,
} from "../server/coshh-verification-service.mjs";

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

function customerRegisterRow() {
  return {
    CoshhId: "coshh-customer-1",
    CompanyFolderId: companyFolderId,
    ProductName: "Industrial Degreaser",
    Supplier: "Acme Chemicals",
    ProductCode: "DEG-001",
    Description: "Customer product",
    PrimaryUse: "Degreasing",
    StorageLocation: "Store A",
    AssessmentRequired: "false",
    ApprovedForUse: "true",
    Status: "current",
    SdsDocumentId: "drive-customer-sds",
    SdsFileName: "degreaser-sds.pdf",
    ReviewDate: "2027-01-01",
    CreatedAt: "2026-01-01T00:00:00.000Z",
    CreatedBy: actor.email,
    UpdatedAt: "2026-01-01T00:00:00.000Z",
    UpdatedBy: actor.email,
  };
}

function createCoshhDeps(initialRegister = [customerRegisterRow()], initialAssessments = []) {
  const tabs = new Map();
  const tabKey = (tab) => tab;

  const ensure = (tab, headers) => {
    if (!tabs.has(tabKey(tab))) {
      const rows =
        tab === COSHH_REGISTER_TAB
          ? initialRegister.map((row) => ({ ...row }))
          : tab === COSHH_ASSESSMENTS_TAB
            ? initialAssessments.map((row) => ({ ...row }))
            : [];
      tabs.set(tabKey(tab), { headers: [...headers], rows });
    }
    return tabs.get(tabKey(tab));
  };

  const deps = {
    resolveCompanyFromFolder: async () => ({
      ok: true,
      companyFolderId,
      companyId: companyFolderId,
      masterSheetId,
    }),
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
        for (const header of headers) {
          normalized[header] = String(row[header] ?? "");
        }
        entry.rows.push(normalized);
      }
      return { ok: true, written: rowObjects.length };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tab, matchHeader, matchValue, updates = {}) => {
      const entry = ensure(tab, []);
      const row = entry.rows.find((candidate) => String(candidate[matchHeader] || "").trim() === String(matchValue).trim());
      if (!row) {
        throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
      }
      Object.assign(row, updates);
      return { ok: true, patched: 1 };
    },
    getRegisterRows() {
      return [...(tabs.get(tabKey(COSHH_REGISTER_TAB))?.rows || [])];
    },
    getAssessmentRows() {
      return [...(tabs.get(tabKey(COSHH_ASSESSMENTS_TAB))?.rows || [])];
    },
  };

  ensure(COSHH_REGISTER_TAB, COSHH_REGISTER_TAB_COLUMNS);
  ensure(COSHH_ASSESSMENTS_TAB, COSHH_ASSESSMENTS_TAB_COLUMNS);
  return deps;
}

function substancePayload(overrides = {}) {
  return buildProductionVerificationCoshhSubstance({
    runId,
    coshhId: buildProductionVerificationCoshhId(runId),
    companyFolderId,
    todayKey,
    ...overrides,
  });
}

function assessmentPayload(coshhId, overrides = {}) {
  return buildProductionVerificationCoshhAssessment({
    runId,
    coshhId,
    assessmentId: buildProductionVerificationCoshhAssessmentId(runId),
    companyFolderId,
    assessorName: actor.name,
    todayKey,
    ...overrides,
  });
}

test("verification marker recognition", () => {
  const substance = substancePayload();
  const mapped = mapCoshhRegisterRecord({
    CoshhId: substance.coshhId,
    ProductName: substance.productName,
    ProductCode: substance.productCode,
    Description: substance.description,
  });
  assert.equal(isVerificationCoshhRegister(mapped), true);
  assert.equal(isActiveVerificationCoshhRegister(mapped), true);
  assert.equal(isOperationalCoshhRegister(mapped), false);
});

test("verification-only cleanup", async () => {
  const substance = substancePayload();
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  const cleaned = await cleanupVerificationCoshh(null, deps, actor, companyFolderId, substance.coshhId, { masterSheetId });
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.cleaned, true);
  const remaining = deps.getRegisterRows().filter((row) => isActiveVerificationCoshhRegister(mapCoshhRegisterRecord(row)));
  assert.equal(remaining.length, 0);
  assert.equal(deps.getRegisterRows().some((row) => row.CoshhId === "coshh-customer-1"), true);
});

test("ordinary COSHH cleanup rejection", async () => {
  const deps = createCoshhDeps([customerRegisterRow()]);
  const denied = await cleanupVerificationCoshh(null, deps, actor, companyFolderId, "coshh-customer-1", { masterSheetId });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_COSHH");
});

test("substance create idempotency", async () => {
  const substance = substancePayload();
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  const again = await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyExists, true);
  assert.equal(deps.getRegisterRows().filter((row) => row.CoshhId === substance.coshhId).length, 1);
});

test("assessment create idempotency", async () => {
  const substance = substancePayload();
  const assessment = assessmentPayload(substance.coshhId);
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  await createVerificationCoshhAssessment(null, deps, actor, companyFolderId, { ...assessment, masterSheetId });
  const again = await createVerificationCoshhAssessment(null, deps, actor, companyFolderId, { ...assessment, masterSheetId });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyExists, true);
});

test("submit and approve idempotency", async () => {
  const substance = substancePayload();
  const assessment = assessmentPayload(substance.coshhId);
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  await createVerificationCoshhAssessment(null, deps, actor, companyFolderId, { ...assessment, masterSheetId });
  const submitInput = { masterSheetId };
  const firstSubmit = await submitVerificationCoshhAssessment(
    null,
    deps,
    actor,
    companyFolderId,
    assessment.assessmentId,
    submitInput,
  );
  assert.equal(firstSubmit.ok, true);
  const secondSubmit = await submitVerificationCoshhAssessment(
    null,
    deps,
    actor,
    companyFolderId,
    assessment.assessmentId,
    submitInput,
  );
  assert.equal(secondSubmit.ok, true);
  assert.equal(secondSubmit.alreadySubmitted, true);
  const firstApprove = await approveVerificationCoshhAssessment(
    null,
    deps,
    actor,
    companyFolderId,
    assessment.assessmentId,
    submitInput,
  );
  assert.equal(firstApprove.ok, true);
  const secondApprove = await approveVerificationCoshhAssessment(
    null,
    deps,
    actor,
    companyFolderId,
    assessment.assessmentId,
    submitInput,
  );
  assert.equal(secondApprove.ok, true);
  assert.equal(secondApprove.alreadyApproved, true);
});

test("review idempotency", async () => {
  const substance = substancePayload();
  const assessment = assessmentPayload(substance.coshhId);
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  await createVerificationCoshhAssessment(null, deps, actor, companyFolderId, { ...assessment, masterSheetId });
  await submitVerificationCoshhAssessment(null, deps, actor, companyFolderId, assessment.assessmentId, { masterSheetId });
  await approveVerificationCoshhAssessment(null, deps, actor, companyFolderId, assessment.assessmentId, { masterSheetId });
  const first = await reviewVerificationCoshhAssessment(null, deps, actor, companyFolderId, assessment.assessmentId, {
    masterSheetId,
    reviewDate: "2027-06-01",
  });
  assert.equal(first.ok, true);
  const second = await reviewVerificationCoshhAssessment(null, deps, actor, companyFolderId, assessment.assessmentId, {
    masterSheetId,
    reviewDate: "2027-06-01",
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyReviewed, true);
});

test("hazard and control patch persists", async () => {
  const substance = substancePayload();
  const assessment = assessmentPayload(substance.coshhId);
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  await createVerificationCoshhAssessment(null, deps, actor, companyFolderId, { ...assessment, masterSheetId });
  const patched = await patchVerificationCoshhAssessment(null, deps, actor, companyFolderId, assessment.assessmentId, {
    masterSheetId,
    hazards: "Irritant — updated",
    ppeRequired: "Protective gloves, safety glasses, face shield",
    storageControls: "Cool dry store",
  });
  assert.equal(patched.ok, true);
  const row = deps.getAssessmentRows().find((item) => item.AssessmentId === assessment.assessmentId);
  assert.match(row.Hazards, /Irritant/);
  assert.match(row.PpeRequired, /face shield/);
});

test("operational overview exclusion", () => {
  const customer = mapCoshhRegisterRecord(customerRegisterRow());
  const verification = mapCoshhRegisterRecord(
    buildProductionVerificationCoshhSubstance({ runId, coshhId: buildProductionVerificationCoshhId(runId), todayKey }),
  );
  verification.reviewDate = todayKey;
  const metrics = buildHealthSafetyMetrics({
    todayKey,
    coshh: [customer, verification],
    incidents: [],
    riddor: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [],
  });
  const verificationOnly = buildHealthSafetyMetrics({
    todayKey,
    coshh: [verification],
    incidents: [],
    riddor: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [],
  });
  assert.equal(metrics.coshhReviewsDueSoon, verificationOnly.coshhReviewsDueSoon);
  assert.equal(metrics.chemicalsMissingSds, 0);
});

test("stale cleanup", async () => {
  const stale = substancePayload({ runId: runId - 1, coshhId: buildProductionVerificationCoshhId(runId - 1) });
  const current = substancePayload();
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...stale, masterSheetId });
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...current, masterSheetId });
  const result = await cleanupStaleVerificationCoshh(null, deps, actor, companyFolderId, {
    masterSheetId,
    keepCoshhId: current.coshhId,
  });
  assert.equal(result.ok, true);
  assert.equal(
    deps.getRegisterRows().some((row) => row.CoshhId === stale.coshhId && !row.ArchivedAt),
    false,
  );
});

test("submit requires SDS metadata", async () => {
  const substance = substancePayload({ sdsDocumentId: "", sdsFileName: "" });
  const assessment = assessmentPayload(substance.coshhId);
  const deps = createCoshhDeps([customerRegisterRow()]);
  await createVerificationCoshhSubstance(null, deps, actor, companyFolderId, { ...substance, masterSheetId });
  await createVerificationCoshhAssessment(null, deps, actor, companyFolderId, { ...assessment, masterSheetId });
  const denied = await submitVerificationCoshhAssessment(null, deps, actor, companyFolderId, assessment.assessmentId, {
    masterSheetId,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "COSHH_SDS_REQUIRED");
});

test("assessment operational filter after cleanup marker", () => {
  const assessment = mapCoshhAssessmentRecord({
    AssessmentId: buildProductionVerificationCoshhAssessmentId(runId),
    CoshhId: buildProductionVerificationCoshhId(runId),
    AssessmentTitle: buildProductionVerificationCoshhAssessmentNumber(runId),
    AdditionalActions: `${PRODUCTION_VERIFICATION_COSHH_NOTES_MARKER} verification-cleaned`,
    Status: "archived",
    ArchivedAt: new Date().toISOString(),
  });
  assert.equal(isVerificationCoshhAssessment(assessment), true);
  assert.equal(isOperationalCoshhAssessment(assessment), true);
});
