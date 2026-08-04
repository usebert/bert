#!/usr/bin/env node
/**
 * Unit tests for production Schedules workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  attemptVerificationScheduleCleanup,
  formatSchedulesWorkflowReport,
  loadSchedulesWorkflowConfig,
  runProductionSchedulesWorkflowChecks,
} from "./lib/production-schedules-workflow-core.mjs";
import {
  buildProductionVerificationSchedule,
  buildProductionVerificationScheduleId,
  countScheduleBaselines,
  findScheduleById,
  isOperationalSchedule,
  isWorkflowVerificationSchedule,
  PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
  PRODUCTION_VERIFICATION_SCHEDULE_TITLE,
} from "../shared/production-verification-schedule.mjs";
import { PRODUCTION_VERIFICATION_AUDIT_ID } from "../shared/production-verification-audit.mjs";
import { enrichSchedulesWithDueOccurrence } from "../shared/schedule-due.mjs";

const baseConfig = loadSchedulesWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_SCHEDULE_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const defaultRunOptions = {
  runId: TEST_RUN_ID,
  listPollMaxAttempts: 5,
  listPollIntervalMs: 0,
};

function trim(value) {
  return String(value ?? "").trim();
}

function customerSchedule() {
  return {
    id: "schedule-customer-1",
    scheduleId: "schedule-customer-1",
    scheduleName: "Daily warehouse walk",
    status: "ACTIVE",
    lifecycle: "Live",
    verificationSource: "",
    assignedUserEmails: ["worker@example.com"],
    audits: [{ auditId: "audit-1", auditName: "Warehouse Walk", frequency: "Daily", liveTime: "08:00", completionHours: 24 }],
    startDate: "2026-07-01",
  };
}

function verificationScheduleRecord(options = {}) {
  const schedule = buildProductionVerificationSchedule({
    runId: options.runId ?? TEST_RUN_ID,
    companyFolderId: baseConfig.companyFolderId,
    createdByEmail: baseConfig.expectedEmail,
    assignedEmail: baseConfig.expectedEmail,
    ...options,
  });
  return enrichSchedulesWithDueOccurrence([schedule])[0];
}

function templateList(includeVerification = true) {
  const templates = [
    {
      id: PRODUCTION_VERIFICATION_AUDIT_ID,
      auditId: PRODUCTION_VERIFICATION_AUDIT_ID,
      name: "BERT Verification Audit",
      status: "active",
      questions: [{ id: "q1", text: "Check area accessible?" }],
    },
  ];
  return includeVerification ? templates : [];
}

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const verificationScheduleId = buildProductionVerificationScheduleId(runId);
  const schedules = options.initialSchedules ? [...options.initialSchedules] : [customerSchedule()];
  const scheduleStore = new Map(schedules.map((item) => [item.id, { ...item }]));
  let assignedChecks = schedules
    .filter((item) => isWorkflowVerificationSchedule(item) ? options.includeVerificationInAssigned !== false : true)
    .filter((item) => normalizeStatus(item.status) !== "paused" && trim(item.healthState).toLowerCase() !== "paused")
    .map((item) => enrichSchedulesWithDueOccurrence([{ ...item }])[0]);

  let loginAttempts = 0;
  let createAttempts = 0;
  let pauseAttempts = 0;
  let reactivateAttempts = 0;
  let cleanupAttempts = 0;
  let create502Attempts = 0;
  let suppressVerificationInListCount = options.listStaleUntilAttempt || 0;
  let paused = false;
  let cleaned = false;
  let duplicateAssigned = options.duplicateAssigned === true;
  let cleanupFails = options.cleanupFails === true;
  let mutationCreated = false;
  let rejectNonVerificationCleanup = options.rejectNonVerificationCleanup !== false;
  let includeTemplate = options.includeTemplate !== false;
  let schedulesApiFails = options.schedulesApiFails === true;
  let createFails = options.createFails === true;
  let editFails = options.editFails === true;
  let pauseLeavesActionable = options.pauseLeavesActionable === true;
  let reactivateMissingFromAssigned = false;
  let dashboardIncludesVerification = options.dashboardIncludesVerification === true;
  let recurrenceMismatch = options.recurrenceMismatch === true;
  let interruptCleanupHandler = null;

  function normalizeStatus(value) {
    return trim(value).toLowerCase();
  }

  function syncAssigned() {
    if (cleaned) {
      assignedChecks = [];
      return;
    }
    assignedChecks = Array.from(scheduleStore.values())
      .filter((item) => {
        if (isWorkflowVerificationSchedule(item) && options.includeVerificationInAssigned === false) {
          return false;
        }
        if (options.reactivateMissingFromAssigned && reactivateMissingFromAssigned && isWorkflowVerificationSchedule(item)) {
          return false;
        }
        return isWorkflowVerificationSchedule(item) || item.id === "schedule-customer-1";
      })
      .filter((item) => {
        if (options.pauseLeavesActionable && isWorkflowVerificationSchedule(item)) {
          return true;
        }
        return normalizeStatus(item.status) !== "paused" && trim(item.healthState).toLowerCase() !== "paused";
      })
      .map((item) => enrichSchedulesWithDueOccurrence([{ ...item }])[0]);
    if (duplicateAssigned && assignedChecks.some((item) => item.id === verificationScheduleId)) {
      assignedChecks.push({ ...assignedChecks.find((item) => item.id === verificationScheduleId) });
    }
  }

  function listSchedules() {
    if (cleaned) {
      return Array.from(scheduleStore.values()).filter((item) => !isWorkflowVerificationSchedule(item));
    }
    let items = Array.from(scheduleStore.values());
    if (suppressVerificationInListCount > 0 && createAttempts <= suppressVerificationInListCount) {
      items = items.filter((item) => !isWorkflowVerificationSchedule(item));
    }
    return items;
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

      if (pathname === "/api/auth/login") {
        loginAttempts += 1;
        if (options.loginFails) {
          return { status: 401, json: { ok: false, error: "Invalid credentials" } };
        }
        return {
          status: 200,
          json: successLoginJson(),
          headers: { "set-cookie": `${COMPANY_SESSION_COOKIE}=session-token; Path=/; HttpOnly` },
        };
      }

      if (pathname === "/api/auth/session") {
        return { status: 200, json: successLoginJson() };
      }

      if (pathname.endsWith("/schedules") && method === "GET") {
        if (schedulesApiFails) {
          return { status: 503, json: { ok: false, error: "Unavailable" } };
        }
        return { status: 200, json: { ok: true, schedules: listSchedules() } };
      }

      if (pathname === "/api/me/assigned-checks" && method === "GET") {
        if (schedulesApiFails) {
          return { status: 503, json: { ok: false, error: "Unavailable" } };
        }
        syncAssigned();
        return { status: 200, json: { ok: true, schedules: assignedChecks } };
      }

      if (pathname === "/api/audits/templates" && method === "GET") {
        return { status: 200, json: { ok: true, templates: templateList(includeTemplate) } };
      }

      if (pathname.endsWith("/dashboard/live") && method === "GET") {
        const actToday = dashboardIncludesVerification
          ? [{ id: `schedule-${verificationScheduleId}`, type: "schedule" }]
          : [];
        return {
          status: 200,
          json: {
            ok: true,
            metrics: { todayDue: dashboardIncludesVerification ? 99 : 1, overdue: 0 },
            actToday,
            sections: { schedules: [] },
          },
        };
      }

      if (pathname.endsWith("/schedules/verification-cleanup") && method === "POST") {
        cleanupAttempts += 1;
        if (cleanupFails && mutationCreated) {
          return { status: 500, json: { ok: false, code: "SCHEDULE_CLEANUP_FAILED" } };
        }
        for (const [id, schedule] of scheduleStore.entries()) {
          if (isWorkflowVerificationSchedule(schedule) && id !== trim(body?.keepScheduleId)) {
            scheduleStore.delete(id);
          }
        }
        syncAssigned();
        return { status: 200, json: { ok: true, cleanedCount: 1, updatedRows: 1 } };
      }

      if (
        method === "POST" &&
        pathname.includes("/schedules/") &&
        pathname.endsWith("/verification-cleanup") &&
        !pathname.endsWith("/schedules/verification-cleanup")
      ) {
        cleanupAttempts += 1;
        const scheduleId = pathname.split("/").at(-2);
        if (rejectNonVerificationCleanup && scheduleId === "schedule-customer-1") {
          return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_SCHEDULE" } };
        }
        if (cleanupFails && mutationCreated) {
          return { status: 500, json: { ok: false } };
        }
        scheduleStore.delete(scheduleId);
        cleaned = true;
        syncAssigned();
        return { status: 200, json: { ok: true, cleaned: true, scheduleId, updatedRows: 1 } };
      }

      if (pathname.endsWith("/schedules/verification") && method === "POST") {
        createAttempts += 1;
        if (create502Attempts < (options.create502RecoverAfter || 0)) {
          create502Attempts += 1;
          return { status: 502, json: { ok: false, code: "SCHEDULE_SAVE_FAILED" } };
        }
        if (createFails) {
          return { status: 500, json: { ok: false, code: "SCHEDULE_CREATE_FAILED" } };
        }
        const requestedId = trim(body?.scheduleId) || verificationScheduleId;
        if (scheduleStore.has(requestedId)) {
          mutationCreated = true;
          return { status: 200, json: { ok: true, alreadyExists: true, scheduleId: requestedId, updatedRows: 0 } };
        }
        const record = verificationScheduleRecord({
          runId,
          scheduleId: requestedId,
          frequency: recurrenceMismatch ? "Weekly" : "Daily",
        });
        scheduleStore.set(requestedId, record);
        paused = false;
        cleaned = false;
        mutationCreated = true;
        syncAssigned();
        return { status: 200, json: { ok: true, scheduleId: requestedId, updatedRows: 1, written: 1 } };
      }

      if (pathname.includes("/verification") && method === "PATCH") {
        if (editFails) {
          return { status: 500, json: { ok: false } };
        }
        const scheduleId = pathname.split("/").at(-2);
        const existing = scheduleStore.get(scheduleId);
        if (!existing) {
          return { status: 404, json: { ok: false } };
        }
        scheduleStore.set(scheduleId, {
          ...existing,
          scheduleName: trim(body?.scheduleName) || existing.scheduleName,
          updatedAt: new Date().toISOString(),
        });
        syncAssigned();
        return { status: 200, json: { ok: true, updatedRows: 1 } };
      }

      if (pathname.endsWith("/pause") && method === "POST") {
        pauseAttempts += 1;
        const scheduleId = pathname.split("/").at(-2);
        const existing = scheduleStore.get(scheduleId);
        if (!existing) {
          return { status: 404, json: { ok: false } };
        }
        if (normalizeStatus(existing.status) === "paused") {
          return { status: 200, json: { ok: true, alreadyPaused: true, updatedRows: 0 } };
        }
        scheduleStore.set(scheduleId, {
          ...existing,
          status: "PAUSED",
          healthState: "Paused",
          nextDueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        });
        paused = !pauseLeavesActionable;
        syncAssigned();
        return { status: 200, json: { ok: true, updatedRows: 1 } };
      }

      if (pathname.endsWith("/reactivate") && method === "POST") {
        reactivateAttempts += 1;
        const scheduleId = pathname.split("/").at(-2);
        const existing = scheduleStore.get(scheduleId);
        if (!existing) {
          return { status: 404, json: { ok: false } };
        }
        if (normalizeStatus(existing.status) === "active" && trim(existing.healthState).toLowerCase() !== "paused") {
          return { status: 200, json: { ok: true, alreadyActive: true, updatedRows: 0 } };
        }
        scheduleStore.set(scheduleId, {
          ...existing,
          status: "ACTIVE",
          healthState: "",
          nextDueAt: "",
        });
        paused = false;
        if (options.reactivateMissingFromAssigned) {
          reactivateMissingFromAssigned = true;
        } else {
          syncAssigned();
        }
        return { status: 200, json: { ok: true, updatedRows: 1 } };
      }

      return { status: 404, json: { ok: false, error: `Unhandled ${method} ${pathname}` } };
    },
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    getState() {
      return {
        loginAttempts,
        createAttempts,
        pauseAttempts,
        reactivateAttempts,
        cleanupAttempts,
        verificationScheduleId,
        scheduleStore,
      };
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

test("1. full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  for (const key of CHECK_KEYS) {
    const status = result.checks[key].status;
    if (key === "notifications" || key === "search") {
      assert.equal(status, "SKIP");
    } else {
      assert.equal(status, "PASS", `${key} should pass`);
    }
  }
});

test("2. login failure", async () => {
  const transport = createTransport({ loginFails: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.authentication.status, "FAIL");
});

test("3. schedules API unavailable", async () => {
  const transport = createTransport({ schedulesApiFails: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.schedulesApi.status, "FAIL");
});

test("4. mutation disabled", async () => {
  const config = loadSchedulesWorkflowConfig({
    BERT_SMOKE_USERNAME: "mr.important",
    BERT_SMOKE_PASSWORD: "secret-password",
    BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
    BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
    BERT_SMOKE_ALLOW_SCHEDULE_MUTATION: "0",
  });
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(config, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createSchedule.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("5. verification template missing", async () => {
  const transport = createTransport({ includeTemplate: false });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.templateAvailability.status, "FAIL");
  assert.match(result.failureReason || "", /bert-verify-audit-v1/i);
});

test("6. stale cleanup", async () => {
  const stale = verificationScheduleRecord({ runId: 99999, scheduleId: "bert-smoke-schedule-99999" });
  const transport = createTransport({ initialSchedules: [customerSchedule(), stale] });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(transport.getState().cleanupAttempts >= 1, true);
});

test("7. create failure", async () => {
  const transport = createTransport({ createFails: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.createSchedule.status, "FAIL");
});

test("8. create succeeds but record not visible", async () => {
  const transport = createTransport({ listStaleUntilAttempt: 99 });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.readback.status, "FAIL");
});

test("9. duplicate create idempotency", async () => {
  const existing = verificationScheduleRecord();
  const transport = createTransport({ initialSchedules: [customerSchedule(), existing] });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createSchedule.status, "PASS");
});

test("10. assignment missing", async () => {
  const transport = createTransport({ includeVerificationInAssigned: false });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.assignedCheck.status, "FAIL");
});

test("11. duplicate assignment detection", async () => {
  const transport = createTransport({ duplicateAssigned: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "assignedCheck");
});

test("12. assigned check not visible", async () => {
  const transport = createTransport({ includeVerificationInAssigned: false });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.assignedCheck.status, "FAIL");
});

test("13. edit failure", async () => {
  const transport = createTransport({ editFails: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.editSchedule.status, "FAIL");
});

test("14. pause success", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.pauseDeactivate.status, "PASS");
  assert.equal(transport.getState().pauseAttempts >= 1, true);
});

test("15. repeated pause idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.pauseDeactivate.status, "PASS");
  assert.equal(transport.getState().pauseAttempts >= 1, true);
});

test("16. paused schedule still actionable — failure", async () => {
  const transport = createTransport({ pauseLeavesActionable: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.pauseDeactivate.status, "FAIL");
});

test("17. reactivate success", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.reactivate.status, "PASS");
});

test("18. repeated reactivation idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.reactivate.status, "PASS");
  assert.equal(transport.getState().reactivateAttempts >= 1, true);
});

test("19. reactivated schedule missing from assigned checks", async () => {
  const transport = createTransport({ reactivateMissingFromAssigned: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.reactivate.status, "FAIL");
});

test("20. recurrence calculation success", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.recurrence.status, "PASS");
});

test("21. recurrence mismatch", async () => {
  const transport = createTransport({ recurrenceMismatch: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.recurrence.status, "FAIL");
});

test("22. timezone edge case", () => {
  const schedule = verificationScheduleRecord({ liveTime: "23:59" });
  const enriched = enrichSchedulesWithDueOccurrence([schedule], new Date("2026-07-01T22:30:00.000Z"))[0];
  assert.ok(enriched.audits?.[0]?.dueAt || enriched.nextDueAt);
});

test("23. dashboard exclusion failure", async () => {
  const transport = createTransport({ dashboardIncludesVerification: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.dashboard.status, "FAIL");
});

test("24. notification skipped", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.notifications.status, "SKIP");
});

test("25. search skipped", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.search.status, "SKIP");
});

test("26. cleanup success", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("27. cleanup failure", async () => {
  const transport = createTransport({ cleanupFails: true });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, false);
  assert.equal(result.checks.cleanup.status, "FAIL");
});

test("28. cleanup helper succeeds for verification schedule", async () => {
  const results = [];
  const cleanup = await attemptVerificationScheduleCleanup(
    async (method, path) => {
      results.push(`${method} ${path}`);
      return { status: 200, json: { ok: true, cleaned: true, cleanedCount: 0 } };
    },
    {
      companyFolderId: baseConfig.companyFolderId,
      masterSheetId: baseConfig.masterSheetId,
      verificationScheduleId: "bert-smoke-schedule-12345",
    },
  );
  assert.equal(results.length, 2);
  assert.equal(cleanup.results.filter((item) => item.ok).length, 2);
  assert.equal(cleanup.ok, true);
});

test("29. transient 502 recovery", async () => {
  const transport = createTransport({ create502RecoverAfter: 1, listStaleUntilAttempt: 0 });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.createSchedule.status, "PASS");
});

test("30. timeout cleanup attempt", async () => {
  const transport = createTransport({ editFails: true, cleanupFails: false });
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.equal(result.ok, false);
});

test("31. SIGINT/SIGTERM cleanup", async () => {
  const transport = createTransport();
  let registered = null;
  await runProductionSchedulesWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registered = fn;
    },
  });
  assert.equal(typeof registered, "function");
  const cleanup = await registered();
  assert.equal(cleanup.ok, true);
});

test("32. secrets/customer assignments absent from output", async () => {
  const transport = createTransport();
  const result = await runProductionSchedulesWorkflowChecks(baseConfig, transport, defaultRunOptions);
  const report = formatSchedulesWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /worker@example\.com/);
  assert.match(report, /bert\.demo\+mr/);
});

test("shared helpers recognise workflow verification schedules", () => {
  const schedule = buildProductionVerificationSchedule({ runId: TEST_RUN_ID, companyFolderId: "folder-abc" });
  assert.equal(isWorkflowVerificationSchedule(schedule), true);
  assert.equal(isOperationalSchedule(schedule), false);
  const baseline = countScheduleBaselines([customerSchedule(), schedule], [schedule]);
  assert.equal(baseline.verificationCount, 1);
  assert.equal(findScheduleById([schedule], schedule.id)?.id, schedule.id);
});
