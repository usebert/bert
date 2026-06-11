#!/usr/bin/env node
/**
 * Major role/path contract — routes, nav, handlers, and must-not-break guards.
 * Module map: docs/MODULE_MAP.md (Dashboard → People → Scheduling → Complete Work → Actions/NCRs → Reports).
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
const formScreen = read("src/screens/CompanyOnboardingFormScreen.tsx");
const coreRoutes = read("server/core-workflow-routes.mjs");
const masterAuth = read("server/master-auth.mjs");
const serverMain = read("server/server.mjs");
const companyUsers = read("server/company-users.mjs");
const reportsDashboardPanel = read("src/components/reports/ReportsDashboardPanel.tsx");
const reportsScreen = read("src/screens/ReportsScreen.tsx");
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
  Admin: ["dashboard", "users", "schedules", "audits", "actions", "nonConformance", "reports", "account"],
  Manager: ["dashboard", "invites", "schedules", "audits", "actions", "nonConformance", "reports", "account"],
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
const inviteCompletionScreen = read("src/screens/AppHostedOnboardingCompletion.tsx");
assert(inviteCompletionScreen.includes("Create account"), "company-user invite button is Create account");
assert(!inviteCompletionScreen.includes("Create workspace"), "company-user invite must not show Create workspace");
assert(
  inviteRoutes.includes("resolveLegacyInviteFlow") &&
    inviteRoutes.includes("INVITE_FLOW_COMPANY_ONBOARDING") &&
    !inviteRoutes.includes("resolveInviteFlowFromToken"),
  "invite flows: path-authoritative canonical routes, legacy token resolver only",
);
assert(formScreen.includes("Create workspace"), "company onboarding retains Create workspace CTA");
const companyOnboarding = read("server/company-onboarding.mjs");
assert(companyOnboarding.includes("probeCompanyLoginSheet"), "company onboarding finalize binds probeCompanyLoginSheet");
assert(pkg.scripts["verify:company-setup-finalize"], "verify:company-setup-finalize npm script registered");
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
assert(coreRoutes.includes('app.get("/api/companies/:companyId/users"'), "company users list API");
assert(coreRoutes.includes("/api/companies/:companyId/schedule-assignees"), "schedule assignees API");
assert(coreRoutes.includes("/api/companies/:companyId/schedules"), "schedule save API");
assert(coreRoutes.includes('app.get("/api/companies/:companyId/schedules"'), "schedule list API");
assert(coreRoutes.includes("/api/companies/:companyId/reports/dashboard"), "reports dashboard API");
assert(appTsx.includes("listCompanySchedules"), "App lists schedules via company context service");
assert(
  appTsx.includes("activeCompanyContext") && reportsScreen.includes("ReportsDashboardPanel"),
  "reports dashboard wired in App",
);
assert(
  reportsDashboardPanel.includes("readReportsDashboardCache") &&
    reportsDashboardPanel.includes("REPORTS_DASHBOARD_LOAD_TIMEOUT_MS"),
  "reports cache-first with timeout",
);
assert(companyUsers.includes("sanitizeUserRecordForClient"), "PasswordHash stripped from client records");
assert(!/res\.json\([\s\S]{0,200}PasswordHash/.test(serverMain), "login responses do not expose PasswordHash");

const ownCompany = "TESTCO";
const adminSession = { role: "Admin", companyId: ownCompany };
const managerSession = { role: "Manager", companyId: ownCompany };
assert(canCreateCompanyInvite(adminSession, ownCompany, "Auditor"), "Admin can invite Auditor");
assert(canCreateCompanyInvite(managerSession, ownCompany, "Auditor"), "Manager can invite Auditor");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Manager"), "Admin cannot invite Manager");
assert(!canCreateCompanyInvite(managerSession, ownCompany, "Admin"), "Manager cannot invite Admin");
assert(canInviteCompanyUsers(managerSession, { status: "Setup in progress" }), "Manager can invite without Live registry");
assert(
  !read("server/core-workflow-routes.mjs").includes("assertCompanyLiveForInvite"),
  "auditor invite API does not live-gate",
);

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
assert(appTsx.includes("readCompanyMembersCache") && appTsx.includes("fetchCompanyMembers"), "company members cache-first API");
assert(pkg.scripts["verify:company-members"], "verify:company-members npm script registered");
assert(appTsx.includes("canShowTechnicalUi"), "technical UI gated in App");
assert(permissions.includes("canCompleteAssignedCheck"), "assigned check completion permission exists");

for (const screen of ROUTED_SCREENS.filter((s) => s !== "complete")) {
  assert(
    appTsx.includes(`screen === "${screen}"`) || appTsx.includes(`'${screen}'`),
    `App references screen route ${screen}`,
  );
}

const companyWorkspaceStatus = read("src/utils/companyWorkspaceStatus.ts");
assert(!companyWorkspaceStatus.includes("Ready for health check"), "no dead-end Ready for health check status");
assert(pkg.scripts["verify:setup-next-actions"], "verify:setup-next-actions npm script registered");

console.log(`[verify:app-paths] OK — ${caseCount} cases passed`);
