#!/usr/bin/env node
/**
 * Regression tests for Risk Assessment list endpoint performance contract.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRiskAssessmentListItemFromRecord,
  buildRiskAssessmentListSummaryFromRecord,
  deriveRiskAssessmentStatus,
  RISK_ASSESSMENTS_TAB_COLUMNS,
} from "../shared/risk-assessments.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  buildProductionVerificationRiskAssessment,
  isOperationalRiskAssessment,
} from "../shared/production-verification-risk-assessment.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";
import {
  cleanupVerificationRiskAssessment,
  createCompanyRiskAssessment,
  getCompanyRiskAssessment,
  invalidateRiskAssessmentListCache,
  listCompanyRiskAssessments,
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

function assessmentRow(overrides = {}) {
  return {
    RiskAssessmentId: "ra-1",
    CompanyFolderId: companyFolderId,
    AssessmentNumber: "RA-0001",
    Title: "Forklift operations",
    AssessmentType: "General",
    Status: "Active",
    Version: "1.0",
    ReviewDate: "2026-06-01",
    HighestResidualRiskScore: "12",
    ResidualOverallRiskScore: "12",
    CreatedAt: "2026-01-01T00:00:00.000Z",
    UpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTrackingDeps(rowsByTab = {}) {
  const readCalls = [];
  let ensureCalls = 0;
  const deps = {
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => {
      readCalls.push(tabName);
      return { records: rowsByTab[tabName] || [] };
    },
    ensureTabColumns: async () => {
      ensureCalls += 1;
      return { ok: true, headers: RISK_ASSESSMENTS_TAB_COLUMNS };
    },
    getReadCalls: () => readCalls,
    getEnsureCalls: () => ensureCalls,
  };
  return deps;
}

function createMutableDeps(initialRows = {}) {
  const rowsByTab = {
    RiskAssessments: [...(initialRows.RiskAssessments || [])],
    RiskAssessmentHazards: [...(initialRows.RiskAssessmentHazards || [])],
    RiskAssessmentLinks: [...(initialRows.RiskAssessmentLinks || [])],
    RiskAssessmentReviews: [...(initialRows.RiskAssessmentReviews || [])],
  };
  const deps = createTrackingDeps(rowsByTab);
  deps.appendTabRows = async (_auth, _deps, _sheetId, tabName, expectedHeaders, rowObjects = []) => {
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
    return { ok: true, written: rows.length, masterSheetId: _sheetId, tabName, updatedRows: rows.length, updatedRange: `${tabName}!A${rowsByTab[tabName].length}:A${rowsByTab[tabName].length}` };
  };
  deps.patchTabRowByHeader = async (_auth, _deps, _sheetId, tabName, header, id, patch) => {
    rowsByTab[tabName] = (rowsByTab[tabName] || []).map((row) =>
      String(row[header]) === String(id) ? { ...row, ...patch } : row,
    );
    return { ok: true };
  };
  deps.getRows = () => rowsByTab;
  return deps;
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("buildRiskAssessmentListSummaryFromRecord uses stored row aggregates", () => {
  const summary = buildRiskAssessmentListSummaryFromRecord(assessmentRow());
  assert.equal(summary.highestResidualRiskScore, 12);
  assert.equal(summary.highestResidualBand?.label, "High");
  assert.equal(summary.highResidualCount, 1);
  assert.equal(summary.veryHighResidualCount, 0);
});

test("buildRiskAssessmentListItemFromRecord derives Review Due and Overdue statuses", () => {
  const todayKey = getUkTodayKey();
  const reviewDueDate = new Date(`${todayKey}T12:00:00Z`);
  reviewDueDate.setUTCDate(reviewDueDate.getUTCDate() + 14);
  const reviewDue = buildRiskAssessmentListItemFromRecord(
    assessmentRow({ Status: "Active", ReviewDate: reviewDueDate.toISOString().slice(0, 10) }),
  );
  assert.equal(reviewDue.status, "Review Due");

  const overdue = buildRiskAssessmentListItemFromRecord(
    assessmentRow({ Status: "Active", ReviewDate: "2020-01-01" }),
  );
  assert.equal(overdue.status, "Overdue");
});

test("list endpoint reads only the RiskAssessments tab", async () => {
  const deps = createTrackingDeps({
    RiskAssessments: [assessmentRow()],
  });
  const result = await listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(deps.getReadCalls(), ["RiskAssessments"]);
  assert.equal(deps.getEnsureCalls(), 4);
});

test("list endpoint does not read hazards, links or reviews tabs", async () => {
  const deps = createTrackingDeps({
    RiskAssessments: [assessmentRow(), assessmentRow({ RiskAssessmentId: "ra-2", AssessmentNumber: "RA-0002" })],
    RiskAssessmentHazards: [{ HazardId: "h-1", RiskAssessmentId: "ra-1" }],
    RiskAssessmentLinks: [{ LinkId: "l-1", RiskAssessmentId: "ra-1" }],
    RiskAssessmentReviews: [{ ReviewId: "r-1", RiskAssessmentId: "ra-1" }],
  });
  await listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true });
  assert.ok(!deps.getReadCalls().includes("RiskAssessmentHazards"));
  assert.ok(!deps.getReadCalls().includes("RiskAssessmentLinks"));
  assert.ok(!deps.getReadCalls().includes("RiskAssessmentReviews"));
});

test("list endpoint preserves archived filtering", async () => {
  const deps = createTrackingDeps({
    RiskAssessments: [
      assessmentRow(),
      assessmentRow({
        RiskAssessmentId: "ra-archived",
        AssessmentNumber: "RA-0009",
        ArchivedAt: "2026-02-01T00:00:00.000Z",
      }),
    ],
  });
  const withoutArchived = await listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true });
  assert.equal(withoutArchived.items.length, 1);

  const withArchived = await listCompanyRiskAssessments({}, deps, resolved, actor, {
    skipCache: true,
    includeArchived: true,
  });
  assert.equal(withArchived.items.length, 2);
});

test("ensure cache and in-flight dedupe share one ensure operation per workbook", async () => {
  let ensureCalls = 0;
  const deps = createTrackingDeps({ RiskAssessments: [assessmentRow()] });
  deps.ensureTabColumns = async () => {
    ensureCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true };
  };

  const [first, second] = await Promise.all([
    listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true }),
    listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(ensureCalls, 4);

  await listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true });
  assert.equal(ensureCalls, 4);
});

test("list cache returns cached payload for repeated requests", async () => {
  let readCount = 0;
  const deps = createTrackingDeps({ RiskAssessments: [assessmentRow()] });
  const originalRead = deps.readTabRecords;
  deps.readTabRecords = async (...args) => {
    readCount += 1;
    return originalRead(...args);
  };

  await listCompanyRiskAssessments({}, deps, resolved, actor);
  await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(readCount, 1);
});

test("list endpoint rejects forbidden actors", async () => {
  const deps = createTrackingDeps({ RiskAssessments: [assessmentRow()] });
  const result = await listCompanyRiskAssessments(
    {},
    deps,
    resolved,
    { email: "other@example.com", role: "Viewer", companyFolderId: "other-folder" },
    { skipCache: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 403);
  assert.deepEqual(deps.getReadCalls(), []);
});

test("derived status helper preserves archived and superseded states", () => {
  assert.equal(
    deriveRiskAssessmentStatus({ status: "Active", archivedAt: "2026-01-01" }),
    "Archived",
  );
  assert.equal(deriveRiskAssessmentStatus({ status: "Superseded" }), "Superseded");
});

test("detail endpoint still loads hazards, links and reviews", async () => {
  const deps = createTrackingDeps({
    RiskAssessments: [assessmentRow()],
    RiskAssessmentHazards: [
      {
        HazardId: "h-1",
        RiskAssessmentId: "ra-1",
        HazardTitle: "Crush",
        InitialLikelihood: 3,
        InitialSeverity: 4,
        ResidualLikelihood: 2,
        ResidualSeverity: 3,
      },
    ],
    RiskAssessmentLinks: [{ LinkId: "l-1", RiskAssessmentId: "ra-1", LinkedRecordType: "Action", LinkedRecordId: "a-1" }],
    RiskAssessmentReviews: [{ ReviewId: "r-1", RiskAssessmentId: "ra-1", ReviewOutcome: "No change" }],
  });
  const result = await getCompanyRiskAssessment({}, deps, resolved, actor, "ra-1");
  assert.equal(result.ok, true);
  assert.equal(result.hazards.length, 1);
  assert.equal(result.links.length, 1);
  assert.equal(result.reviews.length, 1);
  assert.ok(deps.getReadCalls().includes("RiskAssessmentHazards"));
  assert.ok(deps.getReadCalls().includes("RiskAssessmentLinks"));
  assert.ok(deps.getReadCalls().includes("RiskAssessmentReviews"));
});

test("verifier list stage completes within bounded mock budget", async () => {
  const deps = createTrackingDeps({
    RiskAssessments: Array.from({ length: 25 }, (_entry, index) =>
      assessmentRow({
        RiskAssessmentId: `ra-${index + 1}`,
        AssessmentNumber: `RA-${String(index + 1).padStart(4, "0")}`,
      }),
    ),
  });
  const startedAt = Date.now();
  const result = await listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true });
  const durationMs = Date.now() - startedAt;
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 25);
  assert.ok(durationMs < 500, `expected mock list under 500ms, got ${durationMs}ms`);
  assert.deepEqual(deps.getReadCalls(), ["RiskAssessments"]);
});

test("create invalidates warmed list cache so new verification record appears", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 4242, companyFolderId });
  const deps = createMutableDeps({
    RiskAssessments: [assessmentRow()],
  });
  const warmed = await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(warmed.items.length, 1);

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
  assert.equal(created.item.id, verification.id);

  const listed = await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(listed.ok, true);
  assert.equal(listed.items.some((item) => item.id === verification.id), true);
});

test("repeated verification create is idempotent and remains visible in list", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 5252, companyFolderId });
  const deps = createMutableDeps({ RiskAssessments: [] });
  const payload = {
    riskAssessmentId: verification.id,
    assessmentNumber: verification.assessmentNumber,
    title: verification.title,
    description: verification.description,
    activity: verification.activity,
    department: verification.department,
    nextReviewReason: verification.nextReviewReason,
    peopleAtRisk: verification.peopleAtRisk,
  };
  const first = await createCompanyRiskAssessment({}, deps, resolved, actor, payload);
  const second = await createCompanyRiskAssessment({}, deps, resolved, actor, payload);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.item.id, verification.id);
  const listed = await listCompanyRiskAssessments({}, deps, resolved, actor, { skipCache: true });
  assert.equal(listed.items.filter((item) => item.id === verification.id).length, 1);
});

test("verification record is retrievable from detail endpoint", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 6262, companyFolderId });
  const row = {
    RiskAssessmentId: verification.id,
    CompanyFolderId: companyFolderId,
    AssessmentNumber: verification.assessmentNumber,
    Title: verification.title,
    Description: verification.description,
    Activity: verification.activity,
    Department: verification.department,
    NextReviewReason: verification.nextReviewReason,
    PeopleAtRisk: verification.peopleAtRisk,
    Status: "Draft",
    Version: "1.0",
    CreatedAt: verification.createdAt,
    UpdatedAt: verification.updatedAt,
  };
  const deps = createMutableDeps({ RiskAssessments: [row] });
  const detail = await getCompanyRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(detail.ok, true);
  assert.equal(detail.item.id, verification.id);
});

test("cleanup invalidates list cache for verification assessments", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 7272, companyFolderId });
  const row = {
    RiskAssessmentId: verification.id,
    CompanyFolderId: companyFolderId,
    AssessmentNumber: verification.assessmentNumber,
    Title: verification.title,
    Description: verification.description,
    Activity: verification.activity,
    Department: verification.department,
    NextReviewReason: verification.nextReviewReason,
    PeopleAtRisk: verification.peopleAtRisk,
    Status: "Draft",
    Version: "1.0",
    CreatedAt: verification.createdAt,
    UpdatedAt: verification.updatedAt,
  };
  const deps = createMutableDeps({ RiskAssessments: [row] });
  await listCompanyRiskAssessments({}, deps, resolved, actor);
  const cleaned = await cleanupVerificationRiskAssessment({}, deps, resolved, actor, verification.id);
  assert.equal(cleaned.ok, true);
  const listed = await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(listed.items.some((item) => item.id === verification.id), false);
  const archivedList = await listCompanyRiskAssessments({}, deps, resolved, actor, {
    includeArchived: true,
    skipCache: true,
  });
  const match = archivedList.items.find((item) => item.id === verification.id);
  assert.ok(match);
  assert.equal(match.status, "Archived");
});

test("verification records remain excluded from Health & Safety overview metrics", () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 8282, companyFolderId });
  const metrics = buildHealthSafetyMetrics({
    riskAssessments: [
      { id: "ra-customer", status: "Active", highestResidualRiskScore: 8 },
      { ...verification, status: "Active", highestResidualRiskScore: 20 },
    ],
  });
  assert.equal(metrics.activeRiskAssessments, 1);
  assert.equal(metrics.veryHighResidualRiskAssessments, 0);
  assert.equal(isOperationalRiskAssessment(verification), false);
});

test("manual cache invalidation prevents stale empty list after workbook mutation", async () => {
  const deps = createMutableDeps({ RiskAssessments: [] });
  const empty = await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(empty.items.length, 0);
  deps.getRows().RiskAssessments.push(
    assessmentRow({ RiskAssessmentId: "ra-new", AssessmentNumber: "RA-0099", Title: "New assessment" }),
  );
  const stillStale = await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(stillStale.items.length, 0);
  invalidateRiskAssessmentListCache(resolved, "test-invalidate");
  const fresh = await listCompanyRiskAssessments({}, deps, resolved, actor);
  assert.equal(fresh.items.length, 1);
});

test("detail returns 404 without reading hazards when assessment is missing", async () => {
  const deps = createTrackingDeps({
    RiskAssessments: [],
    RiskAssessmentHazards: [{ HazardId: "h-1", RiskAssessmentId: "missing" }],
  });
  const detail = await getCompanyRiskAssessment({}, deps, resolved, actor, "missing-id");
  assert.equal(detail.ok, false);
  assert.equal(detail.httpStatus, 404);
  assert.deepEqual(deps.getReadCalls(), ["RiskAssessments"]);
});
