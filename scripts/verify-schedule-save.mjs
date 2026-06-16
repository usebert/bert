#!/usr/bin/env node
/** Ten schedule save cases — assignedUsers payload, Schedules tab, backward-compat load, errors. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEDULES_TAB,
  SCHEDULES_TAB_COLUMNS,
  SCHEDULE_SAVE_FAILED_CODE,
  SCHEDULE_SAVE_FAILED_MESSAGE,
  assignedUsersFromSchedule,
  buildAssignedUsersFromSelection,
  buildSchedulesTabRows,
  parseAssignedUsersFromRecord,
  parseAuditorEmailsFromRecord,
  scheduleRecordsPreferSchedulesTab,
} from "../shared/schedule-save.mjs";

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

const assigneeOptions = [
  { id: "admin@example.com", email: "admin@example.com", name: "Company Admin", role: "Admin" },
  { id: "manager@example.com", email: "manager@example.com", name: "Site Manager", role: "Manager" },
  { id: "auditor@example.com", email: "auditor@example.com", name: "Auditor", role: "Auditor" },
];

const tabRows = [
  { email: "admin@example.com", name: "Company Admin", role: "Admin", accessLevel: "full", status: "ACTIVE", companyId: "c1", companyAreas: [] },
  { email: "manager@example.com", name: "Site Manager", role: "Manager", accessLevel: "operational", status: "ACTIVE", companyId: "c1", companyAreas: [] },
  { email: "auditor@example.com", name: "Auditor", role: "Auditor", accessLevel: "AUDITOR", status: "ACTIVE", companyId: "c1", companyAreas: [] },
];

const sampleSchedule = {
  id: "schedule-1",
  companyFolderId: "company-folder-1",
  scheduleName: "Weekly checks",
  lifecycle: "Live",
  startDate: "2026-06-01",
  endDate: "",
  updatedAt: "2026-06-09T10:00:00.000Z",
  createdBy: "admin@example.com",
  audits: [
    {
      auditId: "audit-1",
      auditName: "Fire walk",
      days: ["Mon", "Wed"],
      frequency: "Weekly",
      liveTime: "08:00",
      completionHours: 24,
    },
  ],
};

/** 1: assignedUsers payload includes email, name, role, accessLevel for Admin. */
{
  const users = buildAssignedUsersFromSelection(["admin@example.com"], assigneeOptions, tabRows);
  assert(users.length === 1, "1: one assigned user");
  assert(users[0].email === "admin@example.com", "1b: email");
  assert(users[0].name === "Company Admin", "1c: name");
  assert(users[0].role === "Admin", "1d: role");
  assert(users[0].accessLevel === "full", "1e: accessLevel");
}

/** 2: Manager + Auditor multi-role selection preserved. */
{
  const users = buildAssignedUsersFromSelection(
    ["manager@example.com", "auditor@example.com"],
    assigneeOptions,
    tabRows,
  );
  assert(users.length === 2, "2: two assigned users");
  assert(users.some((user) => user.role === "Manager"), "2b: manager role");
  assert(users.some((user) => user.role === "Auditor" && user.accessLevel === "AUDITOR"), "2c: auditor accessLevel");
}

/** 3: Schedules tab rows include required columns. */
{
  const users = buildAssignedUsersFromSelection(["admin@example.com"], assigneeOptions, tabRows);
  const rows = buildSchedulesTabRows({ ...sampleSchedule, assignedUsers: users }, users);
  assert(rows.length === 1, "3: one row per audit");
  for (const column of [
    "Schedule ID",
    "Template Name",
    "Frequency",
    "Days Of Week",
    "Start Date",
    "End Date",
    "Continuous",
    "Due Window",
    "Assigned User Emails",
    "Assigned User Names",
    "Assigned User Roles",
    "Status",
    "Created By",
    "Created At",
    "Updated At",
  ]) {
    assert(Object.prototype.hasOwnProperty.call(rows[0], column), `3b: column ${column}`);
  }
  assert(rows[0]["Assigned User Emails"] === "admin@example.com", "3c: assigned emails written");
}

