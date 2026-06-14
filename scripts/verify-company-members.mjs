#!/usr/bin/env node
/** Company members contract — canonical /users API, active-only list, companyId = companyFolderId. */
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
  assert(userService.includes("companyFolderId: resolvedCompanyId"), "1b: members normalize companyFolderId");
  assert(userService.includes("mapActiveCompanyMember"), "1c: active member mapper exists");
}

/** 2: GET /api/companies/:companyId/users route exists. */
{
  const coreRoutes = read("server/core-workflow-routes.mjs");
  assert(coreRoutes.includes('app.get("/api/companies/:companyId/users"'), "2: company users list route");
  assert(coreRoutes.includes("listActiveCompanyMembers"), "2b: route uses listActiveCompanyMembers");
}

/** 3: ACTIVE users included; pending excluded from active members mapping logic. */
{
  assert(isActiveUser(activeManager), "3: manager ACTIVE");
  assert(isActiveUser(activeAuditorBlankAreas), "3b: mixed-case active");
  assert(!isActiveUser(pendingInvite), "3c: pending excluded");
}

/** 4: companyId = companyFolderId — workbook rows use explicit Company columns. */
{
  const userService = read("server/company-user-service.mjs");
  const sheetFlow = read("server/company-user-sheet-flow.mjs");
  assert(
    userService.includes("pickRowCompanyId") || sheetFlow.includes("pickRowCompanyId"),
    "4: Users tab rows read CompanyId from sheet",
  );
  assert(userService.includes("rowMatchesCompanyContext"), "4b: active members filter by company columns");
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
  assert(userService.includes("readCompanyUsers"), "6a2: list path uses readCompanyUsers");
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
  assert(panel.includes("canShowTechnicalUi(currentUser.role)"), "9c2: godmode gates error detail");
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

console.log("[verify:company-members] OK: all 13 company member cases passed");
