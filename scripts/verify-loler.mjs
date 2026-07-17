#!/usr/bin/env node
/**
 * verify:loler — LOLER equipment register + scheduling (Phase 1).
 * Unit-tests shared date/status helpers and the server service against an
 * in-memory workbook mock, plus static wiring checks (routes, nav, permissions).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOLER_DUE_SOON_DAYS,
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_EXAMINATIONS_TAB,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
  addMonthsToDateKey,
  calculateNextExaminationDueDate,
  lolerDueStatusForDate,
  lolerEquipmentComplianceStatus,
  lolerScheduleStatusForDueDate,
  mapLolerEquipmentRecord,
  summarizeLolerEquipment,
  validateLolerEquipmentInput,
} from "../shared/loler.mjs";
import {
  archiveLolerEquipment,
  canManageLoler,
  canViewLoler,
  createLolerEquipment,
  listLolerEquipment,
  listLolerSchedules,
  markLolerEquipmentOutOfService,
  returnLolerEquipmentToService,
  updateLolerEquipment,
} from "../server/loler-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

/* ---------- In-memory workbook mock ---------- */

function createWorkbookMock() {
  const tabs = new Map(); // `${sheetId}:${tab}` -> { headers, rows: [{...}] }

  const key = (sheetId, tab) => `${sheetId}:${tab}`;
  const ensure = (sheetId, tab, headers = []) => {
    const k = key(sheetId, tab);
    if (!tabs.has(k)) {
      tabs.set(k, { headers: [...headers], rows: [] });
    }
    return tabs.get(k);
  };

  return {
    tabs,
    deps: {
      ensureTabColumns: async (_auth, _deps, sheetId, tab, headers) => {
        ensure(sheetId, tab, headers);
        return { addedColumns: [], headers };
      },
      readTabRecords: async (_auth, _deps, sheetId, tab, options = {}) => {
        const entry = ensure(sheetId, tab, options.expectedHeaders || []);
        return { ok: true, records: entry.rows.map((row) => ({ ...row })), rowCount: entry.rows.length };
      },
      appendTabRows: async (_auth, _deps, sheetId, tab, headers, rowObjects = []) => {
        const entry = ensure(sheetId, tab, headers);
        for (const row of rowObjects) {
          const normalized = {};
          for (const header of headers) {
            normalized[header] = String(row[header] ?? "").trim();
          }
          entry.rows.push(normalized);
        }
        return { ok: true, written: rowObjects.length };
      },
      patchTabRowByHeader: async (_auth, _deps, sheetId, tab, matchHeader, matchValue, updates = {}) => {
        const entry = ensure(sheetId, tab);
        const row = entry.rows.find(
          (candidate) => String(candidate[matchHeader] || "").trim().toLowerCase() === String(matchValue).trim().toLowerCase(),
        );
        if (!row) {
          throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
        }
        for (const [header, value] of Object.entries(updates)) {
          row[header] = String(value ?? "").trim();
        }
        return { ok: true };
      },
    },
    rowsOf(sheetId, tab) {
      return (tabs.get(key(sheetId, tab)) || { rows: [] }).rows;
    },
  };
}

const TODAY = "2026-07-16";
const manager = { kind: "company", role: "Manager", email: "manager@acme.test", companyFolderId: "folder-a" };
const auditor = { kind: "company", role: "Auditor", email: "auditor@acme.test", companyFolderId: "folder-a" };
const companyA = { companyFolderId: "folder-a", masterSheetId: "sheet-a" };
const companyB = { companyFolderId: "folder-b", masterSheetId: "sheet-b" };

/* ---------- Date helpers (tests 5–7) ---------- */

assert(addMonthsToDateKey("2026-03-15", 6) === "2026-09-15", "due date: normal month addition");
assert(addMonthsToDateKey("2026-01-31", 1) === "2026-02-28", "due date: 31 Jan + 1 month clamps to 28 Feb");
assert(addMonthsToDateKey("2024-01-31", 1) === "2024-02-29", "due date: leap year clamps to 29 Feb");
assert(addMonthsToDateKey("2023-11-30", 3) === "2024-02-29", "due date: month-end into leap February");
assert(addMonthsToDateKey("2026-08-31", 6) === "2027-02-28", "due date: year rollover with clamping");
assert(addMonthsToDateKey("2026-01-15", 7) === "2026-08-15", "due date: custom 7-month interval");
assert(
  calculateNextExaminationDueDate({ lastExaminationDate: "2026-01-10", examinationIntervalMonths: 12 }) === "2027-01-10",
  "due date derived from last examination + interval",
);
assert(
  calculateNextExaminationDueDate({ examinationIntervalMonths: 12, nextExaminationDueDate: "2026-10-01" }) === "2026-10-01",
  "missing last examination uses explicit next due date",
);
assert(
  calculateNextExaminationDueDate({ examinationIntervalMonths: 12 }) === "",
  "missing last examination and no explicit due date yields no guess",
);

