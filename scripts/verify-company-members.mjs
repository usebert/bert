#!/usr/bin/env node
/** Company members contract — canonical /users API, active-only list, companyId = companyFolderId. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isActiveUser, isListableCompanyProfile } from "../shared/schedule-assignees.mjs";

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

const ownCompany = "company-folder-own";
const registryWorkspaceId = "registry-workspace-id";

const activeManager = {
  email: "manager@example.com",
  name: "Site Manager",
  role: "Manager",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: registryWorkspaceId,
  companyAreas: [],
};

const activeAuditorBlankAreas = {
  email: "auditor@example.com",
  name: "Field Auditor",
  role: "Auditor",
  accessLevel: "AUDITOR",
  status: "active",
  companyId: "",
  companyAreas: [],
};

const pendingInvite = {
  email: "pending@example.com",
  name: "Pending User",
  role: "User",
  accessLevel: "operational",
  status: "INVITED",
  companyId: ownCompany,
  companyAreas: [],
};

/** 1: Server exposes listActiveCompanyMembers. */
{
  const userService = read("server/company-user-service.mjs");
  const foundation = read("server/company-users-foundation.mjs");
  assert(userService.includes("export async function listActiveCompanyMembers"), "1: listActiveCompanyMembers exported");
  assert(userService.includes("validateCompanyFolderUnderCompaniesRoot") || foundation.includes("validateCompanyFolderUnderCompaniesRoot"), "1a: folder placement is soft-checked before sheet read");
  assert(!userService.includes("rejectIfCompanyFolderNotUnderCompaniesRoot"), "1a2: users list does not hard-block on folder placement");
  assert(!userService.includes("buildCacheOrSessionFallbackSuccess"), "1a3: no cache/session fallback for active users");
  assert(!userService.includes("buildSessionFallbackSuccess"), "1a3b: session fallback helper removed");
  assert(userService.includes("listCompanyProfilesFromFoundation"), "1a4: listActiveCompanyMembers delegates to foundation");
  assert(foundation.includes("listableProfilesFromUsersTabRecords"), "1a4b: foundation maps workbook Users tab profiles");
  assert(foundation.includes("syncCompanyUsersCache"), "1a4c: foundation rebuilds cache from sheet result");
  assert(
    userService.includes("companyFolderId: resolvedCompanyId") ||
      foundation.includes("companyFolderId: resolvedCompanyId") ||
      read("server/users-tab-profiles.mjs").includes("companyFolderId: resolvedFolderId"),
    "1b: members normalize companyFolderId",
  );
  assert(
    userService.includes("mapActiveCompanyMember") ||
      userService.includes("mapCompanyProfileMember") ||
      read("server/users-tab-profiles.mjs").includes("mapUsersTabProfileMember"),
    "1c: company profile mapper exists",
  );
}

/** 2: GET /api/companies/:companyId/users route exists. */
{
  const coreRoutes = read("server/core-workflow-routes.mjs");
  assert(coreRoutes.includes('app.get("/api/companies/:companyId/users"'), "2: company users list route");
  assert(
    (coreRoutes.includes("company-users-foundation") && coreRoutes.includes("listCompanyProfiles")) ||
      coreRoutes.includes("syncAndListActiveUsers") ||
      coreRoutes.includes("listActiveCompanyMembers"),
    "2b: route uses foundation listCompanyProfiles",
  );
}

/** 3: ACTIVE users included; pending profiles listable; deleted/removed excluded. */
{
  assert(isActiveUser(activeManager), "3: manager ACTIVE");
  assert(isActiveUser(activeAuditorBlankAreas), "3b: mixed-case active");
  assert(!isActiveUser(pendingInvite), "3c: pending is not active status");
  assert(isListableCompanyProfile(pendingInvite), "3d: pending profile is listable");
}

