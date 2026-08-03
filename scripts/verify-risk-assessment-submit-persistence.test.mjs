#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS, RISK_ASSESSMENTS_TAB_COLUMNS } from "../shared/risk-assessments.mjs";
import {
  buildProductionVerificationHazard,
  buildProductionVerificationRiskAssessment,
} from "../shared/production-verification-risk-assessment.mjs";
import {
  createCompanyRiskAssessment,
  createRiskAssessmentHazard,
  getCompanyRiskAssessment,
  resetRiskAssessmentListCachesForTests,
  submitCompanyRiskAssessment,
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
    readAppendedRowByRange: async (_auth, _deps, _sheetId, tabName, _appendResult, matchHeader, matchValue) => {
      const row = (rowsByTab[tabName] || []).find((entry) => String(entry[matchHeader]) === String(matchValue));
      return row || null;
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tabName, header, id, patch) => {
      rowsByTab[tabName] = (rowsByTab[tabName] || []).map((row) =>
        String(row[header]) === String(id) ? { ...row, ...patch } : row,
      );
      return { ok: true, patched: 1, updatedRows: 1 };
    },
    batchPatchTabRowsByHeader: async (_auth, _deps, _sheetId, tabName, header, patches = []) => {
      for (const patch of patches) {
        rowsByTab[tabName] = (rowsByTab[tabName] || []).map((row) =>
          String(row[header]) === String(patch.matchValue) ? { ...row, ...patch.updates } : row,
        );
      }
      return { ok: true, patched: patches.length };
    },
    getRows: () => rowsByTab,
  };
  return deps;
}

async function createVerificationAssessmentWithHazards(runId) {
  const verification = buildProductionVerificationRiskAssessment({ runId, companyFolderId });
  const hazardOne = buildProductionVerificationHazard(runId, 1);
  const hazardTwo = buildProductionVerificationHazard(runId, 2);
  const deps = createMutableDeps({ RiskAssessments: [] });
  await createCompanyRiskAssessment({}, deps, resolved, actor, {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    assessmentDate: verification.assessmentDate,
    reviewDate: verification.reviewDate,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  });
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardOne);
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazardTwo);
  return { deps, verification, hazardOne, hazardTwo };
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("submit transitions Draft to Submitted with metadata", async () => {
  const { deps, verification } = await createVerificationAssessmentWithHazards(9201);
  const submitted = await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(submitted.ok, true);
  assert.equal(submitted.item.status, "Submitted");
  assert.equal(submitted.item.version, "1.0");
  assert.ok(submitted.item.submittedAt);
  assert.equal(submitted.item.submittedBy, actor.email);
  const row = deps.getRows().RiskAssessments.find((entry) => entry.RiskAssessmentId === verification.id);
  assert.equal(row.Status, "Submitted");
});

test("submit preserves both hazards and risk scores", async () => {
  const { deps, verification, hazardOne, hazardTwo } = await createVerificationAssessmentWithHazards(9202);
  const submitted = await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(submitted.hazards.length, 2);
  const one = submitted.hazards.find((item) => item.id === hazardOne.id);
  const two = submitted.hazards.find((item) => item.id === hazardTwo.id);
  assert.equal(Number(one.initialRiskScore), 6);
  assert.equal(Number(two.initialRiskScore), 9);
});

test("repeated submit is idempotent", async () => {
  const { deps, verification } = await createVerificationAssessmentWithHazards(9203);
  const first = await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  const second = await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadySubmitted, true);
  assert.equal(second.item.status, "Submitted");
  const row = deps.getRows().RiskAssessments.find((entry) => entry.RiskAssessmentId === verification.id);
  assert.equal(row.Status, "Submitted");
});

test("detail cache warm before submit still returns Submitted", async () => {
  const { deps, verification } = await createVerificationAssessmentWithHazards(9204);
  const cached = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(cached.item.status, "Draft");
  const submitted = await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(submitted.item.status, "Submitted");
  const after = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(after.item.status, "Submitted");
});

test("submit does not change RiskAssessmentId", async () => {
  const { deps, verification } = await createVerificationAssessmentWithHazards(9205);
  const submitted = await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(submitted.item.id, verification.id);
});