/* ---------- Status logic (tests 9–10) ---------- */

assert(LOLER_DUE_SOON_DAYS === 30, "due-soon threshold is central and 30 days");
assert(lolerDueStatusForDate("2026-07-15", TODAY) === "overdue", "status: due before today is overdue");
assert(lolerDueStatusForDate("2026-07-16", TODAY) === "due_soon", "status: due today is due_soon");
assert(lolerDueStatusForDate("2026-08-15", TODAY) === "due_soon", "status: within 30 days is due_soon");
assert(lolerDueStatusForDate("2026-08-16", TODAY) === "compliant", "status: more than 30 days away is compliant");
assert(lolerScheduleStatusForDueDate("2026-12-01", TODAY) === "upcoming", "schedule status maps compliant to upcoming");
assert(
  lolerEquipmentComplianceStatus({ status: "archived", nextExaminationDueDate: "2020-01-01" }, TODAY) === "archived",
  "archived status wins over overdue dates",
);
assert(
  lolerEquipmentComplianceStatus({ status: "out_of_service", nextExaminationDueDate: "2020-01-01" }, TODAY) === "out_of_service",
  "out-of-service status wins over overdue dates",
);

/* ---------- Validation (test 2) ---------- */

const missingFields = validateLolerEquipmentInput({}, []);
assert(!missingFields.ok, "validation: empty input rejected");
assert(
  missingFields.errors.some((error) => error.includes("Asset ID is required")) &&
    missingFields.errors.some((error) => error.includes("Equipment name is required")) &&
    missingFields.errors.some((error) => error.includes("Equipment type is required")),
  "validation: required fields reported",
);
assert(
  !validateLolerEquipmentInput(
    { assetId: "A1", equipmentName: "Hoist", equipmentType: "Hoist", examinationIntervalMonths: 0, nextExaminationDueDate: "2026-09-01" },
    [],
  ).ok,
  "validation: zero interval rejected",
);
assert(
  !validateLolerEquipmentInput(
    { assetId: "A1", equipmentName: "Hoist", equipmentType: "Hoist", examinationIntervalMonths: 6.5, nextExaminationDueDate: "2026-09-01" },
    [],
  ).ok,
  "validation: fractional interval rejected",
);
assert(
  !validateLolerEquipmentInput(
    { assetId: "A1", equipmentName: "Hoist", equipmentType: "Hoist", examinationIntervalMonths: 12 },
    [],
  ).ok,
  "validation: missing due date rejected for active equipment",
);

/* ---------- Service: create + schedules (tests 1, 8, 13–16) ---------- */

const mock = createWorkbookMock();
const baseInput = {
  assetId: "CRANE-001",
  equipmentName: "Overhead crane",
  equipmentType: "Crane",
  examinationIntervalMonths: 12,
  lastExaminationDate: "2026-01-10",
  siteId: "site-1",
  siteName: "Main works",
  assignedPersonId: "auditor@acme.test",
  assignedPersonName: "Avery Auditor",
};

const created = await createLolerEquipment(null, mock.deps, companyA, manager, baseInput, { todayKey: TODAY });
assert(created.ok === true, "create: equipment can be created");
assert(created.equipment.nextExaminationDueDate === "2027-01-10", "create: next due calculated from last exam + interval");
assert(mock.rowsOf("sheet-a", LOLER_EQUIPMENT_TAB).length === 1, "create: one equipment row written to LOLEREquipment");
const openAfterCreate = mock
  .rowsOf("sheet-a", LOLER_SCHEDULES_TAB)
  .filter((row) => ["upcoming", "due_soon", "overdue"].includes(row.ScheduleStatus));
assert(openAfterCreate.length === 1, "create: exactly one open LOLER schedule created");
assert(openAfterCreate[0].EquipmentId === created.equipment.id, "create: schedule linked by EquipmentId");

