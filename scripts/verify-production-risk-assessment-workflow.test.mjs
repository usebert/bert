#!/usr/bin/env node
/**
 * Unit tests for production Risk Assessment workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  attemptVerificationRiskAssessmentCleanup,
  formatRiskAssessmentWorkflowReport,
  loadRiskAssessmentWorkflowConfig,
  runProductionRiskAssessmentWorkflowChecks,
} from "./lib/production-risk-assessment-workflow-core.mjs";
import {
  buildProductionVerificationHazard,
  buildProductionVerificationRiskAssessment,
  PRODUCTION_VERIFICATION_RA_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_RA_TITLE,
} from "../shared/production-verification-risk-assessment.mjs";

const baseConfig = loadRiskAssessmentWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_RISK_ASSESSMENT_MUTATION: "1",
});

function successLoginJson() {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
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

function customerAssessment() {
  return {
    id: "ra-customer-1",
    companyFolderId: baseConfig.companyFolderId,
    assessmentNumber: "RA-0001",
    title: "Warehouse forklift use",
    status: "Active",
    version: "1.0",
    reviewDate: "2027-01-01",
  };
}

const TEST_RUN_ID = 12345;

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const verification = buildProductionVerificationRiskAssessment({
    runId,
    companyFolderId: baseConfig.companyFolderId,
  });
  const hazardOne = buildProductionVerificationHazard(runId, 1);
  const hazardTwo = buildProductionVerificationHazard(runId, 2);
  let assessments = options.initialAssessments ? [...options.initialAssessments] : [customerAssessment()];
  let hazards = [];
  let status = "Draft";
  let description = verification.description;
  let hazardOneControls = hazardOne.existingControls;
  let hazardTwoAdditional = hazardTwo.additionalControls;
  let hazardTwoResidualLikelihood = hazardTwo.residualLikelihood;
  let hazardTwoUpdatedAt = "2026-01-01T00:00:00.000Z";
  let submittedAt = "";
  let submittedBy = "";
  let approvedAt = "";
  let approvedBy = "";
  let reviews = [];
  let loginAttempts = 0;
  let submitAttempts = 0;
  let cleanupAttempts = 0;
  let verificationCleanupCalls = 0;
  let suppressVerificationInListCount = 0;

  const request = async (method, path, body) => {
    if (method === "GET" && path === "/api/health") {
      return {
        status: 200,
        json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" },
      };
    }
    if (method === "POST" && path === "/api/auth/company/login") {
      loginAttempts += 1;
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      if (options.reviewerLoginFails && loginAttempts > 1) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      const email =
        loginAttempts > 1 && options.reviewerExpectedEmail
          ? options.reviewerExpectedEmail
          : baseConfig.expectedEmail;
      return {
        status: 200,
        json: {
          ...successLoginJson(),
          user: { ...successLoginJson().user, email },
        },
      };
    }
    if (method === "GET" && path === "/api/auth/company/session") {
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: "Admin" },
          company: { companyFolderId: baseConfig.companyFolderId },
        },
      };
    }
    if (method === "GET" && path.includes("/risk-assessments") && !/\/risk-assessments\/[^/?]+/.test(path)) {
      if (options.listResponse) {
        return options.listResponse();
      }
      let items = [...assessments];
      if (suppressVerificationInListCount > 0) {
        suppressVerificationInListCount -= 1;
        items = items.filter((item) => item.id !== verification.id);
      }
      return {
        status: options.listUnavailable ? 503 : 200,
        json: options.listUnavailable
          ? { ok: false, code: "RISK_ASSESSMENT_FAILED" }
          : { ok: true, items },
      };
    }
    if (method === "POST" && path.includes("/risk-assessments/verification-cleanup") && !path.includes(verification.id)) {
      verificationCleanupCalls += 1;
      if (options.cleanupFails && verificationCleanupCalls > 1) {
        return { status: 500, json: { ok: false, code: "VERIFICATION_CLEANUP_FAILED" } };
      }
      assessments = assessments.map((item) =>
        String(item.id).startsWith("bert-smoke-ra-")
          ? { ...item, status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS, archivedAt: new Date().toISOString() }
          : item,
      );
      hazards = [];
      return { status: 200, json: { ok: true, cleanedCount: 1, cleanedRiskAssessmentIds: [verification.id] } };
    }
    if (method === "POST" && path.endsWith("/verification-cleanup")) {
      cleanupAttempts += 1;
      if (options.cleanupFails && (cleanupAttempts > 1 || path.includes(verification.id))) {
        return { status: 500, json: { ok: false, code: "VERIFICATION_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsNonVerification) {
        return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_RISK_ASSESSMENT" } };
      }
      const riskAssessmentId = path.split("/").filter(Boolean).at(-2);
      assessments = assessments.map((item) =>
        item.id === riskAssessmentId
          ? { ...item, status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS, archivedAt: new Date().toISOString() }
          : item,
      );
      hazards = hazards.filter((item) => item.riskAssessmentId !== riskAssessmentId);
      return {
        status: 200,
        json: { ok: true, riskAssessmentId, cleaned: true, status: PRODUCTION_VERIFICATION_RA_CLEANED_STATUS },
      };
    }
    if (method === "POST" && path.endsWith("/risk-assessments") && !path.includes("verification-cleanup")) {
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "RISK_ASSESSMENT_FAILED" } };
      }
      if (options.createMissingFromList) {
        return {
          status: 200,
          json: {
            ok: true,
            item: { ...verification, id: verification.id, status: "Draft", version: "1.0" },
            hazards: [],
          },
        };
      }
      assessments.push({ ...verification, id: verification.id, status: "Draft", version: "1.0", description });
      suppressVerificationInListCount = Number(options.listStaleUntilAttempt) || 0;
      return {
        status: 200,
        json: {
          ok: true,
          item: { ...verification, id: verification.id, status: "Draft", version: "1.0", description },
          hazards: [],
        },
      };
    }
    if (method === "POST" && path.endsWith("/hazards")) {
      if (options.firstHazardFails && hazards.length === 0) {
        return { status: 500, json: { ok: false, code: "RISK_HAZARD_FAILED" } };
      }
      if (options.secondHazardFails && hazards.length === 1) {
        return { status: 500, json: { ok: false, code: "RISK_HAZARD_FAILED" } };
      }
      if (options.duplicateHazards) {
        hazards.push({ ...hazardOne, id: hazardOne.id, riskAssessmentId: verification.id });
        hazards.push({ ...hazardOne, id: hazardOne.id, riskAssessmentId: verification.id });
        return { status: 200, json: { ok: true, item: hazardTwo } };
      }
      const next = hazards.length === 0 ? hazardOne : hazardTwo;
      hazards.push({
        ...next,
        id: next.id,
        riskAssessmentId: verification.id,
        existingControls: hazards.length === 0 ? hazardOneControls : next.existingControls,
        additionalControls: hazards.length === 0 ? next.additionalControls : hazardTwoAdditional,
        residualLikelihood: hazards.length === 0 ? next.residualLikelihood : hazardTwoResidualLikelihood,
        initialRiskScore: hazards.length === 0 ? 6 : 9,
        residualRiskScore: hazards.length === 0 ? 2 : 4,
        updatedAt: hazards.length === 0 ? "2026-01-01T00:00:00.000Z" : hazardTwoUpdatedAt,
      });
      return { status: 200, json: { ok: true, item: next } };
    }
    if (method === "PATCH" && path.includes("/risk-assessments/")) {
      if (options.saveDraftFails) {
        return { status: 500, json: { ok: false, code: "RISK_ASSESSMENT_FAILED" } };
      }
      description = body?.description || description;
      assessments = assessments.map((item) =>
        item.id === verification.id ? { ...item, description, status: "Draft", version: "1.0" } : item,
      );
      return {
        status: 200,
        json: {
          ok: true,
          item: { ...verification, description, status: "Draft", version: "1.0" },
          hazards,
        },
      };
    }
    if (method === "PATCH" && path.includes("/risk-assessment-hazards/")) {
      if (options.editHazardFails && String(body?.additionalControls || "").includes("team briefing")) {
        return { status: 500, json: { ok: false, code: "RISK_HAZARD_FAILED" } };
      }
      const hazardId = path.split("/").filter(Boolean).at(-1);
      hazards = hazards.map((item) => {
        if (item.id !== hazardId) {
          return item;
        }
        if (hazardId === hazardOne.id) {
          hazardOneControls = body?.existingControls || item.existingControls;
          return { ...item, existingControls: hazardOneControls, updatedAt: "2026-01-02T00:00:00.000Z" };
        }
        hazardTwoAdditional = body?.additionalControls || item.additionalControls;
        hazardTwoResidualLikelihood = body?.residualLikelihood ?? item.residualLikelihood;
        hazardTwoUpdatedAt = "2026-01-03T00:00:00.000Z";
        return {
          ...item,
          additionalControls: hazardTwoAdditional,
          residualLikelihood: hazardTwoResidualLikelihood,
          residualRiskScore: 2,
          updatedAt: hazardTwoUpdatedAt,
        };
      });
      const item = hazards.find((entry) => entry.id === hazardId);
      return { status: 200, json: { ok: true, item } };
    }
    if (method === "GET" && /\/risk-assessments\/[^/?]+/.test((path.split("?")[0] || path))) {
      const detailId = decodeURIComponent(path.split("/risk-assessments/")[1]?.split("?")[0] || "");
      if (detailId && !detailId.includes("verification-cleanup")) {
        if (options.resumeMismatch) {
          return {
            status: 200,
            json: {
              ok: true,
              item: { ...verification, id: detailId, title: "Wrong title", status, version: "1.0", description, approvedAt, approvedBy },
              hazards,
              links: [],
              reviews,
            },
          };
        }
        if (options.detailVerificationFails && approvedAt) {
          return {
            status: 200,
            json: {
              ok: true,
              item: { id: detailId, title: "Wrong", status: "Active", version: "1.0", approvedAt, approvedBy },
              hazards: [],
              links: [],
              reviews: [],
            },
          };
        }
        return {
          status: 200,
          json: {
            ok: true,
            item: {
              ...verification,
              id: detailId,
              title: PRODUCTION_VERIFICATION_RA_TITLE,
              status,
              version: "1.0",
              description,
              submittedAt,
              submittedBy,
              approvedAt,
              approvedBy,
              nextReviewReason: "verification",
              peopleAtRisk: "production-risk-assessment-workflow",
              activity: "Production smoke verification",
              department: "Verification",
            },
            hazards: options.duplicateHazards
              ? [hazardOne, hazardOne]
              : hazards.map((item) =>
                  item.id === hazardOne.id
                    ? { ...item, existingControls: hazardOneControls }
                    : {
                        ...item,
                        additionalControls: hazardTwoAdditional,
                        residualLikelihood: hazardTwoResidualLikelihood,
                        updatedAt: hazardTwoUpdatedAt,
                      },
                ),
            links: [],
            reviews,
          },
        };
      }
    }
    if (method === "POST" && path.endsWith("/submit")) {
      submitAttempts += 1;
      if (options.submitFails) {
        return { status: 400, json: { ok: false, code: "RISK_ASSESSMENT_VALIDATION", fieldErrors: [{ field: "reviewDate" }] } };
      }
      if (submitAttempts > 1) {
        status = "Submitted";
        return {
          status: 200,
          json: {
            ok: true,
            alreadySubmitted: true,
            item: { ...verification, status: "Submitted", submittedAt, submittedBy, version: "1.0" },
            hazards,
          },
        };
      }
      status = "Submitted";
      submittedAt = new Date().toISOString();
      submittedBy = baseConfig.expectedEmail;
      return {
        status: 200,
        json: {
          ok: true,
          item: { ...verification, status, submittedAt, submittedBy, version: "1.0" },
          hazards,
        },
      };
    }
    if (method === "POST" && path.endsWith("/approve")) {
      if (options.selfApproveBlocked && loginAttempts === 1) {
        return { status: 403, json: { ok: false, error: "You cannot approve your own submission." } };
      }
      if (options.approveFails) {
        return { status: 403, json: { ok: false, code: "RISK_ASSESSMENT_FORBIDDEN" } };
      }
      status = "Active";
      approvedAt = new Date().toISOString();
      approvedBy = loginAttempts > 1 ? options.reviewerExpectedEmail || "reviewer@usebert.co.uk" : baseConfig.expectedEmail;
      return {
        status: 200,
        json: {
          ok: true,
          item: { ...verification, status, approvedAt, approvedBy, version: "1.0" },
          hazards,
          links: [],
          reviews,
        },
      };
    }
    if (method === "POST" && path.endsWith("/review")) {
      if (options.reviewFails) {
        return { status: 500, json: { ok: false, code: "RISK_ASSESSMENT_FAILED" } };
      }
      reviews = [
        {
          id: "rar-test",
          summary: "Production smoke verification review",
          outcome: "no_change",
        },
      ];
      return {
        status: 200,
        json: {
          ok: true,
          item: { ...verification, status: "Active", version: "1.0", reviewDate: body?.nextReviewDate },
          hazards,
          links: [],
          reviews,
        },
      };
    }
    if (method === "GET" && path.includes("/health-safety/overview")) {
      if (options.overviewFails) {
        return { status: 500, json: { ok: false } };
      }
      const includeVerification = options.overviewIncludesVerification;
      return {
        status: 200,
        json: {
          ok: true,
          metrics: { activeRiskAssessments: 1, draftRiskAssessments: 0 },
          attention: includeVerification
            ? [{ recordId: verification.id, id: `attention-ra-overdue-${verification.id}` }]
            : [],
          riskAssessments: includeVerification
            ? [{ ...verification, id: verification.id, status: "Active" }]
            : [customerAssessment()],
        },
      };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    getState: () => ({ assessments, hazards, status, cleanupAttempts, loginAttempts }),
  };
}

test("full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, transport, { runId: TEST_RUN_ID });
  assert.equal(result.ok, true);
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.match(formatRiskAssessmentWorkflowReport(result), /READY FOR CUSTOMERS/);
});

test("login failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ loginFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("risk assessments api unavailable", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(
    baseConfig,
    createTransport({ listUnavailable: true }),
    { runId: TEST_RUN_ID },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "riskAssessmentsApi");
});

test("mutation disabled", async () => {
  const config = {
    ...baseConfig,
    allowRiskAssessmentMutation: false,
  };
  const result = await runProductionRiskAssessmentWorkflowChecks(config, createTransport(), { runId: TEST_RUN_ID });
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale cleanup success path", async () => {
  const transport = createTransport({
    initialAssessments: [
      customerAssessment(),
      { ...buildProductionVerificationRiskAssessment({ runId: 999 }), id: "bert-smoke-ra-999", status: "Draft" },
    ],
  });
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, transport, { runId: TEST_RUN_ID });
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("create draft failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ createFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "createDraft");
});

test("created draft missing from list", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(
    baseConfig,
    createTransport({ createMissingFromList: true }),
    { runId: TEST_RUN_ID, listPollMaxAttempts: 2, listPollIntervalMs: 0 },
  );
  assert.equal(result.failedKey, "createDraft");
  assert.ok(Array.isArray(result.createDraftDiagnostics?.listPollAttempts));
});

test("create draft polls until verification assessment appears in list", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(
    baseConfig,
    createTransport({ listStaleUntilAttempt: 1, runId: TEST_RUN_ID }),
    { runId: TEST_RUN_ID, listPollMaxAttempts: 5, listPollIntervalMs: 0 },
  );
  assert.equal(result.checks.createDraft.status, "PASS");
  assert.ok((result.createDraftDiagnostics?.listPollAttempts || []).length >= 2);
  assert.equal(result.createDraftDiagnostics?.detailLookup?.found, true);
});

test("add first hazard failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ firstHazardFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "addHazards");
});

test("add second hazard failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ secondHazardFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "addHazards");
});

test("duplicate hazard detection", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ duplicateHazards: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "addHazards");
});

test("save draft failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ saveDraftFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "saveDraft");
});

test("resume mismatch", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ resumeMismatch: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "resumeDraft");
});

test("edit hazard failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ editHazardFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "editHazard");
});

test("submit validation failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ submitFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "submit");
});

test("repeated submit idempotency", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  assert.equal(result.checks.submit.status, "PASS");
});

test("reviewer required but missing", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(
    baseConfig,
    createTransport({ selfApproveBlocked: true }),
    { runId: TEST_RUN_ID },
  );
  assert.equal(result.failedKey, "approve");
  assert.match(result.failureReason, /Reviewer credentials are required/i);
});

test("reviewer login failure", async () => {
  const config = {
    ...baseConfig,
    reviewerUsername: "reviewer.user",
    reviewerPassword: "reviewer-password",
    reviewerExpectedEmail: "bert.demo+reviewer@usebert.co.uk",
    hasReviewerCredentials: true,
  };
  const result = await runProductionRiskAssessmentWorkflowChecks(
    config,
    createTransport({ selfApproveBlocked: true, reviewerLoginFails: true, reviewerExpectedEmail: config.reviewerExpectedEmail }),
    { runId: TEST_RUN_ID },
  );
  assert.equal(result.failedKey, "approve");
});

test("approval failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ approveFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "approve");
});

test("detail verification failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(
    baseConfig,
    createTransport({ detailVerificationFails: true }),
    { runId: TEST_RUN_ID },
  );
  assert.equal(result.failedKey, "detailVerification");
});

test("health and safety overview exclusion failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(
    baseConfig,
    createTransport({ overviewIncludesVerification: true }),
    { runId: TEST_RUN_ID },
  );
  assert.equal(result.failedKey, "healthSafetyOverview");
});

test("search skipped", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  assert.equal(result.checks.search.status, "SKIP");
});

test("review success", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  assert.equal(result.checks.review.status, "PASS");
});

test("review failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ reviewFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "review");
});

test("new version skipped", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  assert.equal(result.checks.newVersion.status, "SKIP");
});

test("new version success where supported is not required in phase 3.3", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  assert.notEqual(result.checks.newVersion.status, "FAIL");
});

test("cleanup success", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport({ cleanupFails: true }), {
    runId: TEST_RUN_ID,
  });
  assert.equal(result.failedKey, "cleanup");
});

test("non-verification cleanup rejected", async () => {
  const transport = createTransport({ cleanupRejectsNonVerification: true });
  const cleanup = await attemptVerificationRiskAssessmentCleanup(transport.request, {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    riskAssessmentId: "ra-customer-1",
  });
  const single = cleanup.results.find((item) => item.kind === "single");
  assert.equal(single?.ok, false);
});

test("timeout with cleanup attempt surfaces timed out metadata", async () => {
  const transport = {
    request: async () => {
      const error = new Error("Request timed out after 1000ms");
      error.name = "StageTimeoutError";
      error.code = "STAGE_TIMEOUT";
      error.method = "POST";
      error.safeUrl = "https://api.usebert.co.uk/api/companies/folder-abc/risk-assessments";
      error.elapsedMs = 1000;
      error.timeoutMs = 1000;
      throw error;
    },
  };
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, transport, { runId: TEST_RUN_ID });
  assert.equal(result.timedOut, true);
  assert.equal(result.failedKey, "authentication");
});

test("signal interrupt cleanup helper attempts verification cleanup", async () => {
  const transport = createTransport();
  const cleanup = await attemptVerificationRiskAssessmentCleanup(transport.request, {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    riskAssessmentId: "bert-smoke-ra-12345",
  });
  assert.equal(cleanup.ok, true);
});

test("secrets absent from output", async () => {
  const result = await runProductionRiskAssessmentWorkflowChecks(baseConfig, createTransport(), { runId: TEST_RUN_ID });
  const report = formatRiskAssessmentWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/i);
  assert.doesNotMatch(report, /signed-session-token/i);
  assert.equal(CHECK_KEYS.length, 18);
});
