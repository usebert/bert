#!/usr/bin/env node
/**
 * Download recovery, cache bypass, route ordering, and multi-instance simulation tests.
 */
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWorkbookReportRow,
  canRebuildVerificationReportFromMetadata,
  isValidVerificationPdfBuffer,
  PRODUCTION_VERIFICATION_REPORT_SOURCE,
  resolveVerificationReportRebuildSnapshot,
} from "../shared/production-verification-report.mjs";
import {
  clearReportsRequestCacheForTests,
  cachedReadReportsTabRecords,
  invalidateReportsWorkbookCache,
} from "../server/reports-request-cache.mjs";
import { installReportingRoutes } from "../server/reporting-routes.mjs";
import {
  downloadVerificationReport,
  generateVerificationReport,
  logReportingDownloadRecovery,
  rebuildVerificationReportPdfFromMetadata,
} from "../server/reports-service.mjs";

const COMPANY_FOLDER_ID = "folder-abc";
const MASTER_SHEET_ID = "sheet-xyz";
const REPORT_ID = "bert-smoke-report-123-audit";
const SOURCE_ID = "result-report-123";

function buildReportRow(overrides = {}) {
  return buildWorkbookReportRow({
    reportId: REPORT_ID,
    companyFolderId: COMPANY_FOLDER_ID,
    reportType: "audit",
    createdBy: "bert.demo+mr.important@usebert.co.uk",
    sourceId: SOURCE_ID,
    generatedAt: "2026-08-06T12:00:00.000Z",
    status: "active",
    ...overrides,
  });
}

function createStore(initialRecords = []) {
  return {
    records: [...initialRecords],
    readCalls: 0,
    appendCalls: 0,
  };
}

function createDeps(sessionDir, store) {
  return {
    sessionDir,
    readTabRecords: async () => {
      store.readCalls += 1;
      return { ok: true, records: [...store.records] };
    },
    ensureTabColumns: async () => ({ ok: true }),
    appendTabRows: async (_auth, _deps, _masterSheetId, _tab, rows) => {
      store.appendCalls += 1;
      store.records.push(...rows);
      return { ok: true };
    },
    patchTabRowByHeader: async () => ({ ok: true }),
  };
}

const resolved = {
  companyFolderId: COMPANY_FOLDER_ID,
  masterSheetId: MASTER_SHEET_ID,
  companyName: "Dovecote Demo",
};

const actor = { email: "bert.demo+mr.important@usebert.co.uk", role: "Admin" };

test("workbook round trip preserves ReportId and verification marker fields", () => {
  const row = buildReportRow();
  const snapshot = resolveVerificationReportRebuildSnapshot(row, { reportId: REPORT_ID });
  assert.equal(snapshot.reportId, REPORT_ID);
  assert.equal(snapshot.reportType, "audit");
  assert.equal(snapshot.sourceId, SOURCE_ID);
  assert.equal(canRebuildVerificationReportFromMetadata(row, { reportId: REPORT_ID }), true);
  const rebuilt = rebuildVerificationReportPdfFromMetadata(row, resolved, REPORT_ID);
  assert.equal(isValidVerificationPdfBuffer(rebuilt), true);
});

test("VerificationSource and marker survive workbook round trip", () => {
  const row = buildReportRow();
  assert.equal(row["Verification Source"], PRODUCTION_VERIFICATION_REPORT_SOURCE);
  assert.equal(row["Verification Marker"], "verification");
  assert.equal(canRebuildVerificationReportFromMetadata(row, { reportId: REPORT_ID }), true);
});

test("local session file found returns cached bytes unchanged", async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-local-"));
  const store = createStore([buildReportRow()]);
  const deps = createDeps(sessionDir, store);
  const generated = await generateVerificationReport({}, deps, resolved, actor, {
    reportType: "audit",
    reportId: REPORT_ID,
    sourceId: SOURCE_ID,
    runId: "123",
  });
  assert.equal(generated.ok, true);
  const downloaded = await downloadVerificationReport({}, deps, resolved, actor, REPORT_ID);
  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.rebuiltFromMetadata, false);
  assert.equal(isValidVerificationPdfBuffer(downloaded.buffer), true);
});

test("local session file missing rebuilds from metadata row", async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-rebuild-"));
  const store = createStore([buildReportRow()]);
  const deps = createDeps(sessionDir, store);
  const downloaded = await downloadVerificationReport({}, deps, resolved, actor, REPORT_ID);
  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.rebuiltFromMetadata, true);
  assert.equal(isValidVerificationPdfBuffer(downloaded.buffer), true);
});

test("metadata read bypasses stale Reports cache during download recovery", async () => {
  clearReportsRequestCacheForTests();
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-cache-"));
  const store = createStore([]);
  const deps = createDeps(sessionDir, store);
  const readFn = async () => ({ ok: true, records: [...store.records] });
  await cachedReadReportsTabRecords({}, deps, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, {});
  store.records.push(buildReportRow());
  const downloaded = await downloadVerificationReport({}, deps, resolved, actor, REPORT_ID);
  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.rebuiltFromMetadata, true);
  assert.ok(store.readCalls >= 1);
});

