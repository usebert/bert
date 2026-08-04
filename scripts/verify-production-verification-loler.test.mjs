#!/usr/bin/env node
/**
 * Server-side regression tests for production verification LOLER markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
  calculateNextExaminationDueDate,
  mapLolerEquipmentRecord,
} from "../shared/loler.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";
import {
  buildProductionVerificationLolerEquipment,
  buildProductionVerificationLolerEquipmentId,
  buildProductionVerificationLolerExamId,
  isActiveVerificationLolerEquipment,
  isOperationalLolerEquipment,
  isVerificationLolerEquipment,
  isVerificationLolerEquipmentId,
} from "../shared/production-verification-loler.mjs";
import { getUkTodayKey } from "../shared/uk-date-time.mjs";
import {
  cleanupStaleVerificationLoler,
  cleanupVerificationLolerEquipment,
  createVerificationLolerEquipment,
  patchVerificationLolerEquipment,
  recordVerificationLolerFailExamination,
  recordVerificationLolerPassExamination,
  restoreVerificationLolerEquipment,
} from "../server/loler-verification-service.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 515151;
const todayKey = getUkTodayKey();
const actor = {
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
  name: "Mr Important",
};

function customerEquipmentRow() {
  return {
    EquipmentId: "LOL-CUSTOMER-1",
    AssetId: "HOIST-001",
    EquipmentName: "Main hoist",
    EquipmentType: "Hoist",
    EquipmentStatus: "active",
    ExaminationIntervalMonths: "12",
    LastExaminationDate: "2026-01-01",
    NextExaminationDueDate: "2027-01-01",
    SiteName: "Factory",
    OwnerDepartment: "Production",
    Notes: "",
    CreatedAt: "2026-01-01T00:00:00.000Z",
    CreatedBy: actor.email,
    UpdatedAt: "2026-01-01T00:00:00.000Z",
    UpdatedBy: actor.email,
    ArchivedAt: "",
    ArchivedBy: "",
    ChangeLog: "[]",
  };
}

function createLolerDeps(initialEquipment = [customerEquipmentRow()]) {
  const tabs = new Map();
  const tabKey = (tab) => tab;

  const ensure = (tab, headers) => {
    if (!tabs.has(tabKey(tab))) {
      tabs.set(tabKey(tab), { headers: [...headers], rows: initialEquipment.map((row) => ({ ...row })) });
    }
    return tabs.get(tabKey(tab));
  };

  const deps = {
    resolveCompanyFromFolder: async () => ({
      ok: true,
      companyFolderId,
      companyId: companyFolderId,
      masterSheetId,
    }),
    ensureTabColumns: async (_auth, _deps, _sheetId, tab, headers) => {
      ensure(tab, headers);
      return { ok: true };
    },
    readTabRecords: async (_auth, _deps, _sheetId, tab, options = {}) => {
      const entry = ensure(tab, options.expectedHeaders || []);
      return { ok: true, records: entry.rows.map((row) => ({ ...row })) };
    },
    appendTabRows: async (_auth, _deps, _sheetId, tab, headers, rowObjects = []) => {
      const entry = ensure(tab, headers);
      for (const row of rowObjects) {
        const normalized = {};
        for (const header of headers) {
          normalized[header] = String(row[header] ?? "");
        }
        entry.rows.push(normalized);
      }
      return { ok: true, written: rowObjects.length };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tab, matchHeader, matchValue, updates = {}) => {
      const entry = ensure(tab, []);
      const row = entry.rows.find((candidate) => String(candidate[matchHeader] || "").trim() === String(matchValue).trim());
      if (!row) {
        throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
      }
      Object.assign(row, updates);
      return { ok: true, patched: 1 };
    },
    getEquipmentRows() {
      return [...(tabs.get(tabKey(LOLER_EQUIPMENT_TAB))?.rows || [])];
    },
    getExamRows() {
      return [...(tabs.get(tabKey(LOLER_EXAMINATIONS_TAB))?.rows || [])];
    },
  };

  ensure(LOLER_EQUIPMENT_TAB, LOLER_EQUIPMENT_TAB_COLUMNS);
  ensure(LOLER_SCHEDULES_TAB, LOLER_SCHEDULES_TAB_COLUMNS);
  ensure(LOLER_EXAMINATIONS_TAB, LOLER_EXAMINATIONS_TAB_COLUMNS);

  return deps;
}

function verificationPayload(overrides = {}) {
  return buildProductionVerificationLolerEquipment({
    runId,
    equipmentId: buildProductionVerificationLolerEquipmentId(runId),
    ...overrides,
  });
}

test("verification marker recognition", () => {
  const payload = verificationPayload();
  assert.equal(isVerificationLolerEquipmentId(payload.equipmentId), true);
  assert.equal(isVerificationLolerEquipment(payload), true);
  assert.equal(isActiveVerificationLolerEquipment(payload), true);
  assert.equal(isOperationalLolerEquipment(payload), false);
});

test("verification-only cleanup", async () => {
  const verification = verificationPayload();
  const deps = createLolerDeps([customerEquipmentRow()]);
  const created = await createVerificationLolerEquipment(null, deps, actor, companyFolderId, {
    ...verification,
    masterSheetId,
  });
  assert.equal(created.ok, true);
  const cleaned = await cleanupVerificationLolerEquipment(null, deps, actor, companyFolderId, verification.equipmentId, {
    masterSheetId,
  });
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.cleaned, true);
  const remaining = deps.getEquipmentRows().filter((row) => isActiveVerificationLolerEquipment(mapLolerEquipmentRecord(row)));
  assert.equal(remaining.length, 0);
  assert.equal(deps.getEquipmentRows().some((row) => row.EquipmentId === "LOL-CUSTOMER-1"), true);
});

test("ordinary equipment cleanup rejection", async () => {
  const deps = createLolerDeps([customerEquipmentRow()]);
  const denied = await cleanupVerificationLolerEquipment(null, deps, actor, companyFolderId, "LOL-CUSTOMER-1", {
    masterSheetId,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_LOLER");
});

test("create idempotency", async () => {
  const verification = verificationPayload();
  const deps = createLolerDeps([customerEquipmentRow()]);
  await createVerificationLolerEquipment(null, deps, actor, companyFolderId, { ...verification, masterSheetId });
  const again = await createVerificationLolerEquipment(null, deps, actor, companyFolderId, { ...verification, masterSheetId });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyExists, true);
  assert.equal(again.updatedRows, 0);
  assert.equal(deps.getEquipmentRows().filter((row) => row.EquipmentId === verification.equipmentId).length, 1);
});

test("PASS completion idempotency", async () => {
  const verification = verificationPayload();
  const examId = buildProductionVerificationLolerExamId(runId);
  const deps = createLolerDeps([customerEquipmentRow()]);
  await createVerificationLolerEquipment(null, deps, actor, companyFolderId, { ...verification, masterSheetId });
  const passInput = {
    masterSheetId,
    equipmentId: verification.equipmentId,
    examinationId: examId,
    examinationDate: todayKey,
    examinerEmail: actor.email,
    examinerName: actor.name,
    todayKey,
  };
  const first = await recordVerificationLolerPassExamination(null, deps, actor, companyFolderId, passInput);
  assert.equal(first.ok, true);
  const second = await recordVerificationLolerPassExamination(null, deps, actor, companyFolderId, passInput);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyCompleted, true);
  assert.equal(deps.getExamRows().filter((row) => row.ExaminationId === examId).length, 1);
});

test("fail and restore lifecycle", async () => {
  const verification = verificationPayload();
  const deps = createLolerDeps([customerEquipmentRow()]);
  await createVerificationLolerEquipment(null, deps, actor, companyFolderId, { ...verification, masterSheetId });
  const failExamId = `bert-smoke-loler-fail-${runId}`;
  const failed = await recordVerificationLolerFailExamination(null, deps, actor, companyFolderId, {
    masterSheetId,
    equipmentId: verification.equipmentId,
    examinationId: failExamId,
    examinationDate: todayKey,
    examinerEmail: actor.email,
    examinerName: actor.name,
    todayKey,
  });
  assert.equal(failed.ok, true);
  const outOfService = deps.getEquipmentRows().find((row) => row.EquipmentId === verification.equipmentId);
  assert.equal(outOfService.EquipmentStatus, "out_of_service");
  const restored = await restoreVerificationLolerEquipment(null, deps, actor, companyFolderId, verification.equipmentId, {
    masterSheetId,
    todayKey,
  });
  assert.equal(restored.ok, true);
  const active = deps.getEquipmentRows().find((row) => row.EquipmentId === verification.equipmentId);
  assert.equal(active.EquipmentStatus, "active");
});

test("due-date calculations unchanged for normal equipment", () => {
  const customer = mapLolerEquipmentRecord(customerEquipmentRow());
  const before = calculateNextExaminationDueDate({
    lastExaminationDate: customer.lastExaminationDate,
    examinationIntervalMonths: customer.examinationIntervalMonths,
  });
  const verification = mapLolerEquipmentRecord(
    buildProductionVerificationLolerEquipment({ runId, equipmentId: buildProductionVerificationLolerEquipmentId(runId) }),
  );
  assert.equal(before, customer.nextExaminationDueDate);
  assert.notEqual(verification.id, customer.id);
});

test("operational overview exclusion", () => {
  const customer = mapLolerEquipmentRecord(customerEquipmentRow());
  const verification = mapLolerEquipmentRecord(
    buildProductionVerificationLolerEquipment({ runId, equipmentId: buildProductionVerificationLolerEquipmentId(runId) }),
  );
  verification.nextExaminationDueDate = todayKey;
  const metrics = buildHealthSafetyMetrics({
    todayKey,
    equipment: [customer, verification],
    incidents: [],
    riddor: [],
    coshh: [],
    incidentActions: [],
    riskAssessments: [],
  });
  const verificationOnly = buildHealthSafetyMetrics({
    todayKey,
    equipment: [verification],
    incidents: [],
    riddor: [],
    coshh: [],
    incidentActions: [],
    riskAssessments: [],
  });
  assert.equal(metrics.equipmentInspectionsDueSoon, verificationOnly.equipmentInspectionsDueSoon);
  assert.equal(metrics.equipmentInspectionsOverdue, 0);
});

test("stale cleanup and patch", async () => {
  const stale = verificationPayload({ runId: runId - 1 });
  const current = verificationPayload();
  const deps = createLolerDeps([customerEquipmentRow()]);
  await createVerificationLolerEquipment(null, deps, actor, companyFolderId, { ...stale, masterSheetId });
  await createVerificationLolerEquipment(null, deps, actor, companyFolderId, { ...current, masterSheetId });
  const staleResult = await cleanupStaleVerificationLoler(null, deps, actor, companyFolderId, {
    masterSheetId,
    keepEquipmentId: current.equipmentId,
  });
  assert.equal(staleResult.ok, true);
  assert.equal(
    deps.getEquipmentRows().some((row) => row.EquipmentId === stale.equipmentId && row.EquipmentStatus === "archived"),
    false,
  );
  const patched = await patchVerificationLolerEquipment(null, deps, actor, companyFolderId, current.equipmentId, {
    masterSheetId,
    siteName: "Rugby (patched)",
  });
  assert.equal(patched.ok, true);
  const row = deps.getEquipmentRows().find((item) => item.EquipmentId === current.equipmentId);
  assert.equal(row.SiteName, "Rugby (patched)");
});
