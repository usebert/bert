#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessmentVersion, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS, RISK_ASSESSMENTS_TAB_COLUMNS } from "../shared/risk-assessments.mjs";
import {
  buildProductionVerificationHazard,
  buildProductionVerificationRiskAssessment,
} from "../shared/production-verification-risk-assessment.mjs";
import {
  createCompanyRiskAssessment,
  createRiskAssessmentHazard,
  getCompanyRiskAssessment,
  patchCompanyRiskAssessment,
  resetRiskAssessmentListCachesForTests,
  saveCompanyRiskAssessmentDraft,
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

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("normalizeAssessmentVersion canonicalises numeric sheet values", () => {
  assert.equal(normalizeAssessmentVersion("1"), "1.0");
  assert.equal(normalizeAssessmentVersion("1.0"), "1.0");
  assert.equal(normalizeAssessmentVersion("2"), "2.0");
});

test("draft patch preserves Status and Version", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9101, companyFolderId });
  const deps = createMutableDeps({
    RiskAssessments: [
      {
        RiskAssessmentId: verification.id,
        CompanyFolderId: companyFolderId,
        AssessmentNumber: verification.assessmentNumber,
        Title: verification.title,
        Description: verification.description,
        Status: "Draft",
        Version: "1",
        CreatedAt: "2026-01-01T00:00:00.000Z",
        CreatedBy: actor.email,
        UpdatedAt: "2026-01-01T00:00:00.000Z",
        UpdatedBy: actor.email,
      },
    ],
  });
  const patched = await patchCompanyRiskAssessment({}, deps, resolved, actor, verification.id, {
    description: `${verification.description} Updated during save draft.`,
  });
  assert.equal(patched.ok, true);
  assert.equal(patched.item.status, "Draft");
  assert.equal(patched.item.version, "1.0");
  const row = deps.getRows().RiskAssessments.find((entry) => entry.RiskAssessmentId === verification.id);
  assert.equal(row.Status, "Draft");
  assert.equal(row.Version, "1");
});

test("draft save preserves workflow timestamps", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9102, companyFolderId });
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
        SubmittedAt: "",
        SubmittedBy: "",
        ApprovedAt: "",
        ApprovedBy: "",
        ActivatedAt: "",
        SupersededAt: "",
        CreatedAt: "2026-01-01T00:00:00.000Z",
        CreatedBy: actor.email,
        UpdatedAt: "2026-01-01T00:00:00.000Z",
        UpdatedBy: actor.email,
      },
    ],
  });
  await saveCompanyRiskAssessmentDraft({}, deps, resolved, actor, verification.id, {
    description: "Updated description",
  });
  const row = deps.getRows().RiskAssessments.find((entry) => entry.RiskAssessmentId === verification.id);
  assert.equal(row.SubmittedAt, "");
  assert.equal(row.ApprovedAt, "");
  assert.equal(row.ActivatedAt, "");
  assert.equal(row.SupersededAt, "");
});

test("editable fields persist through save draft", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9103, companyFolderId });
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
  const saved = await saveCompanyRiskAssessmentDraft({}, deps, resolved, actor, verification.id, {
    description: `${verification.description} Updated during save draft.`,
  });
  assert.equal(saved.ok, true);
  assert.match(saved.item.description, /Updated during save draft/);
});

test("full hazard sync keeps both hazards active and archives removed only", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9104, companyFolderId });
  const hazardOne = buildProductionVerificationHazard(9104, 1);
  const hazardTwo = buildProductionVerificationHazard(9104, 2);
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
  const saved = await saveCompanyRiskAssessmentDraft({}, deps, resolved, actor, verification.id, {
    hazards: [hazardOne, hazardTwo],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.hazards.length, 2);
  const active = deps
    .getRows()
    .RiskAssessmentHazards.filter((row) => row.RiskAssessmentId === verification.id && !row.ArchivedAt);
  assert.equal(active.length, 2);
});

test("repeated save draft is idempotent", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9105, companyFolderId });
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
  const first = await saveCompanyRiskAssessmentDraft({}, deps, resolved, actor, verification.id, {
    description: "First save",
  });
  const second = await saveCompanyRiskAssessmentDraft({}, deps, resolved, actor, verification.id, {
    description: "First save",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.item.id, second.item.id);
  assert.equal(deps.getRows().RiskAssessments.filter((row) => row.RiskAssessmentId === verification.id).length, 1);
});

test("duplicate assessment rows resolve to latest row", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9106, companyFolderId });
  const deps = createMutableDeps({
    RiskAssessments: [
      {
        RiskAssessmentId: verification.id,
        CompanyFolderId: companyFolderId,
        AssessmentNumber: verification.assessmentNumber,
        Title: "Stale duplicate",
        Description: "old",
        Status: "Draft",
        Version: "2.0",
        UpdatedAt: "2026-01-01T00:00:00.000Z",
        UpdatedBy: actor.email,
      },
      {
        RiskAssessmentId: verification.id,
        CompanyFolderId: companyFolderId,
        AssessmentNumber: verification.assessmentNumber,
        Title: verification.title,
        Description: verification.description,
        Status: "Draft",
        Version: "1",
        UpdatedAt: "2026-01-02T00:00:00.000Z",
        UpdatedBy: actor.email,
      },
    ],
  });
  const detail = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(detail.item.version, "1.0");
  assert.equal(detail.item.title, verification.title);
});

test("detail cache invalidation after save draft", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9107, companyFolderId });
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
  await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  await saveCompanyRiskAssessmentDraft({}, deps, resolved, actor, verification.id, {
    description: "Updated after cache warm",
  });
  const fresh = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.match(fresh.item.description, /Updated after cache warm/);
});

test("recalculate-only patch does not change status or version", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9108, companyFolderId });
  const hazard = buildProductionVerificationHazard(9108, 1);
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
  await createRiskAssessmentHazard({}, deps, resolved, actor, verification.id, hazard);
  const patched = await patchCompanyRiskAssessment({}, deps, resolved, actor, verification.id, { recalculateRisk: true });
  assert.equal(patched.ok, true);
  assert.equal(patched.item.status, "Draft");
  assert.equal(patched.item.version, "1.0");
});