/** 4: companyId = companyFolderId — workbook rows use explicit Company columns. */
{
  const userService = read("server/company-user-service.mjs");
  const sheetFlow = read("server/company-user-sheet-flow.mjs");
  const profilesModule = read("server/users-tab-profiles.mjs");
  const foundation = read("server/company-users-foundation.mjs");
  assert(
    userService.includes("pickRowCompanyId") || profilesModule.includes("pickRowCompanyId") || sheetFlow.includes("pickRowCompanyId"),
    "4: Users tab rows read CompanyId from sheet",
  );
  assert(
    userService.includes("rowPassesCompanyProfileContext") ||
      profilesModule.includes("isWorkbookScopedCompanyContext") ||
      foundation.includes("isWorkbookScopedCompanyContext"),
    "4b: active members filter by company columns",
  );
  assert(
    userService.includes("isWorkbookScopedCompanyContext") ||
      profilesModule.includes("isWorkbookScopedCompanyContext") ||
      sheetFlow.includes("listableProfilesFromUsersTabRecords"),
    "4c2: workbook rows use permissive company profile filter",
  );
  assert(
    userService.includes("companyId: resolvedFolderId") || profilesModule.includes("companyId: resolvedFolderId"),
    "4c: active members use resolved folder id",
  );
}

/** 5: PasswordHash never returned. */
{
  const companyUsers = read("server/company-users.mjs");
  const userService = read("server/company-user-service.mjs");
  assert(companyUsers.includes("sanitizeUsersTabRecords"), "5: sanitizeUsersTabRecords exists");
  assert(userService.includes("sanitizeUsersTabRecords"), "5b: getCompanyUsers sanitizes records");
}

/** 6: Structured failure — not silent empty. */
{
  const userService = read("server/company-user-service.mjs");
  const reader = read("server/users-tab-reader.mjs");
  const foundation = read("server/company-users-foundation.mjs");
  assert(userService.includes("USERS_TAB_READ_FAILED") || foundation.includes("USERS_TAB_READ_FAILED"), "6: users tab read failure code");
  assert(reader.includes("readCompanyUsers"), "6a: dedicated users tab reader");
  assert(
    reader.includes("buildUsersTabRowObject") ||
      read("server/users-tab-schema.mjs").includes("buildUsersTabRowObject") ||
      read("server/users-tab-profiles.mjs").includes("buildUsersTabRowObject"),
    "6a3: users tab reader resolves columns by header name",
  );
  assert(
    userService.includes("MISSING_COMPANY_CONTEXT") ||
      foundation.includes("MISSING_COMPANY_CONTEXT") ||
      foundation.includes("COMPANY_CONTEXT_FAILED"),
    "6b: company context missing reasonCode",
  );
  assert(userService.includes("COMPANY_USERS_LOAD_FAILED") || foundation.includes("COMPANY_USERS_LOAD_FAILED"), "6c: structured failure code");
}

/** 7: Active members from Users tab; structured failure when sheet read fails. */
{
  const userService = read("server/company-user-service.mjs");
  const sheetFlow = read("server/company-user-sheet-flow.mjs");
  const foundation = read("server/company-users-foundation.mjs");
  assert(sheetFlow.includes("listActiveUsersFromSheet"), "7: listActiveUsersFromSheet helper");
  assert(
    foundation.includes("readUsersTabProfiles") || userService.includes("readActiveUsersFromSheetWithStats"),
    "7b: company profiles read Users tab with stats",
  );
  assert(!userService.includes("buildSessionFallbackSuccess"), "7c: session fallback helper removed");
  assert(foundation.includes('dataSource: "users_tab"'), "7c2: sheet-only dataSource");
  assert(foundation.includes("company_context_resolve") || userService.includes("company_context_resolve"), "7d: canonical failedStep for company context");
  assert(foundation.includes("master_sheet_resolve") || userService.includes("master_sheet_resolve"), "7e: canonical failedStep for master sheet");
  assert(foundation.includes("google_sheets_read") || userService.includes("google_sheets_read"), "7f: canonical failedStep for sheet read");
}

