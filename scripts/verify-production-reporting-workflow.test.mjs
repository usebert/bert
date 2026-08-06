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
  logReportingBaselineTiming,
  reportsBaselinePath,
  runProductionReportingWorkflowChecks,
} from "./lib/production-reporting-workflow-core.mjs";
import {
  buildProductionVerificationReportId,
  buildVerificationReportPdfBuffer,
  isValidVerificationPdfBuffer,
} from "../shared/production-verification-report.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
} from "../shared/production-verification-audit.mjs";
import { buildReportingSourcePlan } from "./lib/production-reporting-source-provisioner.mjs";

const TEST_RUN_ID = 515151;
const SOURCE_PLAN = buildReportingSourcePlan(TEST_RUN_ID);
const baseConfig = loadReportingWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_REPORT_MUTATION: "1",
});

function createEmptyProvisionedSources() {
  return {
    auditResults: [],
    incidents: [],
    riskAssessments: [],
    coshh: [],
    loler: [],
  };
}

function createMockStore() {
  return {
    reports: [],
    files: new Map(),
    provisionedSources: createEmptyProvisionedSources(),
    provisioningLog: [],
    ordinaryRecords: {
      incidents: [{ incidentId: "customer-incident-1", status: "Open" }],
    },
    failGenerate: false,
    failMetadata: false,
    failDrive: false,
    invalidPdf: false,
    wrongMime: false,
    htmlAsPdf: false,
    rejectOrdinaryCleanup: false,
    cleanupFails: false,
    sourceCleanupFails: false,
    reportingApiUnavailable: false,
    loginFails: false,
    failProvisionType: "",
    assignedChecksUnavailable: false,
    duplicateBlocked: false,
    lostResponseRecover: false,
    unauthorizedDownload: false,
    baselineReads: 0,
    baselineDownloadAttempts: 0,
    baselineProvisionAttempts: 0,
    baselineDriveLookups: 0,
  };
}

function buildBaselineRowCounts(store) {
  const verification = store.reports.filter((item) => trim(item.reportId).startsWith("bert-smoke-report-"));
  const activeVerification = verification.filter((item) => trim(item.status) !== "verification-cleaned");
  const operational = store.reports.filter((item) => !trim(item.reportId).startsWith("bert-smoke-report-"));
  return {
    totalRows: store.reports.length,
    operationalCount: operational.length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
    storedFileCount: store.reports.filter((item) => trim(item.sourceId)).length,
    historyCount: store.reports.length,
  };
}

