#!/usr/bin/env node
/**
 * Unit tests for production COSHH workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  attemptVerificationCoshhCleanup,
  formatCoshhWorkflowReport,
  loadCoshhWorkflowConfig,
  runProductionCoshhWorkflowChecks,
} from "./lib/production-coshh-workflow-core.mjs";
import {
  buildProductionVerificationCoshhAssessment,
  buildProductionVerificationCoshhAssessmentId,
  buildProductionVerificationCoshhAssessmentNumber,
  buildProductionVerificationCoshhId,
  buildProductionVerificationCoshhSubstance,
  buildProductionVerificationSdsDocumentId,
  buildProductionVerificationSdsFileName,
  countCoshhBaselines,
  defaultVerificationReviewDate,
  isOperationalCoshhRegister,
  isVerificationCoshhAssessment,
  isVerificationCoshhRegister,
  PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION,
  PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME,
  PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY,
  PRODUCTION_VERIFICATION_COSHH_SOURCE,
} from "../shared/production-verification-coshh.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";

const baseConfig = loadCoshhWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_COSHH_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const TODAY = getUkTodayKey();
const REVIEW_DATE = defaultVerificationReviewDate(TODAY);
const defaultRunOptions = { runId: TEST_RUN_ID, listPollMaxAttempts: 3, listPollIntervalMs: 0 };

function trim(value) {
  return String(value ?? "").trim();
}

function customerCoshhRegister() {
  return {
    id: "COS-CUSTOMER-1",
    productName: "Industrial solvent",
    productCode: "SOL-001",
    supplier: "Real Supplier Ltd",
    primaryUse: "Parts cleaning",
    storageLocation: "Factory",
    status: "review_due",
    reviewDate: "2027-01-01",
  };
}

function verificationCoshhRecord(options = {}) {
  const runId = options.runId ?? TEST_RUN_ID;
  const coshhId = buildProductionVerificationCoshhId(runId);
  const substance = buildProductionVerificationCoshhSubstance({
    runId,
    coshhId,
    companyFolderId: baseConfig.companyFolderId,
    todayKey: TODAY,
    reviewDate: options.reviewDate ?? REVIEW_DATE,
  });
  return {
    id: coshhId,
    productName: substance.productName,
    manufacturer: substance.manufacturer,
    supplier: substance.supplier,
    productCode: substance.productCode,
    description: substance.description,
    physicalForm: substance.physicalForm,
    signalWord: substance.signalWord,
    hazardStatements: substance.hazardStatements,
    precautionaryStatements: substance.precautionaryStatements,
    primaryUse: substance.primaryUse,
    storageLocation: substance.storageLocation,
    assessmentRequired: substance.assessmentRequired,
    approvedForUse: options.approvedForUse ?? false,
    reviewDate: substance.reviewDate,
    sdsDocumentId: options.sdsDocumentId ?? substance.sdsDocumentId,
    sdsFileName: options.sdsFileName ?? substance.sdsFileName,
    sdsIssueDate: options.sdsIssueDate ?? substance.sdsIssueDate,
    sdsVersion: options.sdsVersion ?? substance.sdsVersion,
    status: options.status ?? "draft",
  };
}

function verificationAssessmentRecord(options = {}) {
  const runId = options.runId ?? TEST_RUN_ID;
  const coshhId = buildProductionVerificationCoshhId(runId);
  const assessmentId = buildProductionVerificationCoshhAssessmentId(runId);
  const assessment = buildProductionVerificationCoshhAssessment({
    runId,
    coshhId,
    assessmentId,
    companyFolderId: baseConfig.companyFolderId,
    assessorName: baseConfig.expectedEmail,
    todayKey: TODAY,
    reviewDate: options.reviewDate ?? REVIEW_DATE,
  });
  return {
    id: assessmentId,
    coshhId,
    assessmentTitle: assessment.assessmentTitle,
    activity: assessment.activity,
    personsAtRisk: assessment.personsAtRisk,
    frequencyOfUse: assessment.frequencyOfUse,
    quantityUsed: assessment.quantityUsed,
    durationOfExposure: assessment.durationOfExposure,
    exposureRoutes: assessment.exposureRoutes,
    hazards: assessment.hazards,
    existingControls: assessment.existingControls,
    engineeringControls: assessment.engineeringControls,
    ppeRequired: assessment.ppeRequired,
    storageControls: assessment.storageControls,
    spillProcedure: assessment.spillProcedure,
    firstAid: assessment.firstAid,
    fireResponse: assessment.fireResponse,
    disposalMethod: assessment.disposalMethod,
    emergencyActions: assessment.emergencyActions,
    initialLikelihood: assessment.initialLikelihood,
    initialSeverity: assessment.initialSeverity,
    residualLikelihood: assessment.residualLikelihood,
    residualSeverity: assessment.residualSeverity,
    additionalActions: options.additionalActions ?? assessment.additionalActions,
    assessorName: assessment.assessorName,
    assessmentDate: assessment.assessmentDate,
    reviewDate: assessment.reviewDate,
    status: options.status ?? "draft",
    approvedAt: options.approvedAt ?? "",
  };
}

function successLoginJson(email = baseConfig.expectedEmail) {
  return {
    ok: true,
    user: {
      email,
      role: "Admin",
      name: "Mr Important",
      companyFolderId: baseConfig.companyFolderId,
    },
    company: {
      companyFolderId: baseConfig.companyFolderId,
      companyName: "Dovecote Demo",
      live: true,
    },
    masterSheetId: baseConfig.masterSheetId,
  };
}

function successConfig(overrides = {}) {
  return { ...baseConfig, ...overrides };
}

function reviewerConfig() {
  return successConfig({
    reviewerUsername: "coshh.reviewer",
    reviewerPassword: "reviewer-secret",
    reviewerExpectedEmail: "bert.demo+coshh.reviewer@usebert.co.uk",
    hasReviewerCredentials: true,
    selfApprovalMode: false,
  });
}

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const verificationCoshhId = buildProductionVerificationCoshhId(runId);
  const verificationAssessmentId = buildProductionVerificationCoshhAssessmentId(runId);
  const verificationAssessmentNumber = buildProductionVerificationCoshhAssessmentNumber(runId);
  const expectedSdsDocumentId = buildProductionVerificationSdsDocumentId(runId);
  const expectedSdsFileName = buildProductionVerificationSdsFileName(runId);
  const companyBase = `/api/companies/${baseConfig.companyFolderId}`;

  let coshhStore = new Map(
    (options.initialCoshh || [customerCoshhRegister()]).map((item) => [item.id, { ...item }]),
  );
  let assessmentsStore = new Map(
    (options.initialAssessments || []).map((item) => [item.id, { ...item }]),
  );
  let cleaned = false;
  let mutationCreated = false;
  let createProductAttempts = 0;
  let createDraftAttempts = 0;
  let submitAttempts = 0;
  let approveAttempts = 0;
  let loginAttempts = 0;
  let create502Once = options.create502Once === true;
  let create502Used = false;
  let suppressDetailUntilAttempt = options.suppressDetailUntilAttempt || 0;
  let detailAttempts = 0;
  let overviewIncludesVerification = options.overviewIncludesVerification === true;
  let dashboardOperationalInflated = options.dashboardOperationalInflated === true;
  let cleanupFails = options.cleanupFails === true;
  let cleanupFailsAtEnd = options.cleanupFailsAtEnd === true;
  let interruptCleanupHandler = null;
  let baselineMetrics = {
    coshhReviewsOverdue: 0,
    coshhReviewsDueSoon: 1,
    chemicalsMissingSds: 0,
    coshhAssessmentsDue: 0,
  };

  function coshhList() {
    if (cleaned) {
      return Array.from(coshhStore.values()).filter((item) => !isVerificationCoshhRegister(item));
    }
    return Array.from(coshhStore.values());
  }

  function operationalSummary() {
    const operational = coshhList().filter(
      (item) => isOperationalCoshhRegister(item) && trim(item.status).toLowerCase() !== "archived",
    );
    return {
      overdue: operational.filter((item) => item.status === "overdue").length,
      reviewDue: operational.filter((item) => item.status === "review_due").length,
      missingSds: operational.filter((item) => item.status === "missing_sds").length,
      assessmentRequired: operational.filter((item) => item.status === "assessment_required").length,
    };
  }

  function assessmentsForCoshh(coshhId) {
    return Array.from(assessmentsStore.values()).filter((item) => trim(item.coshhId) === trim(coshhId));
  }

  function markCleaned(record) {
    return {
      ...record,
      description: `${record.description || ""} verification-cleaned`,
      archivedAt: new Date().toISOString(),
      status: "archived",
    };
  }

  const transport = {
    async request(method, path, body, requestOptions = {}) {
      const url = new URL(path, "https://api.example.test");
      const pathname = url.pathname;

      if (pathname === "/api/health") {
        return { status: 200, json: { ok: true, version: "1.0.0", gitSha: "abc123" } };
      }

      if (pathname === "/api/auth/company/login" && method === "POST") {
        loginAttempts += 1;
        if (options.loginFails) {
          return { status: 401, json: { ok: false, error: "Invalid credentials" } };
        }
        if (options.reviewerLoginFails && loginAttempts > 1) {
          return { status: 401, json: { ok: false, error: "Invalid credentials" } };
        }
        cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
        const email =
          loginAttempts > 1 && options.reviewerExpectedEmail
            ? options.reviewerExpectedEmail
            : baseConfig.expectedEmail;
        return { status: 200, json: successLoginJson(email) };
      }

      if (pathname === "/api/auth/company/session" && method === "GET") {
        return {
          status: 200,
          json: {
            ok: true,
            user: { email: baseConfig.expectedEmail, role: "Admin" },
            company: { companyFolderId: baseConfig.companyFolderId },
          },
        };
      }

      if (pathname.endsWith("/coshh") && method === "GET" && !pathname.includes("/coshh/")) {
        if (options.coshhApiFails) {
          return { status: 503, json: { ok: false, error: "Unavailable" } };
        }
        const items = coshhList();
        const summary = operationalSummary();
        if (dashboardOperationalInflated && mutationCreated) {
          const customer = coshhStore.get("COS-CUSTOMER-1");
          if (customer) {
            coshhStore.set("COS-CUSTOMER-1", { ...customer, status: "overdue" });
          }
          coshhStore.set("COS-CUSTOMER-2", {
            ...customerCoshhRegister(),
            id: "COS-CUSTOMER-2",
            productCode: "SOL-002",
            status: "overdue",
          });
          return { status: 200, json: { ok: true, items: coshhList(), summary: operationalSummary() } };
        }
        return { status: 200, json: { ok: true, items, summary } };
      }

      if (pathname.includes("/coshh/") && method === "GET" && !pathname.includes("/assessments")) {
        detailAttempts += 1;
        const coshhId = pathname.split("/coshh/")[1]?.split("?")[0]?.split("/")[0];
        if (suppressDetailUntilAttempt > 0 && detailAttempts <= suppressDetailUntilAttempt) {
          return { status: 404, json: { ok: false, code: "COSHH_NOT_FOUND" } };
        }
        const item = coshhStore.get(coshhId);
        if (!item) {
          return { status: 404, json: { ok: false, code: "COSHH_NOT_FOUND" } };
        }
        return { status: 200, json: { ok: true, item: { ...item } } };
      }

      if (pathname.includes("/coshh/") && pathname.endsWith("/assessments") && method === "GET") {
        if (options.coshhApiFails) {
          return { status: 503, json: { ok: false } };
        }
        const coshhId = pathname.split("/coshh/")[1]?.split("/assessments")[0];
        const items = assessmentsForCoshh(coshhId);
        return { status: 200, json: { ok: true, items } };
      }

      if (pathname.includes("/coshh-assessments/") && method === "GET") {
        const assessmentId = pathname.split("/coshh-assessments/")[1]?.split("?")[0];
        const item = assessmentsStore.get(assessmentId);
        if (!item) {
          return { status: 404, json: { ok: false, code: "COSHH_ASSESSMENT_NOT_FOUND" } };
        }
        let record = { ...item };
        if (options.detailMismatch && mutationCreated) {
          record = { ...record, assessmentTitle: "WRONG-TITLE" };
        }
        if (options.detailProductMismatch && mutationCreated) {
          const substance = coshhStore.get(verificationCoshhId);
          if (substance) {
            coshhStore.set(verificationCoshhId, { ...substance, productName: "Wrong Product Name" });
          }
        }
        return { status: 200, json: { ok: true, item: record } };
      }

      if (pathname.endsWith("/health-safety/overview") && method === "GET") {
        const attentionItems = overviewIncludesVerification
          ? [{ id: `attention-coshh-${verificationCoshhId}`, recordId: verificationCoshhId, type: "coshh_overdue" }]
          : [];
        const metrics = { ...baselineMetrics };
        if (overviewIncludesVerification) {
          metrics.coshhReviewsOverdue = 99;
        }
        return { status: 200, json: { ok: true, metrics, attentionItems, incidents: [] } };
      }

      if (pathname.endsWith("/coshh/verification-cleanup") && method === "POST") {
        if (cleanupFailsAtEnd && mutationCreated) {
          return { status: 500, json: { ok: false, code: "COSHH_CLEANUP_FAILED" } };
        }
        if (cleanupFails && !cleanupFailsAtEnd) {
          return { status: 500, json: { ok: false, code: "COSHH_CLEANUP_FAILED" } };
        }
        const keepId = trim(body?.keepCoshhId);
        for (const [id, item] of coshhStore.entries()) {
          if (isVerificationCoshhRegister(item) && id !== keepId) {
            coshhStore.set(id, markCleaned(item));
          }
        }
        for (const [id, item] of assessmentsStore.entries()) {
          if (isVerificationCoshhAssessment(item) && trim(item.coshhId) !== keepId) {
            assessmentsStore.set(id, {
              ...item,
              additionalActions: `${item.additionalActions || ""} verification-cleaned`,
              status: "archived",
              archivedAt: new Date().toISOString(),
            });
          }
        }
        return { status: 200, json: { ok: true, cleanedCount: 1 } };
      }

      if (pathname.endsWith("/verification-cleanup") && method === "POST" && pathname.includes("/coshh/")) {
        const coshhId = pathname.split("/coshh/")[1]?.split("/verification-cleanup")[0];
        if (options.rejectNonVerificationCleanup !== false && coshhId === "COS-CUSTOMER-1") {
          return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_COSHH" } };
        }
        if (cleanupFailsAtEnd && mutationCreated) {
          return { status: 500, json: { ok: false } };
        }
        if (cleanupFails && !cleanupFailsAtEnd) {
          return { status: 500, json: { ok: false } };
        }
        const item = coshhStore.get(coshhId);
        if (item) {
          coshhStore.set(coshhId, markCleaned(item));
        }
        for (const [id, assessment] of assessmentsStore.entries()) {
          if (trim(assessment.coshhId) === trim(coshhId)) {
            assessmentsStore.set(id, {
              ...assessment,
              additionalActions: `${assessment.additionalActions || ""} verification-cleaned`,
              status: "archived",
              archivedAt: new Date().toISOString(),
            });
          }
        }
        cleaned = true;
        return { status: 200, json: { ok: true, cleaned: true, coshhId, updatedRows: 1 } };
      }

      if (pathname.endsWith("/coshh/verification/substance") && method === "POST") {
        createProductAttempts += 1;
        if (options.createProductFails) {
          return { status: 400, json: { ok: false, code: "COSHH_VALIDATION_FAILED" } };
        }
        if (create502Once && !create502Used) {
          create502Used = true;
          return { status: 502, json: { ok: false, error: "Bad gateway" } };
        }
        if (options.duplicateCreateProduct && coshhStore.has(verificationCoshhId)) {
          mutationCreated = true;
          return {
            status: 200,
            json: { ok: true, alreadyExists: true, updatedRows: 0, coshhId: verificationCoshhId },
          };
        }
        const record = verificationCoshhRecord({ runId });
        if (options.sdsMissing) {
          record.sdsDocumentId = "";
          record.sdsFileName = "";
          record.sdsIssueDate = "";
          record.sdsVersion = "";
        }
        coshhStore.set(verificationCoshhId, record);
        mutationCreated = true;
        return {
          status: 200,
          json: { ok: true, item: record, coshhId: verificationCoshhId, updatedRows: 1 },
        };
      }

      if (pathname.includes("/coshh/verification/substance/") && method === "PATCH") {
        const coshhId = pathname.split("/verification/substance/")[1]?.split("?")[0];
        if (options.editFails && !String(body?.hazardStatements || "").includes("(verified)")) {
          return { status: 500, json: { ok: false } };
        }
        if (options.hazardFails && String(body?.hazardStatements || "").includes("(verified)")) {
          return { status: 500, json: { ok: false } };
        }
        const current = coshhStore.get(coshhId);
        if (!current) {
          return { status: 404, json: { ok: false } };
        }
        coshhStore.set(coshhId, {
          ...current,
          primaryUse: body?.primaryUse || current.primaryUse,
          storageLocation: body?.storageLocation || current.storageLocation,
          signalWord: body?.signalWord || current.signalWord,
          hazardStatements: body?.hazardStatements || current.hazardStatements,
          precautionaryStatements: body?.precautionaryStatements || current.precautionaryStatements,
        });
        return { status: 200, json: { ok: true, item: coshhStore.get(coshhId), updatedRows: 1 } };
      }

      if (pathname.endsWith("/coshh/verification/assessments") && method === "POST") {
        createDraftAttempts += 1;
        if (options.createDraftFails) {
          return { status: 400, json: { ok: false, code: "COSHH_ASSESSMENT_VALIDATION_FAILED" } };
        }
        if (options.duplicateCreateDraft && assessmentsStore.has(verificationAssessmentId)) {
          return {
            status: 200,
            json: { ok: true, alreadyExists: true, updatedRows: 0, assessmentId: verificationAssessmentId },
          };
        }
        const record = verificationAssessmentRecord({ runId });
        assessmentsStore.set(verificationAssessmentId, record);
        return {
          status: 200,
          json: { ok: true, item: record, assessmentId: verificationAssessmentId, updatedRows: 1 },
        };
      }

      if (pathname.includes("/coshh/verification/assessments/") && method === "PATCH") {
        if (options.ppeFails && String(body?.ppeRequired || "").includes("(verified)")) {
          return { status: 500, json: { ok: false } };
        }
        if (options.saveDraftFails && String(body?.activity || "").includes("(draft saved)")) {
          return { status: 500, json: { ok: false } };
        }
        const assessmentId = pathname.split("/verification/assessments/")[1]?.split("?")[0]?.split("/")[0];
        const current = assessmentsStore.get(assessmentId);
        if (!current) {
          return { status: 404, json: { ok: false } };
        }
        assessmentsStore.set(assessmentId, {
          ...current,
          existingControls: body?.existingControls || current.existingControls,
          engineeringControls: body?.engineeringControls || current.engineeringControls,
          ppeRequired: body?.ppeRequired || current.ppeRequired,
          storageControls: body?.storageControls || current.storageControls,
          activity: body?.activity || current.activity,
          status: body?.status || current.status,
        });
        return { status: 200, json: { ok: true, item: assessmentsStore.get(assessmentId), updatedRows: 1 } };
      }

      if (pathname.endsWith("/submit") && method === "POST") {
        submitAttempts += 1;
        if (options.submitFails) {
          return { status: 400, json: { ok: false } };
        }
        const assessmentId = pathname.split("/assessments/")[1]?.split("/submit")[0];
        const current = assessmentsStore.get(assessmentId);
        if (!current) {
          return { status: 404, json: { ok: false } };
        }
        if (options.submitIdempotent && submitAttempts > 1) {
          return { status: 200, json: { ok: true, alreadySubmitted: true, updatedRows: 0 } };
        }
        assessmentsStore.set(assessmentId, {
          ...current,
          additionalActions: `${current.additionalActions || ""}; submitted=true`,
          status: "submitted",
          submittedAt: TODAY,
          submittedBy: baseConfig.expectedEmail,
        });
        return { status: 200, json: { ok: true, updatedRows: 1 } };
      }

      if (pathname.endsWith("/approve") && method === "POST") {
        approveAttempts += 1;
        if (options.selfApprovalBlocked) {
          return {
            status: 403,
            json: { ok: false, code: "COSHH_SELF_APPROVAL_BLOCKED", message: "Self-approval blocked for own submission" },
          };
        }
        if (options.approveFails) {
          return { status: 500, json: { ok: false } };
        }
        const assessmentId = pathname.split("/assessments/")[1]?.split("/approve")[0];
        const current = assessmentsStore.get(assessmentId);
        if (!current) {
          return { status: 404, json: { ok: false } };
        }
        if (options.approveIdempotent && approveAttempts > 1) {
          return { status: 200, json: { ok: true, alreadyApproved: true, updatedRows: 0 } };
        }
        assessmentsStore.set(assessmentId, {
          ...current,
          status: "active",
          approvedAt: TODAY,
          approvedBy: options.reviewerExpectedEmail || baseConfig.expectedEmail,
        });
        const substance = coshhStore.get(verificationCoshhId);
        if (substance) {
          coshhStore.set(verificationCoshhId, { ...substance, approvedForUse: true, status: "active" });
        }
        return { status: 200, json: { ok: true, updatedRows: 1 } };
      }

      if (pathname.endsWith("/review") && method === "POST") {
        if (options.skipReview) {
          return { status: 409, json: { ok: false, code: "COSHH_REVIEW_NOT_SUPPORTED" } };
        }
        const assessmentId = pathname.split("/assessments/")[1]?.split("/review")[0];
        const current = assessmentsStore.get(assessmentId);
        if (!current) {
          return { status: 404, json: { ok: false } };
        }
        const reviewDate = trim(body?.reviewDate) || REVIEW_DATE;
        assessmentsStore.set(assessmentId, {
          ...current,
          additionalActions: `${current.additionalActions || ""}; reviewed=true; ${PRODUCTION_VERIFICATION_COSHH_REVIEW_SUMMARY}`,
          reviewDate,
          status: "active",
        });
        const substance = coshhStore.get(verificationCoshhId);
        if (substance) {
          coshhStore.set(verificationCoshhId, { ...substance, reviewDate });
        }
        return { status: 200, json: { ok: true, updatedRows: 1 } };
      }

      return { status: 404, json: { ok: false, error: `Unhandled ${method} ${pathname}` } };
    },
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    registerInterruptCleanup(fn) {
      interruptCleanupHandler = fn;
    },
    get verificationCoshhId() {
      return verificationCoshhId;
    },
    get verificationAssessmentId() {
      return verificationAssessmentId;
    },
    get verificationAssessmentNumber() {
      return verificationAssessmentNumber;
    },
    get expectedSdsDocumentId() {
      return expectedSdsDocumentId;
    },
    get expectedSdsFileName() {
      return expectedSdsFileName;
    },
    triggerInterruptCleanup() {
      return interruptCleanupHandler?.();
    },
    get coshhStore() {
      return coshhStore;
    },
    get assessmentsStore() {
      return assessmentsStore;
    },
  };

  return transport;
}

test("1. full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.authentication.status, "PASS");
  assert.equal(result.checks.createProduct.status, "PASS");
  assert.equal(result.checks.createDraft.status, "PASS");
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.equal(result.checks.notifications.status, "SKIP");
  assert.equal(result.checks.search.status, "SKIP");
});

test("2. login failure", async () => {
  const transport = createTransport({ loginFails: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("3. COSHH API unavailable", async () => {
  const transport = createTransport({ coshhApiFails: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "coshhApi");
});

test("4. mutation disabled", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(
    successConfig({ allowCoshhMutation: false }),
    transport,
    defaultRunOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.createProduct.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("5. stale cleanup", async () => {
  const stale = verificationCoshhRecord({ runId: TEST_RUN_ID - 1 });
  const transport = createTransport({
    initialCoshh: [customerCoshhRegister(), stale],
    initialAssessments: [verificationAssessmentRecord({ runId: TEST_RUN_ID - 1, coshhId: stale.id })],
  });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("6. product create success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.createProduct.status, "PASS");
});

test("7. product create idempotent", async () => {
  const existing = verificationCoshhRecord();
  const transport = createTransport({
    initialCoshh: [customerCoshhRegister(), existing],
    duplicateCreateProduct: true,
  });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createProduct.status, "PASS");
});

test("8. assessment create failure", async () => {
  const transport = createTransport({ createDraftFails: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createDraft");
});

test("9. create succeeds but not visible", async () => {
  const transport = createTransport({ suppressDetailUntilAttempt: 99 });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, {
    ...defaultRunOptions,
    listPollMaxAttempts: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "readback");
});

test("10. duplicate create idempotency", async () => {
  const existing = verificationCoshhRecord();
  const existingAssessment = verificationAssessmentRecord();
  const transport = createTransport({
    initialCoshh: [customerCoshhRegister(), existing],
    initialAssessments: [existingAssessment],
    duplicateCreateProduct: true,
    duplicateCreateDraft: true,
  });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "PASS");
});

test("11. edit failure", async () => {
  const transport = createTransport({ editFails: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editAssessment");
});

test("12. hazard classification success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.hazardClassification.status, "PASS");
});

test("13. duplicate hazard prevention", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.hazardClassification.status, "PASS");
  const substance = transport.coshhStore.get(transport.verificationCoshhId);
  assert.ok(String(substance?.hazardStatements || "").includes("(verified)"));
  assert.equal(String(substance?.hazardStatements || "").split(PRODUCTION_VERIFICATION_COSHH_HAZARD_CLASSIFICATION).length - 1, 1);
});

test("14. PPE/control persistence", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.ppeAndControls.status, "PASS");
  const assessment = transport.assessmentsStore.get(transport.verificationAssessmentId);
  assert.ok(String(assessment?.ppeRequired || "").includes("(verified)"));
  assert.ok(String(assessment?.existingControls || "").includes("(verified)"));
});

test("15. SDS upload success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.sds.status, "PASS");
  const substance = transport.coshhStore.get(transport.verificationCoshhId);
  assert.equal(substance?.sdsDocumentId, transport.expectedSdsDocumentId);
  assert.equal(substance?.sdsFileName, transport.expectedSdsFileName);
});

test("16. SDS skipped", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(
    successConfig({ allowCoshhMutation: false }),
    transport,
    defaultRunOptions,
  );
  assert.equal(result.checks.sds.status, "SKIP");
});

test("17. SDS upload orphan cleanup", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.cleanup.status, "PASS");
  const substance = transport.coshhStore.get(transport.verificationCoshhId);
  assert.ok(substance?.description?.includes("verification-cleaned") || substance?.archivedAt);
});

test("18. save draft preserves status", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.saveDraft.status, "PASS");
  const assessment = transport.assessmentsStore.get(transport.verificationAssessmentId);
  assert.equal(String(assessment?.activity || "").includes("(draft saved)"), true);
});

test("19. submit success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.submit.status, "PASS");
});

test("20. repeated submit idempotency", async () => {
  const transport = createTransport({ submitIdempotent: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.submit.status, "PASS");
});

test("21. reviewer required but missing", async () => {
  const transport = createTransport({
    selfApprovalBlocked: true,
    reviewerExpectedEmail: "bert.demo+coshh.reviewer@usebert.co.uk",
  });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "approverLogin");
});

test("22. reviewer login failure", async () => {
  const transport = createTransport({
    selfApprovalBlocked: true,
    reviewerLoginFails: true,
    reviewerExpectedEmail: "bert.demo+coshh.reviewer@usebert.co.uk",
  });
  const result = await runProductionCoshhWorkflowChecks(reviewerConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "approverLogin");
});

test("23. approval success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.approveActivate.status, "PASS");
});

test("24. repeated approval idempotency", async () => {
  const transport = createTransport({ approveIdempotent: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.approveActivate.status, "PASS");
});

test("25. detail mismatch", async () => {
  const transport = createTransport({ detailProductMismatch: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "detailVerification");
});

test("26. review success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.review.status, "PASS");
});

test("27. review skipped", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(
    successConfig({ allowCoshhMutation: false }),
    transport,
    defaultRunOptions,
  );
  assert.equal(result.checks.review.status, "SKIP");
});

test("28. H&S overview exclusion failure", async () => {
  const transport = createTransport({ overviewIncludesVerification: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "healthSafetyOverview");
});

test("29. dashboard exclusion failure", async () => {
  const transport = createTransport({ dashboardOperationalInflated: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("30. notification skipped", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.notifications.status, "SKIP");
});

test("31. search skipped", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.search.status, "SKIP");
});

test("32. cleanup success", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("33. cleanup failure", async () => {
  const transport = createTransport({ cleanupFailsAtEnd: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("34. non-verification cleanup rejected", async () => {
  const transport = createTransport();
  const cleanup = await attemptVerificationCoshhCleanup(transport.request.bind(transport), {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationCoshhId: "COS-CUSTOMER-1",
  });
  assert.equal(cleanup.ok, false);
});

test("35. transient 502 recovery", async () => {
  const transport = createTransport({ create502Once: true });
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createProduct.status, "PASS");
});

test("36. timeout cleanup attempt", async () => {
  const transport = createTransport({ cleanupFails: true, createProductFails: true });
  await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  const cleanup = await attemptVerificationCoshhCleanup(transport.request.bind(transport), {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationCoshhId: buildProductionVerificationCoshhId(TEST_RUN_ID),
  });
  assert.equal(cleanup.ok, false);
});

test("37. SIGINT/SIGTERM cleanup", async () => {
  const transport = createTransport();
  let registered = null;
  await runProductionCoshhWorkflowChecks(successConfig(), transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registered = fn;
    },
  });
  assert.equal(typeof registered, "function");
  const cleanup = await registered();
  assert.equal(cleanup.ok, true);
});

test("38. secrets/customer COSHH content absent from output", async () => {
  const transport = createTransport();
  const result = await runProductionCoshhWorkflowChecks(successConfig(), transport, defaultRunOptions);
  const report = formatCoshhWorkflowReport(result);
  assert.ok(!report.includes("secret-password"));
  assert.ok(!report.includes("SOL-001"));
  assert.ok(!report.includes("Industrial solvent"));
  assert.ok(!report.includes("Real Supplier Ltd"));
  assert.equal(isOperationalCoshhRegister(customerCoshhRegister()), true);
  assert.equal(isVerificationCoshhRegister(verificationCoshhRecord()), true);
  const baseline = countCoshhBaselines([customerCoshhRegister(), verificationCoshhRecord()], [], TODAY);
  assert.equal(baseline.totalCoshh, 1);
  assert.equal(baseline.verificationCount, 1);
});

test("CHECK_KEYS covers all report labels", () => {
  assert.equal(CHECK_KEYS.length, 22);
  for (const key of CHECK_KEYS) {
    assert.ok(key.length > 0);
  }
});

test("verification COSHH naming constants", () => {
  assert.equal(PRODUCTION_VERIFICATION_COSHH_PRODUCT_NAME, "BERT Verification Cleaning Product");
  assert.equal(PRODUCTION_VERIFICATION_COSHH_SOURCE, "production-coshh-workflow");
});