const customInterval = await createLolerEquipment(
  null,
  mock.deps,
  companyA,
  manager,
  { ...baseInput, assetId: "SLING-007", equipmentName: "Chain sling", equipmentType: "Sling", examinationIntervalMonths: 7 },
  { todayKey: TODAY },
);
assert(customInterval.ok && customInterval.equipment.nextExaminationDueDate === "2026-08-10", "create: custom 7-month interval works");

/* Duplicate asset id (test 3) */
const duplicate = await createLolerEquipment(null, mock.deps, companyA, manager, baseInput, { todayKey: TODAY });
assert(duplicate.ok === false && duplicate.code === "LOLER_VALIDATION_FAILED", "create: duplicate asset id rejected in same company");

/* Same asset id, other company (tests 4, 17) */
const otherCompany = await createLolerEquipment(null, mock.deps, companyB, manager, baseInput, { todayKey: TODAY });
assert(otherCompany.ok === true, "create: same asset id allowed in a different company");
const listA = await listLolerEquipment(null, mock.deps, companyA, manager, { todayKey: TODAY });
const listB = await listLolerEquipment(null, mock.deps, companyB, manager, { todayKey: TODAY });
assert(listA.equipment.length === 2 && listB.equipment.length === 1, "list: company records never cross companies");
assert(
  !listB.equipment.some((item) => item.id === created.equipment.id),
  "list: company B does not contain company A equipment ids",
);

/* Update modifies open schedule without duplicates (tests 13–14) */
const updated = await updateLolerEquipment(
  null,
  mock.deps,
  companyA,
  manager,
  created.equipment.id,
  { lastExaminationDate: "2026-07-01" },
  { todayKey: TODAY },
);
assert(updated.ok && updated.equipment.nextExaminationDueDate === "2027-07-01", "update: due date recalculated");
const openAfterUpdate = mock
  .rowsOf("sheet-a", LOLER_SCHEDULES_TAB)
  .filter((row) => row.EquipmentId === created.equipment.id && ["upcoming", "due_soon", "overdue"].includes(row.ScheduleStatus));
assert(openAfterUpdate.length === 1, "update: still exactly one open schedule (no duplicates)");
assert(openAfterUpdate[0].DueDate === "2027-07-01", "update: open schedule due date follows the equipment");
assert(
  openAfterUpdate[0].LolerScheduleId === openAfterCreate[0].LolerScheduleId,
  "update: existing open schedule updated in place",
);

/* Out of service + return to service (tests 12, 16) */
const oos = await markLolerEquipmentOutOfService(null, mock.deps, companyA, manager, created.equipment.id, { todayKey: TODAY });
assert(oos.ok && oos.equipment.complianceStatus === "out_of_service", "out of service: status transition works");
const openAfterOos = mock
  .rowsOf("sheet-a", LOLER_SCHEDULES_TAB)
  .filter((row) => row.EquipmentId === created.equipment.id && ["upcoming", "due_soon", "overdue"].includes(row.ScheduleStatus));
assert(openAfterOos.length === 0, "out of service: open schedule made inactive (cancelled)");

const badReturn = await returnLolerEquipmentToService(null, mock.deps, companyA, manager, created.equipment.id, {
  todayKey: TODAY,
  nextExaminationDueDate: "not-a-date",
});
assert(badReturn.ok === false && badReturn.code === "LOLER_DUE_DATE_REQUIRED", "return to service: invalid due date rejected");
const goodReturn = await returnLolerEquipmentToService(null, mock.deps, companyA, manager, created.equipment.id, {
  todayKey: TODAY,
  lastExaminationDate: "2026-07-10",
});
assert(goodReturn.ok && goodReturn.equipment.status === "active", "return to service: valid due date accepted");
const openAfterReturn = mock
  .rowsOf("sheet-a", LOLER_SCHEDULES_TAB)
  .filter((row) => row.EquipmentId === created.equipment.id && ["upcoming", "due_soon", "overdue"].includes(row.ScheduleStatus));
assert(openAfterReturn.length === 1, "return to service: one open schedule re-established");

/* Archive (tests 11, 15) */
const archived = await archiveLolerEquipment(null, mock.deps, companyA, manager, created.equipment.id, { todayKey: TODAY });
assert(archived.ok && archived.equipment.complianceStatus === "archived", "archive: soft archive applied");
const archivedRow = mock.rowsOf("sheet-a", LOLER_EQUIPMENT_TAB).find((row) => row.EquipmentId === created.equipment.id);
assert(
  archivedRow.EquipmentStatus === "archived" && archivedRow.ArchivedBy === "manager@acme.test" && archivedRow.ArchivedAt !== "",
  "archive: actor and timestamp recorded, row retained (no delete)",
);
const openAfterArchive = mock
  .rowsOf("sheet-a", LOLER_SCHEDULES_TAB)
  .filter((row) => row.EquipmentId === created.equipment.id && ["upcoming", "due_soon", "overdue"].includes(row.ScheduleStatus));
