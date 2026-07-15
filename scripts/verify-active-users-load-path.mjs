#!/usr/bin/env node
/** Active users page load must use the same syncAndListActiveUsers path as Re-sync. */
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

const appSrc = read("App.tsx");
const userService = read("server/company-user-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const clientService = read("src/services/companyUserService.ts");
const contextService = read("src/services/companyContextService.ts");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const godmodePanel = read("src/components/godmode/GodmodeUserManagementSection.tsx");
const godmodeService = read("server/godmode-service.mjs");
const pkg = JSON.parse(read("package.json"));

const foundation = read("server/company-users-foundation.mjs");

/** 1: Server canonical helper exported. */
assert(userService.includes("export async function syncAndListActiveUsers"), "1: syncAndListActiveUsers exported");
assert(userService.includes("readActiveUsersFromSheetWithStats"), "1b: reads Users tab with stats");
assert(
  foundation.includes("syncCompanyUsersCache") || userService.includes("reconcileCompanyUsersCache"),
  "1c: server rebuilds users cache from sheet read",
);
assert(foundation.includes("sanitizeUsersTabRecords") || userService.includes("sanitizeUsersTabRecords"), "1d: never returns PasswordHash");

/** 2: GET /api/companies/:companyId/users calls syncAndListActiveUsers. */
assert(coreRoutes.includes('app.get("/api/companies/:companyId/users"'), "2: users list route");
assert(
  (coreRoutes.includes("company-users-foundation") && coreRoutes.includes("listCompanyProfiles")) ||
    coreRoutes.includes("syncAndListActiveUsers"),
  "2b: route uses foundation listCompanyProfiles",
);

/** 3: Client syncAndListActiveUsers alias hits same endpoint. */
assert(clientService.includes("export { fetchCompanyMembers as syncAndListActiveUsers }"), "3: client syncAndListActiveUsers alias");
assert(clientService.includes("/api/companies/"), "3b: client hits canonical users API");

/** 4: Page load and Re-sync share resolveCompanyMembersLoadContext. */
assert(contextService.includes("resolveCompanyMembersLoadContext"), "4: shared load context resolver");
assert(
  /resolveCompanyMembersLoadContext[\s\S]*?activeCompanyContext\.companyFolderId[\s\S]*?selectedFolderId/.test(
    contextService,
  ),
  "4a: linked session folder preferred over stale picker selection",
);
assert(appSrc.includes("resolveCompanyMembersLoadContext"), "4b: App uses shared resolver");
assert(appSrc.includes("loadCompanyMembersCached"), "4c: App uses people SWR cache for members");
assert(appSrc.includes("readPeopleCache"), "4c2: App seeds members from people cache");
assert(!appSrc.includes("applySignedInMemberFallback"), "4d: App does not silently fall back to signed-in user only");
assert(
  /!activeCompanyContext\.masterSheetId\.trim\(\)/.test(appSrc),
  "4d: full-screen block only when workbook context missing",
);
assert(
  /useEffect\([\s\S]{0,2500}resolveCompanyMembersLoadContext[\s\S]{0,2500}loadCompanyMembersCached/.test(appSrc),
  "4c: page load effect uses shared resolver + loadCompanyMembersCached",
);
assert(appSrc.includes("refreshActiveCompanyMembers"), "4d: shared refresh helper exists");
assert(
  /handleResyncUsers[\s\S]{0,1200}refreshActiveCompanyMembers/.test(appSrc),
  "4e: Re-sync delegates to refreshActiveCompanyMembers",
);

/** 5: Both paths update companyMembersState from API. */
assert(appSrc.includes("setCompanyMembersState"), "5: page load updates companyMembersState");
assert(
  /refreshActiveCompanyMembers[\s\S]{0,1200}setCompanyMembersState/.test(appSrc),
  "5b: refresh updates companyMembersState",
);
assert(!appSrc.includes("companyUsersTabRows"), "5c: App does not keep parallel sheet users tab rows");

/** 6: Empty state only when sheet read succeeded with zero ACTIVE rows. */
assert(panel.includes("!activeMembersLoadError && filteredActiveMembers.length === 0"), "6: panel empty only without load error");
assert(godmodePanel.includes("!activeMembersLoadError && activeCompanyMembers.length === 0"), "6b: godmode empty only without load error");
assert(panel.includes("activeMembersLoadError"), "6c: load error surfaced in panel");

/** 7: Godmode People uses same server helper. */
assert(
  godmodeService.includes("listCompanyProfiles") ||
    godmodeService.includes("syncAndListActiveUsers"),
  "7: godmode service uses foundation listCompanyProfiles",
);

/** 8: Schedule assignees reuse list path via getAssignableUsers. */
assert(userService.includes("getAssignableUsers"), "8: schedule assignees path exists");
assert(
  /getAssignableUsers[\s\S]{0,400}syncAndListActiveUsers/.test(userService),
  "8b: getAssignableUsers uses syncAndListActiveUsers",
);

/** 9: npm script registered. */
assert(pkg.scripts["verify:active-users-load-path"], "9: verify npm script registered");

console.log("[verify:active-users-load-path] OK: page load and Re-sync share syncAndListActiveUsers path");
