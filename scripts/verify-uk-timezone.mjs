#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UK_TIME_ZONE,
  compareUkCalendarDates,
  formatUkDateTime,
  getUkTodayKey,
  isUkOverdue,
  ukDateKeyFromTimestamp,
} from "../shared/uk-date-time.mjs";

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

assert(UK_TIME_ZONE === "Europe/London", "UK timezone constant uses Europe/London");
assert(getUkTodayKey("2026-07-09T22:30:00.000Z") === "2026-07-09", "UK today key uses Europe/London clock");
assert(ukDateKeyFromTimestamp("2026-07-09T23:30:00.000Z") === "2026-07-10", "23:30 UTC crosses to next UK day in BST");
assert(compareUkCalendarDates("2026-07-08", "2026-07-09") < 0, "UK calendar date comparison works");
assert(isUkOverdue("2026-07-08", "2026-07-09T08:00:00.000Z"), "Overdue uses UK day, not UTC instant alone");
assert(!isUkOverdue("2026-07-09", "2026-07-09T12:00:00.000Z"), "Due today is not overdue in UK day");

const bstLabel = formatUkDateTime("2026-07-01T12:00:00.000Z");
const gmtLabel = formatUkDateTime("2026-01-01T12:00:00.000Z");
assert(/BST/i.test(bstLabel), "Summer display includes BST");
assert(/GMT/i.test(gmtLabel), "Winter display includes GMT");

const liveDashboard = read("shared/live-dashboard.mjs");
const reportsDashboard = read("shared/reports-dashboard.mjs");
const syncCentre = read("src/screens/SyncCentreScreen.tsx");
const scheduleDueShared = read("shared/schedule-due.mjs");
const scheduleDueClient = read("src/utils/scheduleDue.ts");
const qmsReadiness = read("src/utils/qmsReadiness.ts");
const incidentScreen = read("src/screens/IncidentReportingScreen.tsx");
const dashboardToDo = read("src/utils/dashboardToDo.ts");
const briefingsService = read("server/briefings-service.mjs");

assert(liveDashboard.includes("getUkTodayKey"), "Dashboard today uses UK day key");
assert(liveDashboard.includes("isUkOverdue"), "Dashboard overdue uses UK comparisons");
assert(reportsDashboard.includes("isUkOverdue"), "Reports action overdue uses UK comparisons");
assert(scheduleDueShared.includes("ukDateTimeToUtcDate"), "Shared schedule windows use UK datetime conversion");
assert(scheduleDueClient.includes("ukDateTimeToUtcDate"), "Client schedule windows use UK datetime conversion");
assert(qmsReadiness.includes("isUkOverdue"), "QMS overdue checks use UK helper");
assert(incidentScreen.includes("getUkTodayKey"), "Incident defaults use UK today");
assert(incidentScreen.includes("isUkOverdue"), "Incident overdue actions use UK comparisons");
assert(syncCentre.includes("formatUkDateTime"), "Sync Centre timestamps display in UK time");
assert(syncCentre.includes("Times shown in UK time"), "Sync Centre shows UK time label");
assert(dashboardToDo.includes("compareUkCalendarDates"), "Dashboard to-do due-today uses UK calendar compare");
assert(briefingsService.includes("isUkOverdue"), "Briefings overdue logic uses UK compare");

const criticalFiles = [
  "shared/schedule-due.mjs",
  "src/utils/scheduleDue.ts",
  "shared/live-dashboard.mjs",
  "shared/reports-dashboard.mjs",
  "src/utils/qmsReadiness.ts",
  "src/screens/IncidentReportingScreen.tsx",
  "src/utils/dashboardToDo.ts",
  "server/briefings-service.mjs",
];
const forbiddenFixedOffsets = criticalFiles.some((entry) => {
  const file = read(entry);
  return file.includes("+00:00") || file.includes("+01:00");
});
assert(!forbiddenFixedOffsets, "No fixed +00:00/+01:00 logic remains");

console.log(`[verify:uk-timezone] ${caseCount} checks OK`);
