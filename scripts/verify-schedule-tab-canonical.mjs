#!/usr/bin/env node
/**
 * Canonical Schedules tab — plural tab is source of truth; legacy Schedule is read/migrate only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGACY_SCHEDULE_TAB,
  SCHEDULES_TAB,
  scheduleRecordsPreferSchedulesTab,
} from "../shared/schedule-save.mjs";
import { mergeCompanyScheduleLists } from "../shared/schedule-list.mjs";
import { SETUP_REQUIRED_TABS } from "../server/ensure-required-tabs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const scheduleService = read("server/schedule-service.mjs");
const serverMain = read("server/server.mjs");
const auditMapping = read("server/company-audit-mapping.mjs");
const workspaceReset = read("server/company-workspace-reset.mjs");
const companySchema = read("src/schema/companySchema.ts");
const ensureTabs = read("server/ensure-required-tabs.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const frontendSchedule = read("src/services/scheduleService.ts");
const appTsx = read("App.tsx");

assert(pkg.scripts["verify:schedule-tab-canonical"], "1: npm script registered");
assert(SCHEDULES_TAB === "Schedules", "2: canonical tab constant is Schedules");
assert(LEGACY_SCHEDULE_TAB === "Schedule", "3: legacy tab constant is Schedule");

/** Required tabs use Schedules (plural), not legacy Schedule. */
assert(SETUP_REQUIRED_TABS.includes("Schedules"), "4: setup required tabs include Schedules");
assert(!SETUP_REQUIRED_TABS.includes("Schedule"), "5: setup required tabs exclude legacy Schedule");
assert(ensureTabs.includes('"Schedules"'), "6: ensure-required-tabs references Schedules");

assert(serverMain.includes('"Schedules"'), "7: server REQUIRED_TABS includes Schedules");
assert(!/REQUIRED_TABS\s*=\s*\[[\s\S]*?"Schedule"[\s\S]*?\]/.test(serverMain), "8: server REQUIRED_TABS excludes legacy Schedule");

assert(companySchema.includes('"Schedules"'), "9: companySchema REQUIRED_TABS includes Schedules");
assert(companySchema.includes("LEGACY_SCHEDULE_TAB_NAME"), "10: companySchema documents legacy tab");
assert(!companySchema.includes('"Schedule",\n  "Actions"'), "11: companySchema does not require legacy Schedule tab");

/** Schedule service writes canonical tab only. */
assert(scheduleService.includes("export async function writeScheduleToTab"), "12: writeScheduleToTab exported");
assert(scheduleService.includes("${SCHEDULES_TAB}!"), "13: write targets Schedules tab range");
assert(!scheduleService.includes("writeLegacyCompanySchedules"), "14: no legacy dual-write helper");
assert(scheduleService.includes("migrateLegacySchedulesToCanonicalTab"), "15: legacy migration on read");
assert(scheduleService.includes("readLegacyScheduleRecords"), "16: legacy read helper exists");
assert(scheduleService.includes("mergeCompanyScheduleLists"), "16b: canonical + legacy schedules merge on read");
assert(scheduleService.includes("LEGACY_SCHEDULE_TAB"), "17: legacy tab used for read fallback");

const writeBlock = scheduleService.slice(
  scheduleService.indexOf("export async function writeScheduleToTab"),
  scheduleService.indexOf("export async function listCompanySchedules"),
);
assert(!writeBlock.includes("LEGACY_SCHEDULE_TAB"), "18: writeScheduleToTab never touches legacy tab");
assert(!writeBlock.includes("`Schedule!"), "19: writeScheduleToTab has no legacy Schedule sheet range");

/** Removed legacy server write path. */
assert(!serverMain.includes("writeCompanySchedules"), "20: server has no writeCompanySchedules");
assert(!serverMain.includes("writeLegacyCompanySchedules"), "21: server has no writeLegacyCompanySchedules");
assert(!coreRoutes.includes("writeLegacyCompanySchedules"), "22: core routes have no legacy write dep");

/** Audit mapping prefers canonical Schedules. */
assert(auditMapping.includes("readAuditMappingSchedules"), "23: audit mapping schedule reader");
assert(auditMapping.includes("SCHEDULES_TAB"), "24: audit mapping reads Schedules tab");
assert(auditMapping.includes("LEGACY_SCHEDULE_TAB"), "25: audit mapping legacy fallback");
assert(auditMapping.includes("scheduleTabRecordsPreferCanonical"), "26: audit mapping prefers canonical records");

/** Workspace reset seeds Schedules, not legacy Schedule. */
assert(workspaceReset.includes("SCHEDULES_TAB"), "27: workspace reset uses SCHEDULES_TAB");
assert(!workspaceReset.includes('["Schedule", TAB_COLUMNS.Schedule]'), "28: workspace reset does not seed legacy Schedule");

/** Frontend uses canonical schedule service. */
assert(frontendSchedule.includes("listCompanySchedules"), "29: frontend listCompanySchedules");
assert(frontendSchedule.includes("saveCompanySchedule"), "30: frontend saveCompanySchedule");
assert(appTsx.includes("listCompanySchedules"), "31: App loads schedules via schedule service");
assert(appTsx.includes('"Schedules"'), "32: App workspace tabs include Schedules");

/** Prefer helper keeps canonical rows when both tabs exist. */
{
  const preferred = scheduleRecordsPreferSchedulesTab(
    [{ "Schedule ID": "legacy-only" }],
    [{ "Schedule ID": "canonical" }],
  );
  assert(preferred[0]["Schedule ID"] === "canonical", "33: canonical records preferred over legacy");
  const merged = mergeCompanyScheduleLists(
    [{ id: "canonical", scheduleName: "Canonical schedule", updatedAt: "2026-06-02" }],
    [{ id: "legacy-only", scheduleName: "Legacy schedule", updatedAt: "2026-06-01" }],
  );
  assert(merged.length === 2, "33b: merged schedule lists include both canonical and legacy-only ids");
  assert(merged.some((schedule) => schedule.scheduleName === "Legacy schedule"), "33c: legacy-only schedule survives merge");
}

/** No active server write ranges target legacy Schedule tab. */
const serverFiles = [
  "server/schedule-service.mjs",
  "server/schedule-save-service.mjs",
  "server/core-workflow-routes.mjs",
  "server/background-jobs-service.mjs",
  "server/server.mjs",
];
for (const rel of serverFiles) {
  const source = read(rel);
  assert(!source.includes("range: `Schedule!"), `34: ${rel} has no legacy Schedule write range`);
  assert(!source.includes('range: "Schedule!'), `35: ${rel} has no legacy Schedule write range (quoted)`);
}

console.log(`[verify:schedule-tab-canonical] OK: all ${caseCount} cases passed`);
