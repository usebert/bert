#!/usr/bin/env node
/**
 * Unit tests for production LOLER workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  attemptVerificationLolerCleanup,
  formatLolerWorkflowReport,
  loadLolerWorkflowConfig,
  runProductionLolerWorkflowChecks,
} from "./lib/production-loler-workflow-core.mjs";
import {
  buildProductionVerificationLolerAssetId,
  buildProductionVerificationLolerEquipment,
  buildProductionVerificationLolerEquipmentId,
  buildProductionVerificationLolerExamId,
  buildProductionVerificationLolerFailExamId,
  countLolerBaselines,
  isOperationalLolerEquipment,
  isVerificationLolerEquipment,
  PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_NAME,
  PRODUCTION_VERIFICATION_LOLER_SOURCE,
} from "../shared/production-verification-loler.mjs";
import { calculateNextExaminationDueDate } from "../shared/loler.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";

const baseConfig = loadLolerWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_LOLER_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const TODAY = getUkTodayKey();
const defaultRunOptions = { runId: TEST_RUN_ID, listPollMaxAttempts: 3, listPollIntervalMs: 0 };

function trim(value) {
  return String(value ?? "").trim();
}

function customerEquipment() {
  return {
    id: "LOL-CUSTOMER-1",
    assetId: "HOIST-001",
    equipmentName: "Main hoist",
    equipmentType: "Hoist",
    status: "active",
    examinationIntervalMonths: 12,
    lastExaminationDate: "2026-01-01",
    nextExaminationDueDate: "2027-01-01",
    siteName: "Factory",
    ownerDepartment: "Production",
  };
}

function verificationEquipmentRecord(options = {}) {
  const equipment = buildProductionVerificationLolerEquipment({
    runId: options.runId ?? TEST_RUN_ID,
    companyFolderId: baseConfig.companyFolderId,
    assignedEmail: baseConfig.expectedEmail,
    todayKey: TODAY,
    ...options,
  });
  return {
    id: equipment.equipmentId,
    assetId: equipment.assetId,
    equipmentName: equipment.equipmentName,
    equipmentType: equipment.equipmentType,
    manufacturer: equipment.manufacturer,
    model: equipment.model,
    serialNumber: equipment.serialNumber,
    status: equipment.status,
    examinationIntervalMonths: equipment.examinationIntervalMonths,
    lastExaminationDate: equipment.lastExaminationDate,
    nextExaminationDueDate: equipment.nextExaminationDueDate,
    siteName: equipment.siteName,
    ownerDepartment: equipment.ownerDepartment,
    notes: equipment.notes,
    assignedPersonId: equipment.assignedPersonId,
    assignedPersonName: equipment.assignedPersonName,
  };
}

function openScheduleFor(equipmentId, dueDate = TODAY) {
  return {
    lolerScheduleId: `LSC-TEST-${equipmentId}`,
    equipmentId,
    dueDate,
    scheduleStatus: "due_soon",
  };
}

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const verificationEquipmentId = buildProductionVerificationLolerEquipmentId(runId);
  const verificationAssetId = buildProductionVerificationLolerAssetId(runId);
  const verificationExamId = buildProductionVerificationLolerExamId(runId);
  const verificationFailExamId = buildProductionVerificationLolerFailExamId(runId);
  const companyBase = `/api/companies/${baseConfig.companyFolderId}`;

  let equipmentStore = new Map(
    (options.initialEquipment || [customerEquipment()]).map((item) => [item.id, { ...item }]),
  );
  let schedules = [...(options.initialSchedules || [])];
  let examinations = [...(options.initialExaminations || [])];
  let cleaned = false;
  let equipmentOutOfService = false;
  let passRecorded = false;
  let failRecorded = false;
  let createAttempts = 0;
  let create502Once = options.create502Once === true;
  let create502Used = false;
  let suppressDetailUntilAttempt = options.suppressDetailUntilAttempt || 0;
  let detailAttempts = 0;
  let dueMismatch = options.dueMismatch === true;
  let overviewIncludesVerification = options.overviewIncludesVerification === true;
  let dashboardOperationalInflated = options.dashboardOperationalInflated === true;
  let mutationCreated = false;
  let cleanupFails = options.cleanupFails === true;
  let cleanupFailsAtEnd = options.cleanupFailsAtEnd === true;
  let interruptCleanupHandler = null;
  let baselineMetrics = {
    equipmentInspectionsOverdue: 0,
    equipmentInspectionsDueSoon: 1,
    equipmentOutOfService: 0,
  };

  function equipmentList() {
    if (cleaned) {
      return Array.from(equipmentStore.values()).filter((item) => !isVerificationLolerEquipment(item));
    }
    return Array.from(equipmentStore.values());
  }

  function operationalSummary() {
    const operational = equipmentList().filter((item) => isOperationalLolerEquipment(item));
    return {
      overdue: operational.filter((item) => item.nextExaminationDueDate < TODAY).length,
      dueSoon: operational.filter((item) => item.nextExaminationDueDate === TODAY).length,
      outOfService: operational.filter((item) => item.status === "out_of_service").length,
      totalActive: operational.filter((item) => item.status === "active").length,
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
        if (options.loginFails) {
          return { status: 401, json: { ok: false, error: "Invalid credentials" } };
        }
        cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
        return {
          status: 200,
          json: successLoginJson(),
        };
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

      if (pathname.endsWith("/loler/equipment") && method === "GET" && !pathname.includes("/loler/equipment/")) {
        if (options.lolerApiFails) {
          return { status: 503, json: { ok: false, error: "Unavailable" } };
        }
        const equipment = equipmentList();
        const summary = operationalSummary();
        if (dashboardOperationalInflated && mutationCreated) {
          const customer = equipmentStore.get("LOL-CUSTOMER-1");
          if (customer) {
            equipmentStore.set("LOL-CUSTOMER-1", {
              ...customer,
              nextExaminationDueDate: "2000-01-01",
            });
          }
          equipmentStore.set("LOL-CUSTOMER-2", {
            ...customerEquipment(),
            id: "LOL-CUSTOMER-2",
            assetId: "HOIST-002",
            nextExaminationDueDate: "2000-01-02",
          });
          return { status: 200, json: { ok: true, equipment: equipmentList(), summary: operationalSummary() } };
        }
        return { status: 200, json: { ok: true, equipment, summary } };
      }

      if (pathname.includes("/loler/equipment/") && method === "GET") {
        detailAttempts += 1;
        const equipmentId = pathname.split("/").at(-1).split("?")[0];
        if (suppressDetailUntilAttempt > 0 && detailAttempts <= suppressDetailUntilAttempt) {
          return { status: 404, json: { ok: false, code: "LOLER_EQUIPMENT_NOT_FOUND" } };
        }
        const item = equipmentStore.get(equipmentId);
        if (!item) {
          return { status: 404, json: { ok: false, code: "LOLER_EQUIPMENT_NOT_FOUND" } };
        }
        return { status: 200, json: { ok: true, equipment: { ...item } } };
      }

      if (pathname.endsWith("/loler/schedules") && method === "GET") {
        if (options.lolerApiFails) {
          return { status: 503, json: { ok: false } };
        }
        const list = schedules.filter((item) => equipmentStore.has(item.equipmentId));
        return { status: 200, json: { ok: true, schedules: list } };
      }

      if (pathname.endsWith("/loler/examinations") && method === "GET") {
        if (options.lolerApiFails) {
          return { status: 503, json: { ok: false } };
        }
        const equipmentId = url.searchParams.get("equipmentId");
        const list = examinations.filter((item) => !equipmentId || item.equipmentId === equipmentId);
        return { status: 200, json: { ok: true, examinations: list } };
      }

      if (pathname.endsWith("/health-safety/overview") && method === "GET") {
        const attentionItems = overviewIncludesVerification
          ? [{ id: `attention-equipment-overdue-${verificationEquipmentId}`, recordId: verificationEquipmentId, type: "equipment_overdue" }]
          : [];
        const metrics = { ...baselineMetrics };
        if (overviewIncludesVerification) {
          metrics.equipmentInspectionsOverdue = 99;
        }
        return { status: 200, json: { ok: true, metrics, attentionItems, incidents: [] } };
      }

      if (pathname.endsWith("/loler/verification-cleanup") && method === "POST") {
        if (cleanupFailsAtEnd && mutationCreated) {
          return { status: 500, json: { ok: false, code: "LOLER_CLEANUP_FAILED" } };
        }
        if (cleanupFails && !cleanupFailsAtEnd) {
          return { status: 500, json: { ok: false, code: "LOLER_CLEANUP_FAILED" } };
        }
        const keepId = trim(body?.keepEquipmentId);
        for (const [id, item] of equipmentStore.entries()) {
          if (isVerificationLolerEquipment(item) && id !== keepId) {
            equipmentStore.delete(id);
          }
        }
        schedules = schedules.filter((item) => {
          if (!isVerificationLolerEquipment({ id: item.equipmentId })) {
            return true;
          }
          return trim(item.equipmentId) === keepId;
        });
        examinations = examinations.filter((item) => {
          if (!isVerificationLolerEquipment({ id: item.equipmentId })) {
            return true;
          }
          return trim(item.equipmentId) === keepId;
        });
        return { status: 200, json: { ok: true, cleanedCount: 1 } };
      }

      if (pathname.endsWith("/verification-cleanup") && method === "POST" && pathname.includes("/loler/equipment/")) {
        const equipmentId = pathname.split("/").at(-2);
        if (options.rejectNonVerificationCleanup !== false && equipmentId === "LOL-CUSTOMER-1") {
          return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_LOLER" } };
        }
        if (cleanupFailsAtEnd && mutationCreated) {
          return { status: 500, json: { ok: false } };
        }
        if (cleanupFails && !cleanupFailsAtEnd) {
          return { status: 500, json: { ok: false } };
        }
        equipmentStore.delete(equipmentId);
        cleaned = true;
        return { status: 200, json: { ok: true, cleaned: true, equipmentId, updatedRows: 1 } };
      }

      if (pathname.endsWith("/loler/verification/equipment") && method === "POST") {
        createAttempts += 1;
        if (options.createFails) {
          return { status: 400, json: { ok: false, code: "LOLER_VALIDATION_FAILED" } };
        }
        if (create502Once && !create502Used) {
          create502Used = true;
          return { status: 502, json: { ok: false, error: "Bad gateway" } };
        }
        if (options.duplicateCreate && equipmentStore.has(verificationEquipmentId)) {
          mutationCreated = true;
          return { status: 200, json: { ok: true, alreadyExists: true, updatedRows: 0, equipmentId: verificationEquipmentId } };
        }
        const record = verificationEquipmentRecord({ runId });
        if (dueMismatch) {
          record.nextExaminationDueDate = "2099-01-01";
        }
        equipmentStore.set(verificationEquipmentId, record);
        schedules.push(openScheduleFor(verificationEquipmentId, record.nextExaminationDueDate));
        mutationCreated = true;
        return { status: 200, json: { ok: true, equipment: record, equipmentId: verificationEquipmentId, updatedRows: 1 } };
      }

      if (pathname.includes("/loler/verification/equipment/") && method === "PATCH") {
        if (options.editFails) {
          return { status: 500, json: { ok: false } };
        }
        const equipmentId = pathname.split("/").at(-1).split("?")[0];
        const current = equipmentStore.get(equipmentId);
        if (!current) {
          return { status: 404, json: { ok: false } };
        }
        equipmentStore.set(equipmentId, {
          ...current,
          siteName: body?.siteName || current.siteName,
          ownerDepartment: body?.ownerDepartment || current.ownerDepartment,
          model: body?.model || current.model,
        });
        return { status: 200, json: { ok: true, equipment: equipmentStore.get(equipmentId), updatedRows: 1 } };
      }

      if (pathname.endsWith("/loler/verification/examinations/pass") && method === "POST") {
        if (options.examCreateFails) {
          return { status: 400, json: { ok: false } };
        }
        const examDate = trim(body?.examinationDate) || TODAY;
        const equipment = equipmentStore.get(verificationEquipmentId);
        const nextDue =
          trim(body?.nextExaminationDueDate) ||
          calculateNextExaminationDueDate({
            lastExaminationDate: examDate,
            examinationIntervalMonths: equipment?.examinationIntervalMonths || 6,
          });
        if (!passRecorded) {
          examinations.push({
            examinationId: verificationExamId,
            equipmentId: verificationEquipmentId,
            examinationDate: examDate,
            examinationResult: "passed",
            nextExaminationDueDate: nextDue,
            observations: body?.observations,
          });
          if (options.examNotLinked) {
            examinations[examinations.length - 1].equipmentId = "LOL-OTHER";
          }
          if (options.statusChangesAfterPass) {
            equipmentStore.set(verificationEquipmentId, { ...equipment, status: "out_of_service" });
          } else {
            equipmentStore.set(verificationEquipmentId, {
              ...equipment,
              lastExaminationDate: examDate,
              nextExaminationDueDate: options.nextDueMismatch ? "2099-01-01" : nextDue,
              status: "active",
            });
          }
          schedules = schedules.map((item) =>
            item.equipmentId === verificationEquipmentId ? { ...item, scheduleStatus: "completed" } : item,
          );
          schedules.push(openScheduleFor(verificationEquipmentId, options.nextDueMismatch ? "2099-01-01" : nextDue));
          passRecorded = true;
        }
        if (options.passIdempotent) {
          return { status: 200, json: { ok: true, examinationId: verificationExamId, alreadyCompleted: true, updatedRows: 0 } };
        }
        return { status: 200, json: { ok: true, examinationId: verificationExamId, updatedRows: 1 } };
      }

      if (pathname.endsWith("/loler/verification/examinations/fail") && method === "POST") {
        if (options.skipFail) {
          return { status: 409, json: { ok: false } };
        }
        const equipment = equipmentStore.get(verificationEquipmentId);
        examinations.push({
          examinationId: verificationFailExamId,
          equipmentId: verificationEquipmentId,
          examinationDate: TODAY,
          examinationResult: "failed",
        });
        equipmentStore.set(verificationEquipmentId, { ...equipment, status: "out_of_service" });
        failRecorded = true;
        return { status: 200, json: { ok: true, examinationId: verificationFailExamId, updatedRows: 1 } };
      }

      if (pathname.endsWith("/verification-restore") && method === "POST") {
        if (options.skipRestore) {
          return { status: 409, json: { ok: false } };
        }
        const equipment = equipmentStore.get(verificationEquipmentId);
        equipmentStore.set(verificationEquipmentId, { ...equipment, status: "active" });
        return { status: 200, json: { ok: true, equipment: equipmentStore.get(verificationEquipmentId), updatedRows: 1 } };
      }

      return { status: 404, json: { ok: false, error: `Unhandled ${method} ${pathname}` } };
    },
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    registerInterruptCleanup(fn) {
      interruptCleanupHandler = fn;
    },
    get verificationEquipmentId() {
      return verificationEquipmentId;
    },
    get verificationAssetId() {
      return verificationAssetId;
    },
    get verificationExamId() {
      return verificationExamId;
    },
    triggerInterruptCleanup() {
      return interruptCleanupHandler?.();
    },
    get equipmentStore() {
      return equipmentStore;
    },
  };

  return transport;
}

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

function successConfig(overrides = {}) {
  return { ...baseConfig, ...overrides };
}

test("1. full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.authentication.status, "PASS");
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.equal(result.checks.notifications.status, "SKIP");
  assert.equal(result.checks.search.status, "SKIP");
});

test("2. login failure", async () => {
  const transport = createTransport({ loginFails: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("3. LOLER API unavailable", async () => {
  const transport = createTransport({ lolerApiFails: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "lolerApi");
});

test("4. mutation disabled", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(
    successConfig({ allowLolerMutation: false }),
    transport,
    defaultRunOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.createEquipment.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("5. stale cleanup", async () => {
  const stale = verificationEquipmentRecord({ runId: TEST_RUN_ID - 1 });
  const transport = createTransport({
    initialEquipment: [customerEquipment(), stale],
    initialSchedules: [openScheduleFor(stale.id)],
  });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("6. equipment create failure", async () => {
  const transport = createTransport({ createFails: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createEquipment");
});

test("7. create succeeds but equipment not visible", async () => {
  const transport = createTransport({ suppressDetailUntilAttempt: 99 });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, { ...defaultRunOptions, listPollMaxAttempts: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "readback");
});

test("8. duplicate equipment create idempotency", async () => {
  const existing = verificationEquipmentRecord();
  const transport = createTransport({
    initialEquipment: [customerEquipment(), existing],
    initialSchedules: [openScheduleFor(existing.id)],
    duplicateCreate: true,
  });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createEquipment.status, "PASS");
});

test("9. edit failure", async () => {
  const transport = createTransport({ editFails: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editEquipment");
});

test("10. due calculation mismatch", async () => {
  const transport = createTransport({ dueMismatch: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dueCalculation");
});

test("11. examination create failure", async () => {
  const transport = createTransport({ examCreateFails: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "recordPass");
});

test("12. examination not linked to equipment", async () => {
  const transport = createTransport({ examNotLinked: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "passVerification");
});

test("13. PASS completion success", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.recordPass.status, "PASS");
});

test("14. PASS completion idempotency", async () => {
  const transport = createTransport({ passIdempotent: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.recordPass.status, "PASS");
  assert.equal(result.checks.passVerification.status, "PASS");
});

test("15. next due date mismatch", async () => {
  const transport = createTransport({ nextDueMismatch: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "passVerification");
});

test("16. equipment status changes unexpectedly after PASS", async () => {
  const transport = createTransport({ statusChangesAfterPass: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "passVerification");
});

test("17. defect/fail success", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.defectFail.status, "PASS");
});

test("18. defect/fail skipped", async () => {
  const transport = createTransport({ skipFail: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.defectFail.status, "SKIP");
});

test("19. restore success", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.restoreEquipment.status, "PASS");
});

test("20. restore skipped", async () => {
  const transport = createTransport({ skipFail: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.restoreEquipment.status, "SKIP");
});

test("21. H&S overview exclusion failure", async () => {
  const transport = createTransport({ overviewIncludesVerification: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "healthSafetyOverview");
});

test("22. dashboard exclusion failure", async () => {
  const transport = createTransport({ dashboardOperationalInflated: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("23. notification skipped", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.notifications.status, "SKIP");
});

test("24. search skipped", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.search.status, "SKIP");
});

test("25. cleanup success", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("26. cleanup failure", async () => {
  const transport = createTransport({ cleanupFailsAtEnd: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("27. non-verification cleanup rejected", async () => {
  const transport = createTransport();
  const cleanup = await attemptVerificationLolerCleanup(transport.request.bind(transport), {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationEquipmentId: "LOL-CUSTOMER-1",
  });
  assert.equal(cleanup.ok, false);
});

test("28. transient 502 recovery", async () => {
  const transport = createTransport({ create502Once: true });
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createEquipment.status, "PASS");
});

test("29. timeout cleanup attempt", async () => {
  const transport = createTransport({ cleanupFails: true, createFails: true });
  await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  const cleanup = await attemptVerificationLolerCleanup(transport.request.bind(transport), {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationEquipmentId: buildProductionVerificationLolerEquipmentId(TEST_RUN_ID),
  });
  assert.equal(cleanup.ok, false);
});

test("30. SIGINT/SIGTERM cleanup", async () => {
  const transport = createTransport();
  let registered = null;
  await runProductionLolerWorkflowChecks(successConfig(), transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registered = fn;
    },
  });
  assert.equal(typeof registered, "function");
  const cleanup = await registered();
  assert.equal(cleanup.ok, true);
});

test("31. secrets/customer equipment absent from output", async () => {
  const transport = createTransport();
  const result = await runProductionLolerWorkflowChecks(successConfig(), transport, defaultRunOptions);
  const report = formatLolerWorkflowReport(result);
  assert.ok(!report.includes("secret-password"));
  assert.ok(!report.includes("HOIST-001"));
  assert.ok(!report.includes("Main hoist"));
  assert.equal(isOperationalLolerEquipment(customerEquipment()), true);
  assert.equal(isVerificationLolerEquipment(verificationEquipmentRecord()), true);
  const baseline = countLolerBaselines([customerEquipment(), verificationEquipmentRecord()], [], [], TODAY);
  assert.equal(baseline.operationalCount, 1);
  assert.equal(baseline.verificationCount, 1);
});

test("CHECK_KEYS covers all report labels", () => {
  assert.equal(CHECK_KEYS.length, 18);
  for (const key of CHECK_KEYS) {
    assert.ok(key.length > 0);
  }
});

test("verification equipment naming constants", () => {
  assert.equal(PRODUCTION_VERIFICATION_LOLER_EQUIPMENT_NAME, "BERT Verification Lifting Accessory");
  assert.equal(PRODUCTION_VERIFICATION_LOLER_SOURCE, "production-loler-workflow");
});
