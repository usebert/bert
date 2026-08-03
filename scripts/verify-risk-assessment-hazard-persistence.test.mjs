#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS, RISK_ASSESSMENTS_TAB_COLUMNS } from "../shared/risk-assessments.mjs";
import { buildProductionVerificationHazard, buildProductionVerificationRiskAssessment } from "../shared/production-verification-risk-assessment.mjs";
import {
  createCompanyRiskAssessment,
  createRiskAssessmentHazard,
  getCompanyRiskAssessment,
  invalidateRiskAssessmentDetailCache,
  resetRiskAssessmentListCachesForTests,
} from "../server/risk-assessments-service.mjs";

const companyFolderId = "folder-dovecote";
const masterSheetId = "sheet-dovecote";
const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
};
const resolved = {
  ok: true,
  companyFolderId,
  masterSheetId,
  alternateCompanyIds: [],
};

function createMutableDeps(initialRows = {}) {
  const rowsByTab = {
    RiskAssessments: [...(initialRows.RiskAssessments || [])],
    RiskAssessmentHazards: [...(initialRows.RiskAssessmentHazards || [])],
    RiskAssessmentLinks: [...(initialRows.RiskAssessmentLinks || [])],
    RiskAssessmentReviews: [...(initialRows.RiskAssessmentReviews || [])],
  };
  const appendCalls = [];
  const deps = {
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => ({
      records: (rowsByTab[tabName] || []).map((row) => ({ ...row })),
    }),
    ensureTabColumns: async () => ({ ok: true, headers: RISK_ASSESSMENTS_TAB_COLUMNS }),
    appendTabRows: async (_auth, _deps, _sheetId, tabName, expectedHeaders, rowObjects = []) => {
      const rows =
        Array.isArray(rowObjects) && rowObjects.length > 0
          ? rowObjects
          : Array.isArray(expectedHeaders) &&
              expectedHeaders.length > 0 &&
              typeof expectedHeaders[0] === "object" &&
              !Array.isArray(expectedHeaders[0])
            ? expectedHeaders
            : [];
      rowsByTab[tabName] = [...(rowsByTab[tabName] || []), ...rows];
      appendCalls.push({ tabName, rows });
      const rowNumber = rowsByTab[tabName].length;
      return {
        ok: true,
        written: rows.length,
        updatedRows: rows.length,
        masterSheetId: _sheetId,
        tabName,
        updatedRange: `${tabName}!A${rowNumber}:A${rowNumber}`,
        sheetHeaders: tabName === "RiskAssessmentHazards" ? RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS : RISK_ASSESSMENTS_TAB_COLUMNS,
      };
    },
    readAppendedRowByRange: async (_auth, _deps, _sheetId, tabName, appendResult, matchHeader, matchValue) => {
      const row = (rowsByTab[tabName] || []).find((entry) => String(entry[matchHeader]) === String(matchValue));
      return row || null;
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tabName, header, id, patch) => {
      rowsByTab[tabName] = (rowsByTab[tabName] || []).map((row) =>
        String(row[header]) === String(id) ? { ...row, ...patch } : row,
      );
      return { ok: true };
    },
    batchPatchTabRowsByHeader: async (_auth, _deps, _sheetId, tabName, header, patches = []) => {
      for (const patch of patches) {
        rowsByTab[tabName] = (rowsByTab[tabName] || []).map((row) =>
          String(row[header]) === String(patch.matchValue) ? { ...row, ...patch.updates } : row,
        );
      }
      return { ok: true, patched: patches.length };
    },
    getAppendCalls: () => appendCalls,
    getRows: () => rowsByTab,
  };
  return deps;
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("two distinct HazardIds persist through sequential createRiskAssessmentHazard calls", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 8181, companyFolderId });
  const hazardOne = buildProductionVerificationHazard(8181, 1);
  const hazardTwo = buildProductionVerificationHazard(8181, 2);
  const deps = createMutableDeps({ RiskAssessments: [] });
  const created = await createCompanyRiskAssessment({}, deps, resolved, actor, {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  });
  assert.equal(created.ok, true);
  const first = await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardOne);
  const second = await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardTwo);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const activeHazards = deps
    .getRows()
    .RiskAssessmentHazards.filter((row) => row.RiskAssessmentId === verification.id && !row.ArchivedAt);
  assert.equal(activeHazards.length, 2);
  assert.equal(new Set(activeHazards.map((row) => row.HazardId)).size, 2);
});

test("second hazard create does not archive the first hazard", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 8282, companyFolderId });
  const hazardOne = buildProductionVerificationHazard(8282, 1);
  const hazardTwo = buildProductionVerificationHazard(8282, 2);
  const deps = createMutableDeps({ RiskAssessments: [] });
  await createCompanyRiskAssessment({}, deps, resolved, actor, {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  });
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardOne);
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardTwo);
  const first = deps.getRows().RiskAssessmentHazards.find((row) => row.HazardId === hazardOne.id);
  assert.equal(first?.ArchivedAt, undefined);
  assert.equal(first?.Status, "active");
});

test("repeated hazard create with same HazardId is idempotent", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 8383, companyFolderId });
  const hazard = buildProductionVerificationHazard(8383, 1);
  const deps = createMutableDeps({ RiskAssessments: [] });
  await createCompanyRiskAssessment({}, deps, resolved, actor, {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  });
  const first = await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazard);
  const second = await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazard);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(deps.getAppendCalls().filter((call) => call.tabName === "RiskAssessmentHazards").length, 1);
});

test("detail cache invalidation exposes newly added hazards", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 8484, companyFolderId });
  const hazardOne = buildProductionVerificationHazard(8484, 1);
  const hazardTwo = buildProductionVerificationHazard(8484, 2);
  const deps = createMutableDeps({ RiskAssessments: [] });
  await createCompanyRiskAssessment({}, deps, resolved, actor, {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  });
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardOne);
  const afterOne = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(afterOne.hazards.length, 1);
  const cachedAgain = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(cachedAgain.hazards.length, 1);
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardTwo);
  const afterTwo = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(afterTwo.hazards.length, 2);
  invalidateRiskAssessmentDetailCache(resolved, verification.id, "test");
  const fresh = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(fresh.hazards.length, 2);
});

test("appendTabRows uses canonical hazard headers then row objects", async () => {
  const deps = createMutableDeps();
  const verification = buildProductionVerificationRiskAssessment({ runId: 8585, companyFolderId });
  const hazard = buildProductionVerificationHazard(8585, 1);
  await createCompanyRiskAssessment({}, deps, resolved, actor, {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  });
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazard);
  const call = deps.getAppendCalls().find((entry) => entry.tabName === "RiskAssessmentHazards");
  assert.ok(call);
  assert.equal(call.rows[0].HazardId, hazard.id);
});
