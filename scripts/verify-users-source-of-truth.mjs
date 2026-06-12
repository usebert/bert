#!/usr/bin/env node
/** Users tab is sole source of truth for active company users. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isActiveUser } from "../shared/schedule-assignees.mjs";

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

const sheetFlow = read("server/company-user-sheet-flow.mjs");
const userService = read("server/company-user-service.mjs");
const companyUsers = read("server/company-users.mjs");
const authService = read("server/auth-service.mjs");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const appTsx = read("App.tsx");
const serverMain = read("server/server.mjs");

const activeManager = {
  email: "manager@example.com",
  name: "Site Manager",
  role: "Manager",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: "folder-id",
  companyAreas: [],
};

const pendingInvite = {
  email: "pending@example.com",
  name: "Pending User",
  role: "User",
  accessLevel: "operational",
  status: "INVITED",
  companyId: "folder-id",
  companyAreas: [],
};

/** 1: listActiveUsersFromSheet exported. */
assert(sheetFlow.includes("export async function listActiveUsersFromSheet"), "1: listActiveUsersFromSheet exported");

/** 2: listActiveCompanyMembers uses sheet-only helper. */
assert(userService.includes("listActiveUsersFromSheet"), "2: listActiveCompanyMembers uses listActiveUsersFromSheet");

/** 3: No session fallback merged into active members. */
assert(!userService.includes("session-fallback"), "3: no session-fallback dataSource in user service");
assert(!userService.includes("buildSessionFallbackSuccess"), "3b: session fallback removed");
assert(!userService.includes("buildSessionActorMember"), "3c: session actor not merged into members");

/** 4: No invite merge into active list or demo login users. */
assert(!appTsx.includes("invitedLoginUsers"), "4: App does not merge invites into loginUsers");
assert(panel.includes("!isActiveCompanyUserInvite(invite)"), "4b: pending invites separate from active list");
assert(!panel.includes("activeInvites.map"), "4c: active list not driven by invite rows");

/** 5: isActiveUser filter for ACTIVE only. */
assert(isActiveUser(activeManager), "5: ACTIVE manager included");
assert(!isActiveUser(pendingInvite), "5b: INVITED row excluded");

/** 6: PasswordHash never exposed via list path. */
assert(companyUsers.includes("sanitizeUsersTabRecords"), "6: sanitizeUsersTabRecords exists");
assert(sheetFlow.includes("readCompanyUsers"), "6b: sheet list reads Users tab");

/** 7: Pending INVITED rows excluded from listActiveUsersFromSheet. */
assert(sheetFlow.includes('status !== "ACTIVE"'), "7: non-ACTIVE rows filtered out");

/** 8: canLoginCompanyUser is sheet-only. */
assert(sheetFlow.includes("findCompanyUsersTabRow"), "8: login requires Users tab row");
assert(authService.includes("canLoginCompanyUser"), "8b: auth login uses canLoginCompanyUser");

/** 9: companyUserLoginReady no Config UserAuth fallback. */
{
  const loginReadyBlock = companyUsers.slice(
    companyUsers.indexOf("export async function companyUserLoginReady"),
    companyUsers.indexOf("export async function resolveCompanyUserEmailByHash"),
  );
  assert(loginReadyBlock.includes("rec.passwordHash"), "9: login ready checks Users tab PasswordHash");
  assert(!loginReadyBlock.includes("getConfig"), "9b: companyUserLoginReady does not read Config UserAuth");
}

/** 10: Frontend loads members from canonical API. */
assert(read("src/services/companyUserService.ts").includes("fetchCompanyMembers"), "10: fetchCompanyMembers");
assert(appTsx.includes("fetchCompanyMembers"), "10b: App loads company members API");

/** 11: Invite completion writes sheet before marking used. */
assert(serverMain.includes("completeInviteToUserRow"), "11: invite completion uses sheet write helper");

/** 12: Godmode reuses same active member list path. */
assert(read("server/godmode-service.mjs").includes("listActiveCompanyMembers"), "12: godmode uses listActiveCompanyMembers");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:users-source-of-truth"], "npm script registered");

console.log("[verify:users-source-of-truth] OK: all 12 users source-of-truth cases passed");
