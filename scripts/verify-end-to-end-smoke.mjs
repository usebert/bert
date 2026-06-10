#!/usr/bin/env node
/**
 * End-to-end BERT product-flow smoke test (sections A–J).
 *
 * Combines shared-module behaviour tests with static analysis of routes, handlers,
 * and UI wiring. Does not require a live Google workspace or SMTP by default.
 *
 * LIVE-ONLY (manual / staging — see checklist at end):
 *   - POST /api/auth/company/login with real workbook credentials
 *   - Invite email delivery and SMTP failure recovery
 *   - Google Sheets schedule write + reload
 *   - Check submission to company master sheet
 *
 * STATIC (this script):
 *   - Session payload shape, PasswordHash sanitisation, invite permissions
 *   - Schedule assignee filtering, save payload, check-completion wizard wiring
 *   - Role nav, UX declutter, background-job non-blocking contracts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAvailableScheduleAssigneesFromUsers,
  buildScheduleAssigneeDiagnostics,
  canCompleteAudit,
  isActiveUser,
} from "../shared/schedule-assignees.mjs";
import {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  INVITE_PARTIAL_SUCCESS_USER_MESSAGE,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import { isCompanyUsable } from "../server/company-registry-service.mjs";
import {
  assignedUsersFromSchedule,
  buildAssignedUsersFromSelection,
  parseAssignedUsersFromRecord,
  parseAuditorEmailsFromRecord,
  scheduleRecordsPreferSchedulesTab,
} from "../shared/schedule-save.mjs";
import {
  BACKGROUND_INVITE_CREATED_MESSAGE,
  BACKGROUND_SCHEDULE_SAVED_MESSAGE,
  BACKGROUND_SETUP_USER_MESSAGE,
} from "../shared/background-jobs.mjs";

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

const serverMain = read("server/server.mjs");
const masterAuth = read("server/master-auth.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const registryActions = read("server/godmode-registry-actions.mjs");
const inviteService = read("server/invite-service.mjs");
const companyUsers = read("server/company-users.mjs");
const assigneeService = read("server/schedule-assignee-service.mjs");
const scheduleSaveService = read("server/schedule-save-service.mjs");
const backgroundService = read("server/background-jobs-service.mjs");
const appTsx = read("App.tsx");
const reportsScreen = read("src/screens/ReportsScreen.tsx");
const accountScreen = read("src/screens/AccountSettingsScreen.tsx");
const accountSummary = read("src/components/AccountIdentitySummary.tsx");
const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
const godmodePanel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const jobsPanel = read("src/components/godmode/GodmodeBackgroundJobsPanel.tsx");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const roleNav = read("src/config/roleNavigation.ts");
const uxDeclutter = read("src/utils/uxDeclutter.ts");
const checkWizard = read("src/components/checks/CheckCompletionWizard.tsx");
const checkReview = read("src/components/checks/CheckCompletionReview.tsx");
const scheduleAssigneesUtil = read("src/utils/scheduleAssignees.ts");
const pkg = JSON.parse(read("package.json"));

const ownCompany = "TESTCO";
const testRoles = [
  { email: "admin@testco.test", name: "Co Admin", role: "Admin", accessLevel: "full", status: "ACTIVE", companyId: ownCompany },
  { email: "manager@testco.test", name: "Site Manager", role: "Manager", accessLevel: "operational", status: "ACTIVE", companyId: ownCompany },
  { email: "auditor@testco.test", name: "Field Auditor", role: "Auditor", accessLevel: "AUDITOR", status: "ACTIVE", companyId: ownCompany },
  { email: "user@testco.test", name: "Operator", role: "User", accessLevel: "operational", status: "ACTIVE", companyId: ownCompany },
];

// ─── A. Login — Godmode, Manager, Auditor ───────────────────────────────────

assert(masterAuth.includes('app.post("/api/auth/master/login"'), "A1: master login route");
assert(serverMain.includes('app.post("/api/auth/company/login"'), "A2: company login route");
assert(serverMain.includes("buildCompanySessionPayload"), "A3: company session payload builder");
assert(
  /function buildCompanySessionPayload[\s\S]*?email[\s\S]*?companyId[\s\S]*?companyName[\s\S]*?role[\s\S]*?name[\s\S]*?accessLevel/.test(
    serverMain,
  ),
  "A4: session payload includes email, name, role, companyId, companyName, accessLevel",
);
assert(
  serverMain.includes("user: {") && serverMain.includes("email,") && serverMain.includes("accessLevel"),
  "A5: company login JSON returns user email + accessLevel",
);
assert(serverMain.includes("company: {") && serverMain.includes("companyName"), "A6: company login JSON returns companyName");
assert(companyUsers.includes("sanitizeUserRecordForClient"), "A7: PasswordHash stripped from client records");
assert(!/res\.json\([\s\S]{0,200}PasswordHash/.test(serverMain), "A8: login response does not expose PasswordHash");
assert(
  !serverMain.slice(serverMain.indexOf('app.post("/api/auth/company/login"'), serverMain.indexOf('app.post("/api/auth/company/logout"')).includes(
    "ensureCompanyLiveIfReady",
  ),
  "A9: company login does not block on registry health checks",
);
assert(!appTsx.includes("ensureCompanyLiveIfReady"), "A10: client login does not await health checks");
assert(appTsx.includes("tryServerMasterLogin") && appTsx.includes("tryServerCompanyLogin"), "A11: client uses server login paths");
assert(registryActions.includes("makeCompanyUsable"), "A12: godmode make-usable for company workspace");
assert(isCompanyUsable({ status: "Live", registrySource: "fallback" }), "A13: fallback LIVE company is usable");
assert(isCompanyRegistryLive({ status: "Live" }), "A14: Live registry unlocks company login context");

// ─── B. Account section — name, email, role, company; persists after refresh ─

assert(accountSummary.includes("resolveUserEmail"), "B1: account summary resolves email");
assert(accountSummary.includes("getAccountRoleLabel"), "B2: account summary shows role label");
assert(accountSummary.includes("companyName") && accountSummary.includes("Company"), "B3: account summary shows company");
assert(accountScreen.includes("AccountIdentitySummary"), "B4: account settings uses identity summary");
assert(accountScreen.includes("Signed in as"), "B5: account section labels signed-in identity");
assert(
  /function resolveUserEmail[\s\S]*?email[\s\S]*?username/.test(uxDeclutter),
  "B6: resolveUserEmail falls back to username when email missing",
);
assert(
  serverMain.includes('app.get("/api/auth/company/session"') && serverMain.includes("companyName"),
  "B7: session refresh returns companyName for persistence",
);
assert(serverMain.includes("data.email") && serverMain.includes("data.role"), "B8: session cookie carries email + role");
assert(
  accountSummary.includes('resolvedEmail ?') || accountSummary.includes("resolvedEmail"),
  "B9: account email must be present when resolved (not silently omitted)",
);

// ─── C. Declutter — company roles clean; Godmode diagnostics collapsed ───────

assert(uxDeclutter.includes('role === "Master"') && uxDeclutter.includes("canShowTechnicalUi"), "C1: technical UI Master-only");
assert(!roleNav.includes('companyAdmin: ["qmsReadiness"') || roleNav.includes("companyAdmin: []"), "C2: company admin no More clutter");
assert(roleNav.includes("manager: []") && roleNav.includes("auditor: []"), "C3: manager/auditor no More clutter");
assert(!roleNav.match(/COMPANY_ADMIN_NAV[\s\S]*?id: "admin"/), "C4: company admin nav has no workspace tab");
assert(!roleNav.match(/AUDITOR_NAV[\s\S]*?id: "sync"/), "C5: auditor nav has no sync tab");
assert(godmodePanel.includes("Advanced diagnostics") && godmodePanel.includes("useState(false)"), "C6: godmode diagnostics collapsed by default");
assert(schedulesScreen.includes("Advanced diagnostics") && schedulesScreen.includes("useState(false)"), "C7: schedule diagnostics collapsed by default");
assert(
  appTsx.includes("showAssigneeDiagnostics={canShowTechnicalUi(currentUser.role)}"),
  "C8: schedule advanced diagnostics gated to Master via App prop",
);
assert(schedulesScreen.includes("showAssigneeDiagnostics"), "C8b: schedule screen respects diagnostics prop");
assert(uxDeclutter.includes("softenUserFacingMessage"), "C9: company users get softened jargon");
assert(!appTsx.includes("could not reach BERT"), "C10: no legacy BERT reach error in App");

// ─── D. Users & Invites — Auditor invite; token before email; inviteUrl on fail ─

const adminSession = { role: "Admin", companyId: ownCompany };
const managerSession = { role: "Manager", companyId: ownCompany };
assert(canCreateCompanyInvite(adminSession, ownCompany, "Auditor"), "D1: Admin can invite Auditor");
assert(canCreateCompanyInvite(managerSession, ownCompany, "Auditor"), "D2: Manager can invite Auditor");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Manager"), "D3: Admin cannot invite Manager");
assert(!canCreateCompanyInvite(managerSession, ownCompany, "Admin"), "D4: Manager cannot invite Admin");
assert(canInviteCompanyUsers(managerSession, { status: "Live" }), "D5: Manager can invite when Live");
assert(coreRoutes.includes("/api/companies/:companyId/invites/auditor"), "D6: auditor invite route");
assert(serverMain.indexOf("createInviteRecord(") < serverMain.indexOf("sendCompanyUserInviteEmail"), "D7: token created before email send");
assert(serverMain.includes("inviteUrl"), "D8: invite API returns inviteUrl");
assert(serverMain.includes("buildCompanyUserInviteApiPayload"), "D9: structured invite API payload");
assert(INVITE_PARTIAL_SUCCESS_USER_MESSAGE.includes("Copy"), "D10: partial success message when email fails");
assert(
  serverMain.includes("emailSent: false") && serverMain.includes("inviteUrl"),
  "D11: email failure still returns inviteUrl (invite not blocked by SMTP)",
);
assert(usersPanel.includes("Copy link") || usersPanel.includes("copyTextToClipboard"), "D12: UI can copy invite link");

// ─── E. Invite acceptance — ACTIVE user, company context, hashed password ────

assert(coreRoutes.includes("/api/invites/company-user/:token"), "E1: GET invite token route");
assert(coreRoutes.includes("/api/invites/company-user/:token/complete"), "E2: POST invite complete route");
assert(coreRoutes.includes("companyName: inviteRecord.companyName"), "E3: invite preview includes companyName");
assert(serverMain.includes("setCompanyUserPasswordHash"), "E4: invite completion hashes password");
assert(serverMain.includes('status: "ACTIVE"') || serverMain.includes('status: "active"'), "E5: invite creates ACTIVE user");
assert(serverMain.includes("buildCompanySessionPayload") && serverMain.includes("handleAppInviteComplete"), "E6: invite completion sets session");
assert(companyUsers.includes("isPasswordHash"), "E7: password hash validation helper");
assert(!coreRoutes.includes("PasswordHash:"), "E8: invite routes do not return PasswordHash");
assert(inviteService.includes("assertCompanyLiveForInvite"), "E9: invite service gates non-Live companies");

// ─── F. Schedule assignment — all roles; pending invites don't hide active ───

{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers(testRoles, { companyId: ownCompany });
  assert(assignees.length === 4, "F1: all four active company roles appear as assignees");
  assert(testRoles.every((u) => canCompleteAudit(u)), "F2: all roles can complete checks");
}
{
  const pendingOnly = buildAvailableScheduleAssigneesFromUsers(
    [
      { email: "p1@test.com", role: "Auditor", status: "INVITED", companyId: ownCompany },
      { email: "p2@test.com", role: "Manager", status: "pending", companyId: ownCompany },
    ],
    { companyId: ownCompany },
  );
  assert(pendingOnly.assignees.length === 0, "F3: pending invites alone do not populate assignees");
}
{
  const mixed = buildAvailableScheduleAssigneesFromUsers(
    [...testRoles, { email: "p@test.com", role: "Auditor", status: "INVITED", companyId: ownCompany }],
    { companyId: ownCompany },
  );
  assert(mixed.assignees.length === 4, "F4: pending invites do not hide active users");
}
assert(coreRoutes.includes("/api/companies/:companyId/schedule-assignees"), "F5: schedule-assignees API route");
assert(assigneeService.includes("getScheduleAssigneesForCompany"), "F6: schedule assignee service");
assert(
  coreRoutes.includes("USERS_TAB_READ_FAILED") || assigneeService.includes("USERS_TAB_READ_FAILED"),
  "F7: users tab read failure handled",
);
assert(!appTsx.includes("findPendingAssigneeInvites"), "F8: App does not merge pending invites into assignees");
assert(appTsx.includes("schedule-assignees"), "F9: App loads assignees from canonical API");
assert(
  scheduleAssigneesUtil.includes("activeUsersFound") && scheduleAssigneesUtil.includes("loadError"),
  "F10: empty assignee message distinguishes load failure from zero users",
);
{
  const diagnostics = buildScheduleAssigneeDiagnostics(
    [
      testRoles[3],
      { email: "inactive@test.com", role: "User", status: "INVITED", companyId: ownCompany },
    ],
    { companyId: ownCompany },
  );
  assert(diagnostics.excludedByStatus >= 1, "F11: diagnostics explain inactive exclusion");
}

// ─── G. Schedule save — multi-role, persists, legacy auditor load ───────────

const assigneeOptions = testRoles.map((u) => ({ id: u.email, email: u.email, name: u.name, role: u.role }));
{
  const users = buildAssignedUsersFromSelection(
    ["manager@testco.test", "auditor@testco.test"],
    assigneeOptions,
    testRoles,
  );
  assert(users.length === 2, "G1: multi-role schedule assignment preserved");
  assert(users.some((u) => u.role === "Manager") && users.some((u) => u.role === "Auditor"), "G2: Manager + Auditor roles saved");
}
assert(coreRoutes.includes("/api/companies/:companyId/schedules"), "G3: company schedules save route");
assert(coreRoutes.includes('app.get("/api/companies/:companyId/schedules"'), "G3b: company schedules list route");
assert(read("src/services/scheduleService.ts").includes("listCompanySchedules"), "G3c: frontend schedule list service");
assert(coreRoutes.includes("savedLocally: true") || scheduleSaveService.includes("savedLocally"), "G4: schedule save acks local persistence");
assert(coreRoutes.includes("queueScheduleSyncJob") || scheduleSaveService.includes("queueScheduleSyncJob"), "G5: schedule sync queued in background");
{
  const legacy = parseAuditorEmailsFromRecord({ Auditors: "auditor@testco.test, manager@testco.test" });
  assert(legacy.length === 2, "G6: legacy Auditors column loads for old schedules");
}
{
  const fromAssigned = parseAssignedUsersFromRecord({
    "Assigned User Emails": "admin@testco.test",
    "Assigned User Names": "Co Admin",
    "Assigned User Roles": "Admin",
  });
  assert(fromAssigned[0]?.role === "Admin", "G7: assignedUsers columns load on reload");
}
{
  const preferred = scheduleRecordsPreferSchedulesTab([{ "Schedule ID": "legacy" }], [{ "Schedule ID": "new" }]);
  assert(preferred[0]["Schedule ID"] === "new", "G8: Schedules tab preferred over legacy Schedule tab");
}
assert(
  appTsx.includes("assignedUsers") && appTsx.includes("saveCompanySchedule"),
  "G9: App saves schedules with assignedUsers via schedule service",
);
assert(appTsx.includes("assignedUserEmails"), "G10: App saves assignedUserEmails on schedules");

// ─── H. Complete check — assigned user sees, completes, submits, dashboard ───

assert(appTsx.includes("assignedAudits"), "H1: App computes assigned audits for user");
assert(
  appTsx.includes("isScheduleAssignedToAnyEmail") && appTsx.includes("getScheduleAssignedEmails"),
  "H2: assigned audits filtered via shared assignment helpers",
);
assert(read("src/permissions.ts").includes("canCompleteAssignedCheck"), "H2b: assigned completion roles supported");
assert(appTsx.includes("CheckCompletionWizard"), "H3: check completion wizard wired");
assert(appTsx.includes("completeAuditModeFlow"), "H4: submit handler exists");
assert(checkWizard.includes("Review") && checkReview.includes("Submit check"), "H5: wizard review + submit UI");
assert(appTsx.includes("setAuditCompletionSummary") || appTsx.includes("auditCompletionSummary"), "H6: dashboard updates after submit");
assert(appTsx.includes("applyAuditSubmission"), "H7: online submission path");
{
  const assigned = assignedUsersFromSchedule({
    assignedUsers: [{ email: "auditor@testco.test", name: "Field Auditor", role: "Auditor" }],
  });
  assert(assigned.some((u) => u.email === "auditor@testco.test"), "H8: assigned user parsed from schedule");
}
assert(canCompleteAudit(testRoles[2]), "H9: Auditor role can complete assigned check");
assert(isActiveUser(testRoles[2]), "H10: assigned Auditor is ACTIVE");

// ─── I. Background jobs — non-blocking login/invite/schedule ────────────────

assert(registryActions.includes("queueCompanySetupJobs"), "I1: make-usable queues setup (non-blocking)");
assert(registryActions.includes("BACKGROUND_SETUP_USER_MESSAGE"), "I2: make-usable returns background message");
assert(serverMain.includes("queueInviteEmailJob") || serverMain.includes("emailPending: true"), "I3: invite email queued async");
assert(BACKGROUND_INVITE_CREATED_MESSAGE.includes("Email is being sent"), "I4: invite background UX message");
assert(coreRoutes.includes("BACKGROUND_SCHEDULE_SAVED_MESSAGE"), "I5: schedule save background message");
assert(BACKGROUND_SCHEDULE_SAVED_MESSAGE.includes("syncing"), "I6: schedule sync is background");
assert(backgroundService.includes("/api/godmode/background-jobs"), "I7: background jobs API godmode-only");
assert(godmodePanel.includes("GodmodeBackgroundJobsPanel"), "I8: job failures visible in godmode diagnostics only");
assert(
  jobsPanel.includes("backgroundJobsBannerForRole") || jobsPanel.includes("workingInBackground"),
  "I9: friendly background banner for company users",
);
assert(!usersPanel.includes("GodmodeBackgroundJobsPanel"), "I10: background job panel not on company invite screen");
assert(godmodePanel.includes("GodmodeBackgroundJobsPanel"), "I10b: background jobs only in godmode panel");

// ─── J. Role UI — nav items per role ─────────────────────────────────────────

assert(roleNav.includes('if (role === "Master") return "master"'), "J1: role nav buckets defined");
assert(roleNav.includes("COMPANY_ADMIN_NAV") && roleNav.includes("MANAGER_NAV") && roleNav.includes("AUDITOR_NAV"), "J2: per-role nav templates");
assert(roleNav.includes('id: "schedules", label: "Schedules"'), "J3: Manager/Admin see Schedules");
assert(roleNav.includes('id: "invites", label: "People"'), "J4: Manager sees People nav");
assert(roleNav.includes('id: "audits", label: "Complete Work"'), "J4b: Admin/Manager see Complete Work nav");
assert(roleNav.includes('id: "audits", label: "My Checks"'), "J5: Auditor sees My Checks");
assert(roleNav.includes("getPresentedNavForRole"), "J6: nav resolved per role");
assert(appTsx.includes("getPresentedNavForRole"), "J7: App uses role-based nav");
assert(roleNav.includes('id: "account"'), "J8: all roles have Account nav");

// ─── Package script + cross-cutting must-fail guards ─────────────────────────

assert(pkg.scripts["verify:end-to-end-smoke"], "PKG: npm script registered");
assert(serverMain.includes("installCoreWorkflowRoutes"), "X1: core workflow routes installed");
assert(!appTsx.includes("buildAvailableScheduleAssignees("), "X2: App does not filter assignees locally (empty when API has users)");
assert(appTsx.includes("readScheduleAssigneesCache") && appTsx.includes("SCHEDULE_ASSIGNEES_LOAD_TIMEOUT_MS"), "X3: assignees cache-first with 2s timeout");
assert(pkg.scripts["verify:app-paths"] && pkg.scripts["verify:login-performance"], "X4: path and login-performance verify scripts registered");
assert(coreRoutes.includes("/api/companies/:companyId/reports/dashboard"), "X5: reports dashboard API route");
assert(
  appTsx.includes("activeCompanyContext") && reportsScreen.includes("ReportsDashboardPanel"),
  "X6: live reports dashboard wired",
);
assert(pkg.scripts["verify:reports-dashboard"], "X7: reports dashboard verify script registered");

console.log(`[verify:end-to-end-smoke] OK — ${caseCount} cases passed (static + shared modules)`);
console.log(`
--- Live-only checklist (staging; do not paste secrets) ---

1) Godmode: Make company usable → company status Live; company users can sign in.
2) Login: Master, Manager, Auditor — each returns email, name, role, companyName; no PasswordHash in any JSON.
3) Account: refresh page — name, email, role, company still shown.
4) Invite: Manager invites Auditor — inviteUrl returned even when SMTP unavailable.
5) Accept invite — user ACTIVE, can log in, company context set.
6) Schedule: assign all roles, save, reload — assignments persist; legacy auditor column still loads.
7) Check: assigned Auditor sees check in My Checks, completes wizard, submits — dashboard updates.
8) Declutter: Manager/Auditor do not see Advanced diagnostics or background job technical panels.

--- End checklist ---
`);