assert(openAfterArchive.length === 0, "archive: open schedule cancelled");
const listAfterArchive = await listLolerEquipment(null, mock.deps, companyA, manager, { todayKey: TODAY });
assert(listAfterArchive.summary.totalActive === 1 && listAfterArchive.summary.archived === 1, "archive: excluded from active totals");

/* Audit trail on the row */
const changeLog = JSON.parse(archivedRow.ChangeLog);
const changeTypes = changeLog.map((entry) => entry.type);
assert(
  changeTypes.includes("created") &&
    changeTypes.includes("edited") &&
    changeTypes.includes("due_date_changed") &&
    changeTypes.includes("out_of_service") &&
    changeTypes.includes("returned_to_service") &&
    changeTypes.includes("archived"),
  "audit trail: created/edited/due-date/out-of-service/return/archive changes recorded",
);
assert(
  changeLog.every((entry) => entry.by && entry.at && entry.equipmentId && entry.assetId),
  "audit trail: entries include actor, timestamp, equipment id, asset id",
);

/* Dashboard counts (tests 12, 21) */
const summaryFixture = [
  { status: "active", nextExaminationDueDate: "2026-07-01" }, // overdue
  { status: "active", nextExaminationDueDate: "2026-08-01" }, // due soon
  { status: "active", nextExaminationDueDate: "2026-12-01" }, // compliant
  { status: "out_of_service", nextExaminationDueDate: "2026-07-01" },
  { status: "archived", nextExaminationDueDate: "2026-07-01" },
];
const summary = summarizeLolerEquipment(summaryFixture, TODAY);
assert(
  summary.totalActive === 3 &&
    summary.overdue === 1 &&
    summary.dueSoon === 1 &&
    summary.compliant === 1 &&
    summary.outOfService === 1 &&
    summary.archived === 1,
  "dashboard: summary counts correct (out-of-service separated from active compliance)",
);

/* Invalid stored rows fail safely (test 22) */
mock.rowsOf("sheet-a", LOLER_EQUIPMENT_TAB).push({ EquipmentId: "", AssetId: "GHOST" });
mock.rowsOf("sheet-a", LOLER_EQUIPMENT_TAB).push({ EquipmentId: "LOL-BAD", NextExaminationDueDate: "garbage" });
const listWithBadRows = await listLolerEquipment(null, mock.deps, companyA, manager, { todayKey: TODAY });
assert(listWithBadRows.ok === true, "invalid rows: listing still succeeds");
assert(
  !listWithBadRows.equipment.some((item) => item.assetId === "GHOST"),
  "invalid rows: rows without EquipmentId are skipped",
);
const badDateRow = listWithBadRows.equipment.find((item) => item.id === "LOL-BAD");
assert(badDateRow && badDateRow.complianceStatus === "overdue", "invalid rows: malformed due date degrades safely to overdue");
assert(mapLolerEquipmentRecord({}) === null, "invalid rows: empty record maps to null");

/* Role restrictions (test 18) */
assert(canViewLoler(manager) && canManageLoler(manager), "roles: manager can view and manage");
assert(canViewLoler(auditor) && !canManageLoler(auditor), "roles: auditor can view but not manage");
assert(!canViewLoler({ role: "Manager" }) && !canViewLoler(null), "roles: no session actor is rejected");
const auditorList = await listLolerEquipment(null, mock.deps, companyA, auditor, { todayKey: TODAY });
assert(
  auditorList.equipment.every((item) => item.assignedPersonId === "auditor@acme.test"),
  "roles: auditor list is scoped to assigned equipment only",
);
const auditorSchedules = await listLolerSchedules(null, mock.deps, companyA, auditor, { todayKey: TODAY });
assert(
  auditorSchedules.schedules.every((schedule) => schedule.assignedPersonId === "auditor@acme.test"),
  "roles: auditor schedules scoped to assignments",
);