/** 4: Backward-compat load from Auditors column. */
{
  const auditors = parseAuditorEmailsFromRecord({ Auditors: "admin@example.com, manager@example.com" });
  assert(auditors.length === 2, "4: legacy auditors parsed");
}

/** 5: Backward-compat load from auditorEmails / assignedAuditors. */
{
  const fromEmails = parseAuditorEmailsFromRecord({ "Auditor Emails": "auditor@example.com" });
  const fromAssigned = parseAuditorEmailsFromRecord({ "Assigned Auditors": "manager@example.com" });
  assert(fromEmails[0] === "auditor@example.com", "5: auditorEmails");
  assert(fromAssigned[0] === "manager@example.com", "5b: assignedAuditors");
}

/** 6: assignedUsers load from assigned user email/name/role columns. */
{
  const users = parseAssignedUsersFromRecord({
    "Assigned User Emails": "admin@example.com, manager@example.com",
    "Assigned User Names": "Company Admin, Site Manager",
    "Assigned User Roles": "Admin, Manager",
  });
  assert(users.length === 2, "6: assignedUsers parsed");
  assert(users[0].role === "Admin" && users[1].role === "Manager", "6b: roles preserved");
}

/** 7: Prefer Schedules tab records over legacy Schedule tab. */
{
  const preferred = scheduleRecordsPreferSchedulesTab([{ "Schedule ID": "legacy" }], [{ "Schedule ID": "new" }]);
  assert(preferred[0]["Schedule ID"] === "new", "7: Schedules tab preferred");
}

/** 8: assignedUsersFromSchedule falls back to auditors array. */
{
  const users = assignedUsersFromSchedule({ auditors: ["user@example.com"] });
  assert(users.length === 1 && users[0].email === "user@example.com", "8: auditors fallback");
}

/** 9: Save failure code/message contract. */
{
  assert(SCHEDULE_SAVE_FAILED_CODE === "SCHEDULE_SAVE_FAILED", "9: failure code");
  assert(SCHEDULE_SAVE_FAILED_MESSAGE.includes("BERT could not save"), "9b: failure message");
  const saveService = read("server/schedule-save-service.mjs");
  const coreRoutes = read("server/core-workflow-routes.mjs");
  assert(saveService.includes("SCHEDULE_SAVE_FAILED"), "9c: service returns failure code");
  assert(coreRoutes.includes("/api/companies/:companyId/schedules"), "9d: company schedules save route");
  assert(coreRoutes.includes('app.get("/api/companies/:companyId/schedules"'), "9e: company schedules list route");
  assert(read("server/schedule-service.mjs").includes("listCompanySchedules"), "9f: shared schedule service lists by company");
}

/** 10: No PasswordHash in save path; frontend uses company context + assignedUsers. */
{
  const appSrc = read("App.tsx");
  const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
  const scheduleSaveUtil = read("src/utils/scheduleSave.ts");
  assert(appSrc.includes("assignedUsers"), "10: App sends assignedUsers");
  assert(appSrc.includes("activeCompanyContext.masterSheetId"), "10b: App uses company context masterSheetId");
  assert(appSrc.includes("listCompanySchedules"), "10c: App lists schedules via schedule service");
  assert(read("src/services/scheduleService.ts").includes("saveCompanySchedule"), "10c2: schedule service save helper");
  assert(scheduleSaveUtil.includes("buildAssignedUsersForSave"), "10d: client save helper exists");
  assert(schedulesScreen.includes("Saving schedule"), "10e: save button shows saving state");
  assert(!saveServiceIncludesPasswordHash(read("server/schedule-save-service.mjs")), "10f: save service has no PasswordHash");
  assert(SCHEDULES_TAB === "Schedules", "10g: Schedules tab constant");
  assert(SCHEDULES_TAB_COLUMNS.includes("Assigned User Emails"), "10h: Schedules tab columns include assigned users");
}

function saveServiceIncludesPasswordHash(source) {
  return /passwordhash/i.test(source);
}

console.log("[verify:schedule-save] OK: all 10 schedule save cases passed");
