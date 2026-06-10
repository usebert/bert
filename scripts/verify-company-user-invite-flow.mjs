#!/usr/bin/env node
/**
 * Static checks: COMPANY_USER invite flow is separate from workspace/company setup.
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

const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");
const formScreen = read("src/screens/CompanyOnboardingFormScreen.tsx");
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");
const inviteRoutesTs = read("src/utils/inviteRoutes.ts");
const appTsx = read("App.tsx");
const serverMain = read("server/server.mjs");
const inviteTarget = read("server/invite-target.mjs");
const companyUsers = read("server/company-users.mjs");
const scheduleAssignees = read("server/schedule-assignee-service.mjs");

const WORKSPACE_UI = ["Create workspace", "Creating your workspace", "couldn't finish setting up your workspace"];

for (const phrase of WORKSPACE_UI) {
  assert(!inviteCompletion.includes(phrase), `1: company-user page must not show "${phrase}"`);
}

assert(inviteCompletion.includes("Create account"), "2: company-user button says Create account");
assert(inviteCompletion.includes("Creating account"), "2b: company-user submitting label");

assert(
  !inviteCompletion.includes("provisionNewCompanyWorkspace") &&
    !inviteCompletion.includes("/api/onboarding/company/"),
  "3: company-user completion does not call workspace setup endpoints",
);

assert(serverMain.includes('status: "active"') || serverMain.includes('status: "ACTIVE"'), "4: invite completion creates ACTIVE user");
assert(
  serverMain.includes("buildCompanySessionPayload") &&
    serverMain.includes("enrichCompanyContextFromRegistry") &&
    inviteCompletion.includes("masterSheetId"),
  "5: company-user completion returns company context",
);

assert(inviteMessages.includes("mapCompanyUserInviteError"), "6: company-user error mapper exists");
for (const phrase of WORKSPACE_UI) {
  const mapperBlock = inviteMessages.slice(inviteMessages.indexOf("mapCompanyUserInviteError"));
  assert(
    mapperBlock.includes("COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE") ||
      mapperBlock.includes("never surfaces workspace"),
    `6b: mapper guards workspace copy (${phrase})`,
  );
}

assert(
  inviteRoutesTs.includes("/onboarding/company/") &&
    inviteRoutesTs.includes("/invite/company-user/") &&
    inviteRoutesTs.includes("INVITE_FLOW_COMPANY_ONBOARDING") &&
    inviteRoutesTs.includes("INVITE_FLOW_COMPANY_USER") &&
    !inviteRoutesTs.includes("resolveInviteFlowFromToken"),
  "7: COMPANY_ONBOARDING and COMPANY_USER routes are separate and path-authoritative",
);

assert(
  serverMain.includes("consumedAt: null") && serverMain.includes("USER_ACCOUNT_CREATE_FAILED"),
  "8: failed user creation keeps invite pending (consumedAt null) with USER_ACCOUNT_CREATE_FAILED",
);

assert(!serverMain.includes("PasswordHash:"), "9: PasswordHash not returned in server responses");
assert(companyUsers.includes("sanitizeUserRecordForClient"), "9b: PasswordHash stripped for clients");

assert(
  scheduleAssignees.includes("getAssignableUsers") && serverMain.includes("writeCompanyUsers"),
  "10: accepted users flow into company users / schedule assignees",
);

assert(inviteTarget.includes("USER_ACCOUNT_CREATE_FAILED"), "backend USER_ACCOUNT_CREATE_FAILED code");
assert(appTsx.includes("companyUserInvitePath"), "App redirects misrouted tokens to canonical company-user path");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-user-invite-flow"], "npm script registered");

console.log("OK: verify-company-user-invite-flow (10 cases)");
