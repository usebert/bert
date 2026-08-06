#!/usr/bin/env node
/**
 * Unit tests for verification report PDF builder, integrity analysis, and download handling.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeVerificationPdfBuffer,
  buildVerificationReportPdfBuffer,
  isValidVerificationPdfBuffer,
  SUPPORTED_VERIFICATION_REPORT_TYPES,
} from "../shared/production-verification-report.mjs";
import {
  downloadVerificationReport,
  rebuildVerificationReportPdfFromMetadata,
} from "../server/reports-service.mjs";
import { extractDownloadPdfBuffer } from "./lib/production-reporting-workflow-core.mjs";

const REPORT_ID = "bert-smoke-report-999-audit";
const COMPANY_FOLDER_ID = "folder-abc";

function sampleInput(overrides = {}) {
  return {
    reportType: "audit",
    reportId: REPORT_ID,
    sourceId: "result-report-999",
    companyName: "Dovecote Demo",
    generatedAt: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

test("valid minimal PDF passes integrity checks", () => {
  const buffer = buildVerificationReportPdfBuffer(sampleInput());
  const analysis = analyzeVerificationPdfBuffer(buffer);
  assert.equal(analysis.valid, true);
  assert.equal(analysis.signatureValid, true);
  assert.equal(analysis.eofMarkerValid, true);
  assert.ok(analysis.byteLength >= 128);
  assert.equal(analysis.pageCount, 1);
});

test("byte-accurate xref offsets and stream length", () => {
  const buffer = buildVerificationReportPdfBuffer(sampleInput());
  const text = buffer.toString("utf8");
  const lengthMatch = text.match(/\/Length (\d+)>>stream\n/);
  assert.ok(lengthMatch, "stream length present");
  const streamStart = text.indexOf(">>stream\n") + ">>stream\n".length;
  const streamEnd = text.indexOf("endstream", streamStart);
  const streamBody = text.slice(streamStart, streamEnd);
  assert.equal(Buffer.byteLength(streamBody, "utf8"), Number(lengthMatch[1]));
  assert.match(text, /xref\n0 6\n/);
  assert.match(text, /startxref\n\d+\n%%EOF/);
});

test("multibyte marker text does not corrupt stream length", () => {
  const buffer = buildVerificationReportPdfBuffer(
    sampleInput({ companyName: "Dovecote Demo — 验证 ✓" }),
  );
  const analysis = analyzeVerificationPdfBuffer(buffer);
  assert.equal(analysis.valid, true);
  const text = buffer.toString("utf8");
  const lengthMatch = text.match(/\/Length (\d+)>>stream\n/);
  const streamStart = text.indexOf(">>stream\n") + ">>stream\n".length;
  const streamEnd = text.indexOf("endstream", streamStart);
  const streamBody = text.slice(streamStart, streamEnd);
  assert.equal(Buffer.byteLength(streamBody, "utf8"), Number(lengthMatch[1]));
});

test("each supported report type generates a valid PDF", () => {
  for (const reportType of SUPPORTED_VERIFICATION_REPORT_TYPES) {
    const reportId = `bert-smoke-report-999-${reportType}`;
    const buffer = buildVerificationReportPdfBuffer(
      sampleInput({ reportType, reportId, sourceId: `source-${reportType}` }),
    );
    assert.equal(isValidVerificationPdfBuffer(buffer), true, reportType);
    const text = buffer.toString("utf8");
    assert.match(text, new RegExp(reportType.replace("-", "\\-")));
    assert.match(text, /production-reporting-workflow/);
  }
});

test("empty file rejected", () => {
  const analysis = analyzeVerificationPdfBuffer(Buffer.alloc(0));
  assert.equal(analysis.valid, false);
  assert.equal(analysis.failureReason, "empty_or_too_small");
});

test("JSON error body rejected", () => {
  const buffer = Buffer.from('{"ok":false,"code":"REPORT_FILE_MISSING"}', "utf8");
  const analysis = analyzeVerificationPdfBuffer(buffer);
  assert.equal(analysis.valid, false);
  assert.equal(analysis.looksLikeJson, true);
});

test("HTML error body rejected", () => {
  const buffer = Buffer.from("<!doctype html><html><body>error</body></html>", "utf8");
  const analysis = analyzeVerificationPdfBuffer(buffer);
  assert.equal(analysis.valid, false);
  assert.equal(analysis.looksLikeHtml, true);
});

test("corrupted PDF fails clearly", () => {
  const buffer = buildVerificationReportPdfBuffer(sampleInput());
  buffer[buffer.length - 3] = 0x58;
  const analysis = analyzeVerificationPdfBuffer(buffer);
  assert.equal(analysis.valid, false);
});

test("extractDownloadPdfBuffer prefers binary buffer over text", () => {
  const original = buildVerificationReportPdfBuffer(sampleInput());
  const download = {
    buffer: original,
    text: "corrupted",
  };
  const extracted = extractDownloadPdfBuffer(download);
  assert.equal(extracted.equals(original), true);
});

test("download rebuilds PDF from metadata when session file is missing", async () => {
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "bert-report-download-"));
  const reportRow = {
    "Report ID": REPORT_ID,
    "Company ID": COMPANY_FOLDER_ID,
    "Report Type": "audit",
    "Source ID": "result-report-999",
    "Generated At": "2026-08-06T12:00:00.000Z",
    Status: "active",
    "Verification Marker": "verification",
    "Verification Source": "production-reporting-workflow",
  };
  const deps = {
    sessionDir,
    readTabRecords: async () => ({ ok: true, records: [reportRow] }),
    ensureTabColumns: async () => ({ ok: true }),
  };
  const result = await downloadVerificationReport(
    {},
    deps,
    { companyFolderId: COMPANY_FOLDER_ID, masterSheetId: "sheet-xyz", companyName: "Dovecote Demo" },
    { email: "bert.demo+mr.important@usebert.co.uk", role: "Admin" },
    REPORT_ID,
  );
  assert.equal(result.ok, true);
  assert.equal(result.rebuiltFromMetadata, true);
  assert.equal(isValidVerificationPdfBuffer(result.buffer), true);
  const cached = await fs.readFile(path.join(sessionDir, "verification-reports", COMPANY_FOLDER_ID, `${REPORT_ID}.pdf`));
  assert.equal(isValidVerificationPdfBuffer(cached), true);
});

test("rebuildVerificationReportPdfFromMetadata matches generated buffer inputs", () => {
  const input = sampleInput();
  const direct = buildVerificationReportPdfBuffer(input);
  const rebuilt = rebuildVerificationReportPdfFromMetadata(
    {
      reportType: input.reportType,
      reportId: input.reportId,
      sourceId: input.sourceId,
      generatedAt: input.generatedAt,
      status: "verification",
    },
    { companyName: input.companyName },
  );
  assert.equal(direct.equals(rebuilt), true);
});
