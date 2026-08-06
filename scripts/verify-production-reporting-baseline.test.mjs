#!/usr/bin/env node
/**
 * Unit tests for reporting verification baseline — counts-only, cache, and bounded reads.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerificationReportBaselineCounts,
  PRODUCTION_VERIFICATION_REPORT_ID_PREFIX,
} from "../shared/production-verification-report.mjs";
import {
  clearReportsRequestCacheForTests,
  cachedReadReportsTabRecords,
  dedupedEnsureReportsTabColumns,
  invalidateReportsWorkbookCache,
} from "../server/reports-request-cache.mjs";
import {
  getVerificationReportBaseline,
  logReportingBaselineTiming,
} from "../server/reports-service.mjs";

const COMPANY_FOLDER_ID = "folder-abc";
const MASTER_SHEET_ID = "sheet-xyz";

function sampleRecords() {
  return [
    {
      "Report ID": `${PRODUCTION_VERIFICATION_REPORT_ID_PREFIX}111-audit`,
      "Company ID": COMPANY_FOLDER_ID,
      Status: "active",
      "Verification Marker": "verification",
      "Verification Source": "production-reporting-workflow",
    },
    {
      "Report ID": "customer-monthly-audit",
      "Company ID": COMPANY_FOLDER_ID,
      Title: "Monthly Audit Pack",
      Status: "active",
    },
    {
      "Report ID": `${PRODUCTION_VERIFICATION_REPORT_ID_PREFIX}222-incident`,
      "Company ID": COMPANY_FOLDER_ID,
      Status: "verification-cleaned",
      "Verification Marker": "verification",
    },
  ];
}

function createDeps(store) {
  return {
    readTabRecords: async (_auth, _deps, _masterSheetId, tabName, options = {}) => {
      store.readCalls.push({ tabName, options });
      return { ok: true, records: [...store.records] };
    },
    ensureTabColumns: async () => {
      store.ensureCalls += 1;
      return { ok: true };
    },
    google: {
      drive: () => ({
        files: {
          list: async () => {
            store.driveListCalls += 1;
            return { data: { files: [{ name: "BERT-Verification-audit-1.pdf" }] } };
          },
        },
      }),
    },
  };
}

test("buildVerificationReportBaselineCounts returns counts only", () => {
  const counts = buildVerificationReportBaselineCounts(sampleRecords(), COMPANY_FOLDER_ID);
  assert.equal(counts.totalRows, 3);
  assert.equal(counts.verificationCount, 2);
  assert.equal(counts.activeVerificationCount, 1);
  assert.equal(counts.operationalCount, 1);
});

test("baseline service uses one summary reports tab read", async () => {
  clearReportsRequestCacheForTests();
  const store = { records: sampleRecords(), readCalls: [], ensureCalls: 0, driveListCalls: 0 };
  const deps = createDeps(store);
  const result = await getVerificationReportBaseline(
    {},
    deps,
    {
      companyFolderId: COMPANY_FOLDER_ID,
      masterSheetId: MASTER_SHEET_ID,
      exportsFolderId: "exports-folder",
    },
    { includeDriveCount: false },
  );
  assert.equal(result.ok, true);
  assert.equal(store.readCalls.length, 1);
  assert.equal(store.readCalls[0].options.summaryOnly, true);
  assert.equal(store.driveListCalls, 0);
  assert.equal(result.rowCounts.activeVerificationCount, 1);
  assert.equal(JSON.stringify(result).includes("customer-monthly-audit"), false);
  assert.equal(JSON.stringify(result).includes("Monthly Audit Pack"), false);
});

test("baseline does not download PDFs or provision sources", async () => {
  const store = { records: [], readCalls: [], ensureCalls: 0, driveListCalls: 0 };
  const deps = createDeps(store);
  const result = await getVerificationReportBaseline(
    {},
    deps,
    { companyFolderId: COMPANY_FOLDER_ID, masterSheetId: MASTER_SHEET_ID },
    { includeDriveCount: false },
  );
  assert.equal(result.ok, true);
  assert.equal(store.driveListCalls, 0);
  assert.equal("buffer" in result, false);
});

test("optional drive count is reported separately", async () => {
  clearReportsRequestCacheForTests();
  const store = { records: sampleRecords(), readCalls: [], ensureCalls: 0, driveListCalls: 0 };
  const deps = createDeps(store);
  const result = await getVerificationReportBaseline(
    {},
    deps,
    {
      companyFolderId: COMPANY_FOLDER_ID,
      masterSheetId: MASTER_SHEET_ID,
      exportsFolderId: "exports-folder",
    },
    { includeDriveCount: true },
  );
  assert.equal(result.ok, true);
  assert.equal(result.driveExportCounts.verificationFileCount, 1);
  assert.equal(store.driveListCalls, 1);
});

test("cache and in-flight dedupe for ensure and read", async () => {
  clearReportsRequestCacheForTests();
  let ensureCalls = 0;
  let readCalls = 0;
  const ensureFn = async () => {
    ensureCalls += 1;
    return { ok: true };
  };
  const readFn = async () => {
    readCalls += 1;
    return { ok: true, records: [] };
  };
  await Promise.all([
    dedupedEnsureReportsTabColumns({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", [], ensureFn),
    dedupedEnsureReportsTabColumns({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", [], ensureFn),
  ]);
  assert.equal(ensureCalls, 1);
  await Promise.all([
    cachedReadReportsTabRecords({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, { summaryOnly: true }),
    cachedReadReportsTabRecords({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, { summaryOnly: true }),
  ]);
  assert.equal(readCalls, 1);
  await cachedReadReportsTabRecords({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, { summaryOnly: true });
  assert.equal(readCalls, 1);
});

test("cache invalidation after metadata mutation", async () => {
  clearReportsRequestCacheForTests();
  let readCalls = 0;
  const readFn = async () => {
    readCalls += 1;
    return { ok: true, records: [] };
  };
  await cachedReadReportsTabRecords({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, { summaryOnly: true });
  invalidateReportsWorkbookCache(COMPANY_FOLDER_ID, MASTER_SHEET_ID);
  await cachedReadReportsTabRecords({}, {}, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, { summaryOnly: true });
  assert.equal(readCalls, 2);
});

test("baseline completes under configured test threshold", async () => {
  const store = { records: sampleRecords(), readCalls: [], ensureCalls: 0, driveListCalls: 0 };
  const deps = createDeps(store);
  const started = Date.now();
  const result = await getVerificationReportBaseline(
    {},
    deps,
    { companyFolderId: COMPANY_FOLDER_ID, masterSheetId: MASTER_SHEET_ID },
    { includeDriveCount: false },
  );
  const durationMs = Date.now() - started;
  assert.equal(result.ok, true);
  assert.ok(durationMs < 500, `expected baseline under 500ms, got ${durationMs}ms`);
});

test("logReportingBaselineTiming emits structured payload", () => {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args.map((arg) => String(arg)).join(" "));
  try {
    logReportingBaselineTiming("baseline", {
      workbookId: MASTER_SHEET_ID,
      rowCounts: { totalRows: 1 },
      durationMs: 12,
      totalMs: 20,
    });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines.join(" "), /\[reporting:baseline-timing\]/);
  assert.match(lines.join(" "), /"workbookId":"sheet-xyz"/);
});
