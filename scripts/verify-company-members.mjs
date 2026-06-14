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
  assert(userService.includes("export async function listActiveCompanyMembers"), "1: listActiveCompanyMembers exported");
  assert(userService.includes("validateCompanyFolderUnderCompaniesRoot"), "1a: folder placement is soft-checked before sheet read");
  assert(!userService.includes("rejectIfCompanyFolderNotUnderCompaniesRoot"), "1a2: users list does not hard-block on folder placement");
  assert(userService.includes("buildCacheOrSessionFallbackSuccess"), "1a3: cache fallback before session-only fallback");
  assert(userService.includes("skipUsersTabColumnMigration: true"), "1a4: sheet read prefers no-migration path");
  assert(userService.includes("cache-fallback-rejected"), "1a5: stale cache fallback rejected when sheet has more rows");
  assert(userService.includes("session-fallback-rejected"), "1a6: session-only fallback rejected when sheet has multiple rows");
  assert(userService.includes("companyFolderId: resolvedCompanyId"), "1b: members normalize companyFolderId");
  assert(userService.includes("mapActiveCompanyMember") || userService.includes("mapCompanyProfileMember"), "1c: company profile mapper exists");
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
  assert(
    userService.includes("pickRowCompanyId") || sheetFlow.includes("pickRowCompanyId"),
    "4: Users tab rows read CompanyId from sheet",
  );
  assert(userService.includes("rowPassesCompanyProfileContext"), "4b: active members filter by company columns");
  assert(
    userService.includes("isWorkbookScopedCompanyContext") || sheetFlow.includes("rowPassesCompanyProfileContext"),
    "4c2: workbook rows use permissive company profile filter",
  );
  assert(userService.includes("companyId: resolvedFolderId"), "4c: active members use resolved folder id");
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
  assert(userService.includes("USERS_TAB_READ_FAILED"), "6: users tab read failure code");
  assert(reader.includes("readCompanyUsers"), "6a: dedicated users tab reader");
  assert(reader.includes("buildUsersTabRowObject"), "6a3: users tab reader resolves columns by header name");
  assert(userService.includes("MISSING_COMPANY_CONTEXT"), "6b: company context missing reasonCode");
  assert(userService.includes("COMPANY_USERS_LOAD_FAILED"), "6c: structured failure code");
}

/** 7: Active members from Users tab; session fallback when sheet read fails. */
{
  const userService = read("server/company-user-service.mjs");
  const sheetFlow = read("server/company-user-sheet-flow.mjs");
  assert(sheetFlow.includes("listActiveUsersFromSheet"), "7: listActiveUsersFromSheet helper");
  assert(userService.includes("readActiveUsersFromSheetWithStats"), "7b: listActiveCompanyMembers uses sheet helper with stats");
  assert(userService.includes("buildSessionFallbackSuccess"), "7c: session fallback on sheet read failure");
  assert(userService.includes("company_context_resolve"), "7d: canonical failedStep for company context");
  assert(userService.includes("master_sheet_resolve"), "7e: canonical failedStep for master sheet");
  assert(userService.includes("google_sheets_read"), "7f: canonical failedStep for sheet read");
}