/** 8: Frontend loads active members from canonical API without localStorage cache. */
{
  const appSrc = read("App.tsx");
  const service = read("src/services/companyUserService.ts");
  const fetchJson = read("src/utils/fetchJson.ts");
  assert(service.includes("fetchCompanyMembers"), "8: frontend fetchCompanyMembers");
  assert(service.includes("COMPANY_MEMBERS_LOAD_TIMEOUT_MS"), "8c: load timeout");
  assert(service.includes("fetchJson"), "8c2: safe fetchJson used");
  assert(fetchJson.includes("NON_JSON_RESPONSE"), "8c3: NON_JSON_RESPONSE handled");
  assert(appSrc.includes("loadCompanyMembersCached"), "8d: App uses people SWR members loader");
  assert(!appSrc.includes("readCompanyMembersCache"), "8e: App does not read legacy members bag cache");
  assert(!appSrc.includes("writeCompanyMembersCache"), "8f: App does not write legacy members bag cache");
}

/** 9: Users panel — active from /users, pending invites separate, godmode-only workbook hint. */
{
  const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
  assert(panel.includes("Pending invites"), "9: pending invites section");
  assert(panel.includes("activeCompanyMembers"), "9b: active members prop");
  assert(panel.includes("activeMembersLoadError"), "9c: load error UI");
  assert(panel.includes("canShowCompanyMembersDiagnostics"), "9c2: godmode gates error detail");
  assert(panel.includes("activeMembersLoadErrorDetail"), "9c2b: technical error detail prop");
  assert(panel.includes("COMPANY_MEMBERS_USER_MESSAGE"), "9c3: normal user load error constant");
  assert(panel.includes("COMPANY_MEMBERS_LOADING_MESSAGE"), "9c3b: loading message constant");
  assert(panel.includes("!isActiveCompanyUserInvite(invite)"), "9d: pending excludes active invite rows");
  assert(!panel.includes("activeInvites.map"), "9e: active list not driven by invite rows");
}

/** 10: Schedule assignees reuse shared active member read path. */
{
  const userService = read("server/company-user-service.mjs");
  const assigneeService = read("server/schedule-assignee-service.mjs");
  const scheduleService = read("server/schedule-service.mjs");
  assert(
    userService.includes("getAssignableUsers") ||
      read("server/company-users-foundation.mjs").includes("getAssignableUsers"),
    "10: getAssignableUsers exported from company users layer",
  );
  assert(
    assigneeService.includes("getAssignableUsers") || assigneeService.includes("listSchedulerAssignees"),
    "10b: schedule assignee service uses shared list path",
  );
  assert(
    scheduleService.includes("listActiveUsers") || scheduleService.includes("listActiveCompanyMembers"),
    "10c: schedule service reads active users from sheet",
  );
}

/** 11: Blank CompanyAreas users remain assignable when no area filter (shared module). */
{
  const { buildAvailableScheduleAssigneesFromUsers } = await import("../shared/schedule-assignees.mjs");
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeAuditorBlankAreas], {
    companyId: ownCompany,
    selectedArea: "",
  });
  assert(assignees.some((item) => item.email === activeAuditorBlankAreas.email), "11: blank areas included without filter");
}

/** 12: Registry workspace id on sheet row still appears when companyFolderId passed. */
{
  const { buildAvailableScheduleAssigneesFromUsers } = await import("../shared/schedule-assignees.mjs");
  const normalized = { ...activeManager, companyId: ownCompany };
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([normalized], { companyId: ownCompany });
  assert(assignees.some((item) => item.email === activeManager.email), "12: normalized companyId matches folder");
}

/** 13: Active user edit — PATCH route, validation, writeback. */
{
  const companyUsers = read("server/company-users.mjs");
  const serverMain = read("server/server.mjs");
  const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
  const service = read("src/services/companyUserService.ts");
  assert(companyUsers.includes("updateCompanyUserRecord"), "13: updateCompanyUserRecord exported");
  assert(companyUsers.includes("isValidCompanyUserEmail"), "13b: email validation");
  assert(
    serverMain.includes('"/api/companies/:companyFolderId/users/:email"') && serverMain.includes("app.patch"),
    "13c: PATCH route",
  );
  assert(service.includes("updateCompanyMember"), "13d: client updateCompanyMember");
  assert(panel.includes("ActiveUserCard"), "13e: active user cards in panel");
  assert(panel.includes("onUpdateCompanyMember"), "13f: edit handler wired");
}

