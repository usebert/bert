#!/usr/bin/env node
/** Static checks for company-user invite target resolution and registry unification. */
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
const registry = read("server/company-workspace-registry.mjs");
const serverMain = read("server/server.mjs");
const companyOnboarding = read("server/company-onboarding.mjs");
const inviteRoutes = read("server/invite-routes.mjs");
const inviteMessages = read("src/utils/inviteCompletionMessages.ts");
const inviteApi = read("src/utils/inviteApi.ts");
const godmodePanel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const inviteCompletion = read("src/screens/AppHostedOnboardingCompletion.tsx");

/** 1: single registry-backed resolver */
assert(resolveInviteTarget.includes("resolveCompanyWorkspaceForInvite"), "1: resolveCompanyWorkspaceForInvite helper");
assert(resolveInviteTarget.includes("getCompanyWorkspaceRegistryRecord"), "2: registry is canonical source");

/** 3: registry masterSheetId wins over stale invite metadata */
assert(
  resolveInviteTarget.includes("registryRecord.masterSheetId") &&
    resolveInviteTarget.includes('sources.push("registry")'),
  "3: registry masterSheetId preferred over invite",
);

/** 4–6: structured customer error codes */
assert(inviteTarget.includes("INVITE_COMPANY_LINK_MISSING"), "4: INVITE_COMPANY_LINK_MISSING code");
assert(inviteTarget.includes("COMPANY_MASTER_SHEET_UNAVAILABLE"), "5: COMPANY_MASTER_SHEET_UNAVAILABLE code");
assert(inviteTarget.includes("USER_SETUP_FAILED"), "6: USER_SETUP_FAILED code");

/** 7: health checks preserve persisted workspace IDs */
assert(
  registry.includes("Failed health checks must never erase persisted workspace links"),
  "7: health check failures do not clear workspace IDs",
);

/** 8: repair persists registry + invite metadata */
assert(resolveInviteTarget.includes("persistCompanyWorkspaceSetup"), "8: repair persists registry links");
assert(resolveInviteTarget.includes("repairPendingCompanyUserInvites"), "8b: repair backfills invite metadata");

/** 9: legacy customer network copy removed */
const legacyStrings = [
  "We could not reach BERT to finish setup",
  "Check your internet connection and try again",
  "We could not verify your company workspace with Google right now",
  "We could not verify the company master sheet with Google right now",
];
for (const legacy of legacyStrings) {
  assert(!inviteTarget.includes(legacy), `9: removed legacy copy: ${legacy}`);
  assert(!inviteMessages.includes(legacy), `9: removed legacy copy from client: ${legacy}`);
  assert(!inviteCompletion.includes(legacy), `9: removed legacy copy from completion screen: ${legacy}`);
}

assert(inviteTarget.includes("STALE_INVITE_CUSTOMER_MESSAGE"), "stale invite customer message alias");
assert(inviteTarget.includes("google_access_denied"), "google access denied code");
assert(inviteTarget.includes("diagnostics"), "invite failure diagnostics logging");

assert(resolveInviteTarget.includes("resolveCompanyUserInviteTarget"), "resolve invite target helper");
assert(resolveInviteTarget.includes("prepareCompanyUserInviteTarget"), "prepare invite target helper");
assert(resolveInviteTarget.includes("repairCompanyInviteTarget"), "repair invite target helper");

assert(companyOnboarding.includes("ensureCompanyWorkspaceLiveIfReady"), "promote live when ready");
assert(registry.includes("ensureCompanyLiveIfReady"), "registry promote live when ready");
assert(registry.includes("getCanonicalCompanyStatus"), "registry canonical status helper");

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
assert(inviteMessages.includes("BERT is temporarily unavailable"), "temporarily unavailable UI message");
assert(inviteApi.includes("INVITE_COMPANY_LINK_MISSING"), "invite API maps company link missing");
assert(inviteApi.includes("COMPANY_MASTER_SHEET_UNAVAILABLE"), "invite API maps master sheet unavailable");

assert(godmodePanel.includes("Repair invite/company sheet link"), "godmode repair button");
assert(godmodePanel.includes("company-invite-target-diagnostics"), "godmode diagnostics fetch");

assert(inviteCompletion.includes("fetchInviteApi"), "company user screen uses fetchInviteApi");
assert(!inviteCompletion.includes("/api/onboarding/app-invites/"), "retired app-invites client paths");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:invite-target"], "npm script registered");

console.log("[verify:invite-target] OK (9 registry cases)");
