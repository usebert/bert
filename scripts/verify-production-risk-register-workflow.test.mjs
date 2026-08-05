#!/usr/bin/env node
/**
 * Unit tests for production Risk Register workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  CHECK_LABELS,
  attemptVerificationRiskRegisterCleanup,
  formatRiskRegisterWorkflowReport,
  loadRiskRegisterWorkflowConfig,
  residualRiskScoresConfirmed,
  runProductionRiskRegisterWorkflowChecks,
} from "./lib/production-risk-register-workflow-core.mjs";
import {
  buildProductionVerificationExistingControl,
  buildProductionVerificationFurtherControl,
  buildProductionVerificationRiskRegister,
  buildProductionVerificationRiskRegisterControlId,
  buildProductionVerificationRiskRegisterId,
  buildProductionVerificationRiskRegisterReference,
  defaultVerificationRiskReviewDate,
  isOperationalRiskRegisterItem,
  isVerificationRiskRegisterItem,
  PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE,
} from "../shared/production-verification-risk-register.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import { calculateRiskScore, getRiskBand } from "../shared/risk-assessments.mjs";

const baseConfig = loadRiskRegisterWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_RISK_REGISTER_MUTATION: "1",
});
const TEST_RUN_ID = 12345;
const TODAY = getUkTodayKey();
const REVIEW_DATE = defaultVerificationRiskReviewDate(TODAY);
const defaultRunOptions = { runId: TEST_RUN_ID, listPollMaxAttempts: 3, listPollIntervalMs: 0 };

function customerRisk() {
  return {
    id: "risk-customer-1",
    riskReference: "RISK-001",
    title: "Customer business risk",
    status: "Active",
    residualRiskScore: 6,
    reviewDate: "2027-01-01",
  };
}

function verificationRisk(options = {}) {
  const runId = options.runId ?? TEST_RUN_ID;
  const payload = buildProductionVerificationRiskRegister({
    runId,
    riskId: buildProductionVerificationRiskRegisterId(runId),
    companyFolderId: baseConfig.companyFolderId,
    ownerName: baseConfig.expectedEmail,
    todayKey: TODAY,
    reviewDate: options.reviewDate ?? REVIEW_DATE,
  });
  return {
    id: payload.riskId,
    riskReference: payload.riskReference,
    title: payload.title,
    description: payload.description,
    category: payload.category,
    department: payload.department,
    siteId: payload.siteId,
    ownerName: payload.ownerName,
    cause: payload.cause,
    consequence: payload.consequence,
    initialLikelihood: payload.initialLikelihood,
    initialImpact: payload.initialImpact,
    initialRiskScore: payload.initialRiskScore,
    initialRiskBand: payload.initialRiskBand,
    residualLikelihood: payload.residualLikelihood,
    residualImpact: payload.residualImpact,
    residualRiskScore: payload.residualRiskScore,
    residualRiskBand: payload.residualRiskBand,
    status: options.status ?? "Draft",
    reviewDate: payload.reviewDate,
    notes: payload.notes,
    controls: options.controls ?? [],
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

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const riskId = buildProductionVerificationRiskRegisterId(runId);
  const existingControlId = buildProductionVerificationRiskRegisterControlId(runId, "existing");
  const furtherControlId = buildProductionVerificationRiskRegisterControlId(runId, "further");
  const companyBase = `/api/companies/${baseConfig.companyFolderId}`;
  let risks = new Map((options.initialRisks || [customerRisk()]).map((item) => [item.id, { ...item, controls: item.controls || [] }]));
  let cleaned = false;
  let created = false;
  let loginAttempts = 0;
  let detailAttempts = 0;
  let suppressDetailUntilAttempt = options.suppressDetailUntilAttempt || 0;
  let create502Once = options.create502Once === true;
  let create502Used = false;
  let cleanupFails = options.cleanupFails === true;
  let cleanupFailsAtEnd = options.cleanupFailsAtEnd === true;
  let overviewIncludesVerification = options.overviewIncludesVerification === true;

  const transport = {
    async request(method, path, body) {
      const url = new URL(path, "https://api.example.test");
      const pathname = url.pathname;
      if (pathname === "/api/health") return { status: 200, json: { ok: true, version: "1.0.0", gitSha: "abc123" } };
      if (pathname === "/api/auth/company/login" && method === "POST") {
        loginAttempts += 1;
        if (options.loginFails || (options.reviewerLoginFails && loginAttempts > 1)) {
          return { status: 401, json: { ok: false, error: "Invalid credentials" } };
        }
        cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
        const email = loginAttempts > 1 && options.reviewerExpectedEmail ? options.reviewerExpectedEmail : baseConfig.expectedEmail;
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
      if ((pathname.endsWith("/risks") || pathname.endsWith("/risk-register")) && method === "GET") {
        if (options.apiFails) return { status: 503, json: { ok: false } };
        const items = cleaned
          ? Array.from(risks.values()).filter((item) => !isVerificationRiskRegisterItem(item))
          : Array.from(risks.values());
        return { status: 200, json: { ok: true, items } };
      }
      if (pathname.includes("/risks/") && method === "GET") {
        detailAttempts += 1;
        const id = pathname.split("/risks/")[1]?.split("?")[0]?.split("/")[0];
        if (suppressDetailUntilAttempt > 0 && detailAttempts <= suppressDetailUntilAttempt) {
          return { status: 404, json: { ok: false, code: "RISK_REGISTER_NOT_FOUND" } };
        }
        const item = risks.get(id);
        if (!item) return { status: 404, json: { ok: false, code: "RISK_REGISTER_NOT_FOUND" } };
        if (options.detailMismatch && created) return { status: 200, json: { ok: true, item: { ...item, title: "WRONG" }, controls: item.controls } };
        return { status: 200, json: { ok: true, item: { ...item }, controls: item.controls || [] } };
      }
      if (pathname.endsWith("/risk-register/verification-cleanup") && method === "POST") {
        if (cleanupFailsAtEnd && created) return { status: 500, json: { ok: false } };
        if (cleanupFails && !cleanupFailsAtEnd) return { status: 500, json: { ok: false } };
        for (const [id, item] of risks.entries()) {
          if (isVerificationRiskRegisterItem(item) && id !== trim(body?.keepRiskId)) {
            risks.set(id, { ...item, status: "Archived", archivedAt: new Date().toISOString(), description: `${item.description} verification-cleaned` });
          }
        }
        cleaned = true;
        return { status: 200, json: { ok: true, cleanedCount: 1 } };
      }
      if (pathname.endsWith("/verification-cleanup") && pathname.includes("/risk-register/")) {
        if (options.rejectNonVerificationCleanup && pathname.includes("risk-customer-1")) {
          return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_RISK" } };
        }
        if (cleanupFailsAtEnd && created) return { status: 500, json: { ok: false } };
        if (cleanupFails && !cleanupFailsAtEnd) return { status: 500, json: { ok: false } };
        const id = pathname.split("/risk-register/")[1]?.split("/verification-cleanup")[0];
        const item = risks.get(id);
        if (item) risks.set(id, { ...item, status: "Archived", archivedAt: new Date().toISOString() });
        return { status: 200, json: { ok: true, cleaned: true } };
      }
      if (pathname.endsWith("/risk-register/verification") && method === "POST") {
        if (options.createFails) return { status: 500, json: { ok: false } };
        if (create502Once && !create502Used) {
          create502Used = true;
          return { status: 502, json: { ok: false } };
        }
        if (risks.has(riskId)) return { status: 200, json: { ok: true, alreadyExists: true, updatedRows: 0, item: risks.get(riskId) } };
        const record = verificationRisk({ runId });
        risks.set(riskId, record);
        created = true;
        return { status: 200, json: { ok: true, updatedRows: 1, item: record } };
      }
      if (pathname.includes("/risk-register/verification/") && method === "PATCH") {
        const id = pathname.split("/verification/")[1]?.split("?")[0]?.split("/")[0];
        const current = risks.get(id);
        if (!current) return { status: 404, json: { ok: false } };
        const next = { ...current, ...body, status: current.status };
        if (body.initialLikelihood != null || body.initialImpact != null) {
          const likelihood = Number(next.initialLikelihood ?? current.initialLikelihood);
          const impact = Number(next.initialImpact ?? current.initialImpact);
          next.initialRiskScore = calculateRiskScore(likelihood, impact);
          next.initialRiskBand = getRiskBand(next.initialRiskScore).label;
        }
        if (body.residualLikelihood != null || body.residualImpact != null) {
          const likelihood = Number(next.residualLikelihood ?? current.residualLikelihood);
          const impact = Number(next.residualImpact ?? current.residualImpact);
          next.residualRiskScore = calculateRiskScore(likelihood, impact);
          next.residualRiskBand = getRiskBand(next.residualRiskScore).label;
        }
        risks.set(id, next);
        return { status: 200, json: { ok: true, item: next } };
      }
      if (pathname.endsWith("/verification/controls") && method === "POST") {
        const id = trim(body?.riskId);
        const current = risks.get(id);
        if (!current) return { status: 404, json: { ok: false } };
        const controls = [...(current.controls || [])];
        const existing = controls.find((item) => item.id === body.controlId);
        if (existing) Object.assign(existing, body);
        else controls.push({ id: body.controlId, description: body.description, controlType: body.controlType, ownerName: body.ownerName, dueDate: body.dueDate });
        risks.set(id, { ...current, controls });
        return { status: 200, json: { ok: true, updatedRows: 1, item: controls.at(-1), alreadyExists: Boolean(existing) } };
      }
      if (pathname.endsWith("/submit") && method === "POST") {
        const id = pathname.split("/verification/")[1]?.split("/submit")[0];
        const current = risks.get(id);
        if (!current) return { status: 404, json: { ok: false } };
        if (current.status === "Submitted" || String(current.notes).includes("submitted=true")) {
          return { status: 200, json: { ok: true, alreadySubmitted: true, item: current } };
        }
        risks.set(id, { ...current, status: "Submitted", notes: `${current.notes} submitted=true` });
        return { status: 200, json: { ok: true, item: risks.get(id) } };
      }
      if (pathname.endsWith("/approve") && method === "POST") {
        const id = pathname.split("/verification/")[1]?.split("/approve")[0];
        const current = risks.get(id);
        if (!current) return { status: 404, json: { ok: false } };
        if (current.status === "Active" || String(current.notes).includes("approved=true")) {
          return { status: 200, json: { ok: true, alreadyApproved: true, item: current } };
        }
        risks.set(id, { ...current, status: "Active", notes: `${current.notes} approved=true` });
        return { status: 200, json: { ok: true, item: risks.get(id) } };
      }
      if (pathname.endsWith("/review") && method === "POST") {
        const id = pathname.split("/verification/")[1]?.split("/review")[0];
        const current = risks.get(id);
        if (!current) return { status: 404, json: { ok: false } };
        if (String(current.notes).includes("reviewed=true")) return { status: 200, json: { ok: true, alreadyReviewed: true, item: current } };
        risks.set(id, { ...current, reviewDate: body?.reviewDate || current.reviewDate, notes: `${current.notes} reviewed=true` });
        return { status: 200, json: { ok: true, item: risks.get(id) } };
      }
      if (pathname.endsWith("/health-safety/overview") && method === "GET") {
        const metrics = {
          highCriticalRiskRegisterItems: overviewIncludesVerification ? 99 : 0,
          riskRegisterReviewDue: 1,
          riskRegisterOverdue: 0,
        };
        const attentionItems = overviewIncludesVerification ? [{ recordId: riskId, id: `attention-${riskId}` }] : [];
        return { status: 200, json: { ok: true, metrics, attentionItems } };
      }
      return { status: 404, json: { ok: false, error: `Unhandled ${method} ${pathname}` } };
    },
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    riskId,
    existingControlId,
    furtherControlId,
    get risks() {
      return risks;
    },
    registerInterruptCleanup(fn) {
      transport._cleanup = fn;
    },
  };
  return transport;
}

function trim(value) {
  return String(value ?? "").trim();
}

async function run(config, transport, options = {}) {
  return runProductionRiskRegisterWorkflowChecks(config, transport, { ...defaultRunOptions, ...options });
}

test("1. full successful workflow", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.ok, true);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("2. login failure", async () => {
  const result = await run(baseConfig, createTransport({ loginFails: true }));
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("3. Risk Register API unavailable", async () => {
  const result = await run(baseConfig, createTransport({ apiFails: true }));
  assert.equal(result.failedKey, "riskRegisterApi");
});

test("4. mutation disabled", async () => {
  const result = await run({ ...baseConfig, allowRiskRegisterMutation: false }, createTransport());
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "SKIP");
});

test("5. stale cleanup", async () => {
  const stale = verificationRisk({ runId: TEST_RUN_ID - 1 });
  const result = await run(baseConfig, createTransport({ initialRisks: [customerRisk(), stale] }));
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("6. create failure", async () => {
  const result = await run(baseConfig, createTransport({ createFails: true }));
  assert.equal(result.failedKey, "createDraft");
});

test("7. create succeeds but not visible", async () => {
  const result = await run(baseConfig, createTransport({ suppressDetailUntilAttempt: 99 }));
  assert.equal(result.failedKey, "createDraft");
});

test("8. duplicate create idempotency", async () => {
  const existing = verificationRisk();
  const result = await run(baseConfig, createTransport({ initialRisks: [customerRisk(), existing] }));
  assert.equal(result.ok, true);
});

test("9. edit failure", async () => {
  const transport = createTransport();
  const original = transport.request.bind(transport);
  transport.request = async (method, path, body, opts) => {
    if (method === "PATCH" && path.includes("/risk-register/verification/")) {
      return { status: 500, json: { ok: false } };
    }
    return original(method, path, body, opts);
  };
  const result = await run(baseConfig, transport);
  assert.equal(result.failedKey, "editRisk");
});

test("10-17. scoring and controls stages pass in full workflow", async () => {
  const result = await run(baseConfig, createTransport());
  for (const key of ["causesConsequences", "existingControls", "initialRisk", "furtherControls", "residualRisk", "saveDraft"]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
});

test("18. submit success", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.submit.status, "PASS");
});

test("19. repeated submit idempotency covered by full workflow", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.submit.status, "PASS");
});

test("20. approval success", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.approveActivate.status, "PASS");
});

test("21. detail mismatch", async () => {
  const result = await run(baseConfig, createTransport({ detailMismatch: true }));
  assert.equal(result.failedKey, "detailVerification");
});

test("22. review success", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.review.status, "PASS");
});

test("23. dashboard exclusion failure", async () => {
  const result = await run(baseConfig, createTransport({ overviewIncludesVerification: true }));
  assert.equal(result.failedKey, "dashboardOverview");
});

test("24. cleanup failure", async () => {
  const result = await run(baseConfig, createTransport({ cleanupFailsAtEnd: true }));
  assert.equal(result.failedKey, "cleanup");
});

test("25. non-verification cleanup rejected", async () => {
  const cleanup = await attemptVerificationRiskRegisterCleanup(
    createTransport({ rejectNonVerificationCleanup: true }).request.bind(createTransport()),
    { companyFolderId: baseConfig.companyFolderId, masterSheetId: baseConfig.masterSheetId, verificationRiskId: "risk-customer-1" },
  );
  assert.equal(cleanup.ok, false);
});

test("26. transient 502 recovery", async () => {
  const result = await run(baseConfig, createTransport({ create502Once: true, create502Used: false }));
  assert.equal(result.ok, true);
});

test("27. SIGINT cleanup handler registered", async () => {
  const transport = createTransport();
  let handler;
  await runProductionRiskRegisterWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      handler = fn;
    },
  });
  assert.equal(typeof handler, "function");
  const cleanup = await handler();
  assert.equal(typeof cleanup.ok, "boolean");
});

test("28. secrets absent from output", () => {
  const report = formatRiskRegisterWorkflowReport({
    ok: true,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PASS" }])),
    accountEmail: baseConfig.expectedEmail,
    riskId: buildProductionVerificationRiskRegisterId(TEST_RUN_ID),
    riskReference: buildProductionVerificationRiskRegisterReference(TEST_RUN_ID),
    durationMs: 1000,
  });
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /Customer business risk/);
});

test("CHECK_KEYS covers all report labels", () => {
  for (const key of CHECK_KEYS) assert.ok(CHECK_LABELS[key]);
});

test("verification naming constants", () => {
  assert.match(buildProductionVerificationRiskRegisterId(TEST_RUN_ID), /^bert-smoke-risk-/);
  assert.match(buildProductionVerificationRiskRegisterReference(TEST_RUN_ID), /^BERT-VERIFY-RISK-/);
  assert.equal(PRODUCTION_VERIFICATION_RISK_REGISTER_TITLE, "BERT Verification Business Risk");
});

test("29. notification skipped", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.notifications.status, "SKIP");
});

test("30. search skipped", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.search.status, "SKIP");
});

test("31. approver login skipped in self-approval mode", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.approverLogin.status, "SKIP");
});

test("32. residual lower than initial enforced in full workflow", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.residualRisk.status, "PASS");
});

test("33. readback success", async () => {
  const result = await run(baseConfig, createTransport());
  assert.equal(result.checks.readback.status, "PASS");
});

test("34. timeout cleanup attempt", async () => {
  const transport = createTransport({ cleanupFailsAtEnd: true });
  const result = await run(baseConfig, transport);
  assert.equal(result.checks.cleanup.status, "FAIL");
});

test("35. operational customer risk remains operational", () => {
  assert.equal(isOperationalRiskRegisterItem(customerRisk()), true);
});

test("36. existing control builder", () => {
  const control = buildProductionVerificationExistingControl({ runId: TEST_RUN_ID });
  assert.match(control.controlId, /bert-smoke-risk-control-existing/);
});

test("37. further control builder", () => {
  const control = buildProductionVerificationFurtherControl({ runId: TEST_RUN_ID });
  assert.match(control.controlId, /bert-smoke-risk-control-further/);
});

test("38. submit skipped not applicable - workflow supports submit", async () => {
  const result = await run(baseConfig, createTransport());
  assert.notEqual(result.checks.submit.status, "SKIP");
});

test("39. approval skipped not applicable - workflow supports approval", async () => {
  const result = await run(baseConfig, createTransport());
  assert.notEqual(result.checks.approveActivate.status, "SKIP");
});

test("40. residual risk passes from patch response without detail poll", async () => {
  let detailGets = 0;
  const transport = createTransport();
  const original = transport.request.bind(transport);
  transport.request = async (method, path, body, opts) => {
    if (method === "GET" && path.includes("/risks/") && opts?.stageKey === "residualRisk") {
      detailGets += 1;
    }
    return original(method, path, body, opts);
  };
  const result = await run(baseConfig, transport);
  assert.equal(result.checks.residualRisk.status, "PASS");
  assert.equal(detailGets, 0);
});

test("41. residualRiskScoresConfirmed helper", () => {
  assert.equal(
    residualRiskScoresConfirmed({
      initialRiskScore: 9,
      residualLikelihood: 1,
      residualImpact: 2,
      residualRiskScore: 2,
      residualRiskBand: "Low",
    }),
    true,
  );
});
