#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS, RISK_ASSESSMENTS_TAB_COLUMNS } from "../shared/risk-assessments.mjs";
import {
  buildProductionVerificationHazard,
  buildProductionVerificationRiskAssessment,
} from "../shared/production-verification-risk-assessment.mjs";
import {
  approveCompanyRiskAssessment,
  canSelfApproveRiskAssessment,
  createCompanyRiskAssessment,
  createRiskAssessmentHazard,
  getCompanyRiskAssessment,
  resetRiskAssessmentListCachesForTests,
  submitCompanyRiskAssessment,
} from "../server/risk-assessments-service.mjs";

const companyFolderId = "folder-dovecote";
const masterSheetId = "sheet-dovecote";
const adminActor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
};
const managerActor = {
  email: "bert.demo+manager@usebert.co.uk",
  role: "Manager",
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

async function createSubmittedAssessment(runId, actor = adminActor) {
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
  return { deps, verification, hazardOne, hazardTwo, actor };
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("Admin self-approval is allowed by policy", () => {
  assert.equal(
    canSelfApproveRiskAssessment(adminActor, { submittedBy: adminActor.email }),
    true,
  );
});

test("Manager self-approval is blocked", () => {
  assert.equal(
    canSelfApproveRiskAssessment(managerActor, { submittedBy: managerActor.email }),
    false,
  );
});

test("Admin approve with activateNow transitions Submitted to Active", async () => {
  const { deps, verification } = await createSubmittedAssessment(9301);
  const approved = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(approved.ok, true);
  assert.equal(approved.item.status, "Active");
  assert.equal(approved.item.version, "1.0");
  assert.ok(approved.item.approvedAt);
  assert.equal(approved.item.approvedBy, adminActor.email);
  assert.ok(approved.item.activatedAt);
  const row = deps.getRows().RiskAssessments.find((entry) => entry.RiskAssessmentId === verification.id);
  assert.equal(row.Status, "Active");
});

test("Manager cannot approve own submission", async () => {
  const { deps, verification } = await createSubmittedAssessment(9302, managerActor);
  const approved = await approveCompanyRiskAssessment({}, deps, resolved, managerActor, verification.id, { activateNow: true });
  assert.equal(approved.ok, false);
  assert.equal(approved.httpStatus, 403);
});

test("repeated approval is idempotent", async () => {
  const { deps, verification } = await createSubmittedAssessment(9303);
  const first = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  const second = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyApproved, true);
  assert.equal(first.item.approvedAt, second.item.approvedAt);
});

test("detail cache warm before approve still returns Active", async () => {
  const { deps, verification } = await createSubmittedAssessment(9304);
  const cached = await getCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id);
  assert.equal(cached.item.status, "Submitted");
  const approved = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(approved.item.status, "Active");
  const after = await getCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id);
  assert.equal(after.item.status, "Active");
});

test("approval preserves both hazards", async () => {
  const { deps, verification, hazardOne, hazardTwo } = await createSubmittedAssessment(9305);
  const approved = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(approved.hazards.length, 2);
  assert.ok(approved.hazards.some((item) => item.id === hazardOne.id));
  assert.ok(approved.hazards.some((item) => item.id === hazardTwo.id));
});

test("approval without Submitted state is rejected", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9306, companyFolderId });
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
        CreatedAt: "2026-01-01T00:00:00.000Z",
        CreatedBy: adminActor.email,
        UpdatedAt: "2026-01-01T00:00:00.000Z",
        UpdatedBy: adminActor.email,
      },
    ],
  });
  const approved = await approveCompanyRiskAssessment({}, deps, resolved, adminActor, verification.id, { activateNow: true });
  assert.equal(approved.ok, false);
  assert.equal(approved.httpStatus, 403);
});
