#!/usr/bin/env node
/**
 * Server-side regression tests for production verification schedule markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveDashboardFromSources } from "../shared/live-dashboard.mjs";
import { buildSchedulesTabRows, SCHEDULES_TAB, SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { parseCompanyScheduleListFromRecords } from "../shared/schedule-list.mjs";
import {
  buildProductionVerificationSchedule,
  isActiveWorkflowVerificationSchedule,
  isOperationalAssignedCheck,
  isOperationalSchedule,
  isWorkflowVerificationSchedule,
  isWorkflowVerificationScheduleId,
  PRODUCTION_VERIFICATION_SCHEDULE_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
} from "../shared/production-verification-schedule.mjs";
import { PRODUCTION_VERIFICATION_AUDIT_ID } from "../shared/production-verification-audit.mjs";
import { isActiveMyCheckScheduleStatus } from "../server/schedule-service.mjs";
import {
  cleanupStaleVerificationSchedules,
  cleanupVerificationSchedule,
  createVerificationSchedule,
  pauseVerificationSchedule,
  reactivateVerificationSchedule,
} from "../server/schedule-verification-service.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 424242;
const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
  name: "Mr Important",
};

function customerSchedulePayload() {
  return {
    id: "schedule-customer-1",
    companyFolderId,
    companyId: companyFolderId,
    scheduleName: "Daily warehouse walk",
    lifecycle: "Live",
    status: "ACTIVE",
    startDate: "2026-07-01",
    assignedUsers: [{ email: "worker@example.com", name: "Worker", role: "User", accessLevel: "operational" }],
    audits: [{ auditId: "audit-1", auditName: "Warehouse Walk", frequency: "Daily", liveTime: "08:00", completionHours: 24 }],
  };
}

function verificationSchedulePayload(overrides = {}) {
  return buildProductionVerificationSchedule({
    runId,
    companyFolderId,
    createdByEmail: actor.email,
    ...overrides,
  });
}

function rowsToRecords(rows) {
  const [headers, ...data] = rows;
  return data.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
}

function createScheduleDeps(initialSchedules = []) {
  let sheetValues = [SCHEDULES_TAB_COLUMNS];
  for (const schedule of initialSchedules) {
    const users = schedule.assignedUsers || [];
    sheetValues.push(...buildSchedulesTabRows(schedule, users).map((row) => SCHEDULES_TAB_COLUMNS.map((header) => row[header] ?? "")));
  }

  const deps = {
    rowsByTab: { [SCHEDULES_TAB]: sheetValues },
    resolveCompanyFromFolder: async () => ({
      ok: true,
      companyFolderId,
      companyId: companyFolderId,
      masterSheetId,
    }),
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => ({
      records: rowsToRecords(deps.rowsByTab[tabName] || []),
    }),
    getTabValues: async (_auth, _deps, _sheetId, tabName, range) => {
      const rows = deps.rowsByTab[tabName] || [];
      if (!range) {
        return rows;
      }
      return rows;
    },
    rowsToRecords,
    ensureTabColumns: async () => ({ ok: true }),
    withSheetsQuotaRetry: (fn) => fn(),
    google: {
      sheets: () => ({
        spreadsheets: {
          values: {
            clear: async () => ({}),
            update: async ({ requestBody }) => {
              sheetValues = requestBody.values;
              deps.rowsByTab[SCHEDULES_TAB] = sheetValues;
              return {};
            },
          },
        },
      }),
    },
    getRows() {
      return rowsToRecords(sheetValues);
    },
    getSchedules() {
      return parseCompanyScheduleListFromRecords(this.getRows(), companyFolderId);
    },
  };

  return deps;
}

test("verification marker recognition", () => {
  const schedule = verificationSchedulePayload();
  assert.equal(isWorkflowVerificationScheduleId(schedule.id), true);
  assert.equal(isWorkflowVerificationSchedule(schedule), true);
  assert.equal(isActiveWorkflowVerificationSchedule(schedule), true);
  assert.equal(isOperationalSchedule(schedule), false);
  assert.equal(isOperationalAssignedCheck(schedule), false);
});

test("verification-only cleanup", async () => {
  const verification = verificationSchedulePayload();
  const deps = createScheduleDeps([customerSchedulePayload(), verification]);
  const result = await cleanupVerificationSchedule(null, deps, actor, companyFolderId, verification.id, {
    masterSheetId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleaned, true);
  assert.equal(deps.getSchedules().some((item) => item.id === verification.id), false);
  assert.equal(deps.getSchedules().some((item) => item.id === "schedule-customer-1"), true);
});

test("ordinary schedule cleanup rejection", async () => {
  const deps = createScheduleDeps([customerSchedulePayload()]);
  const denied = await cleanupVerificationSchedule(null, deps, actor, companyFolderId, "schedule-customer-1", {
    masterSheetId,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_SCHEDULE");
});

test("create idempotency", async () => {
  const verification = verificationSchedulePayload();
  const deps = createScheduleDeps([customerSchedulePayload(), verification]);
  const result = await createVerificationSchedule(null, deps, actor, companyFolderId, {
    ...verification,
    masterSheetId,
    templateId: PRODUCTION_VERIFICATION_AUDIT_ID,
    verificationSource: PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyExists, true);
  assert.equal(result.updatedRows, 0);
});

test("assignment idempotency guard rejects broad assignment", async () => {
  const deps = createScheduleDeps([customerSchedulePayload()]);
  const denied = await createVerificationSchedule(null, deps, actor, companyFolderId, {
    scheduleId: `bert-smoke-schedule-${runId + 1}`,
    masterSheetId,
    templateId: PRODUCTION_VERIFICATION_AUDIT_ID,
    assignedUserEmails: ["worker@example.com", actor.email],
    verificationSource: PRODUCTION_VERIFICATION_SCHEDULE_SOURCE,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "SCHEDULE_ASSIGNEE_TOO_BROAD");
});

test("pause and reactivate lifecycle rules", async () => {
  const verification = verificationSchedulePayload();
  const deps = createScheduleDeps([customerSchedulePayload(), verification]);
  const paused = await pauseVerificationSchedule(null, deps, actor, companyFolderId, verification.id, {
    masterSheetId,
  });
  assert.equal(paused.ok, true);
  const pausedSchedule = deps.getSchedules().find((item) => item.id === verification.id);
  assert.equal(String(pausedSchedule.status).toUpperCase(), "PAUSED");
  assert.equal(isActiveMyCheckScheduleStatus(pausedSchedule), false);

  const pausedAgain = await pauseVerificationSchedule(null, deps, actor, companyFolderId, verification.id, {
    masterSheetId,
  });
  assert.equal(pausedAgain.alreadyPaused, true);

  const reactivated = await reactivateVerificationSchedule(null, deps, actor, companyFolderId, verification.id, {
    masterSheetId,
  });
  assert.equal(reactivated.ok, true);
  const activeSchedule = deps.getSchedules().find((item) => item.id === verification.id);
  assert.equal(String(activeSchedule.status).toUpperCase(), "ACTIVE");
  assert.equal(isActiveMyCheckScheduleStatus(activeSchedule), true);
});

test("operational dashboard exclusion", () => {
  const verification = verificationSchedulePayload();
  const customer = customerSchedulePayload();
  const rows = [...buildSchedulesTabRows(customer, customer.assignedUsers), ...buildSchedulesTabRows(verification, verification.assignedUsers)];
  const dashboard = buildLiveDashboardFromSources(
    { schedules: rows },
    { companyFolderId, now: new Date("2026-07-01T12:00:00.000Z") },
  );
  assert.equal(dashboard.metrics.todayDue >= 0, true);
  const actTodayIds = (dashboard.actToday || []).map((item) => String(item.id || ""));
  assert.equal(actTodayIds.some((id) => id.includes(verification.id)), false);
});

test("stale verification cleanup", async () => {
  const stale = verificationSchedulePayload({ runId: 111 });
  const current = verificationSchedulePayload({ runId: 222, scheduleId: "bert-smoke-schedule-222" });
  const deps = createScheduleDeps([customerSchedulePayload(), stale, current]);
  const result = await cleanupStaleVerificationSchedules(null, deps, actor, companyFolderId, {
    masterSheetId,
    keepScheduleId: current.id,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleanedCount, 1);
  assert.equal(deps.getSchedules().some((item) => item.id === stale.id), false);
  assert.equal(deps.getSchedules().some((item) => item.id === current.id), true);
});

test("service documents zero-row acknowledgement guard", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../server/schedule-verification-service.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /SCHEDULE_WRITE_ZERO_ROWS/);
});

test("cleaned status marker constant", () => {
  assert.equal(PRODUCTION_VERIFICATION_SCHEDULE_CLEANED_STATUS, "verification-cleaned");
});
