#!/usr/bin/env node
/** Static checks for company-user invite target resolution and verification. */
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
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");
const godmodePanel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");

assert(inviteTarget.includes("STALE_INVITE_CUSTOMER_MESSAGE"), "stale invite customer message");
assert(inviteTarget.includes("google_access_denied"), "google access denied code");
assert(inviteTarget.includes("diagnostics"), "invite failure diagnostics logging");

assert(resolveInviteTarget.includes("resolveCompanyUserInviteTarget"), "resolve invite target helper");
assert(resolveInviteTarget.includes("readOnboardingRegistryMasterSheetForFolder"), "registry sheet lookup");
assert(resolveInviteTarget.includes("findMasterSheetInCompanyFolder"), "folder master sheet search");
assert(resolveInviteTarget.includes("prepareCompanyUserInviteTarget"), "prepare invite target helper");
assert(resolveInviteTarget.includes("repairCompanyInviteTarget"), "repair invite target helper");
assert(resolveInviteTarget.includes("repairPendingCompanyUserInvites"), "repair pending invites");
assert(resolveInviteTarget.includes("diagnoseCompanyInviteTarget"), "invite diagnostics helper");

assert(companyOnboarding.includes("ensureCompanyWorkspaceLiveIfReady"), "promote live when ready");
assert(companyOnboarding.includes("readOnboardingRegistryMasterSheetForFolder"), "registry read export");
assert(companyOnboarding.includes("writeOnboardingRegistryMasterSheetForFolder"), "registry write export");

assert(serverMain.includes("validatePreparedCompanyUserInviteTarget"), "server uses prepared invite validation");
assert(serverMain.includes("repair-company-invite-target"), "repair invite endpoint");
assert(serverMain.includes("company-invite-target-diagnostics"), "invite diagnostics endpoint");
assert(serverMain.includes("prepareCompanyUserInviteTarget"), "server imports prepare helper");

assert(
  inviteMessages.includes("This invite is out of date. Please ask your administrator to send a fresh invite."),
  "stale invite UI message",
);
assert(inviteMessages.includes("google_access_denied"), "google access denied UI mapping");

assert(godmodePanel.includes("Repair invite/company sheet link"), "godmode repair button");
assert(godmodePanel.includes("company-invite-target-diagnostics"), "godmode diagnostics fetch");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-target"], "npm script registered");

console.log("[verify:invite-target] OK");
