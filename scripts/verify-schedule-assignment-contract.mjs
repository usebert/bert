#!/usr/bin/env node
/**
 * Schedule assignment contract — assignedUserEmails save/load, listAssignedChecks, isScheduleAssignedToUser.
 * Complements verify:schedule-assignees (assignee picker) with sheet + API contract guards.
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

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const scheduleService = read("server/schedule-service.mjs");
const checkService = read("server/check-service.mjs");
const frontendSchedule = read("src/services/scheduleService.ts");
const frontendCheck = read("src/services/checkService.ts");
const appSrc = read("App.tsx");

/** 1: npm script registered. */
assert(pkg.scripts["verify:schedule-assignment-contract"], "1: npm script registered");

/** 2: Core service exports per spec naming. */
assert(scheduleService.includes("export async function listCompanySchedules"), "2: listCompanySchedules exported");
assert(scheduleService.includes("export async function saveCompanySchedule"), "2b: saveCompanySchedule exported");
assert(
  scheduleService.includes("saveCompanySchedule as saveSchedule") ||
    scheduleService.includes("export async function saveSchedule"),
  "2c: saveSchedule alias exported",
);
assert(
  scheduleService.includes("listMyChecks as listAssignedChecks") ||
    scheduleService.includes("export async function listAssignedChecks"),
  "2d: listAssignedChecks alias exported",
);
assert(scheduleService.includes("listMyChecks"), "2d2: listMyChecks exported");
assert(checkService.includes("listMyChecks"), "2e: check service uses listMyChecks");
assert(checkService.includes("submitCompletedCheck"), "2f: check service submits AuditResults");
assert(read("server/completion-service.mjs").includes("verifyScheduleCompletionEligibility"), "2g: completion service eligibility");

/** 3: assignedUserEmails written on save payload and sheet rows. */
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
    "3: save payload exposes assignedUserEmails",
  );
  const rows = buildSchedulesTabRows(payload, assignedUsers);
  assert(rows[0]["Assigned User Emails"] === "manager@testco.test, auditor@testco.test", "3b: sheet column written");
}

/** 4: load reads assignedUserEmails with legacy fallbacks. */
{
  const canonical = getScheduleAssignedEmails({ assignedUserEmails: "manager@testco.test, auditor@testco.test" });
  assert(canonical.length === 2, "4: canonical assignedUserEmails parsed");
  const legacy = getScheduleAssignedEmails({ auditors: "auditor@testco.test" });
  assert(legacy.includes("auditor@testco.test"), "4b: legacy auditors fallback");
}

/** 5: isScheduleAssignedToUser normalizes trim + lowercase. */
{
  const schedule = { assignedUserEmails: " Manager@TestCo.TEST , auditor@testco.test " };
  assert(isScheduleAssignedToUser(schedule, "  MANAGER@testco.test "), "5: assignee match is case-insensitive");
  assert(!isScheduleAssignedToUser(schedule, "other@testco.test"), "5b: non-assignee rejected");
}

/** 6: Frontend services mirror server contract. */
assert(frontendSchedule.includes("listCompanySchedules"), "6: frontend listCompanySchedules");
assert(
  frontendSchedule.includes("saveCompanySchedule as saveSchedule") ||
    frontendSchedule.includes("export async function saveCompanySchedule"),
  "6b: frontend saveSchedule/saveCompanySchedule",
);
assert(frontendSchedule.includes("assignedUserEmails"), "6c: frontend persists assignedUserEmails");
assert(
  frontendCheck.includes("fetchAssignedChecks as listAssignedChecks") ||
    frontendCheck.includes("fetchAssignedChecks as listAssignedSchedulesForUser") ||
    frontendCheck.includes("fetchAssignedChecks"),
  "6d: frontend listAssignedChecks path",
);
assert(frontendCheck.includes("/api/me/assigned-checks"), "6e: frontend uses assigned-checks API");

/** 7: App wires folder-first schedule context (no registry gate). */
assert(
  appSrc.includes("listCompanySchedules") &&
    (appSrc.includes("activeCompanyContext") || appSrc.includes("resolveCompanyMembersLoadContext")),
  "7: App lists schedules via company context",
);
assert(scheduleService.includes("resolveCompanyFromFolder"), "7b: folder-first schedule context on server");
assert(!scheduleService.includes("assertCompanyLiveForInvite"), "7c: no live gate on schedule list");

console.log("[verify:schedule-assignment-contract] OK: schedule assignment contract verified");
