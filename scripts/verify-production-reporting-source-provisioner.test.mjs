#!/usr/bin/env node
/**
 * Unit tests for reporting source provisioner — audit route reuse and partial cleanup.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadAuditWorkflowConfig, PRODUCTION_ASSIGNED_CHECKS_ROUTE } from "./lib/production-audit-workflow-core.mjs";
import {
  buildReportingSourcePlan,
  cleanupReportingSources,
  logReportingSourceProvisioning,
  provisionAllReportingSources,
} from "./lib/production-reporting-source-provisioner.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
} from "../shared/production-verification-audit.mjs";

const TEST_RUN_ID = 626262;
const baseConfig = loadAuditWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
});

function createStore(overrides = {}) {
  return {
    assignedChecksRoute: "",
    requestRoutes: [],
    provisionedSources: {
      auditResults: [],
      incidents: [],
      riskAssessments: [],
      coshh: [],
      loler: [],
    },
    failProvisionType: "",
    assignedChecksUnavailable: false,
    ...overrides,
  };
}

function createTransport(store) {
  const request = async (method, path, body) => {
    const pathname = (path.split("?")[0] || path).replace(/\/$/, "");
    store.requestRoutes.push(`${method} ${pathname}`);
    if (method === "GET" && pathname === PRODUCTION_ASSIGNED_CHECKS_ROUTE) {
      store.assignedChecksRoute = pathname;
      if (store.assignedChecksUnavailable) {
        return { status: 404, json: { ok: false, code: "NOT_FOUND" } };
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
    if (method === "GET" && pathname.includes("/google-forms")) {
      return { status: 200, json: { ok: true, forms: [] } };
    }
    if (method === "GET" && pathname === "/api/audits/templates") {
      return { status: 200, json: { ok: true, templates: [] } };
    }
    if (method === "POST" && pathname.includes("/checks/") && pathname.endsWith("/complete")) {
      if (store.failProvisionType === "audit") {
        return { status: 500, json: { ok: false } };
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
        Status: "verification",
        localSubmissionId: body?.localSubmissionId,
        verificationSource: body?.verificationSource,
      });
      return { status: 200, json: { ok: true, resultId } };
    }
    if (method === "GET" && pathname.includes("/audit-results")) {
      return { status: 200, json: { ok: true, results: store.provisionedSources.auditResults } };
    }
    if (method === "POST" && pathname.endsWith("/incidents") && !pathname.includes("verification-cleanup")) {
      if (store.failProvisionType === "incident") {
        return { status: 500, json: { ok: false } };
      }
      const incidentId = body?.incidentId;
      store.provisionedSources.incidents.push({ incidentId, status: "Open" });
      return { status: 200, json: { ok: true, incidentId } };
    }
    if (method === "POST" && pathname.endsWith("/risk-assessments") && !pathname.includes("verification-cleanup")) {
      const riskAssessmentId = body?.riskAssessmentId || body?.id;
      store.provisionedSources.riskAssessments.push({ riskAssessmentId, status: "current" });
      return { status: 200, json: { ok: true, item: { id: riskAssessmentId } } };
    }
    if (method === "POST" && pathname.endsWith("/coshh/verification/substance")) {
      const coshhId = body?.coshhId;
      store.provisionedSources.coshh.push({ coshhId, status: "active" });
      return { status: 200, json: { ok: true, coshhId } };
    }
    if (method === "POST" && pathname.endsWith("/loler/verification/equipment")) {
      const equipmentId = body?.equipmentId;
      store.provisionedSources.loler.push({ equipmentId, status: "active" });
      return { status: 200, json: { ok: true, equipmentId } };
    }
    if (method === "POST" && pathname.includes("/audit-results/") && pathname.endsWith("/verification-cleanup")) {
      const resultId = pathname.split("/audit-results/")[1]?.split("/")[0];
      store.provisionedSources.auditResults = store.provisionedSources.auditResults.filter(
        (row) => row.resultId !== resultId,
      );
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/incidents/") && pathname.endsWith("/verification-cleanup")) {
      const incidentId = pathname.split("/incidents/")[1]?.split("/")[0];
      store.provisionedSources.incidents = store.provisionedSources.incidents.filter((row) => row.incidentId !== incidentId);
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.endsWith("/incidents/verification-cleanup")) {
      return { status: 200, json: { ok: true } };
    }
    if (method === "POST" && pathname.endsWith("/risk-assessments/verification-cleanup")) {
      return { status: 200, json: { ok: true } };
    }
    if (method === "POST" && pathname.endsWith("/coshh/verification-cleanup")) {
      return { status: 200, json: { ok: true } };
    }
    if (method === "POST" && pathname.endsWith("/loler/verification-cleanup")) {
      return { status: 200, json: { ok: true } };
    }
    if (method === "POST" && pathname.includes("/risk-assessments/") && pathname.endsWith("/verification-cleanup")) {
      const riskAssessmentId = pathname.split("/risk-assessments/")[1]?.split("/")[0];
      store.provisionedSources.riskAssessments = store.provisionedSources.riskAssessments.filter(
        (row) => row.riskAssessmentId !== riskAssessmentId,
      );
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/coshh/") && pathname.endsWith("/verification-cleanup")) {
      const coshhId = pathname.split("/coshh/")[1]?.split("/")[0];
      store.provisionedSources.coshh = store.provisionedSources.coshh.filter((row) => row.coshhId !== coshhId);
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    if (method === "POST" && pathname.includes("/loler/equipment/") && pathname.endsWith("/verification-cleanup")) {
      const equipmentId = pathname.split("/loler/equipment/")[1]?.split("/")[0];
      store.provisionedSources.loler = store.provisionedSources.loler.filter((row) => row.equipmentId !== equipmentId);
      return { status: 200, json: { ok: true, cleaned: true } };
    }
    return { status: 404, json: { ok: false, code: "NOT_FOUND" } };
  };
  return { request };
}

const workflowContext = () => ({
  companyFolderId: baseConfig.companyFolderId,
  masterSheetId: baseConfig.masterSheetId,
  sources: {
    audit: "",
    incident: "",
    "risk-assessment": "",
    coshh: "",
    loler: "",
  },
  sourcePlan: null,
});

const login = {
  accountEmail: baseConfig.expectedEmail,
  user: { name: "Mr Important", email: baseConfig.expectedEmail },
};

test("uses canonical /api/me/assigned-checks route", async () => {
  const store = createStore({ failProvisionType: "incident" });
  const transport = createTransport(store);
  await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  assert.equal(store.assignedChecksRoute, PRODUCTION_ASSIGNED_CHECKS_ROUTE);
  assert.equal(
    store.requestRoutes.some((route) => route === `GET ${PRODUCTION_ASSIGNED_CHECKS_ROUTE}`),
    true,
  );
});

test("404 route failure reports safe route", async () => {
  const store = createStore({ assignedChecksUnavailable: true });
  const transport = createTransport(store);
  const result = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  assert.equal(result.ok, false);
  assert.equal(result.failedReportType, "audit");
  assert.equal(result.results[0].safeRoute, PRODUCTION_ASSIGNED_CHECKS_ROUTE);
});

test("audit source created from assigned verification check", async () => {
  const store = createStore({ failProvisionType: "incident" });
  const transport = createTransport(store);
  const ctx = workflowContext();
  const result = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, ctx, login, TEST_RUN_ID);
  assert.equal(result.ok, false);
  assert.equal(result.failedReportType, "incident");
  const auditResult = result.results.find((item) => item.reportType === "audit");
  assert.equal(auditResult.ok, true);
  assert.equal(ctx.sources.audit, `result-report-${TEST_RUN_ID}`);
});

test("correct schedule and template selected", async () => {
  const store = createStore({ failProvisionType: "incident" });
  const transport = createTransport(store);
  const result = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  const auditResult = result.results.find((item) => item.reportType === "audit");
  assert.equal(auditResult.scheduleId, PRODUCTION_VERIFICATION_SCHEDULE_ID);
  assert.equal(auditResult.templateId, PRODUCTION_VERIFICATION_AUDIT_ID);
});

test("partial provisioning cleanup removes audit source after later failure", async () => {
  const store = createStore({ failProvisionType: "incident" });
  const transport = createTransport(store);
  const result = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  assert.equal(result.failedReportType, "incident");
  assert.equal(store.provisionedSources.auditResults.length, 0);
});

test("audit cleanup after later source failure", async () => {
  const store = createStore({ failProvisionType: "incident" });
  const transport = createTransport(store);
  await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  assert.equal(store.provisionedSources.incidents.length, 0);
  assert.equal(store.provisionedSources.auditResults.length, 0);
});

test("no dependency on stale audit results", async () => {
  const store = createStore({ failProvisionType: "incident" });
  store.provisionedSources.auditResults = [];
  const transport = createTransport(store);
  const result = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].sourceId, `result-report-${TEST_RUN_ID}`);
});

test("no duplicate AuditResult on retry", async () => {
  const store = createStore();
  const transport = createTransport(store);
  const ctx = workflowContext();
  const first = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, ctx, login, TEST_RUN_ID);
  assert.equal(first.ok, true);
  const second = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, ctx, login, TEST_RUN_ID);
  assert.equal(second.results[0].idempotent, true);
  assert.equal(store.provisionedSources.auditResults.length, 1);
});

test("source readback confirmed", async () => {
  const store = createStore({ failProvisionType: "incident" });
  const transport = createTransport(store);
  const result = await provisionAllReportingSources(transport.request.bind(transport), baseConfig, workflowContext(), login, TEST_RUN_ID);
  const audit = result.results.find((item) => item.reportType === "audit");
  assert.equal(audit.ok, true);
  assert.match(audit.sourceId, /^result-report-/);
});

test("logReportingSourceProvisioning is structured", () => {
  const lines = [];
  logReportingSourceProvisioning((line) => lines.push(line), {
    reportType: "audit",
    stage: "assigned_checks",
    method: "GET",
    safeRoute: PRODUCTION_ASSIGNED_CHECKS_ROUTE,
    httpStatus: 200,
    durationMs: 3,
  });
  assert.match(lines[0], /\[reporting:source-provisioning\]/);
  assert.match(lines[0], /"safeRoute":"\/api\/me\/assigned-checks"/);
});

test("manual cleanup uses reporting audit plan", async () => {
  const store = createStore();
  const transport = createTransport(store);
  const ctx = workflowContext();
  const plan = buildReportingSourcePlan(TEST_RUN_ID);
  plan.audit.resultId = `result-report-${TEST_RUN_ID}`;
  store.provisionedSources.auditResults.push({
    resultId: plan.audit.resultId,
    "Result ID": plan.audit.resultId,
    "Schedule ID": PRODUCTION_VERIFICATION_SCHEDULE_ID,
    "Audit ID": PRODUCTION_VERIFICATION_AUDIT_ID,
    Status: "verification",
  });
  const cleanup = await cleanupReportingSources(transport.request.bind(transport), ctx, baseConfig, plan, {
    audit: plan.audit.resultId,
  });
  assert.equal(cleanup.ok, true);
  assert.equal(store.provisionedSources.auditResults.length, 0);
});
