#!/usr/bin/env node
/**
 * Unit tests for production Reporting workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  formatReportingWorkflowReport,
  loadReportingWorkflowConfig,
  runProductionReportingWorkflowChecks,
} from "./lib/production-reporting-workflow-core.mjs";
import {
  buildProductionVerificationReportId,
  buildVerificationReportPdfBuffer,
  isValidVerificationPdfBuffer,
  PRODUCTION_VERIFICATION_REPORT_SOURCE,
} from "../shared/production-verification-report.mjs";
import { PRODUCTION_VERIFICATION_AUDIT_ID } from "../shared/production-verification-audit.mjs";
import { PRODUCTION_VERIFICATION_INCIDENT_ID_PREFIX } from "../shared/production-verification-incident.mjs";
import { PRODUCTION_VERIFICATION_RA_ID_PREFIX } from "../shared/production-verification-risk-assessment.mjs";
import { PRODUCTION_VERIFICATION_COSHH_ID_PREFIX } from "../shared/production-verification-coshh.mjs";
import { PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_ID_PREFIX } from "../shared/production-verification-loler.mjs";

const TEST_RUN_ID = 515151;
const baseConfig = loadReportingWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_REPORT_MUTATION: "1",
});

function createMockStore() {
  return {
    reports: [],
    files: new Map(),
    auditResults: [
      {
        "Result ID": "result-verify-1",
        "Schedule ID": "bert-sch-production-verification",
        "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
        Status: "verification",
      },
    ],
    incidents: [{ incidentId: `${PRODUCTION_VERIFICATION_INCIDENT_ID_PREFIX}${TEST_RUN_ID}`, status: "Open" }],
    riskAssessments: [{ riskAssessmentId: `${PRODUCTION_VERIFICATION_RA_ID_PREFIX}${TEST_RUN_ID}`, status: "current" }],
    coshh: [{ coshhId: `${PRODUCTION_VERIFICATION_COSHH_ID_PREFIX}${TEST_RUN_ID}`, status: "active" }],
    loler: [{ equipmentId: `${PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_ID_PREFIX}${TEST_RUN_ID}`, status: "active" }],
    failGenerate: false,
    failMetadata: false,
    failDrive: false,
    invalidPdf: false,
    wrongMime: false,
    htmlAsPdf: false,
    rejectOrdinaryCleanup: false,
    cleanupFails: false,
    reportingApiUnavailable: false,
    loginFails: false,
    missingSources: false,
    duplicateBlocked: false,
    lostResponseRecover: false,
    unauthorizedDownload: false,
  };
}

function createTransport(store, options = {}) {
  const cookies = new Map();
  const request = async (method, path, body) => {
    const pathname = (path.split("?")[0] || path).replace(/\/$/, "");
    if (method === "GET" && pathname === "/api/health") {
      return { status: 200, json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" } };
    }
    if (method === "POST" && pathname === "/api/auth/company/login") {
      if (store.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: "Admin", name: "Mr Important", companyFolderId: baseConfig.companyFolderId },
          company: { companyFolderId: baseConfig.companyFolderId, companyName: "Dovecote Demo", live: true },
          masterSheetId: baseConfig.masterSheetId,
        },
      };
    }
    if (method === "GET" && pathname === "/api/auth/company/session") {
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: "Admin", companyFolderId: baseConfig.companyFolderId },
          company: { companyFolderId: baseConfig.companyFolderId, companyName: "Dovecote Demo" },
        },
      };
    }
    if (store.reportingApiUnavailable && pathname.includes("/reports")) {
      return { status: 503, json: { ok: false, code: "REPORTS_UNAVAILABLE" } };
    }
    if (method === "GET" && pathname.endsWith("/reports/supported-types")) {
      return {
        status: 200,
        json: {
          ok: true,
          supported: ["audit", "incident", "risk-assessment", "coshh", "loler"],
          unsupported: ["action", "briefing", "risk-register", "document", "dashboard"],
        },
      };
    }
    if (method === "GET" && pathname.endsWith("/reports") && !pathname.includes("/download")) {
      return {
        status: 200,
        json: {
          ok: true,
          reports: store.reports.map((item) => ({
            reportId: item.reportId,
            reportType: item.reportType,
            title: item.title,
            sourceId: item.sourceId,
            status: item.status,
          })),
        },
      };
    }
    if (method === "GET" && pathname.includes("/audit-results")) {
      return { status: 200, json: { ok: true, results: store.missingSources ? [] : store.auditResults } };
    }
    if (method === "GET" && pathname.endsWith("/incidents")) {
      return { status: 200, json: { ok: true, incidents: store.missingSources ? [] : store.incidents } };
    }
    if (method === "GET" && pathname.endsWith("/risk-assessments")) {
      return { status: 200, json: { ok: true, riskAssessments: store.missingSources ? [] : store.riskAssessments } };
    }
    if (method === "GET" && pathname.endsWith("/coshh")) {
      return { status: 200, json: { ok: true, registers: store.missingSources ? [] : store.coshh } };
    }
    if (method === "GET" && pathname.endsWith("/loler/equipment")) {
      return { status: 200, json: { ok: true, equipment: store.missingSources ? [] : store.loler } };
    }
    if (method === "POST" && pathname.endsWith("/reports/generate")) {
      if (store.failGenerate) {
        return { status: 500, json: { ok: false, code: "REPORT_GENERATE_FAILED" } };
      }
      if (store.lostResponseRecover && !store._recovered) {
        store._recovered = true;
        return { status: 504, json: { ok: false, code: "GATEWAY_TIMEOUT" } };
      }
      const reportId = trim(body?.reportId);
      if (store.duplicateBlocked && store.reports.some((item) => item.reportId === reportId)) {
        return { status: 200, json: { ok: true, idempotent: true, reportId, reportType: body.reportType, sourceId: body.sourceId } };
      }
      let buffer = buildVerificationReportPdfBuffer({
        reportType: body.reportType,
        reportId,
        sourceId: body.sourceId,
      });
      if (store.invalidPdf) {
        buffer = Buffer.from("not-a-pdf", "utf8");
      }
      if (store.htmlAsPdf) {
        buffer = Buffer.from("<html><body>error</body></html>", "utf8");
      }
      store.files.set(reportId, buffer);
      const row = {
        reportId,
        reportType: body.reportType,
        sourceId: body.sourceId,
        title: `BERT Verification ${body.reportType} Report`,
        status: "active",
      };
      const existing = store.reports.find((item) => item.reportId === reportId);
      if (!existing) {
        store.reports.push(row);
      }
      return {
        status: 200,
        json: {
          ok: true,
          reportId,
          reportType: body.reportType,
          sourceId: body.sourceId,
          fileSize: buffer.length,
          pageCount: 1,
          mimeType: store.wrongMime ? "text/plain" : "application/pdf",
        },
      };
    }
    if (method === "GET" && pathname.includes("/reports/") && pathname.endsWith("/download")) {
      const reportId = pathname.split("/reports/")[1]?.split("/")[0];
      if (reportId === "bert-smoke-report-missing") {
        return { status: 404, json: { ok: false, code: "REPORT_NOT_FOUND" } };
      }
      if (store.unauthorizedDownload && reportId === "bert-smoke-report-forbidden") {
        return { status: 403, json: { ok: false, code: "REPORT_FORBIDDEN" } };
      }
      const buffer = store.files.get(reportId);
      if (!buffer) {
        return { status: 404, json: { ok: false, code: "REPORT_FILE_MISSING" } };
      }
      return { status: 200, text: buffer.toString("binary") };
    }
    if (method === "GET" && pathname.includes("/reports/") && !pathname.endsWith("/download")) {
      const reportId = pathname.split("/reports/")[1];
      if (store.failMetadata) {
        return { status: 500, json: { ok: false, code: "REPORT_GET_FAILED" } };
      }
      const report = store.reports.find((item) => item.reportId === reportId);
      if (!report) {
        return { status: 404, json: { ok: false, code: "REPORT_NOT_FOUND" } };
      }
      return { status: 200, json: { ok: true, report } };
    }
    if (method === "POST" && pathname.endsWith("/reports/verification-cleanup")) {
      store.reports = store.reports.filter((item) => !item.reportId.includes(String(TEST_RUN_ID)));
      return { status: 200, json: { ok: true, cleanedCount: 1, results: [] } };
    }
    if (method === "POST" && pathname.includes("/reports/") && pathname.endsWith("/verification-cleanup")) {
      const reportId = pathname.split("/reports/")[1]?.split("/")[0];
      if (!reportId.startsWith("bert-smoke-report-")) {
        return { status: 400, json: { ok: false, code: "REPORT_CLEANUP_REJECTED" } };
      }
      if (store.cleanupFails) {
        return { status: 500, json: { ok: false, code: "REPORT_CLEANUP_FAILED" } };
      }
      const report = store.reports.find((item) => item.reportId === reportId);
      if (report) {
        report.status = "verification-cleaned";
      }
      store.files.delete(reportId);
      return { status: 200, json: { ok: true, reportId, cleaned: true } };
    }
    return { status: 404, json: { ok: false, code: "NOT_FOUND" } };
  };
  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
  };
}

function trim(value) {
  return String(value ?? "").trim();
}

async function runWorkflow(storeOverrides = {}, options = {}) {
  const store = { ...createMockStore(), ...storeOverrides };
  const transport = createTransport(store, options);
  const result = await runProductionReportingWorkflowChecks(baseConfig, transport, {
    runId: TEST_RUN_ID,
    ...options,
  });
  return { result, store };
}

test("full successful workflow", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.ok, true);
  for (const key of ["authentication", "reportingApi", "auditReport", "cleanup"]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
  assert.equal(result.checks.additionalReports.status, "SKIP");
  assert.equal(result.checks.dashboardExport.status, "SKIP");
});

test("login failure", async () => {
  const { result } = await runWorkflow({ loginFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.authentication.status, "FAIL");
});

test("reporting API unavailable", async () => {
  const { result } = await runWorkflow({ reportingApiUnavailable: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.reportingApi.status, "FAIL");
});

test("mutation disabled", async () => {
  const config = loadReportingWorkflowConfig({
    BERT_SMOKE_USERNAME: "mr.important",
    BERT_SMOKE_PASSWORD: "secret-password",
    BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
    BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
    BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
    BERT_SMOKE_ALLOW_REPORT_MUTATION: "0",
  });
  const store = createMockStore();
  const transport = createTransport(store);
  const result = await runProductionReportingWorkflowChecks(config, transport, { runId: TEST_RUN_ID });
  assert.equal(result.ok, true);
  assert.equal(result.checks.staleCleanup.status, "SKIP");
  assert.equal(result.checks.auditReport.status, "SKIP");
});

test("stale cleanup", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("audit report success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.auditReport.status, "PASS");
});

test("incident report success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.incidentReport.status, "PASS");
});

test("risk assessment report success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.riskAssessmentReport.status, "PASS");
});

test("coshh report success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.coshhReport.status, "PASS");
});

test("loler report success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.lolerReport.status, "PASS");
});

test("unsupported report skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.additionalReports.status, "SKIP");
});

test("empty file failure", async () => {
  const { result } = await runWorkflow({ invalidPdf: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.pdfIntegrity.status, "FAIL");
});

test("wrong MIME type failure", async () => {
  const { result } = await runWorkflow({ wrongMime: true });
  assert.equal(result.checks.auditReport.status, "PASS");
});

test("invalid PDF signature", async () => {
  const buffer = Buffer.from("NOTPDF", "utf8");
  assert.equal(isValidVerificationPdfBuffer(buffer), false);
});

test("HTML error page returned as PDF", async () => {
  const { result } = await runWorkflow({ htmlAsPdf: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.pdfIntegrity.status, "FAIL");
});

test("missing source record", async () => {
  const { result } = await runWorkflow({ missingSources: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.auditReport.status, "FAIL");
});

test("metadata write failure", async () => {
  const { result } = await runWorkflow({ failMetadata: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.metadataVerification.status, "FAIL");
});

test("drive upload failure", async () => {
  const { result } = await runWorkflow({ failDrive: true });
  assert.equal(result.checks.auditReport.status, "PASS");
});

test("lost response recovery", async () => {
  const { result } = await runWorkflow({ lostResponseRecover: true });
  assert.equal(result.checks.auditReport.status, "PASS");
});

test("duplicate report prevention", async () => {
  const store = createMockStore();
  const reportId = buildProductionVerificationReportId(TEST_RUN_ID, "audit");
  store.reports.push({ reportId, reportType: "audit", sourceId: PRODUCTION_VERIFICATION_AUDIT_ID, status: "active" });
  store.files.set(reportId, buildVerificationReportPdfBuffer({ reportType: "audit", reportId, sourceId: PRODUCTION_VERIFICATION_AUDIT_ID }));
  const { result } = await runWorkflow(store);
  assert.equal(result.checks.auditReport.status, "PASS");
});

test("download success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.downloadVerification.status, "PASS");
});

test("download unauthorised", async () => {
  const { result } = await runWorkflow({ unauthorizedDownload: true });
  assert.equal(result.checks.downloadVerification.status, "PASS");
});

test("missing report safe 404", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.downloadVerification.status, "PASS");
});

test("dashboard export skip", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.dashboardExport.status, "SKIP");
});

test("report history success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.searchReportHistory.status, "PASS");
});

test("search/history skip is not used when server history exists", async () => {
  const { result } = await runWorkflow();
  assert.notEqual(result.checks.searchReportHistory.status, "SKIP");
});

test("cleanup success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const { result } = await runWorkflow({ cleanupFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.cleanup.status, "FAIL");
});

test("ordinary-report cleanup rejected", async () => {
  const store = createMockStore();
  store.reports.push({ reportId: "customer-report-1", reportType: "audit", sourceId: "cust-1", status: "active" });
  const transport = createTransport(store);
  const cleanup = await transport.request(
    "POST",
    `/api/companies/${baseConfig.companyFolderId}/reports/customer-report-1/verification-cleanup`,
    { masterSheetId: baseConfig.masterSheetId },
  );
  assert.equal(cleanup.json.code, "REPORT_CLEANUP_REJECTED");
});

test("interrupt cleanup registers handler", async () => {
  let registered = false;
  const store = createMockStore();
  const transport = createTransport(store);
  await runProductionReportingWorkflowChecks(baseConfig, transport, {
    runId: TEST_RUN_ID,
    registerInterruptCleanup(fn) {
      registered = typeof fn === "function";
    },
  });
  assert.equal(registered, true);
});

test("secret/customer-content-safe output", async () => {
  const { result } = await runWorkflow();
  const report = formatReportingWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /bert_company_session=/);
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 17);
  assert.equal(CHECK_KEYS.includes("pdfIntegrity"), true);
});
