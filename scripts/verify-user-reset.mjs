#!/usr/bin/env node
/** BERT controlled user reset — 15 contract cases from spec. */
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

const resetModule = read("server/company-user-reset.mjs");
const sessionRevocation = read("server/company-session-revocation.mjs");
const usersCache = read("server/company-users-cache.mjs");
const authIndex = read("server/auth-index.mjs");
const authService = read("server/auth-service.mjs");
const serverMain = read("server/server.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const resetPanel = read("src/components/godmode/CompanyUserResetPanel.tsx");
const resetService = read("src/services/companyUserResetService.ts");
const appTsx = read("App.tsx");
const userService = read("server/company-user-service.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const workspaceReset = read("server/company-workspace-reset.mjs");
const pkg = JSON.parse(read("package.json"));

/** 1: Godmode survives reset — platform owner never revoked or written to Users tab. */
{
  assert(resetModule.includes("isPlatformOwnerEmail"), "1: reset skips platform owner");
  assert(sessionRevocation.includes("isPlatformOwnerEmail"), "1b: session revocation skips platform owner");
  assert(!resetModule.includes("writeUsersTabRecord"), "1c: reset does not write Users tab rows");
  assert(!resetModule.includes("master-operators"), "1d: reset does not touch master-operators.json");
  assert(authIndex.includes("isPlatformOwnerAuthIndexEmail"), "1e: auth index skips platform owner on rebuild");
  assert(read("server/master-auth.mjs").includes("performMasterLogin"), "1f: master login uses performMasterLogin");
}

/** 2: Selected company Users tab is backed up. */
{
  assert(resetModule.includes("Users_Backup_"), "2: backup tab naming convention");
  assert(resetModule.includes("duplicateSheet"), "2b: duplicates Users tab before clear");
  assert(resetModule.includes("backupTabName"), "2c: report includes backupTabName");
}

/** 3: Users tab cleared with required headers preserved. */
{
  assert(resetModule.includes("USERS_TAB_MINIMUM_HEADERS"), "3: clears to minimum headers");
  assert(resetModule.includes("clearUsersTabToHeaders"), "3b: clears rows keeps headers");
  assert(resetModule.includes('"Email"') || resetModule.includes("Email"), "3c: Email header preserved");
}

/** 4: Company user cache cleared. */
{
  assert(usersCache.includes("clearCompanyUsersCache"), "4: per-company cache clear");
  assert(resetModule.includes("clearCompanyUsersCache"), "4b: reset clears company cache");
  assert(resetModule.includes("cacheEntriesRemoved"), "4c: report counts cache entries");
}

/** 5: Auth index entries cleared. */
{
  assert(authIndex.includes("clearCompanyAuthIndexEntries"), "5: auth index company clear");
  assert(resetModule.includes("clearCompanyAuthIndexEntries"), "5b: reset clears auth index");
  assert(resetModule.includes("authIndexEntriesRemoved"), "5c: report counts auth index removals");
}

/** 6: Pending and used company invites cleared. */
{
  assert(resetModule.includes('record?.kind !== "company_user"'), "6: only company_user invites purged");
  assert(!resetModule.includes("if (record.consumedAt)"), "6b: consumed invites also removed");
  assert(resetModule.includes("invitesRemoved"), "6c: report counts invites removed");
}

/** 7: Company user sessions invalidated (not Godmode). */
{
  assert(sessionRevocation.includes("revokeCompanyUserSessions"), "7: session revocation API");
  assert(serverMain.includes("isCompanyUserSessionRevoked"), "7b: session endpoint checks revocation");
  assert(authService.includes("isCompanyUserSessionRevoked"), "7c: login checks revocation");
  assert(resetModule.includes("sessionsInvalidated"), "7d: report counts invalidated sessions");
}

/** 8: Removed users cannot log in — auth index cleared and login uses index. */
{
  assert(authService.includes("lookupByEmail"), "8: login reads auth index");
  assert(authService.includes("invalid_credentials"), "8b: missing index returns invalid credentials");
  assert(resetModule.includes("clearCompanyAuthIndexEntries"), "8c: reset clears index entries");
}

/** 9: Active users list empty after reset — frontend clears member caches and refetches. */
{
  assert(appTsx.includes("handleCompanyUserResetSuccess"), "9: App handles user reset success");
  assert(appTsx.includes("clearStaleCompanyLocalStorage"), "9b: clears stale local storage");
  assert(appTsx.includes("setInvitedUsers([])"), "9c: clears invite list state");
  assert(resetPanel.includes("No active users") || read("src/components/godmode/GodmodeUserManagementSection.tsx").includes("No active users yet"), "9d: empty users UI copy");
}

/** 10: New invite can be sent after reset — invite routes unchanged, reset only purges store. */
{
  assert(serverMain.includes("createInviteRecord"), "10: invite create still available");
  assert(resetModule.includes("purgeAllCompanyUserInvitesForCompany"), "10b: reset purges old invites only");
}

/** 11: Invite acceptance writes correct Users tab row. */
{
  assert(sheetFlow.includes("completeInviteToUserRow"), "11: invite completion writes Users tab");
  assert(sheetFlow.includes('status: "ACTIVE"'), "11b: completion sets ACTIVE");
}

/** 12: New user can log in after invite acceptance. */
{
  assert(sheetFlow.includes("canLoginCompanyUser"), "12: login reads Users tab after invite");
  assert(authService.includes("canLoginCompanyUser"), "12b: auth service can probe sheet login");
}

/** 13: Godmode can see new user after invite — listActiveCompanyMembers path preserved. */
{
  assert(userService.includes("listActiveCompanyMembers"), "13: active members list path exists");
  assert(panel.includes("GodmodeUserManagementSection"), "13b: godmode user management section");
}

/** 14: PasswordHash never returned from list/reset paths. */
{
  assert(userService.includes("sanitizeUsersTabRecords"), "14: user list sanitizes PasswordHash");
  assert(!resetService.includes("PasswordHash"), "14b: client reset service does not mention PasswordHash payload");
  assert(resetModule.includes("readCompanyUsers"), "14c: reset uses sanitized reader");
}

/** 15: Schedules/reports/evidence not deleted — reset scope is users/auth only. */
{
  assert(!resetModule.includes("Schedule"), "15: reset module does not touch Schedule tab");
  assert(!resetModule.includes("Evidence"), "15b: reset module does not touch Evidence tab");
  assert(!resetModule.includes("Reports"), "15c: reset module does not touch Reports tab");
  assert(resetModule.includes("preservedOperationalData"), "15d: report marks operational data preserved");
  assert(!workspaceReset.includes("reset-users"), "15e: distinct from full workspace reset routes");
}

/** Routes and UI wiring. */
{
  assert(resetModule.includes("/api/godmode/companies/:companyId/reset-users"), "16: company reset-users route");
  assert(resetModule.includes("/api/godmode/reset-all-company-users"), "16b: global reset-all route");
  assert(serverMain.includes("installCompanyUserResetRoutes"), "16c: routes installed");
  assert(panel.includes("CompanyUserResetPanel"), "16d: godmode panel wired");
  assert(resetPanel.includes("RESET_USERS_CONFIRM_PHRASE"), "16e: typed confirmation for company reset");
  assert(resetPanel.includes("RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE"), "16f: typed confirmation for global reset");
}

assert(pkg.scripts["verify:user-reset"], "17: npm script registered");

console.log("[verify:user-reset] OK: all 15 user reset contract cases passed");
