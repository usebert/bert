#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS, RISK_ASSESSMENTS_TAB_COLUMNS } from "../shared/risk-assessments.mjs";
import {
  buildProductionVerificationHazard,
  buildProductionVerificationReviewId,
  buildProductionVerificationRiskAssessment,
} from "../shared/production-verification-risk-assessment.mjs";
import {
  approveCompanyRiskAssessment,
  createCompanyRiskAssessment,
  createRiskAssessmentHazard,
  resetRiskAssessmentListCachesForTests,
  reviewCompanyRiskAssessment,
  submitCompanyRiskAssessment,
} from "../server/risk-assessments-service.mjs";

const companyFolderId = "folder-dovecote";
const masterSheetId = "sheet-dovecote";
const adminActor = {
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
    batchPatchTabRowsByHeader: async () => ({ ok: true, patched: 0 }),
    getRows: () => rowsByTab,
  };
  return deps;
}

async function createSubmittedAssessment(runId) {
  const verification = buildProductionVerificationRiskAssessment({ runId, companyFolderId });
  const hazardOne = buildProductionVerificationHazard(runId, 1);
  const hazardTwo = buildProductionVerificationHazard(runId, 2);
  const deps = createMutableDeps({ RiskAssessments: [] });
  await createCompanyRiskAssessment({}, deps, resolved, adminActor, {
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
  await createRiskAssessmentHazard({}, deps, resolved, adminActor, verification.id, hazardOne);
  await createRiskAssessmentHazard({}, deps, resolved, adminActor, verification.id, hazardTwo);
  await submitCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id);
  return { deps, verification, hazardOne, hazardTwo };
}

async function createActiveAssessment(runId) {
  const created = await createSubmittedAssessment(runId);
  await approveCompanyRiskAssessment({}, created.deps, resolved, adminActor, created.verification.id, { activateNow: true });
  return created;
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("approve returns hazards without requiring full detail rebuild", async () => {
  const { deps, verification, hazardOne, hazardTwo } = await createSubmittedAssessment(9501);
  const approved = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(approved.ok, true);
  assert.equal(approved.item.status, "Active");
  assert.equal(approved.hazards.length, 2);
  assert.ok(approved.hazards.some((item) => item.id === hazardOne.id));
  assert.ok(approved.hazards.some((item) => item.id === hazardTwo.id));
});

test("repeated approval is idempotent without duplicate metadata", async () => {
  const { deps, verification } = await createSubmittedAssessment(9502);
  const first = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  const second = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(first.item.approvedAt, second.item.approvedAt);
  assert.equal(second.alreadyApproved, true);
});

test("review returns review history from appended row", async () => {
  const runId = 9503;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewId = buildProductionVerificationReviewId(runId);
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.reviews.length, 1);
  assert.equal(reviewed.reviews[0].id, reviewId);
  assert.equal(deps.getRows().RiskAssessmentReviews.length, 1);
});

test("repeated review with same ReviewId does not duplicate rows", async () => {
  const runId = 9504;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewId = buildProductionVerificationReviewId(runId);
  await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  const second = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2028-06-01",
  });
  assert.equal(second.alreadyReviewed, true);
  assert.equal(deps.getRows().RiskAssessmentReviews.filter((row) => row.ReviewId === reviewId).length, 1);
});

test("service emits mutation timing instrumentation", async () => {
  const service = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../server/risk-assessments-service.mjs", import.meta.url), "utf8"),
  );
  assert.match(service, /\[risk-assessment:mutation-timing\]/);
  assert.match(service, /buildAssessmentMutationResponse/);
  assert.match(service, /readAssessmentHazardsForAssessment/);
});