test("generation invalidates legacy and company-scoped Reports cache keys", async () => {
  clearReportsRequestCacheForTests();
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-invalidate-"));
  const store = createStore([]);
  const deps = createDeps(sessionDir, store);
  const readFn = async () => ({ ok: true, records: [...store.records] });
  await cachedReadReportsTabRecords({}, deps, "", MASTER_SHEET_ID, "Reports", readFn, {});
  await cachedReadReportsTabRecords({}, deps, COMPANY_FOLDER_ID, MASTER_SHEET_ID, "Reports", readFn, {});
  const generated = await generateVerificationReport({}, deps, resolved, actor, {
    reportType: "audit",
    reportId: REPORT_ID,
    sourceId: SOURCE_ID,
    runId: "123",
  });
  assert.equal(generated.ok, true);
  store.records.length = 0;
  store.records.push(buildReportRow());
  let legacyReads = 0;
  const legacyReadFn = async () => {
    legacyReads += 1;
    return { ok: true, records: [...store.records] };
  };
  const legacyCached = await cachedReadReportsTabRecords({}, deps, "", MASTER_SHEET_ID, "Reports", legacyReadFn, {});
  assert.equal(legacyCached.cacheHit, false);
  assert.equal(legacyReads, 1);
});

test("fallback does not require source record still existing", async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-no-source-"));
  const store = createStore([buildReportRow()]);
  const deps = createDeps(sessionDir, store);
  const downloaded = await downloadVerificationReport({}, deps, resolved, actor, REPORT_ID);
  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.rebuiltFromMetadata, true);
});

test("metadata missing returns safe 404", async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-missing-"));
  const store = createStore([]);
  const deps = createDeps(sessionDir, store);
  const downloaded = await downloadVerificationReport({}, deps, resolved, actor, REPORT_ID);
  assert.equal(downloaded.ok, false);
  assert.equal(downloaded.code, "REPORT_NOT_FOUND");
  assert.equal(downloaded.httpStatus, 404);
});

test("ordinary non-verification report cannot use verification rebuild", async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-operational-"));
  const store = createStore([
    {
      "Report ID": "customer-monthly-audit",
      "Company ID": COMPANY_FOLDER_ID,
      "Report Type": "audit",
      "Source ID": "customer-source-1",
      Status: "active",
      Title: "Monthly Audit Pack",
    },
  ]);
  const deps = createDeps(sessionDir, store);
  const downloaded = await downloadVerificationReport({}, deps, resolved, actor, "customer-monthly-audit");
  assert.equal(downloaded.ok, false);
  assert.equal(downloaded.code, "REPORT_FILE_MISSING");
});

test("multi-instance simulation: generate on A, download on B without shared session file", async () => {
  const sessionDirA = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-instance-a-"));
  const sessionDirB = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-instance-b-"));
  const store = createStore([]);
  const depsA = createDeps(sessionDirA, store);
  const depsB = createDeps(sessionDirB, store);
  const generated = await generateVerificationReport({}, depsA, resolved, actor, {
    reportType: "audit",
    reportId: REPORT_ID,
    sourceId: SOURCE_ID,
    runId: "123",
  });
  assert.equal(generated.ok, true);
  const downloaded = await downloadVerificationReport({}, depsB, resolved, actor, REPORT_ID);
  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.rebuiltFromMetadata, true);
  assert.equal(isValidVerificationPdfBuffer(downloaded.buffer), true);
});

test("download route is registered before detail route", () => {
  const app = express();
  installReportingRoutes(app, {
    getAuthedClient: () => ({}),
    parseBertActorFromRequest: () => actor,
    registryDeps: {},
    readCompanySheetById: async () => ({
      ok: true,
      companyFolderId: COMPANY_FOLDER_ID,
      masterSheetId: MASTER_SHEET_ID,
      companyName: "Dovecote Demo",
    }),
    readTabRecords: async () => ({ ok: true, records: [buildReportRow()] }),
    appendTabRows: async () => ({ ok: true }),
    ensureTabExists: async () => ({ ok: true }),
    ensureColumns: async () => ({ ok: true }),
    getTabValues: async () => ({ ok: true, values: [] }),
    getWorkbook: async () => ({}),
    withSheetsQuotaRetry: async (fn) => fn(),
    google: {},
    rowsToRecords: (rows) => rows,
    rejectCompanyApiIfFolderInvalid: async () => null,
    sessionDir: "/tmp/bert-report-route",
    getCompanyUsersDeps: () => ({}),
  });
  const paths = app._router.stack
    .map((layer) => layer.route?.path)
    .filter(Boolean);
  const downloadIndex = paths.indexOf("/api/companies/:companyFolderId/reports/:reportId/download");
  const detailIndex = paths.indexOf("/api/companies/:companyFolderId/reports/:reportId");
  assert.ok(downloadIndex >= 0);
  assert.ok(detailIndex >= 0);
  assert.ok(downloadIndex < detailIndex);
});

test("logReportingDownloadRecovery emits structured payload", () => {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args.map((arg) => String(arg)).join(" "));
  try {
    logReportingDownloadRecovery("rebuild_complete", {
      reportId: REPORT_ID,
      workbookId: MASTER_SHEET_ID,
      rebuildAttempted: true,
      rebuildSucceeded: true,
      rebuiltByteLength: 900,
      responseStatus: 200,
      durationMs: 12,
    });
  } finally {
    console.info = original;
  }
  assert.match(lines.join(" "), /\[reporting:download-recovery\]/);
  assert.match(lines.join(" "), /"stage":"rebuild_complete"/);
  assert.match(lines.join(" "), /"rebuildSucceeded":true/);
});
