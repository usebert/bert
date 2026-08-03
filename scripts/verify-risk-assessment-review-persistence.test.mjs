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
  canReviewRiskAssessment,
  createCompanyRiskAssessment,
  createRiskAssessmentHazard,
  getCompanyRiskAssessment,
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
const viewerActor = {
  email: "bert.demo+viewer@usebert.co.uk",
  role: "Viewer",
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

async function createActiveAssessment(runId, actor = adminActor) {
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
  await submitCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  await approveCompanyRiskAssessment({}, deps, resolved, actor, verification.id, { activateNow: true });
  return { deps, verification, hazardOne, hazardTwo, actor };
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("Admin can review Active assessment", () => {
  assert.equal(
    canReviewRiskAssessment(adminActor, { status: "Active" }),
    true,
  );
});

test("Viewer cannot review Active assessment", () => {
  assert.equal(
    canReviewRiskAssessment(viewerActor, { status: "Active" }),
    false,
  );
});

test("no_change review preserves Active and version 1.0", async () => {
  const runId = 9401;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewId = buildProductionVerificationReviewId(runId);
  const nextReviewDate = "2027-06-01";
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    reviewType: "manual",
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate,
  });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.item.status, "Active");
  assert.equal(reviewed.item.version, "1.0");
  assert.equal(reviewed.item.reviewDate, nextReviewDate);
  assert.equal(reviewed.reviews.length, 1);
  assert.equal(reviewed.reviews[0].id, reviewId);
  assert.equal(reviewed.reviews[0].outcome, "no_change");
});

test("review preserves both hazards", async () => {
  const runId = 9402;
  const { deps, verification, hazardOne, hazardTwo } = await createActiveAssessment(runId);
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId: buildProductionVerificationReviewId(runId),
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.hazards.length, 2);
  assert.ok(reviewed.hazards.some((item) => item.id === hazardOne.id));
  assert.ok(reviewed.hazards.some((item) => item.id === hazardTwo.id));
});

test("review row written once to RiskAssessmentReviews tab", async () => {
  const runId = 9403;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewId = buildProductionVerificationReviewId(runId);
  await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  const reviewRows = deps.getRows().RiskAssessmentReviews.filter((row) => row.RiskAssessmentId === verification.id);
  assert.equal(reviewRows.length, 1);
  assert.equal(reviewRows[0].ReviewId, reviewId);
  assert.equal(reviewRows[0].Outcome, "no_change");
});

test("detail cache warm before review still returns new review", async () => {
  const runId = 9404;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewId = buildProductionVerificationReviewId(runId);
  const cached = await getCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id);
  assert.equal(cached.item.status, "Active");
  assert.equal(cached.reviews.length, 0);
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.reviews.length, 1);
  const after = await getCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id);
  assert.equal(after.reviews.length, 1);
  assert.equal(after.reviews[0].id, reviewId);
});

test("repeated review with same ReviewId is idempotent", async () => {
  const runId = 9405;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewId = buildProductionVerificationReviewId(runId);
  const nextReviewDate = "2027-06-01";
  const first = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate,
  });
  const second = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId,
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2028-06-01",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyReviewed, true);
  assert.equal(second.item.reviewDate, nextReviewDate);
  assert.equal(deps.getRows().RiskAssessmentReviews.filter((row) => row.ReviewId === reviewId).length, 1);
});

test("zero-row review append fails", async () => {
  const runId = 9406;
  const { deps, verification } = await createActiveAssessment(runId);
  const originalAppend = deps.appendTabRows;
  deps.appendTabRows = async (...args) => {
    const result = await originalAppend(...args);
    return { ...result, updatedRows: 0 };
  };
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId: buildProductionVerificationReviewId(runId),
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.httpStatus, 500);
  assert.match(reviewed.code || "", /RISK_REVIEW_CREATE_WRITE_FAILED/);
});

test("invalid review outcome rejected", async () => {
  const runId = 9407;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    outcome: "not-a-real-outcome",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.httpStatus, 400);
});

test("insufficient role rejected", async () => {
  const runId = 9408;
  const { deps, verification } = await createActiveAssessment(runId);
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, viewerActor, verification.id, {
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.httpStatus, 403);
});

test("no_change review does not create new version", async () => {
  const runId = 9409;
  const { deps, verification } = await createActiveAssessment(runId);
  const beforeCount = deps.getRows().RiskAssessments.length;
  await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    reviewId: buildProductionVerificationReviewId(runId),
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(deps.getRows().RiskAssessments.length, beforeCount);
  const row = deps.getRows().RiskAssessments.find((entry) => entry.RiskAssessmentId === verification.id);
  assert.equal(row.Version, "1.0");
  assert.equal(row.Status, "Active");
});

test("Draft assessment review rejected", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9410, companyFolderId });
  const deps = createMutableDeps({
    RiskAssessments: [
      {
        RiskAssessmentId: verification.id,
        CompanyFolderId: companyFolderId,
        AssessmentNumber: verification.assessmentNumber,
        Title: verification.title,
        Description: verification.description,
        Status: "Draft",
        Version: "1.0",
        ReviewDate: verification.reviewDate,
        CreatedAt: "2026-01-01T00:00:00.000Z",
        CreatedBy: adminActor.email,
        UpdatedAt: "2026-01-01T00:00:00.000Z",
        UpdatedBy: adminActor.email,
      },
    ],
  });
  const reviewed = await reviewCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, {
    outcome: "no_change",
    summary: "Production smoke verification review",
    nextReviewDate: "2027-06-01",
  });
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.httpStatus, 403);
});