/* General schedules / audits untouched (tests 19–20) */
const lolerServiceSource = read("server/loler-service.mjs");
assert(
  !lolerServiceSource.includes("saveCompanySchedules") && !lolerServiceSource.includes('"Schedules"'),
  "isolation: loler service never touches the general Schedules sheet",
);
assert(
  !lolerServiceSource.includes("completion-service") && !lolerServiceSource.includes("AuditResults"),
  "isolation: loler service never touches audit results",
);
const touchedTabs = Array.from(mock.tabs.keys()).map((key) => key.split(":")[1]);
assert(
  touchedTabs.every(
    (tab) => tab === LOLER_EQUIPMENT_TAB || tab === LOLER_SCHEDULES_TAB || tab === LOLER_EXAMINATIONS_TAB,
  ),
  "isolation: only LOLER equipment/schedules/examinations tabs were written",
);

/* Sheet schema */
assert(
  LOLER_EQUIPMENT_TAB === "LOLEREquipment" &&
    LOLER_SCHEDULES_TAB === "LOLERSchedules" &&
    LOLER_EQUIPMENT_TAB_COLUMNS.includes("EquipmentId") &&
    LOLER_EQUIPMENT_TAB_COLUMNS.includes("NextExaminationDueDate") &&
    LOLER_EQUIPMENT_TAB_COLUMNS.includes("ArchivedBy") &&
    LOLER_SCHEDULES_TAB_COLUMNS.includes("LolerScheduleId") &&
    LOLER_SCHEDULES_TAB_COLUMNS.includes("ScheduleStatus"),
  "schema: dedicated LOLER tabs and stable headers",
);

/* ---------- Static wiring ---------- */

const routes = read("server/core-workflow-routes.mjs");
assert(
  routes.includes('"/api/companies/:companyFolderId/loler/equipment"') &&
    routes.includes('"/api/companies/:companyFolderId/loler/equipment/:equipmentId"') &&
    routes.includes('"/api/companies/:companyFolderId/loler/equipment/:equipmentId/archive"') &&
    routes.includes('"/api/companies/:companyFolderId/loler/equipment/:equipmentId/out-of-service"') &&
    routes.includes('"/api/companies/:companyFolderId/loler/equipment/:equipmentId/return-to-service"') &&
    routes.includes('"/api/companies/:companyFolderId/loler/schedules"'),
  "wiring: all LOLER API routes registered",
);
assert(
  routes.includes("resolveCompanyScheduleContext") && routes.includes("rejectCompanyApiIfFolderInvalid") && routes.includes("canManageLoler"),
  "wiring: LOLER routes reuse existing auth/company scoping patterns",
);

const appSource = read("App.tsx");
assert(
  appSource.includes('screen === "loler" && canRoleAccessNavItem(currentUser.role, "loler")') && appSource.includes("<LolerScreen"),
  "wiring: App routes the LOLER screen behind nav permission",
);

const permissions = read("src/permissions.ts");
assert(
  permissions.includes("export function canAccessLoler") &&
    permissions.includes("export function canManageLoler") &&
    permissions.includes('if (itemId === "loler") return canAccessLoler(role);'),
  "wiring: client permissions define LOLER access without changing existing roles",
);

const navItemsSource = read("src/config/navItems.ts");
assert(navItemsSource.includes('{ id: "loler", label: "LOLER"'), "wiring: nav catalog contains LOLER entry");

const roleNav = read("src/config/roleNavigation.ts");
assert(
  (roleNav.match(/id: "loler"/g) || []).length >= 4,
  "wiring: LOLER present in Master, Admin, Manager, and Auditor nav buckets",
);

const navigationTypes = read("src/types/navigation.ts");
assert(navigationTypes.includes('| "loler"'), "wiring: RoutedScreen includes loler");

const cardDefinitions = read("src/dashboard-layout/cardDefinitions.ts");
assert(
  (cardDefinitions.match(/id: "loler-summary"/g) || []).length === 2,
  "wiring: LOLER summary card registered for admin and manager dashboards",
);

const lolerScreen = read("src/screens/LolerScreen.tsx");
assert(
  lolerScreen.includes("LOLER_OFFLINE_WRITE_MESSAGE") && lolerScreen.includes("guardWrite"),
  "wiring: offline writes are blocked with a clear message",
);
assert(
  lolerScreen.includes("fetchCompanyStructure") && lolerScreen.includes("loadScheduleAssigneesCached"),
  "wiring: site/area/person pickers use existing company data sources",
);

const lolerClient = read("src/services/lolerService.ts");
assert(
  lolerClient.includes("dedupeInFlight") && lolerClient.includes("readCachedLolerEquipment"),
  "wiring: LOLER client dedupes requests and preserves cached data during refresh",
);

console.log(`verify:loler passed (${caseCount} checks).`);
