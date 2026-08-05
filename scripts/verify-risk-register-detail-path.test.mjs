#!/usr/bin/env node
/**
 * Regression tests for optimized Risk Register detail path.
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
} from "../shared/risk-register.mjs";
import {
  buildProductionVerificationRiskRegister,
  buildProductionVerificationRiskRegisterControlId,
  buildProductionVerificationRiskRegisterId,
} from "../shared/production-verification-risk-register.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { clearRiskRegisterCachesForTests } from "../server/risk-register-cache.mjs";
import {
  getCompanyRiskRegisterItem,
  invalidateRiskRegisterWorkbookCache,
  loadRiskRegisterDetail,
  logRiskRegisterDetailTiming,
} from "../server/risk-register-service.mjs";
import { residualRiskScoresConfirmed } from "../scripts/lib/production-risk-register-workflow-core.mjs";
import { patchVerificationRiskRegisterItem as patchVerificationRisk } from "../server/risk-register-verification-service.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 909090;
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

function verificationRiskRow() {
  const payload = buildProductionVerificationRiskRegister({
    runId,
    riskId: buildProductionVerificationRiskRegisterId(runId),
    companyFolderId,
    ownerName: actor.email,
    todayKey,
  });
  return {
    RiskId: payload.riskId,
    CompanyFolderId: companyFolderId,
    RiskReference: payload.riskReference,
    Title: payload.title,
    Description: payload.description,
    Category: payload.category,
    Department: payload.department,
    SiteId: payload.siteId,
    OwnerName: payload.ownerName,
    Cause: payload.cause,
    Consequence: payload.consequence,
    InitialLikelihood: String(payload.initialLikelihood),
    InitialImpact: String(payload.initialImpact),
    InitialRiskScore: String(payload.initialRiskScore),
    InitialRiskBand: payload.initialRiskBand,
    ResidualLikelihood: String(payload.residualLikelihood),
    ResidualImpact: String(payload.residualImpact),
    ResidualRiskScore: String(payload.residualRiskScore),
    ResidualRiskBand: payload.residualRiskBand,
    Status: payload.status,
    ReviewDate: payload.reviewDate,
    Notes: payload.notes,
    CreatedAt: "2026-01-01T00:00:00.000Z",
    CreatedBy: actor.email,
    UpdatedAt: "2026-01-01T00:00:00.000Z",
    UpdatedBy: actor.email,
  };
}

function createTrackedDeps(initialRisks = [customerRiskRow(), verificationRiskRow()], initialControls = [], initialReviews = []) {
  const tabs = new Map();
  const calls = {
    ensureTabColumns: 0,
    readTabRecords: [],
    resolveCompanyScheduleContext: 0,
  };
  const ensure = (tab, headers, seed = []) => {
    if (!tabs.has(tab)) {
      tabs.set(tab, { headers: [...headers], rows: seed.map((row) => ({ ...row })) });
    }
    return tabs.get(tab);
  };
  const deps = {
    ensureTabColumns: async (_auth, _deps, _sheetId, tab, headers) => {
      calls.ensureTabColumns += 1;
      ensure(tab, headers);
      return { ok: true };
    },
    readTabRecords: async (_auth, _deps, _sheetId, tab, options = {}) => {
      calls.readTabRecords.push(tab);
      const entry = ensure(tab, options.expectedHeaders || []);
      return { ok: true, records: entry.rows.map((row) => ({ ...row })) };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tab, matchHeader, matchValue, updates = {}) => {
      const entry = ensure(tab, []);
      const row = entry.rows.find((candidate) => String(candidate[matchHeader] || "").trim() === String(matchValue).trim());
      if (!row) throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
      Object.assign(row, updates);
      return { ok: true, patched: 1 };
    },
    resolveCompanyScheduleContext: async () => {
      calls.resolveCompanyScheduleContext += 1;
      return { ok: true, companyFolderId, masterSheetId };
    },
    calls,
  };
  ensure(RISK_REGISTER_TAB, RISK_REGISTER_TAB_COLUMNS, initialRisks);
  ensure(RISK_REGISTER_CONTROLS_TAB, RISK_REGISTER_CONTROLS_TAB_COLUMNS, initialControls);
  ensure(RISK_REGISTER_REVIEWS_TAB, RISK_REGISTER_REVIEWS_TAB_COLUMNS, initialReviews);
  return deps;
}

const resolved = { companyFolderId, masterSheetId, alternateIds: [] };
const verificationRiskId = buildProductionVerificationRiskRegisterId(runId);

test.beforeEach(() => {
  clearRiskRegisterCachesForTests();
});

test("detail reads one risk and filters controls/reviews by RiskId", async () => {
  const controlId = buildProductionVerificationRiskRegisterControlId(runId, "existing");
  const otherControlId = buildProductionVerificationRiskRegisterControlId(runId, "other-risk");
  const deps = createTrackedDeps(
    [customerRiskRow(), verificationRiskRow()],
    [
      {
        ControlId: controlId,
        RiskId: verificationRiskId,
        CompanyFolderId: companyFolderId,
        ControlType: "existing",
        Description: "Existing control",
        Status: "active",
      },
      {
        ControlId: otherControlId,
        RiskId: "risk-customer-1",
        CompanyFolderId: companyFolderId,
        ControlType: "existing",
        Description: "Customer control",
        Status: "active",
      },
    ],
    [
      { ReviewId: "review-1", RiskId: verificationRiskId, CompanyFolderId: companyFolderId, Outcome: "no_change" },
      { ReviewId: "review-2", RiskId: "risk-customer-1", CompanyFolderId: companyFolderId, Outcome: "no_change" },
    ],
  );

  const detail = await loadRiskRegisterDetail(null, deps, resolved, verificationRiskId);
  assert.equal(detail.ok, true);
  assert.equal(detail.item.id, verificationRiskId);
  assert.equal(detail.controls.length, 1);
  assert.equal(detail.controls[0].id, controlId);
  assert.equal(detail.reviews.length, 1);
  assert.equal(detail.reviews[0].riskId, verificationRiskId);
  assert.ok(deps.calls.readTabRecords.includes(RISK_REGISTER_TAB));
  assert.ok(deps.calls.readTabRecords.includes(RISK_REGISTER_CONTROLS_TAB));
  assert.ok(deps.calls.readTabRecords.includes(RISK_REGISTER_REVIEWS_TAB));
  assert.equal(deps.calls.resolveCompanyScheduleContext, 0, "detail should not resolve workbook when resolved is provided");
});

test("getCompanyRiskRegisterItem does not call list path or double-resolve workbook", async () => {
  const deps = createTrackedDeps();
  const result = await getCompanyRiskRegisterItem(null, deps, resolved, actor, verificationRiskId);
  assert.equal(result.ok, true);
  assert.equal(result.item.id, verificationRiskId);
  assert.equal(deps.calls.resolveCompanyScheduleContext, 0);
  const riskReads = deps.calls.readTabRecords.filter((tab) => tab === RISK_REGISTER_TAB).length;
  assert.equal(riskReads, 1, "detail should read RiskRegister tab once per request");
});

test("detail coalesces concurrent in-flight reads", async () => {
  const deps = createTrackedDeps();
  const [first, second] = await Promise.all([
    loadRiskRegisterDetail(null, deps, resolved, verificationRiskId),
    loadRiskRegisterDetail(null, deps, resolved, verificationRiskId),
  ]);
  assert.equal(first.item.id, second.item.id);
  const riskReads = deps.calls.readTabRecords.filter((tab) => tab === RISK_REGISTER_TAB).length;
  assert.equal(riskReads, 1, "concurrent detail requests should share one load");
});

test("stale detail cache invalidated after control mutation", async () => {
  const deps = createTrackedDeps();
  await loadRiskRegisterDetail(null, deps, resolved, verificationRiskId);
  const readsBefore = deps.calls.readTabRecords.length;
  invalidateRiskRegisterWorkbookCache(masterSheetId);
  await loadRiskRegisterDetail(null, deps, resolved, verificationRiskId);
  assert.ok(deps.calls.readTabRecords.length > readsBefore);
});

test("patch returns confirmed residual scores without full reload", async () => {
  const deps = createTrackedDeps([customerRiskRow(), verificationRiskRow()]);
  const patched = await patchVerificationRisk(null, deps, actor, companyFolderId, verificationRiskId, {
    masterSheetId,
    residualLikelihood: 1,
    residualImpact: 2,
  });
  assert.equal(patched.ok, true);
  assert.equal(Number(patched.item.residualLikelihood), 1);
  assert.equal(Number(patched.item.residualImpact), 2);
  assert.equal(Number(patched.item.residualRiskScore), 2);
  assert.equal(residualRiskScoresConfirmed(patched.item), true);
});

test("residual verification helper rejects invalid scores", () => {
  assert.equal(
    residualRiskScoresConfirmed({
      initialRiskScore: 9,
      residualLikelihood: 1,
      residualImpact: 2,
      residualRiskScore: 2,
      residualRiskBand: "Low",
    }),
    true,
  );
  assert.equal(
    residualRiskScoresConfirmed({
      initialRiskScore: 2,
      residualLikelihood: 1,
      residualImpact: 2,
      residualRiskScore: 2,
      residualRiskBand: "Low",
    }),
    false,
  );
});

test("detail timing logger emits structured stage metadata", () => {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args);
  try {
    logRiskRegisterDetailTiming("risk_row_lookup", {
      riskId: verificationRiskId,
      workbookId: masterSheetId,
      rowCounts: { risks: 12 },
      durationMs: 4,
      totalMs: 10,
    });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], "[risk-register:detail-timing]");
  assert.equal(lines[0][1].stage, "risk_row_lookup");
  assert.equal(lines[0][1].riskId, verificationRiskId);
});

test("customer risk remains accessible with normal permissions", async () => {
  const deps = createTrackedDeps();
  const result = await getCompanyRiskRegisterItem(null, deps, resolved, actor, "risk-customer-1");
  assert.equal(result.ok, true);
  assert.equal(result.item.id, "risk-customer-1");
  assert.equal(result.controls.length, 0);
});
