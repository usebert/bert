#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS } from "../shared/risk-assessments.mjs";
import { buildProductionVerificationRiskAssessment } from "../shared/production-verification-risk-assessment.mjs";
import {
  analyzeTabHeaderAlignment,
  appendTabRows,
  mapRowObjectToHeaders,
  readAppendedRowByRange,
} from "../server/workbook-service.mjs";
import {
  createCompanyRiskAssessment,
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

function isSingleRowRange(a1 = "") {
  const match = String(a1).match(/^([A-Za-z]+)(\d+):[A-Za-z]+(\d+)$/);
  return Boolean(match && match[2] === match[3]);
}

function createGoogleDeps(options = {}) {
  const liveHeaders = options.liveHeaders || [...RISK_ASSESSMENTS_TAB_COLUMNS];
  const rowsByTab = {
    RiskAssessments: [liveHeaders],
    RiskAssessmentHazards: [["HazardId", "RiskAssessmentId"]],
    RiskAssessmentLinks: [["LinkId", "RiskAssessmentId"]],
    RiskAssessmentReviews: [["ReviewId", "RiskAssessmentId"]],
  };
  const appendCalls = [];
  const readRanges = [];

  const deps = {
    safeLower: (value) => String(value || "").trim().toLowerCase(),
    withSheetsQuotaRetry: async (fn) => fn(),
    google: {
      sheets: () => ({
        spreadsheets: {
          values: {
            get: async ({ range }) => {
              readRanges.push(range);
              const [tabPart, a1 = "A1:ZZ1"] = String(range || "").split("!");
              const tab = tabPart;
              const values = rowsByTab[tab] || [];
              if (isSingleRowRange(a1)) {
                const rowIndex = Number(a1.match(/^[A-Za-z]+(\d+):/)[1]) - 1;
                const row = values[rowIndex];
                return { data: { values: row ? [row] : [] } };
              }
              return { data: { values } };
            },
            append: async ({ spreadsheetId, requestBody }) => {
              appendCalls.push({ spreadsheetId, values: requestBody.values });
              const values = requestBody.values || [];
              for (const row of values) {
                rowsByTab.RiskAssessments.push(row);
              }
              const rowNumber = rowsByTab.RiskAssessments.length;
              const lastCol = String.fromCharCode(64 + liveHeaders.length);
              return {
                data: {
                  updates: {
                    updatedRange: `RiskAssessments!A${rowNumber}:${lastCol}${rowNumber}`,
                    updatedRows: values.length,
                    updatedColumns: liveHeaders.length,
                    tableRange: `RiskAssessments!A1:${lastCol}${rowNumber}`,
                  },
                },
              };
            },
            update: async () => ({ data: {} }),
          },
          get: async () => ({
            data: {
              sheets: Object.keys(rowsByTab).map((title) => ({ properties: { title, sheetId: 1 } })),
            },
          }),
          batchUpdate: async () => ({ data: {} }),
        },
      }),
    },
    ensureTabColumns: async () => ({ addedColumns: [], headers: liveHeaders }),
    getAppendCalls: () => appendCalls,
    getReadRanges: () => readRanges,
    getRows: () => rowsByTab,
  };
  return deps;
}

test.beforeEach(() => {
  resetRiskAssessmentListCachesForTests();
});

test("appendTabRows maps values using live sheet headers", async () => {
  const liveHeaders = ["Title", "RiskAssessmentId", "CompanyFolderId"];
  const deps = createGoogleDeps({ liveHeaders });
  const row = {
    RiskAssessmentId: "ra-live-header",
    CompanyFolderId: companyFolderId,
    Title: "Header alignment test",
  };
  const mapped = mapRowObjectToHeaders(liveHeaders, row);
  assert.deepEqual(mapped, ["Header alignment test", "ra-live-header", companyFolderId]);

  const result = await appendTabRows({}, deps, masterSheetId, "RiskAssessments", RISK_ASSESSMENTS_TAB_COLUMNS.slice(0, 3), [row]);
  assert.equal(result.written, 1);
  assert.equal(result.masterSheetId, masterSheetId);
  assert.match(result.updatedRange, /RiskAssessments!A\d+:/);

  const stored = deps.getRows().RiskAssessments[1];
  assert.equal(stored[0], "Header alignment test");
  assert.equal(stored[1], "ra-live-header");
  assert.equal(stored[2], companyFolderId);
});

test("appendTabRows fails when Google acknowledges zero updated rows", async () => {
  const deps = createGoogleDeps();
  deps.google.sheets = () => ({
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [RISK_ASSESSMENTS_TAB_COLUMNS] } }),
        append: async () => ({ data: { updates: { updatedRows: 0 } } }),
        update: async () => ({ data: {} }),
      },
      get: async () => ({ data: { sheets: [{ properties: { title: "RiskAssessments" } }] } }),
      batchUpdate: async () => ({ data: {} }),
    },
  });
  await assert.rejects(
    () =>
      appendTabRows({}, deps, masterSheetId, "RiskAssessments", RISK_ASSESSMENTS_TAB_COLUMNS, [
        { RiskAssessmentId: "ra-fail", CompanyFolderId: companyFolderId, Title: "Fail" },
      ]),
    /wrote zero rows/,
  );
});

test("readAppendedRowByRange verifies RiskAssessmentId in exact updated range", async () => {
  const deps = createGoogleDeps();
  const row = { RiskAssessmentId: "ra-exact", CompanyFolderId: companyFolderId, Title: "Exact row" };
  const appendResult = await appendTabRows({}, deps, masterSheetId, "RiskAssessments", RISK_ASSESSMENTS_TAB_COLUMNS.slice(0, 3), [row]);
  const exact = await readAppendedRowByRange({}, deps, masterSheetId, "RiskAssessments", appendResult, "RiskAssessmentId", "ra-exact");
  assert.equal(exact.RiskAssessmentId, "ra-exact");
  assert.equal(exact.CompanyFolderId, companyFolderId);
});

test("analyzeTabHeaderAlignment reports missing and duplicate headers", () => {
  const alignment = analyzeTabHeaderAlignment(
    ["RiskAssessmentId", "CompanyFolderId", "Title"],
    ["Title", "RiskAssessmentId", "RiskAssessmentId"],
  );
  assert.deepEqual(alignment.missing, ["CompanyFolderId"]);
  assert.deepEqual(alignment.duplicates, ["RiskAssessmentId"]);
});

test("create uses same workbook for write and read with exact-row confirmation", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9393, companyFolderId });
  const deps = createGoogleDeps();
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
  assert.equal(deps.getAppendCalls()[0].spreadsheetId, masterSheetId);
  const storedRow = deps.getRows().RiskAssessments[1];
  assert.equal(storedRow[0], verification.id);
});

test("repeated create with same RiskAssessmentId is idempotent and does not append duplicates", async () => {
  const verification = buildProductionVerificationRiskAssessment({ runId: 9494, companyFolderId });
  const deps = createGoogleDeps();
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
  assert.equal(deps.getAppendCalls().length, 1);
});

test("legacy append argument order still writes rows", async () => {
  const deps = createGoogleDeps();
  const row = { RiskAssessmentId: "ra-legacy", CompanyFolderId: companyFolderId, Title: "Legacy args" };
  const result = await appendTabRows({}, deps, masterSheetId, "RiskAssessments", [row], {
    expectedHeaders: RISK_ASSESSMENTS_TAB_COLUMNS.slice(0, 3),
  });
  assert.equal(result.written, 1);
  assert.equal(result.legacyCall, true);
});