/** 14: Dovecote Users tab fixture (actual xlsx) — all 3 ACTIVE users listable. */
{
  const { buildUsersTabRowObject, normalizeUsersTabRowObject } = await import("../server/users-tab-schema.mjs");
  const { listableProfilesFromUsersTabRecords } = await import("../server/users-tab-profiles.mjs");
  const {
    DOVECOTE_FOLDER_ID,
    DOVECOTE_MASTER_SHEET_ID,
    DOVECOTE_COMPANY_NAME,
    DOVECOTE_USERS_TAB_HEADERS,
    DOVECOTE_USERS_TAB_ROWS,
    DOVECOTE_EXPECTED_EMAILS,
  } = await import("./fixtures/dovecote-users-tab.fixture.mjs");

  const companyCtx = {
    companyFolderId: DOVECOTE_FOLDER_ID,
    companyId: DOVECOTE_FOLDER_ID,
    companyName: DOVECOTE_COMPANY_NAME,
    masterSheetId: DOVECOTE_MASTER_SHEET_ID,
  };

  const records = DOVECOTE_USERS_TAB_ROWS.map((row) =>
    normalizeUsersTabRowObject(buildUsersTabRowObject(DOVECOTE_USERS_TAB_HEADERS, row)),
  );
  const { members, totalSheetRows, profilesReturned } = listableProfilesFromUsersTabRecords(records, companyCtx);

  assert(totalSheetRows === 3, "14: fixture has 3 data rows");
  assert(profilesReturned === 3, "14: all 3 wide-schema ACTIVE users listable");
  assert(
    members.every((row) => !String(row.PasswordHash || row.passwordHash || "").startsWith("scrypt$")),
    "14b: PasswordHash never returned from sanitized profiles",
  );
  const emails = members.map((row) => String(row.email || "").toLowerCase()).sort();
  assert(emails.join(",") === DOVECOTE_EXPECTED_EMAILS.join(","), "14c: expected Dovecote user emails");
}

/** 15: BERT Master Sheet template fixture — exact xlsx headers + 3 Dovecote rows → 3 profiles. */
{
  const {
    BERT_MASTER_SHEET_USERS_HEADERS,
    DOVECOTE_USERS_TAB_ROWS,
    DOVECOTE_COMPANY_CONTEXT,
  } = await import("../server/fixtures/bert-master-sheet-users-template.mjs");
  const { listProfilesFromUsersTabRows } = await import("../server/users-tab-profiles.mjs");
  const { USERS_TAB_COLUMNS } = await import("../server/users-tab-constants.mjs");

  assert(
    JSON.stringify(BERT_MASTER_SHEET_USERS_HEADERS) === JSON.stringify(USERS_TAB_COLUMNS),
    "15: fixture headers match BERT Master Sheet template columns",
  );
  assert(DOVECOTE_USERS_TAB_ROWS.length === 3, "15b: fixture has 3 user rows");

  const result = listProfilesFromUsersTabRows(
    BERT_MASTER_SHEET_USERS_HEADERS,
    DOVECOTE_USERS_TAB_ROWS,
    DOVECOTE_COMPANY_CONTEXT,
  );
  assert(result.members.length === 3, "15c: fixture lists all 3 Dovecote workbook users");
  assert(
    result.members.every((row) => !String(row.passwordHash || row.PasswordHash || "").startsWith("scrypt$")),
    "15d: PasswordHash never returned from profile mapper",
  );
  const fixtureEmails = result.members.map((row) => String(row.email || "").toLowerCase()).sort();
  assert(
    fixtureEmails.join(",") ===
      "7oakcottages@gmail.com,andy@qmsprecast.co.uk,dovecotestudio@icloud.com",
    "15e: expected Dovecote fixture emails",
  );
}

console.log("[verify:company-members] OK: all 15 company member cases passed");
