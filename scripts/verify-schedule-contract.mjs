#!/usr/bin/env node
/**
 * Schedule contract — listSchedules, listScheduleAssignees (same users), saveSchedule with AssignedUserEmails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignedUserEmailsFromSchedule,
  buildSchedulesTabRows,
} from "../shared/schedule-save.mjs";
import {
  getScheduleAssignedEmails,
  isScheduleAssignedToUser,
} from "../shared/schedule-assignment.mjs";

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
const assigneeService = read("server/schedule-assignee-service.mjs");
const foundation = read("server/company-users-foundation.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");

assert(pkg.scripts["verify:schedule-contract"], "1: npm script registered");
assert(scheduleService.includes("listSchedules"), "2: scheduleService.listSchedules alias");
assert(scheduleService.includes("listScheduleAssignees"), "3: scheduleService.listScheduleAssignees");
assert(scheduleService.includes("saveSchedule"), "4: scheduleService.saveSchedule alias");
assert(assigneeService.includes("getAssignableUsers"), "5: assignees use same Users tab path");
assert(foundation.includes("getAssignableUsers"), "6: foundation getAssignableUsers for assignees");
assert(coreRoutes.includes("getScheduleAssigneesForCompany"), "7: routes wire schedule assignees");
assert(coreRoutes.includes("listCompanySchedules"), "8: routes wire schedule list");

{
  const assignedUsers = [
    { email: "manager@testco.test", name: "Site Manager", role: "Manager", accessLevel: "operational" },
    { email: "auditor@testco.test", name: "Field Auditor", role: "Auditor", accessLevel: "AUDITOR" },
  ];
  const payload = {
    id: "schedule-1",
    companyFolderId: "company-1",
    scheduleName: "Daily walk",
    lifecycle: "Live",
    audits: [{ auditId: "audit-1", auditName: "Fire walk", frequency: "Daily" }],
    assignedUserEmails: assignedUsers.map((user) => user.email),
    assignedUsers,
  };
  assert(
    assignedUserEmailsFromSchedule(payload).join(",") === "manager@testco.test,auditor@testco.test",
    "9: save payload exposes assignedUserEmails",
  );
  const rows = buildSchedulesTabRows(payload, assignedUsers);
  assert(rows[0]["Assigned User Emails"] === "manager@testco.test, auditor@testco.test", "10: sheet column written");
}

{
  const schedule = {
    id: "s1",
    assignedUserEmails: ["auditor@testco.test"],
    assignedUsers: [{ email: "auditor@testco.test" }],
  };
  assert(getScheduleAssignedEmails(schedule).includes("auditor@testco.test"), "11: load reads assignedUserEmails");
  assert(isScheduleAssignedToUser(schedule, "auditor@testco.test"), "12: isScheduleAssignedToUser");
}

{
  const scheduleSaveUtil = read("src/utils/scheduleSave.ts");
  assert(scheduleSaveUtil.includes("resolveScheduleSaveValidationMessage"), "13: schedule save validation helper");
  assert(
    scheduleSaveUtil.includes("No audit templates are available yet"),
    "14: empty picker validation message",
  );
  assert(
    scheduleSaveUtil.includes("Select at least one audit for this schedule"),
    "15: audit selection validation message",
  );
  const appSrc = read("App.tsx");
  assert(appSrc.includes("resolveScheduleSaveValidationMessage"), "16: App uses schedule validation helper");
  assert(appSrc.includes("syncCompanyAuditMappingFromServer({ silent: true })"), "17: schedules screen reloads audit templates");
  assert(
    appSrc.includes("resolveCompanyMembersLoadContext") &&
      /resolveWorkspaceMasterSheetId[\s\S]*?resolveCompanyMembersLoadContext/.test(appSrc),
    "17b: audit template sync resolves masterSheetId from company context",
  );
  const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
  assert(schedulesScreen.includes("No audit templates yet"), "18: schedules UI empty audit picker state");
  assert(
    /setMappingSyncLoading\(true\)[\s\S]*?syncCompanyAuditMappingFromServer/.test(appSrc) &&
      !/if \(!options\?\.silent\) \{\s*setMappingSyncLoading\(true\)/.test(appSrc),
    "19: audit mapping load always drives schedule picker loading state",
  );
}

console.log(`[verify:schedule-contract] OK — ${caseCount} cases passed`);
