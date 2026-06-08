#!/usr/bin/env node
/** Static checks for company-user invite target resolution and two-flow consolidation. */
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

const inviteTarget = read("server/invite-target.mjs");
const resolveInviteTarget = read("server/resolve-invite-target.mjs");
const serverMain = read("server/server.mjs");
const companyOnboarding = read("server/company-onboarding.mjs");
const inviteRoutes = read("server/invite-routes.mjs");
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");
const godmodePanel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");

assert(inviteTarget.includes("STALE_INVITE_CUSTOMER_MESSAGE"), "stale invite customer message");
assert(inviteTarget.includes("google_access_denied"), "google access denied code");
assert(inviteTarget.includes("diagnostics"), "invite failure diagnostics logging");

assert(resolveInviteTarget.includes("resolveCompanyUserInviteTarget"), "resolve invite target helper");
assert(resolveInviteTarget.includes("prepareCompanyUserInviteTarget"), "prepare invite target helper");
assert(resolveInviteTarget.includes("repairCompanyInviteTarget"), "repair invite target helper");

assert(companyOnboarding.includes("ensureCompanyWorkspaceLiveIfReady"), "promote live when ready");

assert(serverMain.includes("validatePreparedCompanyUserInviteTarget"), "server uses prepared invite validation on complete");
assert(serverMain.includes("repair-company-invite-target"), "repair invite endpoint");
assert(serverMain.includes("company-invite-target-diagnostics"), "invite diagnostics endpoint");

assert(inviteRoutes.includes("resolveCompanyUserInviteTokenAccess"), "token-only company user GET validation");
assert(inviteRoutes.includes("COMPANY_USER_INVITE_TYPE"), "company user invite type constant");
assert(serverMain.includes('app.get("/api/invites/:token"'), "unified invite GET wired");
assert(serverMain.includes('app.post("/api/invites/company-user/:tokenId/complete"'), "company-user complete wired");

assert(inviteMessages.includes("This invite is no longer valid"), "invalid invite UI message");
assert(inviteMessages.includes("not ready for user invites"), "company not live UI message");
assert(inviteMessages.includes("couldn't finish setting up your account"), "user setup failed UI message");

assert(godmodePanel.includes("Repair invite/company sheet link"), "godmode repair button");
assert(godmodePanel.includes("company-invite-target-diagnostics"), "godmode diagnostics fetch");

assert(inviteCompletion.includes("fetchInviteApi"), "company user screen uses fetchInviteApi");
assert(!inviteCompletion.includes("/api/onboarding/app-invites/"), "retired app-invites client paths");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-target"], "npm script registered");

console.log("[verify:invite-target] OK");
