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
} from "../shared/risk-assessments.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  getCompanyRiskAssessment,
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
      return { ok: true };
    },
    getReadCalls: () => readCalls,
    getEnsureCalls: () => ensureCalls,
  };
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
