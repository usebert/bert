#!/usr/bin/env node
/**
 * Invite → Users tab contract — token on create, Users tab write before success on complete.
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

const pkg = JSON.parse(read("package.json"));
const inviteService = read("server/invite-service.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const serverMain = read("server/server.mjs");
const authService = read("server/auth-service.mjs");
const userAuth = read("server/user-auth-service.mjs");

assert(pkg.scripts["verify:invite-to-users-tab"], "1: npm script registered");
assert(inviteService.includes("export function createInvite"), "2: inviteService.createInvite");
assert(inviteService.includes("completeInvite"), "3: inviteService.completeInvite alias");
assert(inviteService.includes("buildCompanyUserInvitePayload"), "4: invite payload builder");
assert(sheetFlow.includes("export async function completeInviteToUserRow"), "5: completeInviteToUserRow exported");
assert(serverMain.includes("completeInviteToUserRow"), "6: server wires completeInviteToUserRow");
assert(
  serverMain.indexOf("completeInviteToUserRow") < serverMain.indexOf('status: "USED"'),
  "7: Users tab write before invite marked USED",
);
assert(inviteService.includes('Status: "ACTIVE"'), "8: completion writes ACTIVE status");
assert(inviteService.includes("hashPassword"), "9: completion hashes password for PasswordHash");
assert(inviteService.includes("resolveInviteCompanyContext"), "10: folder-first context on accept");
assert(
  !serverMain.includes("writeCompanyUsers(authed, resolvedMasterSheetId") &&
    !serverMain.includes("writeCompanyUsers(auth, resolvedMasterSheetId"),
  "11: invite create does not write Users tab",
);
assert(inviteService.includes("rebuildAuthIndexFromUsersTab"), "12: auth index rebuild after invite");

console.log(`[verify:invite-to-users-tab] OK — ${caseCount} cases passed`);
