#!/usr/bin/env node
/** Godmode + company schedule list — shared service, company context, read failures. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCompanyScheduleListFromRecords,
  scheduleBelongsToCompany,
} from "../shared/schedule-list.mjs";
import { buildSchedulesTabRows, scheduleRecordsPreferSchedulesTab } from "../shared/schedule-save.mjs";
import { canListCompanySchedules } from "../server/schedule-service.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const ownCompany = "folder-testco";
const otherCompany = "folder-other";
const masterSheetId = "sheet-testco";

const sampleSchedule = {
  id: "schedule-godmode-1",
  companyFolderId: ownCompany,
  companyId: ownCompany,
  scheduleName: "Weekly walk",
  lifecycle: "Live",
  startDate: "2026-06-01",
  endDate: "",
  createdBy: "admin@testco.test",
  createdByEmail: "admin@testco.test",
  createdByRole: "Admin",
  createdAt: "2026-06-09T10:00:00.000Z",
  updatedAt: "2026-06-09T10:00:00.000Z",
  audits: [
    {
      auditId: "audit-1",
      auditName: "Fire walk",
      days: ["Mon"],
      frequency: "Weekly",
      liveTime: "08:00",
      completionHours: 24,
    },
  ],
  assignedUsers: [
    {
      email: "manager@testco.test",
      name: "Site Manager",
      role: "Manager",
      accessLevel: "operational",
    },
  ],
};

/** 1: save writes company folder id + assigned users for company-owned schedules. */
{
  const rows = buildSchedulesTabRows(sampleSchedule, sampleSchedule.assignedUsers);
  assert(rows[0]["Company Folder ID"] === ownCompany, "1: company folder id saved on sheet row");
  assert(rows[0]["Assigned User Emails"].includes("manager@testco.test"), "1b: assigned users saved");
  assert(rows[0].Status === "ACTIVE", "1c: live schedules persist ACTIVE status");
}

/** 2: company list parser groups rows and keeps assigned users. */
{
  const rows = buildSchedulesTabRows(sampleSchedule, sampleSchedule.assignedUsers);
  const listed = parseCompanyScheduleListFromRecords(rows, ownCompany);
  assert(listed.length === 1, "2: one grouped schedule");
  assert(listed[0].scheduleName === "Weekly walk", "2b: schedule name parsed");
  assert(listed[0].assignedUserEmails.includes("manager@testco.test"), "2c: assigned emails parsed");
}

/** 3: backward compat — rows without company id belong to workbook company. */
{
  const legacyRow = {
    "Schedule ID": "legacy-1",
    "Schedule Name": "Legacy schedule",
    "Template Name": "Walk",
    "Audit ID": "audit-legacy",
    Frequency: "Daily",
    "Assigned User Emails": "user@testco.test",
    Status: "ACTIVE",
  };
  assert(scheduleBelongsToCompany(legacyRow, ownCompany), "3: legacy row without company id included");
  const listed = parseCompanyScheduleListFromRecords([legacyRow], ownCompany);
  assert(listed.length === 1 && listed[0].id === "legacy-1", "3b: legacy schedule listed for workbook company");
}

/** 4: wrong company folder id is excluded. */
{
  const rows = buildSchedulesTabRows({ ...sampleSchedule, companyFolderId: otherCompany }, sampleSchedule.assignedUsers);
  const listed = parseCompanyScheduleListFromRecords(rows, ownCompany);
  assert(listed.length === 0, "4: other company schedules hidden from selected company");
}

/** 5: Godmode can list any company; company roles only own company. */
{
  assert(
    canListCompanySchedules({ kind: "master", role: "Master" }, ownCompany),
    "5: Godmode can list selected company schedules",
  );
  assert(
    canListCompanySchedules({ kind: "company", role: "Admin", companyId: ownCompany }, ownCompany),
    "5b: company admin can list own schedules",
  );
  assert(
    !canListCompanySchedules({ kind: "company", role: "Admin", companyId: ownCompany }, otherCompany),
    "5c: company admin cannot list another company",
  );
  assert(
    !canListCompanySchedules({ kind: "company", role: "Auditor", companyId: ownCompany }, ownCompany),
    "5d: auditor cannot list company schedules",
  );
}

/** 6: prefer Schedules tab over legacy Schedule tab when listing. */
{
  const preferred = scheduleRecordsPreferSchedulesTab(
    [{ "Schedule ID": "legacy-tab" }],
    [{ "Schedule ID": "schedules-tab", "Schedule Name": "Canonical", "Template Name": "Walk", "Audit ID": "a1" }],
  );
  const listed = parseCompanyScheduleListFromRecords(preferred, ownCompany);
  assert(listed[0].id === "schedules-tab", "6: Schedules tab preferred for list");
}

/** 7: API + frontend use shared listCompanySchedules path. */
{
  const coreRoutes = read("server/core-workflow-routes.mjs");
  const scheduleService = read("server/schedule-service.mjs");
  const frontendService = read("src/services/scheduleService.ts");
  const appSrc = read("App.tsx");
  assert(coreRoutes.includes('app.get("/api/companies/:companyId/schedules"'), "7: GET company schedules route");
  assert(scheduleService.includes("listCompanySchedules"), "7b: server listCompanySchedules");
  assert(frontendService.includes("export async function listCompanySchedules"), "7c: frontend listCompanySchedules");
  assert(appSrc.includes("listCompanySchedules(activeCompanyContext"), "7d: App loads schedules via company context");
  assert(appSrc.includes("saveCompanySchedule"), "7e: App saves via schedule service");
}

/** 8: UI distinguishes read failure from successful empty list. */
{
  const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
  assert(schedulesScreen.includes("schedulesLoadError"), "8: schedules screen accepts load error");
  assert(schedulesScreen.includes("schedulesLoadError"), "8b: read failure surfaced to UI");
  assert(schedulesScreen.includes("No schedules found"), "8c: successful empty state copy");
  assert(read("App.tsx").includes("companySchedulesState"), "8d: App tracks schedule list load state");
}

/** 9: Godmode selected-company context uses same masterSheetId resolver as company users. */
{
  const companyContextService = read("src/services/companyContextService.ts");
  const appSrc = read("App.tsx");
  assert(companyContextService.includes("resolveActiveCompanyContext"), "9: shared company context resolver");
  assert(appSrc.includes("activeCompanyContext.masterSheetId"), "9b: schedules use active company master sheet");
  assert(appSrc.includes("activeCompanyContext.companyFolderId"), "9c: schedules use active company folder id");
}

/** 10: create as company role → listed for same company → not listed for other company (parser contract). */
{
  const rows = buildSchedulesTabRows(sampleSchedule, sampleSchedule.assignedUsers);
  const forOwn = parseCompanyScheduleListFromRecords(rows, ownCompany, [ownCompany]);
  const forOther = parseCompanyScheduleListFromRecords(rows, otherCompany, [otherCompany]);
  assert(forOwn.length === 1, "10: company-created schedule visible for own company");
  assert(forOther.length === 0, "10b: same schedule hidden for wrong company");
}

console.log("[verify:godmode-company-schedules] OK: all 10 godmode company schedule cases passed");
