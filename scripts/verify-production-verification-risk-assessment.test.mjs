#!/usr/bin/env node
/**
 * Server-side regression tests for production verification Risk Assessment markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupStaleVerificationRiskAssessments,
  cleanupVerificationRiskAssessment,
} from "../server/risk-assessments-service.mjs";
import {
  buildProductionVerificationRiskAssessment,
  isActiveVerificationRiskAssessment,
  isOperationalRiskAssessment,
  isVerificationRiskAssessment,
  listActiveVerificationRiskAssessments,
  PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
} from "../shared/production-verification-risk-assessment.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 424242;

function customerAssessmentRow() {
  return {
    RiskAssessmentId: "ra-customer-1",
    CompanyFolderId: companyFolderId,
    AssessmentNumber: "RA-0001",
    Title: "Warehouse forklift use",
    Description: "Customer assessment",
    AssessmentType: "General",
    Activity: "Forklift operations",
    Department: "Operations",
    Status: "Active",
    Version: "1.0",
    ReviewDate: "2027-01-01",
    CreatedAt: "2026-01-01T00:00:00.000Z",
    UpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function verificationAssessmentRow(overrides = {}) {
  const assessment = buildProductionVerificationRiskAssessment({ runId, companyFolderId });
  return {
    RiskAssessmentId: assessment.id,
    CompanyFolderId: companyFolderId,
    AssessmentNumber: assessment.assessmentNumber,
    Title: assessment.title,
    Description: assessment.description,
    AssessmentType: assessment.assessmentType,
    Activity: assessment.activity,
    Department: assessment.department,
    NextReviewReason: assessment.nextReviewReason,
    PeopleAtRisk: assessment.peopleAtRisk,
    Status: "Draft",
    Version: "1.0",
    ReviewDate: assessment.reviewDate,
    AssessmentDate: assessment.assessmentDate,
    CreatedAt: assessment.createdAt,
    UpdatedAt: assessment.updatedAt,
    ...overrides,
  };
}

function mockDeps(rowsByTab) {
  return {
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => ({
      records: rowsByTab[tabName] || [],
    }),
    appendTabRows: async () => ({ ok: true }),
    patchTabRowByHeader: async () => ({ ok: true }),
    batchPatchTabRowsByHeader: async () => ({ ok: true }),
    ensureTabColumns: async () => ({ ok: true }),
  };
}

const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
};

const resolved = {
  companyFolderId,
  companyId: companyFolderId,
  masterSheetId,
};

test("verification marker parsing identifies verification risk assessments", () => {
  const verification = verificationAssessmentRow();
  const mapped = {
    id: verification.RiskAssessmentId,
    assessmentNumber: verification.AssessmentNumber,
    title: verification.Title,
    activity: verification.Activity,
    department: verification.Department,
    nextReviewReason: verification.NextReviewReason,
    peopleAtRisk: verification.PeopleAtRisk,
    description: verification.Description,
    status: verification.Status,
  };
  assert.equal(isVerificationRiskAssessment(mapped), true);
  assert.equal(isActiveVerificationRiskAssessment(mapped), true);
  assert.equal(isOperationalRiskAssessment(mapped), false);
});

test("operational risk assessment metrics exclude active verification rows", () => {
  const customer = {
    id: "ra-customer-1",
    status: "Active",
    archivedAt: "",
    highestResidualRiskScore: 6,
    reviewDate: "2027-01-01",
  };
  const verification = {
    id: buildProductionVerificationRiskAssessment({ runId }).id,
    title: "BERT Verification Risk Assessment",
    activity: "Production smoke verification",
    department: "Verification",
    nextReviewReason: "verification",
    peopleAtRisk: "production-risk-assessment-workflow",
    description: "Automated production Risk Assessment workflow verification. Safe to remove.",
    status: "Active",
    archivedAt: "",
    highestResidualRiskScore: 4,
    reviewDate: "2027-01-01",
  };
  const metrics = buildHealthSafetyMetrics({
    incidents: [],
    riddor: [],
    coshh: [],
    equipment: [],
    incidentActions: [],
    riskAssessments: [customer, verification],
    todayKey: "2026-07-01",
  });
  assert.equal(metrics.activeRiskAssessments, 1);
});

test("verification-only cleanup archives hazards links and assessment", async () => {
  const verification = verificationAssessmentRow({ Status: "Active" });
  const hazardId = `bert-smoke-ra-hazard-${runId}-1`;
  const rowsByTab = {
    RiskAssessments: [customerAssessmentRow(), verification],
    RiskAssessmentHazards: [
      {
        HazardId: hazardId,
        RiskAssessmentId: verification.RiskAssessmentId,
        CompanyFolderId: companyFolderId,
        HazardTitle: "Slips, trips and falls",
        Status: "active",
        UpdatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    RiskAssessmentLinks: [
      {
        LinkId: "ral-test",
        RiskAssessmentId: verification.RiskAssessmentId,
        CompanyFolderId: companyFolderId,
        LinkedRecordType: "document",
        LinkedRecordId: "doc-1",
      },
    ],
    RiskAssessmentReviews: [],
  };
  const deps = mockDeps(rowsByTab);
  const result = await cleanupVerificationRiskAssessment(null, deps, resolved, actor, verification.RiskAssessmentId);
  assert.equal(result.ok, true);
  assert.equal(result.status, PRODUCTION_VERIFICATION_RA_CLEANED_STATUS);
  assert.equal(result.cleanedHazards, 1);
  assert.equal(result.cleanedLinks, 1);
});

test("stale verification cleanup only affects verification-marked assessments", async () => {
  const verification = verificationAssessmentRow({ Status: "Submitted" });
  const rowsByTab = {
    RiskAssessments: [customerAssessmentRow(), verification],
    RiskAssessmentHazards: [],
    RiskAssessmentLinks: [],
    RiskAssessmentReviews: [],
  };
  const deps = mockDeps(rowsByTab);
  const result = await cleanupStaleVerificationRiskAssessments(null, deps, resolved, actor);
  assert.equal(result.ok, true);
  assert.equal(result.cleanedCount, 1);
  assert.deepEqual(result.cleanedRiskAssessmentIds, [verification.RiskAssessmentId]);
});

test("non-verification cleanup is rejected", async () => {
  const rowsByTab = {
    RiskAssessments: [customerAssessmentRow()],
    RiskAssessmentHazards: [],
    RiskAssessmentLinks: [],
    RiskAssessmentReviews: [],
  };
  const deps = mockDeps(rowsByTab);
  const denied = await cleanupVerificationRiskAssessment(null, deps, resolved, actor, "ra-customer-1");
  assert.equal(denied.ok, false);
  assert.equal(denied.httpStatus, 403);
});

test("listActiveVerificationRiskAssessments ignores cleaned rows", () => {
  const active = {
    id: buildProductionVerificationRiskAssessment({ runId }).id,
    title: "BERT Verification Risk Assessment",
    activity: "Production smoke verification",
    department: "Verification",
    nextReviewReason: "verification",
    peopleAtRisk: "production-risk-assessment-workflow",
    status: "Draft",
  };
  const cleaned = {
    ...active,
    status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
    archivedAt: "2026-07-01T00:00:00.000Z",
  };
  assert.equal(listActiveVerificationRiskAssessments([active, cleaned]).length, 1);
});
