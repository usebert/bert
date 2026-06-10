#!/usr/bin/env node
/**
 * Godmode + Company Admin path contract — setup, login, dashboard, invites.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canCreateCompanyInvite, canInviteCompanyUsers } from "../shared/company-invite-permissions.mjs";

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
const inviteRoutes = read("src/utils/inviteRoutes.ts");
const inviteFlowTypes = read("src/utils/inviteFlowTypes.ts");
const formScreen = read("src/screens/CompanyOnboardingFormScreen.tsx");
const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");
const godmodeWorkspace = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const masterAuth = read("server/master-auth.mjs");
const serverMain = read("server/server.mjs");
const registryActions = read("server/godmode-registry-actions.mjs");
const companyOnboarding = read("server/company-onboarding.mjs");
const pkg = JSON.parse(read("package.json"));

const ownCompany = "TESTCO";
const adminSession = { role: "Admin", companyId: ownCompany };
const managerSession = { role: "Manager", companyId: ownCompany };

// ─── Godmode login & setup ───────────────────────────────────────────────────

assert(masterAuth.includes('app.post("/api/auth/master/login"'), "1: Godmode master login API");
assert(appTsx.includes("GodmodeStartScreen"), "2: Godmode home screen wired");
assert(appTsx.includes("setupInitial") && appTsx.includes("canAccessGodmodeInitialSetup"), "3: Godmode company setup route");
assert(registryActions.includes("makeCompanyUsable"), "4: make company usable handler");
assert(
  godmodeWorkspace.includes("Make company usable") || godmodeWorkspace.includes("make_usable"),
  "5: Godmode workspace panel exposes make company usable",
);
assert(appTsx.includes("GodmodeCompanyWorkspacePanel") || godmodeWorkspace.length > 500, "6: Godmode company workspace UI wired");

// ─── Company onboarding (first admin / workspace) ──────────────────────────

assert(formScreen.includes("Create workspace"), "7: company onboarding may say Create workspace");
assert(formScreen.includes("expectedType=COMPANY_ONBOARDING"), "8: company onboarding loads with COMPANY_ONBOARDING gate");
assert(formScreen.includes("/api/onboarding/company/"), "9: company onboarding posts workspace setup endpoint");
assert(
  inviteRoutes.includes("COMPANY_ONBOARDING_PATH_RE") && !inviteRoutes.includes("resolveInviteFlowFromToken"),
  "10: onboarding path is authoritative (no token-shape override on canonical routes)",
);
assert(companyOnboarding.includes("provisionNewCompanyWorkspace"), "11: company onboarding provisions workspace");
assert(companyOnboarding.includes("probeCompanyLoginSheet"), "11b: company onboarding finalize probes Users tab login");
assert(companyOnboarding.includes("COMPANY_ONBOARDING_INTERNAL_SETUP_ERROR_MESSAGE"), "11c: customer-safe internal setup error copy");

// ─── Company Admin login & dashboard ───────────────────────────────────────

assert(serverMain.includes('app.post("/api/auth/company/login"'), "12: Company Admin login API");
assert(serverMain.includes('app.get("/api/auth/company/session"'), "13: company session API");
assert(roleNav.includes("COMPANY_ADMIN_NAV") && roleNav.includes('id: "dashboard"'), "14: Company Admin dashboard nav");
assert(roleNav.includes('id: "users"') && roleNav.includes("COMPANY_ADMIN_NAV"), "15: Company Admin users nav");
assert(appTsx.includes("UsersInvitesPilotPanel") || usersPanel.length > 100, "16: Users & Invites panel exists");

// ─── Company Admin invites (Auditor only) ──────────────────────────────────

assert(canCreateCompanyInvite(adminSession, ownCompany, "Auditor"), "17: Company Admin can invite Auditor");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Manager"), "18: Company Admin cannot invite Manager");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Admin"), "19: Company Admin cannot invite Admin");
assert(!canCreateCompanyInvite(adminSession, ownCompany, "Master"), "20: Company Admin cannot invite Godmode");
assert(canCreateCompanyInvite(managerSession, ownCompany, "Auditor"), "21: Manager can invite Auditor");
assert(!canCreateCompanyInvite(managerSession, ownCompany, "Admin"), "22: Manager cannot invite Admin");
assert(usersPanel.includes("COMPANY_USER_INVITE_TYPE") || usersPanel.includes("Auditor"), "23: Users panel targets company-user invites");
assert(usersPanel.includes("fetchCompanyInviteReadiness"), "23b: Users panel uses invite-readiness endpoint");
assert(read("server/core-workflow-routes.mjs").includes("/api/companies/:companyId/invite-readiness"), "23c: invite-readiness API route");

// ─── Godmode tools hidden from normal company users ──────────────────────────

const auditorNavBlock = roleNav.match(/const AUDITOR_NAV: PresentedNavItem\[\] = \[([\s\S]*?)\];/)?.[0] || "";
const managerNavBlock = roleNav.match(/const MANAGER_NAV: PresentedNavItem\[\] = \[([\s\S]*?)\];/)?.[0] || "";
assert(auditorNavBlock.length > 0 && !auditorNavBlock.includes("godmodeHome"), "24: Auditor nav has no Godmode home");
assert(managerNavBlock.length > 0 && !managerNavBlock.includes("setupInitial"), "25: Manager nav has no Godmode setupInitial");
assert(inviteFlowTypes.includes("GODMODE_COMPANY_SETUP_FLOW"), "26: explicit Godmode setup flow constant");

// ─── Flow separation from company-user invite ───────────────────────────────

assert(inviteCompletion.includes("Create account"), "27: company-user invite says Create account");
assert(!inviteCompletion.includes("Create workspace"), "28: company-user invite never says Create workspace");
assert(formScreen.includes("Create workspace"), "29: onboarding keeps workspace wording");
assert(
  inviteRoutes.includes("resolveLegacyInviteFlow") && inviteRoutes.includes("legacy_company_onboarding"),
  "30: legacy invite links resolve flow explicitly",
);

const setupState = read("shared/company-setup-state.mjs");
const setupStateTs = read("src/utils/companySetupState.ts");
assert(!read("src/utils/companyWorkspaceStatus.ts").includes("Ready for health check"), "31: no dead-end health-check status");
assert(setupState.includes("HEALTH_CHECK_READY"), "32: HEALTH_CHECK_READY phase defined");
assert(godmodeWorkspace.includes("resolveCompanySetupPrimaryAction"), "33: godmode panel resolves next primary action");
assert(godmodeWorkspace.includes("Invite users"), "34: godmode ready state invites users");
assert(pkg.scripts["verify:setup-next-actions"], "35: verify:setup-next-actions npm script");
assert(setupStateTs.includes("Working in the background"), "36: plain working-in-background status");

assert(pkg.scripts["verify:admin-paths"], "npm script registered");

console.log(`OK: verify-admin-paths (${caseCount} cases)`);
