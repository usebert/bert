#!/usr/bin/env node
/**
 * People ↔ Scheduler consistency — same listActiveUsers path for both surfaces.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAvailableScheduleAssigneesFromUsers } from "../shared/schedule-assignees.mjs";

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
const foundation = read("server/company-users-foundation.mjs");
const userService = read("server/user-service.mjs");
const companyUserService = read("server/company-user-service.mjs");
const assigneeService = read("server/schedule-assignee-service.mjs");
const scheduleService = read("server/schedule-service.mjs");
const godmodeService = read("server/godmode-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");

assert(pkg.scripts["verify:people-scheduler-consistency"], "1: npm script registered");
assert(userService.includes("listActiveUsers"), "2: userService exports listActiveUsers");
assert(companyUserService.includes("listActiveUsers"), "3: company-user-service listActiveUsers");
assert(foundation.includes("export async function listCompanyProfiles"), "4: foundation listCompanyProfiles");
assert(foundation.includes("export async function getAssignableUsers"), "5: foundation getAssignableUsers");
assert(assigneeService.includes('from "./company-users-foundation.mjs"'), "6: assignees import foundation");
assert(assigneeService.includes("getAssignableUsers(auth, deps"), "7: assignees call foundation getAssignableUsers");
assert(scheduleService.includes("listScheduleAssignees"), "8: scheduleService listScheduleAssignees");
assert(godmodeService.includes("listCompanyProfiles"), "9: godmode People uses listCompanyProfiles");
assert(
  coreRoutes.includes("listCompanyProfiles") && coreRoutes.includes("/api/companies/:companyId/users"),
  "10: GET /users uses listCompanyProfiles",
);
assert(
  coreRoutes.includes("/api/companies/:companyId/schedule-assignees"),
  "11: schedule-assignees route exists",
);

const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
const people = [
  {
    email: "andy@qmsprecast.co.uk",
    name: "Andy Hall",
    role: "Manager",
    accessLevel: "operational",
    status: "ACTIVE",
    companyId: companyFolderId,
    companyFolderId,
    companyAreas: ["Bay 1"],
  },
  {
    email: "7oakcottages@gmail.com",
    name: "sophie Graney",
    role: "Manager",
    accessLevel: "operational",
    status: "ACTIVE",
    companyId: companyFolderId,
    companyFolderId,
    companyAreas: [],
  },
];

const { assignees } = buildAvailableScheduleAssigneesFromUsers(people, {
  companyId: companyFolderId,
  selectedArea: "",
});
assert(assignees.length === people.length, "12: all ACTIVE people are schedule assignees");
for (const member of people) {
  assert(
    assignees.some((row) => row.email === member.email),
    `13: assignee includes ${member.email}`,
  );
}

console.log(`[verify:people-scheduler-consistency] OK — ${caseCount} cases passed`);
