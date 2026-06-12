#!/usr/bin/env node
/** Spreadsheet Users tab is sole source of truth — active list, cache, login, invites, assignees. */
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
const cacheModule = read("server/company-users-cache.mjs");
const companyUsers = read("server/company-users.mjs");
const authService = read("server/auth-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const serverMain = read("server/server.mjs");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const godmodePanel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const appTsx = read("App.tsx");
const companyUserServiceTs = read("src/services/companyUserService.ts");

const activeUser = {
  email: "manager@example.com",
  name: "Site Manager",
  role: "Manager",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: "folder-a",
  companyAreas: [],
};

const pendingInvite = {
  email: "pending@example.com",
  name: "Pending User",
  role: "User",
  accessLevel: "operational",
  status: "INVITED",
  companyId: "folder-a",
  companyAreas: [],
};

/** 1: Active users equal Users tab ACTIVE rows only. */
assert(sheetFlow.includes('status !== "ACTIVE"'), "1: non-ACTIVE rows filtered");
assert(userService.includes("readActiveUsersFromSheetWithStats"), "1b: sheet stats reader used");
assert(userService.includes('dataSource: "users_tab"'), "1c: dataSource users_tab");

/** 2: Cache-only users are removed on sheet read. */
assert(cacheModule.includes("rebuildCompanyUsersCache"), "2: cache rebuild helper");
assert(cacheModule.includes("cacheOnlyEmails"), "2b: tracks cache-only emails");
assert(userService.includes("cacheOnlyUsersRemoved"), "2c: diagnostics include cacheOnlyUsersRemoved");
assert(userService.includes("reconcileCompanyUsersCache"), "2d: list path reconciles cache");

/** 3: Pending invites are not active users. */
assert(panel.includes("!isActiveCompanyUserInvite(invite)"), "3: pending invites excluded from active");
assert(!panel.includes("activeInvites.map"), "3b: active list not invite-driven");
assert(!isActiveUser(pendingInvite), "3c: INVITED status excluded");

/** 4: Wrong-company users excluded — members tagged with companyFolderId. */
assert(userService.includes("companyId: companyFolderId"), "4: members force companyFolderId");
assert(sheetFlow.includes("mapActiveCompanyMember(row, companyFolderId)"), "4b: mapper uses folder id");

/** 5: Login requires Users tab ACTIVE row; cache-only denied. */
assert(sheetFlow.includes("canLoginCompanyUser"), "5: canLoginCompanyUser exists");
assert(sheetFlow.includes('reason: "cache_only"'), "5b: cache-only login denied");
assert(authService.includes("not active in this company"), "5c: cache-only user message");
assert(authService.includes("canLoginCompanyUser"), "5d: auth uses canLoginCompanyUser");

/** 6: Invite acceptance writes Users tab before login. */
assert(sheetFlow.includes("completeInviteToUserRow"), "6: invite completion helper");
assert(serverMain.includes("completeInviteToUserRow"), "6b: server uses completion helper");
assert(sheetFlow.includes('status: "ACTIVE"'), "6c: writes ACTIVE status");
assert(sheetFlow.includes("canLoginCompanyUser"), "6d: verifies login after write");

/** 7: Schedule assignees equal Users tab ACTIVE rows (shared list path). */
assert(userService.includes("getAssignableUsers"), "7: getAssignableUsers exists");
assert(userService.includes("listActiveCompanyMembers"), "7b: assignees use listActiveCompanyMembers");

/** 8: Godmode and company workspace use same users API path. */
assert(coreRoutes.includes("listActiveCompanyMembers"), "8: company users API uses listActiveCompanyMembers");
assert(serverMain.includes("rebuild-users-from-sheet"), "8b: godmode rebuild endpoint");
assert(godmodePanel.includes("Rebuild users from sheet"), "8c: godmode rebuild button");
assert(read("server/godmode-service.mjs").includes("listActiveCompanyMembers"), "8d: godmode service shares list path");

/** 9: PasswordHash never returned to clients. */
assert(companyUsers.includes("sanitizeUsersTabRecords"), "9: sanitizeUsersTabRecords");
assert(companyUsers.includes("sanitizeUserRecordForClient"), "9b: client sanitizer");
assert(!companyUserServiceTs.includes("PasswordHash"), "9c: frontend service has no PasswordHash");

/** UI: no stale-cache banner on company members load path. */
assert(
  !/fetchCompanyMembers[\s\S]{0,4000}Showing recently loaded users/.test(appTsx),
  "UI: company members path has no stale-cache banner",
);
assert(companyUserServiceTs.includes("COMPANY_MEMBERS_LOADING_MESSAGE"), "UI: loading message constant");
assert(companyUserServiceTs.includes("Could not load company users."), "UI: failed message constant");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:spreadsheet-users-source-of-truth"], "npm script registered");

console.log("[verify:spreadsheet-users-source-of-truth] OK: all 9 spreadsheet users source-of-truth cases passed");
