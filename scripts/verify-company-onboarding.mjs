#!/usr/bin/env node
/**
 * Static checks for two-flow invite/onboarding consolidation (COMPANY_ONBOARDING + COMPANY_USER).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const serverOnboarding = read("server/company-onboarding.mjs");
const serverMain = read("server/server.mjs");
const inviteRoutes = read("server/invite-routes.mjs");
const appTsx = read("App.tsx");
const formScreen = read("src/screens/CompanyOnboardingFormScreen.tsx");
const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");
const inviteRoutesTs = read("src/utils/inviteRoutes.ts");
const panel = read("src/components/admin/CompanyOnboardingInvitePanel.tsx");
const adminScreen = read("src/screens/AdminScreen.tsx");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");
const inviteApi = read("src/utils/inviteApi.ts");

const LEGACY_ONBOARDING_ERROR_STRINGS = [
  "We could not reach BERT to finish setup",
  "Check your internet connection and try again",
  "could not reach BERT",
  "We could not finish setup. Please try again or contact BERT support",
];

const srcFiles = [
  formScreen,
  inviteCompletion,
  inviteMessages,
  inviteApi,
  inviteRoutesTs,
  appTsx,
];

for (const legacy of LEGACY_ONBOARDING_ERROR_STRINGS) {
  for (const file of srcFiles) {
    assert(!file.includes(legacy), `legacy onboarding copy removed: ${legacy}`);
  }
}

/** 14 consolidation test cases */
assert(appTsx.includes("/onboarding/company/") || inviteRoutesTs.includes("/onboarding/company/"), "1: COMPANY_ONBOARDING path route");
assert(appTsx.includes("/invite/company-user/") || inviteRoutesTs.includes("/invite/company-user/"), "2: COMPANY_USER path route");
assert(inviteRoutesTs.includes("legacy_company_onboarding"), "3: legacy ?company-onboarding= handled");
assert(inviteRoutesTs.includes("legacy_company_user"), "4: legacy ?invite= handled");
assert(serverMain.includes('app.get("/api/invites/:token"'), "5: GET /api/invites/:token");
assert(
  serverOnboarding.includes('app.post("/api/onboarding/company/:tokenParam/complete"') ||
    serverMain.includes("/api/onboarding/company/"),
  "6: POST /api/onboarding/company/:token/complete",
);
assert(serverMain.includes('app.post("/api/invites/company-user/:tokenId/complete"'), "7: POST company-user complete");
assert(inviteRoutes.includes("resolveCompanyOnboardingInviteAccess"), "8: token-only onboarding validation");
assert(!inviteRoutes.includes("validateCompanyUserInviteTarget"), "8b: no sheet health on invite GET");
assert(serverOnboarding.includes("/onboarding/company/"), "9: company onboarding email URL path");
assert(serverMain.includes("/invite/company-user/"), "10: company user email URL path");
assert(serverOnboarding.includes("Set up your company on BERT"), "11: company onboarding email subject");
assert(serverMain.includes("Join your company on BERT"), "12: company user email subject");
assert(formScreen.includes("fetchInviteApi") && inviteCompletion.includes("fetchInviteApi"), "13: shared fetchInviteApi");
assert(
  inviteMessages.includes("BERT is temporarily unavailable") &&
    inviteMessages.includes("This invite is no longer valid") &&
    inviteMessages.includes("not ready for user invites") &&
    inviteMessages.includes("could not complete this request") &&
    inviteMessages.includes("check your invite"),
  "13b: canonical customer error messages",
);
assert(
  serverOnboarding.includes("isPlatformOwnerEmail") && serverMain.includes("isPlatformOwnerEmail(toEmail"),
  "14: platform owner blocked from invite flows",
);

assert(serverOnboarding.includes("COMPANY_ONBOARDING"), "invite type constant");
assert(serverOnboarding.includes("installCompanyOnboardingRoutes"), "route installer");
assert(serverOnboarding.includes("provisionNewCompanyWorkspace"), "reuses provision");
assert(serverOnboarding.includes("assertCompanyWorkspaceAcceptsUserInvite"), "live gate helper");
assert(serverOnboarding.includes("ensureCompanyWorkspaceLiveIfReady"), "auto live promotion helper");
assert(serverOnboarding.includes("ensureCompanyLiveIfReady"), "registry live promotion helper");
assert(serverOnboarding.includes("getCanonicalCompanyStatus"), "onboarding uses canonical registry status");
assert(serverOnboarding.includes("isSystemTemplateCompany"), "onboarding blocks system template workspaces");

assert(appTsx.includes("CompanyOnboardingFormScreen"), "form screen mounted");
assert(appTsx.includes("AppHostedOnboardingCompletion"), "company user completion screen mounted");
assert(appTsx.includes("parseInviteRoute"), "App uses path-based invite routing");

assert(formScreen.includes("/api/invites/") && formScreen.includes("expectedType=COMPANY_ONBOARDING"), "form loads unified invite API");
assert(formScreen.includes("/api/onboarding/company/"), "form posts company complete endpoint");
assert(inviteCompletion.includes("expectedType=COMPANY_USER"), "user invite loads with type gate");
assert(inviteCompletion.includes("/api/invites/company-user/"), "user invite posts company-user complete");
assert(!inviteCompletion.includes("new_company"), "retired new_company UI removed");

assert(inviteApi.includes("USER_SETUP_FAILED") && inviteApi.includes("COMPANY_NOT_LIVE"), "invite API error codes");

assert(panel.includes("Send company onboarding invite"), "Godmode panel label");
assert(adminScreen.includes("CompanyOnboardingInvitePanel"), "godmode onboarding panel");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-onboarding"], "npm script registered");

console.log("OK: verify-company-onboarding (14 cases)");