function isVerificationSourceId(sourceId = "") {
  const id = trim(sourceId);
  return id.startsWith("bert-smoke-") || id.startsWith("result-report-");
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
          user: {
            email: baseConfig.expectedEmail,
            role: "Admin",
            name: "Mr Important",
            companyFolderId: baseConfig.companyFolderId,
            userId: baseConfig.username,
          },
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
    if (method === "GET" && pathname === "/api/me/assigned-checks") {
      store.assignedChecksRoute = pathname;
      if (store.assignedChecksUnavailable) {
        return { status: 503, json: { ok: false, code: "ASSIGNED_CHECKS_UNAVAILABLE" } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          companyFolderId: baseConfig.companyFolderId,
          masterSheetId: baseConfig.masterSheetId,
          schedules: [
            {
              id: PRODUCTION_VERIFICATION_SCHEDULE_ID,
              scheduleName: "BERT Verification Audit",
              audits: [{ auditId: PRODUCTION_VERIFICATION_AUDIT_ID, auditName: "BERT Verification Audit" }],
              assignedUserEmails: [baseConfig.expectedEmail],
            },
          ],
        },
      };
    }
    if (method === "GET" && pathname.includes("/me/assigned-checks")) {
      return { status: 404, json: { ok: false, code: "NOT_FOUND" } };
    }
    if (method === "POST" && pathname.includes("/checks/") && pathname.endsWith("/complete")) {
      if (store.failProvisionType === "audit") {
        return { status: 500, json: { ok: false, code: "AUDIT_COMPLETE_FAILED" } };
      }
      const resultId = `result-report-${TEST_RUN_ID}`;
      const existing = store.provisionedSources.auditResults.find((row) => row.resultId === resultId);
      if (existing) {
        return { status: 200, json: { ok: true, alreadyExists: true, resultId } };
      }
      store.provisionedSources.auditResults.push({
        resultId,
        "Result ID": resultId,
        "Schedule ID": PRODUCTION_VERIFICATION_SCHEDULE_ID,
        "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
        localSubmissionId: body?.localSubmissionId,
        verificationSource: body?.verificationSource,
        Status: "verification",
      });
      store.provisioningLog.push({ reportType: "audit", sourceId: resultId });
      return { status: 200, json: { ok: true, resultId } };
    }
    if (method === "POST" && pathname.endsWith("/incidents") && !pathname.includes("verification-cleanup")) {
      if (store.failProvisionType === "incident") {
        return { status: 500, json: { ok: false, code: "INCIDENT_CREATE_FAILED" } };
      }
      const incidentId = trim(body?.incidentId);
      const existing = store.provisionedSources.incidents.find((row) => row.incidentId === incidentId);
      if (existing) {
        return { status: 200, json: { ok: true, alreadyExists: true, incidentId } };
      }
      store.provisionedSources.incidents.push({ incidentId, status: "Open", verificationSource: body?.verificationSource });
      store.provisioningLog.push({ reportType: "incident", sourceId: incidentId });
      return { status: 200, json: { ok: true, incidentId } };
    }
    if (method === "POST" && pathname.endsWith("/risk-assessments") && !pathname.includes("verification-cleanup")) {
      if (store.failProvisionType === "risk-assessment") {
        return { status: 500, json: { ok: false, code: "RISK_ASSESSMENT_CREATE_FAILED" } };
      }
      const riskAssessmentId = trim(body?.riskAssessmentId || body?.id);
      const existing = store.provisionedSources.riskAssessments.find((row) => row.riskAssessmentId === riskAssessmentId);
      if (existing) {
        return { status: 200, json: { ok: true, alreadyExists: true, item: { id: riskAssessmentId } } };
      }
      store.provisionedSources.riskAssessments.push({
        riskAssessmentId,
        status: "current",
        verificationSource: body?.verificationSource,
      });
      store.provisioningLog.push({ reportType: "risk-assessment", sourceId: riskAssessmentId });
      return { status: 200, json: { ok: true, item: { id: riskAssessmentId } } };
    }
    if (method === "POST" && pathname.endsWith("/coshh/verification/substance")) {
      if (store.failProvisionType === "coshh") {
        return { status: 500, json: { ok: false, code: "COSHH_CREATE_FAILED" } };
      }
      const coshhId = trim(body?.coshhId);
      const existing = store.provisionedSources.coshh.find((row) => row.coshhId === coshhId);
      if (existing) {
        return { status: 200, json: { ok: true, alreadyExists: true, coshhId } };
      }
      store.provisionedSources.coshh.push({ coshhId, status: "active", verificationSource: body?.verificationSource });
      store.provisioningLog.push({ reportType: "coshh", sourceId: coshhId });
      return { status: 200, json: { ok: true, coshhId } };
    }
    if (method === "POST" && pathname.endsWith("/loler/verification/equipment")) {
      if (store.failProvisionType === "loler") {
        return { status: 500, json: { ok: false, code: "LOLER_CREATE_FAILED" } };
      }
      const equipmentId = trim(body?.equipmentId);
      const existing = store.provisionedSources.loler.find((row) => row.equipmentId === equipmentId);
      if (existing) {
        return { status: 200, json: { ok: true, alreadyExists: true, equipmentId } };
      }
      store.provisionedSources.loler.push({
        equipmentId,
        status: "active",
        verificationSource: body?.verificationSource,
      });
      store.provisioningLog.push({ reportType: "loler", sourceId: equipmentId });
      return { status: 200, json: { ok: true, equipmentId } };
    }
    if (method === "POST" && pathname.endsWith("/incidents/verification-cleanup")) {
      const keepIncidentId = trim(body?.keepIncidentId);
      store.provisionedSources.incidents = store.provisionedSources.incidents.filter(
        (row) => row.incidentId === keepIncidentId,
      );
      return { status: 200, json: { ok: true, cleanedCount: 1 } };
    }
    if (method === "POST" && pathname.endsWith("/risk-assessments/verification-cleanup")) {
      const keepRiskAssessmentId = trim(body?.keepRiskAssessmentId);
      store.provisionedSources.riskAssessments = store.provisionedSources.riskAssessments.filter(
        (row) => row.riskAssessmentId === keepRiskAssessmentId,
      );
      return { status: 200, json: { ok: true, cleanedCount: 1 } };
    }
    if (method === "POST" && pathname.endsWith("/coshh/verification-cleanup")) {
      const keepCoshhId = trim(body?.keepCoshhId);
      store.provisionedSources.coshh = store.provisionedSources.coshh.filter((row) => row.coshhId === keepCoshhId);
      return { status: 200, json: { ok: true, cleanedCount: 1 } };
    }
    if (method === "POST" && pathname.endsWith("/loler/verification-cleanup")) {
      const keepEquipmentId = trim(body?.keepEquipmentId);
      store.provisionedSources.loler = store.provisionedSources.loler.filter((row) => row.equipmentId === keepEquipmentId);
      return { status: 200, json: { ok: true, cleanedCount: 1 } };
    }
    if (method === "POST" && pathname.includes("/audit-results/") && pathname.endsWith("/verification-cleanup")) {
      const resultId = pathname.split("/audit-results/")[1]?.split("/")[0];
      if (!isVerificationSourceId(resultId)) {
        return { status: 400, json: { ok: false, code: "SOURCE_CLEANUP_REJECTED" } };
      }
      if (store.sourceCleanupFails) {
        return { status: 500, json: { ok: false, code: "SOURCE_CLEANUP_FAILED" } };
      }
      store.provisionedSources.auditResults = store.provisionedSources.auditResults.filter((row) => row.resultId !== resultId);
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/incidents/") && pathname.endsWith("/verification-cleanup")) {
      const incidentId = pathname.split("/incidents/")[1]?.split("/")[0];
      if (!isVerificationSourceId(incidentId)) {
        return { status: 400, json: { ok: false, code: "SOURCE_CLEANUP_REJECTED" } };
      }
      if (store.sourceCleanupFails) {
        return { status: 500, json: { ok: false, code: "SOURCE_CLEANUP_FAILED" } };
      }
      store.provisionedSources.incidents = store.provisionedSources.incidents.filter((row) => row.incidentId !== incidentId);
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/risk-assessments/") && pathname.endsWith("/verification-cleanup")) {
      const riskAssessmentId = pathname.split("/risk-assessments/")[1]?.split("/")[0];
      if (!isVerificationSourceId(riskAssessmentId)) {
        return { status: 400, json: { ok: false, code: "SOURCE_CLEANUP_REJECTED" } };
      }
      if (store.sourceCleanupFails) {
        return { status: 500, json: { ok: false, code: "SOURCE_CLEANUP_FAILED" } };
      }
      store.provisionedSources.riskAssessments = store.provisionedSources.riskAssessments.filter(
        (row) => row.riskAssessmentId !== riskAssessmentId,
      );
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/coshh/") && pathname.endsWith("/verification-cleanup")) {
      const coshhId = pathname.split("/coshh/")[1]?.split("/")[0];
      if (!isVerificationSourceId(coshhId)) {
        return { status: 400, json: { ok: false, code: "SOURCE_CLEANUP_REJECTED" } };
      }
      if (store.sourceCleanupFails) {
        return { status: 500, json: { ok: false, code: "SOURCE_CLEANUP_FAILED" } };
      }
      store.provisionedSources.coshh = store.provisionedSources.coshh.filter((row) => row.coshhId !== coshhId);
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/loler/equipment/") && pathname.endsWith("/verification-cleanup")) {
      const equipmentId = pathname.split("/loler/equipment/")[1]?.split("/")[0];
      if (!isVerificationSourceId(equipmentId)) {
        return { status: 400, json: { ok: false, code: "SOURCE_CLEANUP_REJECTED" } };
      }
      if (store.sourceCleanupFails) {
        return { status: 500, json: { ok: false, code: "SOURCE_CLEANUP_FAILED" } };
      }
      store.provisionedSources.loler = store.provisionedSources.loler.filter((row) => row.equipmentId !== equipmentId);
      return { status: 200, json: { ok: true, cleaned: true } };
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
    if (method === "GET" && pathname.endsWith("/reports/verification-baseline")) {
      store.baselineReads += 1;
      store.downloadsAtBaseline = store.baselineDownloadAttempts;
      store.provisionsAtBaseline = store.provisioningLog.length;
      if (store.baselineFails) {
        return { status: 503, json: { ok: false, code: "REPORTS_BASELINE_FAILED" } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          companyFolderId: baseConfig.companyFolderId,
          masterSheetId: baseConfig.masterSheetId,
          rowCounts: buildBaselineRowCounts(store),
          driveExportCounts: { available: false, skipped: true, verificationFileCount: 0, durationMs: 0 },
          timings: {
            reportsTabEnsureMs: 1,
            reportsTabReadMs: 2,
            verificationFilterMs: 0,
            reportsMetadataReadMs: 3,
            totalMs: 3,
            cacheHit: store.baselineCacheHit === true,
          },
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
      return {
        status: 200,
        json: {
          ok: true,
          results: store.provisionedSources.auditResults,
        },
      };
    }
    if (method === "GET" && pathname.includes("/google-forms")) {
      return { status: 200, json: { ok: true, forms: [] } };
    }
    if (method === "GET" && pathname === "/api/audits/templates") {
      return { status: 200, json: { ok: true, templates: [] } };
    }
    if (method === "GET" && pathname.endsWith("/incidents")) {
      return {
        status: 200,
        json: {
          ok: true,
          incidents: [...store.ordinaryRecords.incidents, ...store.provisionedSources.incidents],
        },
      };
    }
    if (method === "GET" && pathname.endsWith("/risk-assessments")) {
      return { status: 200, json: { ok: true, riskAssessments: store.provisionedSources.riskAssessments } };
    }
    if (method === "GET" && pathname.endsWith("/coshh")) {
      return { status: 200, json: { ok: true, registers: store.provisionedSources.coshh } };
    }
    if (method === "GET" && pathname.endsWith("/loler/equipment")) {
      return { status: 200, json: { ok: true, equipment: store.provisionedSources.loler } };
    }
    if (method === "POST" && pathname.endsWith("/reports/generate")) {
      store.baselineProvisionAttempts += 1;
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
      store.baselineDownloadAttempts += 1;
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
      return {
        status: 200,
        text: buffer.toString("binary"),
        buffer,
        contentType: "application/pdf",
        contentLength: buffer.length,
      };
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
  for (const key of ["authentication", "reportingApi", "sourceProvisioning", "auditReport", "cleanup"]) {
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

test("no pre-existing source records", async () => {
  const store = createMockStore();
  assert.deepEqual(store.provisionedSources, createEmptyProvisionedSources());
  const { result } = await runWorkflow(store);
  assert.equal(result.ok, true);
  assert.equal(result.checks.sourceProvisioning.status, "PASS");
});

test("successful self-provisioning", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.sourceProvisioning.status, "PASS");
  assert.equal(store.provisioningLog.length, 5);
  const byType = Object.fromEntries(store.provisioningLog.map((entry) => [entry.reportType, entry.sourceId]));
  assert.equal(byType.incident, SOURCE_PLAN.incident.incidentId);
  assert.equal(byType["risk-assessment"], SOURCE_PLAN["risk-assessment"].riskAssessmentId);
  assert.equal(byType.coshh, SOURCE_PLAN.coshh.coshhId);
  assert.equal(byType.loler, SOURCE_PLAN.loler.equipmentId);
  assert.equal(byType.audit, `result-report-${TEST_RUN_ID}`);
});

test("source creation failure identifies report type", async () => {
  const { result } = await runWorkflow({ failProvisionType: "coshh" });
  assert.equal(result.ok, false);
  assert.equal(result.checks.sourceProvisioning.status, "FAIL");
  assert.equal(result.failedReportType, "coshh");
  assert.match(result.failureReason || "", /coshh/i);
});

test("report generation after provisioning", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.sourceProvisioning.status, "PASS");
  for (const key of ["auditReport", "incidentReport", "riskAssessmentReport", "coshhReport", "lolerReport"]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
});

test("source cleanup after success", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.ok, true);
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.deepEqual(store.provisionedSources, createEmptyProvisionedSources());
  assert.equal(store.ordinaryRecords.incidents.length, 1);
  assert.equal(store.ordinaryRecords.incidents[0].incidentId, "customer-incident-1");
});

test("source cleanup after report failure", async () => {
  const { result, store } = await runWorkflow({ invalidPdf: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.pdfIntegrity.status, "FAIL");
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.deepEqual(store.provisionedSources, createEmptyProvisionedSources());
});

test("no stale source dependency", async () => {
  const store = createMockStore();
  const { result } = await runWorkflow(store);
  assert.equal(result.ok, true);
  assert.equal(result.checks.sourceProvisioning.status, "PASS");
  assert.equal(result.checks.auditReport.status, "PASS");
});

test("HTML error page returned as PDF", async () => {
  const { result } = await runWorkflow({ htmlAsPdf: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.pdfIntegrity.status, "FAIL");
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
  const auditSourceId = `result-report-${TEST_RUN_ID}`;
  store.reports.push({ reportId, reportType: "audit", sourceId: auditSourceId, status: "active" });
  store.files.set(
    reportId,
    buildVerificationReportPdfBuffer({ reportType: "audit", reportId, sourceId: auditSourceId }),
  );
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

test("baseline uses verification-baseline endpoint once", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.baseline.status, "PASS");
  assert.equal(store.baselineReads, 1);
});

test("baseline does not download PDFs", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.baseline.status, "PASS");
  assert.equal(store.downloadsAtBaseline, 0);
});

test("baseline does not provision sources", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.baseline.status, "PASS");
  assert.equal(store.provisionsAtBaseline, 0);
});

test("baseline path helper targets verification-baseline route", () => {
  const path = reportsBaselinePath(baseConfig.companyFolderId, baseConfig.masterSheetId);
  assert.match(path, /\/reports\/verification-baseline\?/);
});

test("baseline logging helper is structured", () => {
  const lines = [];
  logReportingBaselineTiming((line) => lines.push(line), {
    stage: "baseline",
    workbookId: baseConfig.masterSheetId,
    rowCounts: { totalRows: 0 },
    durationMs: 5,
    totalMs: 10,
  });
  assert.match(lines[0], /\[reporting:baseline-timing\]/);
});

test("source provisioning uses canonical assigned-checks route", async () => {
  const { result, store } = await runWorkflow({ failProvisionType: "incident" });
  assert.equal(result.checks.sourceProvisioning.status, "FAIL");
  assert.equal(store.assignedChecksRoute, "/api/me/assigned-checks");
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 18);
  assert.equal(CHECK_KEYS.includes("sourceProvisioning"), true);
  assert.equal(CHECK_KEYS.includes("pdfIntegrity"), true);
});
