#!/usr/bin/env node
/**
 * scheduleService foundation — assignees from listActiveUsers, Schedules tab I/O, My Checks filters.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildScheduleAssignmentFields,
  isActiveMyCheckScheduleStatus,
  listMyChecks,
  listSchedulerAssignees,
  scheduleMatchesCompanyFolder,
} from "../server/schedule-service.mjs";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";
import { isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";
import { buildSchedulesTabRows } from "../shared/schedule-save.mjs";

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
const saveService = read("server/schedule-save-service.mjs");
const checkService = read("server/check-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const serverMain = read("server/server.mjs");
const userService = read("server/user-service.mjs");

assert(pkg.scripts["verify:schedule-service-foundation"], "1: npm script registered");
assert(scheduleService.includes("listSchedulerAssignees"), "2: listSchedulerAssignees exported");
assert(scheduleService.includes("listActiveUsersFromUserService") || scheduleService.includes("listActiveUsers"), "3: assignees delegate to listActiveUsers");
assert(scheduleService.includes("readSchedulesFromTab"), "4: readSchedulesFromTab exported");
assert(scheduleService.includes("writeScheduleToTab"), "5: writeScheduleToTab exported");
assert(scheduleService.includes("buildScheduleAssignmentFields"), "6: buildScheduleAssignmentFields exported");
assert(scheduleService.includes("listMyChecks"), "7: listMyChecks exported");
assert(scheduleService.includes("readTabRecords"), "8: Schedules tab uses workbookService readTabRecords");
assert(saveService.includes("writeScheduleToTab"), "9: save service delegates to writeScheduleToTab");
assert(assigneeService.includes("listSchedulerAssignees"), "10: assignee service delegates to scheduleService");
assert(checkService.includes("listMyChecks"), "11: check service uses listMyChecks");
assert(read("server/completion-service.mjs").includes("submitCompletedCheck"), "11b: completion service submits AuditResults");
assert(coreRoutes.includes("listSchedulerAssignees"), "12: routes wire listSchedulerAssignees");
assert(serverMain.includes("listSchedulerAssignees"), "13: legacy assignee routes use scheduleService");
assert(!assigneeService.includes("session-fallback"), "14: no session-fallback assignee path");
assert(!assigneeService.includes("auth-index"), "15: no auth-index assignee path");
assert(!scheduleService.includes("isAuditorUser"), "16: no Auditor-only filter helper");
assert(!scheduleService.includes("buildSessionActorAssignee"), "17: no session actor assignee fallback");

const companyFolderId = "folder-company-a";
const activeUsers = [
  { email: "admin@testco.test", name: "Co Admin", role: "Admin", status: "ACTIVE", companyFolderId },
  { email: "manager@testco.test", name: "Site Manager", role: "Manager", status: "ACTIVE", companyFolderId },
  { email: "auditor@testco.test", name: "Field Auditor", role: "Auditor", status: "ACTIVE", companyFolderId },
  { email: "user@testco.test", name: "Operator", role: "User", status: "ACTIVE", companyFolderId },
];

const people = buildAvailableScheduleAssigneesFromUsers(activeUsers, { companyId: companyFolderId });
const scheduler = buildAvailableScheduleAssigneesFromUsers(activeUsers, { companyId: companyFolderId });
assert(people.assignees.length === activeUsers.length, "18: all ACTIVE roles assignable");
assert(scheduler.assignees.length === people.assignees.length, "19: People vs Scheduler same count");
for (const user of activeUsers) {
  assert(
    people.assignees.some((row) => row.email === user.email) &&
      scheduler.assignees.some((row) => row.email === user.email),
    `20: both surfaces include ${user.email}`,
  );
}

const assignment = buildScheduleAssignmentFields(activeUsers, [
  "manager@testco.test",
  "auditor@testco.test",
]);
assert(
  assignment.AssignedUserEmails === "manager@testco.test, auditor@testco.test",
  "21: AssignedUserEmails primary",
);
assert(assignment.AssignedUserNames === "Site Manager, Field Auditor", "22: AssignedUserNames derived");
assert(assignment.AssignedUserRoles === "Manager, Auditor", "23: AssignedUserRoles derived");

const rows = buildSchedulesTabRows(
  {
    id: "schedule-1",
    companyFolderId,
    scheduleName: "Daily walk",
    audits: [{ auditId: "audit-1", auditName: "Fire walk", frequency: "Daily" }],
    assignedUserEmails: assignment.assignedUserEmails,
  },
  assignment.assignedUsers.map((user) => ({ ...user, accessLevel: "operational" })),
);
assert(rows[0]["Assigned User Emails"] === "manager@testco.test, auditor@testco.test", "24: sheet writes Assigned User Emails");
assert(rows[0]["Assigned User Names"] === "Site Manager, Field Auditor", "25: sheet writes Assigned User Names");
assert(rows[0]["Assigned User Roles"] === "Manager, Auditor", "26: sheet writes Assigned User Roles");

assert(isActiveMyCheckScheduleStatus({ status: "ACTIVE" }), "27: ACTIVE status passes My Checks filter");
assert(isActiveMyCheckScheduleStatus({ lifecycle: "Live" }), "28: Live lifecycle passes");
assert(isActiveMyCheckScheduleStatus({ status: "scheduled" }), "29: scheduled status passes");
assert(!isActiveMyCheckScheduleStatus({ status: "Archived" }), "30: archived excluded");

assert(scheduleMatchesCompanyFolder({ companyFolderId }, companyFolderId), "31: company folder match");
assert(!scheduleMatchesCompanyFolder({ companyFolderId: "other-folder" }, companyFolderId), "32: other folder excluded");
assert(
  scheduleMatchesCompanyFolder({ companyFolderId: "registry-company-id" }, companyFolderId, [
    companyFolderId,
    "registry-company-id",
  ]),
  "32b: alternate company id matches session folder",
);
assert(
  !scheduleMatchesCompanyFolder({ companyFolderId: "registry-company-id" }, companyFolderId),
  "32c: registry company id excluded without alternates",
);

const scheduleRecords = [
  {
    "Schedule ID": "s-live",
    "Company Folder ID": companyFolderId,
    "Schedule Name": "Live check",
    Status: "Live",
    "Assigned User Emails": "manager@testco.test",
    "Audit ID": "a1",
    "Template Name": "Walk",
    Frequency: "Daily",
  },
  {
    "Schedule ID": "s-archived",
    "Company Folder ID": companyFolderId,
    "Schedule Name": "Archived check",
    Status: "Archived",
    "Assigned User Emails": "manager@testco.test",
    "Audit ID": "a2",
    "Template Name": "Walk",
    Frequency: "Daily",
  },
  {
    "Schedule ID": "s-other-company",
    "Company Folder ID": "other-folder",
    "Schedule Name": "Other company",
    Status: "Live",
    "Assigned User Emails": "manager@testco.test",
    "Audit ID": "a3",
    "Template Name": "Walk",
    Frequency: "Daily",
  },
];

const tabStore = new Map();
async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
  if (tabName !== "Schedules") {
    return { ok: true, records: [], rowCount: 0 };
  }
  return { ok: true, records: scheduleRecords, rowCount: scheduleRecords.length };
}

const myChecks = await listMyChecks(
  null,
  {
    readTabRecords: mockReadTabRecords,
    masterSheetCache: {
      getEntry: (id) => (id === companyFolderId ? { masterSheetId: "sheet-123" } : null),
    },
  },
  {
    email: "manager@testco.test",
    companyFolderId,
    masterSheetId: "sheet-123",
    trustSessionContext: true,
  },
);
assert(myChecks.ok, "33: listMyChecks succeeds with mock tab read");
assert(myChecks.schedules.length === 1, "34: My Checks returns one active assigned schedule");
assert(myChecks.schedules[0].id === "s-live", "35: assigned live schedule kept");
assert(
  isScheduleAssignedToUser(myChecks.schedules[0], "manager@testco.test"),
  "36: assignment uses assignedUserEmails not Auditors field",
);

const listedUsers = activeUsers;
const mockListActiveUsers = async () => ({
  ok: true,
  users: listedUsers,
  companyFolderId,
  companyId: companyFolderId,
  masterSheetId: "sheet-123",
});
const assigneeResult = await listSchedulerAssignees(
  {},
  {
    readTabRecords: mockReadTabRecords,
    listActiveUsers: mockListActiveUsers,
  },
  { companyFolderId, masterSheetId: "sheet-123" },
);
assert(assigneeResult.ok, "37: listSchedulerAssignees succeeds with mock listActiveUsers");
assert(assigneeResult.assignees.length === activeUsers.length, "38: mock assignees include all ACTIVE roles");
assert(userService.includes("listActiveUsers"), "39: userService exports listActiveUsers");

console.log(`[verify:schedule-service-foundation] OK — ${caseCount} cases passed`);
