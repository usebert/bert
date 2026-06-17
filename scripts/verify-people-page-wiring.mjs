#!/usr/bin/env node
/** People page — active users from GET /users, pending from app-invites; no sheet/cache mixing. */
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


function asyncFunctionBody(source, name) {
  const re = new RegExp(`const ${name} = async[\\s\\S]*?\\n  };`);
  const match = source.match(re);
  return match ? match[0] : "";
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const appTsx = read("App.tsx");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const adminScreen = read("src/screens/AdminScreen.tsx");
const userService = read("src/services/companyUserService.ts");
const inviteService = read("src/services/companyInviteListService.ts");
const contextService = read("src/services/companyContextService.ts");
const adminProps = read("src/types/adminScreenProps.ts");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:people-page-wiring"], "PKG: npm script registered");

/** 1: Active users — canonical GET /api/companies/:companyId/users only. */
assert(userService.includes("fetchCompanyMembers"), "1: client fetchCompanyMembers");
assert(userService.includes("/api/companies/"), "1b: users API path");
assert(userService.includes("sanitizeCompanyMembersForClient"), "1c: PasswordHash stripped client-side");
assert(appTsx.includes("fetchCompanyMembers"), "1d: App loads active users via fetchCompanyMembers");
assert(
  /useEffect\([\s\S]{0,3500}resolveCompanyMembersLoadContext[\s\S]{0,3500}fetchCompanyMembers/.test(appTsx),
  "1e: page load uses session company context + fetchCompanyMembers",
);
assert(appTsx.includes("activeCompanyMembers={companyMembersState.members}"), "1f: People panel gets API members");

/** 2: Pending invites — GET /api/onboarding/app-invites only. */
assert(inviteService.includes('apiUrl("/api/onboarding/app-invites")'), "2: fetchPendingCompanyInvites hits app-invites");
assert(appTsx.includes("fetchPendingCompanyInvites"), "2b: App imports fetchPendingCompanyInvites");
assert(appTsx.includes("refreshPendingCompanyInvites"), "2c: refreshPendingCompanyInvites helper");
assert(
  /refreshPendingCompanyInvites[\s\S]{0,800}fetchPendingCompanyInvites/.test(appTsx),
  "2d: refresh delegates to fetchPendingCompanyInvites",
);
assert(appTsx.includes("companyInvitesState"), "2e: pending invites load state tracked");
assert(appTsx.includes("pendingInvitesLoading={companyInvitesState.loading}"), "2f: loading wired to AdminScreen");

/** 3: No mixing — sheet load must not populate invitedUsers or active members. */
assert(!appTsx.includes("parseCompanySheetUsers"), "3: no sheet-to-invite parser in App");
{
  const loadCompanySheetFn = appTsx.match(/const loadCompanySheet = async[\s\S]*?\n  };\n/)?.[0] ?? "";
  const loadCompanySheetByIdFn = appTsx.match(/const loadCompanySheetById = async[\s\S]*?\n  };\n/)?.[0] ?? "";
  assert(loadCompanySheetFn.length > 0, "3a: loadCompanySheet function present");
  assert(loadCompanySheetByIdFn.length > 0, "3a2: loadCompanySheetById function present");
  assert(!loadCompanySheetFn.includes("setInvitedUsers"), "3b: sheet load does not set invitedUsers");
  assert(!loadCompanySheetByIdFn.includes("setInvitedUsers"), "3b2: sheet-by-id load does not set invitedUsers");
}
assert(panel.includes("!isActiveCompanyUserInvite(invite)"), "3c: pending list excludes active invite rows");
assert(!panel.includes("activeInvites.map"), "3d: active list not driven by invite rows");

/** 4: No localStorage/cache/sheet merge for People lists. */
assert(!appTsx.includes("readCompanyMembersCache"), "4: App does not read members localStorage cache");
assert(!appTsx.includes("writeCompanyMembersCache"), "4b: App does not write members localStorage cache");
assert(!appTsx.includes("companyUsersTabRows"), "4c: App does not keep parallel sheet users tab rows");

