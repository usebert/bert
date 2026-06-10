#!/usr/bin/env node
/**
 * Major role/path contract — routes, nav, handlers, and must-not-break guards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canCreateCompanyInvite, canInviteCompanyUsers } from "../shared/company-invite-permissions.mjs";
import { canCompleteAudit } from "../shared/schedule-assignees.mjs";
import { getScheduleAssignedEmails, isScheduleAssignedToUser } from "../shared/schedule-assignment.mjs";

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

const appTsx = read("App.tsx");
const roleNav = read("src/config/roleNavigation.ts");
const permissions = read("src/permissions.ts");
const navigation = read("src/types/navigation.ts");
const inviteRoutes = read("src/utils/inviteRoutes.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
const masterAuth = read("server/master-auth.mjs");
const serverMain = read("server/server.mjs");
const companyUsers = read("server/company-users.mjs");
const pkg = JSON.parse(read("package.json"));

const ROUTED_SCREENS = [
  "dashboard",
  "godmodeHome",
  "setup",
  "companies",
  "users",
  "invites",
  "settings",
  "setupInitial",
  "audits",
  "actions",
  "nonConformance",
  "incidents",
  "reports",
  "sync",
  "schedules",
  "documentTraining",
  "admin",
  "onboarding",
  "account",
  "emailReminders",
  "qmsReadiness",
  "auditBuilder",
  "auditTemplateEdit",
  "complete",
];

assert(pkg.scripts["verify:app-paths"], "PKG: npm script registered");

for (const screen of ROUTED_SCREENS) {
  assert(navigation.includes(`"${screen}"`), `navigation type includes ${screen}`);
}

const ROLE_NAV_EXPECTATIONS = {
  Master: ["godmodeHome", "setup", "companies", "users", "account"],
  Admin: ["dashboard", "audits", "schedules", "users", "reports", "account"],
  Manager: ["dashboard", "audits", "schedules", "invites", "reports", "account"],
  Auditor: ["dashboard", "audits", "account"],
};

for (const [role, ids] of Object.entries(ROLE_NAV_EXPECTATIONS)) {
  const bucket =
    role === "Master"
      ? "MASTER_NAV"
      : role === "Admin"
        ? "COMPANY_ADMIN_NAV"
        : role === "Manager"
          ? "MANAGER_NAV"
          : "AUDITOR_NAV";
  for (const id of ids) {
    assert(roleNav.includes(`id: "${id}"`) && roleNav.includes(bucket), `${role} nav includes ${id}`);
  }
}

assert(inviteRoutes.includes("/onboarding/company/"), "company onboarding invite path");
assert(inviteRoutes.includes("/invite/company-user/"), "company user invite path");
assert(appTsx.includes("CompanyOnboardingFormScreen"), "onboarding invite screen wired");
assert(appTsx.includes("AppHostedOnboardingCompletion"), "company user invite completion screen wired");
assert(appTsx.includes("PasswordResetConfirm"), "password reset path wired");
assert(appTsx.includes("GodmodeStartScreen"), "godmode home screen wired");
assert(appTsx.includes("SchedulesScreen"), "schedules screen wired");
assert(appTsx.includes("AuditsScreen"), "audits / my checks screen wired");
assert(appTsx.includes("CheckCompletionWizard"), "complete check wizard wired");
assert(appTsx.includes("AccountSettingsScreen"), "account screen wired");

assert(masterAuth.includes('app.post("/api/auth/master/login"'), "master login API");
assert(serverMain.includes('app.post("/api/auth/company/login"'), "company login API");
assert(serverMain.includes('app.get("/api/auth/company/session"'), "company session API");
assert(coreRoutes.includes("/api/companies/:companyId/invites/auditor"), "auditor invite API");
assert(coreRoutes.includes("/api/invites/company-user/:token"), "invite token lookup API");
assert(coreRoutes.includes("/api/companies/:companyId/schedule-assignees"), "schedule assignees API");
assert(coreRoutes.includes("/api/companies/:companyId/schedules"), "schedule save API");
assert(companyUsers.includes("sanitizeUserRecordForClient"), "PasswordHash stripped from client records");
assert(!/res\.json\([\s\S]{0,200}PasswordHash/.test(serverMain), "login responses do not expose PasswordHash");

const ownCompany = "TESTCO";
const adminSession = { role: "Admin", companyId: ownCompany };
const managerSession = { role: "Manager", companyId: ownCompany };
assert(canCreateCompanyInvite(adminSession, ownCompany, "Auditor"), "Admin can invite Auditor");
assert(canCreateCompanyInvite(managerSession, ownCompany, "Auditor"), "Manager can invite Auditor");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Manager"), "Admin cannot invite Manager");
assert(!canCreateCompanyInvite(managerSession, ownCompany, "Admin"), "Manager cannot invite Admin");
assert(canInviteCompanyUsers(managerSession, { status: "Live" }), "Manager can invite when Live");

for (const role of ["Admin", "Manager", "Auditor", "User"]) {
  assert(canCompleteAudit({ email: `${role}@test.com`, role }), `${role} can complete assigned checks`);
}

assert(appTsx.includes("getScheduleAssignedEmails") && appTsx.includes("isScheduleAssignedToAnyEmail"), "dashboard uses assignedUserEmails helpers");
assert(
  isScheduleAssignedToUser({ assignedUserEmails: ["a@test.com"] }, "a@test.com") &&
    !isScheduleAssignedToUser({ assignedUserEmails: ["a@test.com"] }, "b@test.com"),
  "assignment filter works",
);
assert(getScheduleAssignedEmails({ assignedUserEmails: "a@test.com, b@test.com" }).length === 2, "assignedUserEmails canonical");

assert(appTsx.includes("readScheduleAssigneesCache") && appTsx.includes("SCHEDULE_ASSIGNEES_LOAD_TIMEOUT_MS"), "assignees cache-first with timeout");
assert(appTsx.includes("canShowTechnicalUi"), "technical UI gated in App");
assert(permissions.includes("canCompleteAssignedCheck"), "assigned check completion permission exists");

for (const screen of ROUTED_SCREENS.filter((s) => s !== "complete")) {
  assert(
    appTsx.includes(`screen === "${screen}"`) || appTsx.includes(`'${screen}'`),
    `App references screen route ${screen}`,
  );
}

console.log(`[verify:app-paths] OK — ${caseCount} cases passed`);