/** 8: Frontend loads active members from canonical API with cache + safe JSON fetch. */
{
  const appSrc = read("App.tsx");
  const service = read("src/services/companyUserService.ts");
  const fetchJson = read("src/utils/fetchJson.ts");
  assert(service.includes("fetchCompanyMembers"), "8: frontend fetchCompanyMembers");
  assert(service.includes("readCompanyMembersCache"), "8b: cache read");
  assert(service.includes("COMPANY_MEMBERS_LOAD_TIMEOUT_MS"), "8c: load timeout");
  assert(service.includes("fetchJson"), "8c2: safe fetchJson used");
  assert(fetchJson.includes("NON_JSON_RESPONSE"), "8c3: NON_JSON_RESPONSE handled");
  assert(appSrc.includes("/api/companies/") && appSrc.includes("fetchCompanyMembers"), "8d: App uses company users API");
  assert(appSrc.includes("readCompanyMembersCache"), "8e: App uses members cache for loading optimisation");
  assert(
    !/fetchCompanyMembers[\s\S]{0,4000}Showing recently loaded users/.test(appSrc),
    "8f: company members path has no stale-cache banner",
  );
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
  assert(userService.includes("listActiveCompanyMembers(auth, deps"), "10: getAssignableUsers uses listActiveCompanyMembers");
  assert(assigneeService.includes("getAssignableUsers"), "10b: schedule assignee service uses getAssignableUsers");
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

/** 14: Wide legacy Users tab (duplicate Company headers) — all 3 Dovecote ACTIVE users listable. */
{
  const {
    buildUsersTabRowObject,
    normalizeUsersTabRowObject,
    backfillRowCompanyFields,
    rowPassesCompanyProfileContext,
    sanitizeUserRecordForClient,
  } = await import("../server/users-tab-schema.mjs");
  const { isExcludedCompanyProfileStatus } = await import("../shared/schedule-assignees.mjs");
  const { normalizeUserStatus } = await import("../server/users-tab-schema.mjs");

  const folderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11c";
  const masterSheetId = "1PIwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3o";
  const companyCtx = {
    companyFolderId: folderId,
    companyId: folderId,
    companyName: "Dovecote Studio",
    masterSheetId,
  };
  const headers = [
    "Email",
    "Name",
    "Role",
    "AccessLevel",
    "Status",
    "CompanyAreas",
    "PasswordHash",
    "CreatedAt",
    "UpdatedAt",
    "User ID",
    "Company ID",
    "PasswordUpdatedAt",
    "LastLoginAt",
    "InvitedAt",
    "Full Name",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
    "Company",
    "CompanyId",
    "CompanyFolderId",
  ];
  const sheetRows = [
    [
      "dovecotestudio@icloud.com",
      "Edward Thomas",
      "Company Admin",
      "",
      "ACTIVE",
      "",
      "scrypt$edward",
      "2024-01-01",
      "",
      "",
      "",
      "",
      "",
      "",
      "Edward Thomas",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Dovecote Studio",
      "",
      "",
    ],
    [
      "andy@qmsprecast.co.uk",
      "Andy Hall",
      "Manager",
      "",
      "ACTIVE",
      "operational",
      "scrypt$andy",
      "2024-01-02",
      "",
      "",
      masterSheetId,
      "",
      "",
      "",
      "Andy Hall",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Dovecote Studio",
      folderId,
      "",
    ],
    [
      "7oakcottages@gmail.com",
      "sophie Graney",
      "Manager",
      "",
      "ACTIVE",
      "",
      "scrypt$sophie",
      "2024-01-03",
      "",
      "",
      "registry-workspace-id",
      "",
      "",
      "",
      "sophie Graney",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Dovecote Studio",
      folderId,
      folderId,
    ],
  ];

  const profiles = sheetRows
    .map((row) => normalizeUsersTabRowObject(buildUsersTabRowObject(headers, row)))
    .map((row) => backfillRowCompanyFields(row, companyCtx))
    .filter((row) => {
      const email = String(row.Email || "").trim().toLowerCase();
      const name = String(row.Name || "").trim();
      if (!email || !name || isExcludedCompanyProfileStatus(normalizeUserStatus(row.Status))) {
        return false;
      }
      return rowPassesCompanyProfileContext(row, companyCtx);
    })
    .map((row) => sanitizeUserRecordForClient(row));

  assert(profiles.length === 3, "14: all 3 wide-schema ACTIVE users listable");
  assert(
    profiles.every((row) => !String(row.PasswordHash || row.passwordHash || "").startsWith("scrypt$")),
    "14b: PasswordHash never returned from sanitized profiles",
  );
  const emails = profiles.map((row) => String(row.Email || row.email || "").toLowerCase()).sort();
  assert(
    emails.join(",") ===
      "7oakcottages@gmail.com,andy@qmsprecast.co.uk,dovecotestudio@icloud.com",
    "14c: expected Dovecote user emails",
  );
}

console.log("[verify:company-members] OK: all 14 company member cases passed");