/** 5: Session company context for both loads. */
assert(contextService.includes("resolveCompanyMembersLoadContext"), "5: shared members load context");
assert(
  /refreshPendingCompanyInvites[\s\S]{0,400}activeCompanyContext\.companyFolderId/.test(appTsx),
  "5b: pending invites scoped to session company folder",
);
assert(
  /fetchPendingCompanyInvites[\s\S]{0,400}companyFolderId/.test(appTsx),
  "5c: app-invites fetch passes companyFolderId filter",
);

/** 6: No PasswordHash in People UI path. */
assert(!/PasswordHash/.test(panel), "6: panel omits PasswordHash");
assert(userService.includes("sanitizeCompanyMemberForClient"), "6b: client sanitizes members");
assert(userService.includes('PASSWORD_HASH_FIELD_NAMES = ["PasswordHash", "passwordHash"]'), "6c: hash fields stripped");

/** 7: Friendly states — loading, error, empty; no endless loading. */
assert(panel.includes("COMPANY_MEMBERS_LOADING_MESSAGE"), "7: active loading message");
assert(panel.includes("activeMembersLoadError"), "7b: active load error UI");
assert(panel.includes("COMPANY_INVITES_LOADING_MESSAGE"), "7c: pending loading message");
assert(panel.includes("pendingInvitesLoadError"), "7d: pending load error prop");
assert(adminProps.includes("pendingInvitesLoading"), "7e: AdminScreenProps pending loading");
assert(appTsx.includes("COMPANY_MEMBERS_LOAD_TIMEOUT_MS"), "7f: active users load timeout");
assert(appTsx.includes("COMPANY_INVITES_LOAD_TIMEOUT_MS"), "7g: pending invites load timeout");
assert(
  /!masterCompanyWorkspaceDataMatchesSelection[\s\S]{0,200}loading:\s*false/.test(appTsx),
  "7h: stale godmode selection does not spin forever on members",
);

/** 8: Panel + AdminScreen wiring. */
assert(adminScreen.includes("pendingInvitesLoading"), "8: AdminScreen accepts pendingInvitesLoading");
assert(adminScreen.includes("pendingInvitesLoadError"), "8b: AdminScreen accepts pendingInvitesLoadError");
assert(panel.includes("Pending invites"), "8c: pending section present");
assert(panel.includes("Company people"), "8d: active users section present");
assert(
  !panel.includes("workbook Users tab"),
  "8e: panel copy does not reference sheet as People source",
);

/** 9: Mutations refresh canonical sources. */
{
  const handleInviteUserFn = appTsx.match(/const handleInviteUser = async[\s\S]*?\n  };\n/)?.[0] ?? "";
  const handleResendInviteFn = appTsx.match(/const handleResendInvite = async[\s\S]*?\n  };\n/)?.[0] ?? "";
  const handleDeleteInviteFn = appTsx.match(/const handleDeleteInvite = async[\s\S]*?\n  };\n/)?.[0] ?? "";
  const handleResyncUsersFn = appTsx.match(/const handleResyncUsers = async[\s\S]*?\n  };\n/)?.[0] ?? "";
  assert(handleInviteUserFn.includes("refreshPendingCompanyInvites"), "9: invite create refreshes pending list");
  assert(handleResendInviteFn.includes("refreshPendingCompanyInvites"), "9b: resend refreshes pending list");
  assert(handleDeleteInviteFn.includes("refreshPendingCompanyInvites"), "9c: revoke refreshes pending list");
  assert(handleResyncUsersFn.includes("refreshActiveCompanyMembers"), "9d: re-sync refreshes active users API");
  assert(handleResyncUsersFn.includes("refreshPendingCompanyInvites"), "9e: re-sync refreshes pending invites");
}

console.log(`[verify:people-page-wiring] OK — ${caseCount} cases passed`);
