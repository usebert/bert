#!/usr/bin/env node
/**
 * Company-user invite resend/replace contract — expired/used/stale creates fresh token.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const inviteService = read("server/invite-service.mjs");
const appTsx = read("App.tsx");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const adminScreen = read("src/screens/AdminScreen.tsx");
const godmodeUsers = read("src/components/godmode/GodmodeUserManagementSection.tsx");
const inviteStatus = read("src/utils/inviteStatusDisplay.ts");
const pkg = JSON.parse(read("package.json"));

assert(serverMain.includes("findCompanyUserInviteForResend"), "1: resend lookup helper exists");
assert(
  serverMain.includes("company_user replace token="),
  "2: server creates fresh token when resend finds no active invite",
);
assert(
  !serverMain.includes("No active invite found for this user. Send a new invite link instead."),
  "3: resend does not dead-end with invite_not_found",
);
assert(inviteService.includes("isCompanyUserInviteActiveForResend"), "4: invite service documents active resend");

const resendBlock = serverMain.slice(
  serverMain.indexOf("if (resendRequested || resendTokenId)"),
  serverMain.indexOf("const inviteUrl = buildAppOnboardingUrl(id)"),
);
assert(resendBlock.includes("createInviteRecord"), "5: resend path can create invite record");
assert(resendBlock.includes("revokeInviteRecord"), "6: stale token revoked before replace");

assert(appTsx.includes("resend: true"), "7: frontend sends resend flag");
assert(
  appTsx.includes("staleOrIncomplete ? \"\" : getInviteServerTokenId"),
  "8: stale invites omit tokenId so server replaces",
);
assert(
  !appTsx.includes("resend skipped — stale or incomplete invite row"),
  "9: frontend does not skip resend for stale rows",
);

for (const file of [usersPanel, adminScreen, godmodeUsers]) {
  assert(
    !file.includes("Send a fresh invite from a live company workspace"),
    "10: admin resend UI does not mention live company workspace",
  );
}

assert(
  !inviteStatus.includes("live company workspace"),
  "11: invite status help does not mention live company workspace",
);
assert(
  !usersPanel.includes("Ask your administrator to send a fresh invite"),
  "12: Users panel does not show administrator fresh-invite message",
);

assert(pkg.scripts["verify:invite-resend"], "13: npm script registered");

console.log(`OK: verify-invite-resend (${caseCount} cases)`);
