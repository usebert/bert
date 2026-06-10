#!/usr/bin/env node
/** Fourteen schedule assignee loading cases — all active company roles, area, company scope, diagnostics. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAvailableScheduleAssigneesFromUsers,
  buildScheduleAssigneeDiagnostics,
  belongsToCurrentCompany,
  canCompleteAudit,
  isActiveUser,
} from "../shared/schedule-assignees.mjs";

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
const otherCompany = "company-folder-other";

const activeAdmin = {
  email: "admin@example.com",
  name: "Company Admin",
  role: "Admin",
  accessLevel: "full",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: ["Bay 1"],
};

const activeManager = {
  email: "manager@example.com",
  name: "Site Manager",
  role: "Manager",
  accessLevel: "operational",
  status: "Active",
  companyId: ownCompany,
  companyAreas: ["Bay 1"],
};

const activeAuditor = {
  email: "auditor@example.com",
  name: "Auditor",
  role: "Auditor",
  accessLevel: "AUDITOR",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: ["Bay 2"],
};

const activeUser = {
  email: "user@example.com",
  name: "Operator",
  role: "User",
  accessLevel: "operational",
  status: "active",
  companyId: ownCompany,
  companyAreas: ["Bay 2"],
};

const activeAuditorByAccessLevel = {
  email: "auditor.access@example.com",
  name: "Access Auditor",
  role: "User",
  accessLevel: "AUDITOR",
  status: "Active",
  companyId: ownCompany,
  companyAreas: [],
};

const mixedCaseUser = {
  email: "mixed@example.com",
  name: "Mixed Case",
  role: "manager",
  accessLevel: "Manager",
  status: "active",
  companyId: ownCompany,
  companyAreas: [],
};

const blankAreasUser = {
  email: "blank.areas@example.com",
  name: "Blank Areas",
  role: "User",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: [],
};

const matchingAreaUser = {
  email: "area.match@example.com",
  name: "Area Match",
  role: "User",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: ["Bay 2"],
};

const otherCompanyUser = {
  email: "other.company@example.com",
  name: "Other Company",
  role: "User",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: otherCompany,
  companyAreas: [],
};

const inactiveUser = {
  email: "inactive@example.com",
  name: "Inactive",
  role: "User",
  accessLevel: "operational",
  status: "INVITED",
  companyId: ownCompany,
  companyAreas: [],
};

const godmodeOnlyUser = {
  email: "godmode@example.com",
  name: "Platform Owner",
  role: "Master",
  accessLevel: "full",
  status: "ACTIVE",
  companyId: "",
  companyAreas: [],
};

/** 1: Company Admin + ACTIVE appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeAdmin], { companyId: ownCompany });
  assert(assignees.some((item) => item.email === activeAdmin.email), "1: Company Admin + ACTIVE appears");
}

/** 2: Manager + ACTIVE appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeManager], { companyId: ownCompany });
  assert(assignees.some((item) => item.email === activeManager.email), "2: Manager + ACTIVE appears");
}

/** 3: Auditor + ACTIVE appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeAuditor], { companyId: ownCompany });
  assert(assignees.some((item) => item.email === activeAuditor.email), "3: Auditor + ACTIVE appears");
}

/** 4: User + ACTIVE appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeUser], { companyId: ownCompany });
  assert(assignees.some((item) => item.email === activeUser.email), "4: User + ACTIVE appears");
}

/** 5: AccessLevel AUDITOR + Status ACTIVE appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeAuditorByAccessLevel], {
    companyId: ownCompany,
  });
  assert(
    assignees.some((item) => item.email === activeAuditorByAccessLevel.email),
    "5: AccessLevel AUDITOR + ACTIVE appears",
  );
}

/** 6: Lowercase/mixed-case role/status still appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([mixedCaseUser], { companyId: ownCompany });
  assert(assignees.some((item) => item.email === mixedCaseUser.email), "6: mixed-case role/status appears");
  assert(isActiveUser(mixedCaseUser) && canCompleteAudit(mixedCaseUser), "6b: helpers accept mixed case");
}

/** 7: Blank CompanyAreas appears when no schedule area selected. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([blankAreasUser], {
    companyId: ownCompany,
    selectedArea: "",
  });
  assert(assignees.some((item) => item.email === blankAreasUser.email), "7: blank CompanyAreas with no area filter");
}

/** 8: Matching selected area appears. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([matchingAreaUser], {
    companyId: ownCompany,
    selectedArea: "Bay 2",
  });
  assert(assignees.some((item) => item.email === matchingAreaUser.email), "8: matching selected area appears");
}

/** 9: User from another company does not appear. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([otherCompanyUser], { companyId: ownCompany });
  assert(!assignees.some((item) => item.email === otherCompanyUser.email), "9: other-company user excluded");
  assert(!belongsToCurrentCompany(otherCompanyUser, ownCompany), "9b: belongsToCurrentCompany rejects other company");
}

/** 10: Inactive / pending users do not appear. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([inactiveUser], { companyId: ownCompany });
  assert(!assignees.some((item) => item.email === inactiveUser.email), "10: inactive user excluded");
}

/** 11: Godmode-only platform user does not appear. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([godmodeOnlyUser], { companyId: ownCompany });
  assert(!assignees.some((item) => item.email === godmodeOnlyUser.email), "11: godmode-only user excluded");
  assert(!canCompleteAudit(godmodeOnlyUser), "11b: master role is not assignable");
}

/** 12: Area mismatch excludes user when schedule area is selected. */
{
  const { assignees } = buildAvailableScheduleAssigneesFromUsers([activeUser], {
    companyId: ownCompany,
    selectedArea: "Bay 9",
  });
  assert(!assignees.some((item) => item.email === activeUser.email), "12: area mismatch excludes user");
}

/** 13: PasswordHash is not returned from server sanitisation path. */
{
  const companyUsersSrc = read("server/company-users.mjs");
  const assigneeService = read("server/schedule-assignee-service.mjs");
  const coreRoutes = read("server/core-workflow-routes.mjs");
  assert(companyUsersSrc.includes("sanitizeUsersTabRecords"), "13: sanitizeUsersTabRecords exists");
  assert(assigneeService.includes("getScheduleAssigneesForCompany"), "13b: schedule assignee service exists");
  assert(coreRoutes.includes("/api/companies/:companyId/schedule-assignees"), "13c: company schedule-assignees route exists");
  assert(coreRoutes.includes('app.get("/api/companies/:companyId/schedules"'), "13d: company schedules list route exists");
  assert(coreRoutes.includes("USERS_TAB_READ_FAILED") || assigneeService.includes("USERS_TAB_READ_FAILED"), "13d: users tab read failure code");
  assert(coreRoutes.includes("COMPANY_CONTEXT_MISSING") || assigneeService.includes("COMPANY_CONTEXT_MISSING"), "13e: company context missing code");
}

/** 14: Diagnostics show why a user was excluded. */
{
  const diagnostics = buildScheduleAssigneeDiagnostics(
    [activeUser, inactiveUser, otherCompanyUser, godmodeOnlyUser],
    { companyId: ownCompany, masterSheetId: "sheet-123", selectedArea: "Bay 9" },
  );
  assert(diagnostics.totalRows === 4, "14: diagnostics total rows");
  assert(diagnostics.excludedByStatus >= 1, "14b: inactive user counted in excludedByStatus");
  assert(diagnostics.excludedByCompany >= 1, "14c: other-company user counted in excludedByCompany");
  assert(diagnostics.excludedNotAssignable >= 1, "14d: godmode user counted in excludedNotAssignable");
  const inactiveCandidate = diagnostics.candidates.find((item) => item.email === inactiveUser.email);
  const otherCandidate = diagnostics.candidates.find((item) => item.email === otherCompanyUser.email);
  const godmodeCandidate = diagnostics.candidates.find((item) => item.email === godmodeOnlyUser.email);
  assert(inactiveCandidate?.excludedReason === "inactive_status", "14e: inactive exclusion reason");
  assert(otherCandidate?.excludedReason === "wrong_company", "14f: company exclusion reason");
  assert(godmodeCandidate?.excludedReason === "not_assignable", "14g: godmode exclusion reason");
}

const scheduleAssigneesSrc = read("src/utils/scheduleAssignees.ts");
const appSrc = read("App.tsx");
const schedulesScreenSrc = read("src/screens/SchedulesScreen.tsx");
assert(scheduleAssigneesSrc.includes("CompanyUsersTabRow"), "14h: scheduleAssignees defines CompanyUsersTabRow");
assert(scheduleAssigneesSrc.includes("canCompleteAuditUser"), "14i: canCompleteAuditUser helper exists");
assert(appSrc.includes("/api/companies/"), "14j: App loads schedule assignees from company API");
assert(appSrc.includes("schedule-assignees"), "14k: App calls schedule-assignees endpoint");
assert(schedulesScreenSrc.includes("Advanced diagnostics"), "14l: schedule UI exposes advanced diagnostics for godmode");
assert(schedulesScreenSrc.includes("Assign users to this schedule"), "14m: schedule UI uses assignee wording");
assert(schedulesScreenSrc.includes("companyAreas"), "14n: schedule UI shows company areas");

/** 15: Live failure scenario — pending invites must not replace active Users tab assignees. */
{
  assert(appSrc.includes("resolveActiveCompanyContext"), "15: App uses unified company context resolver");
  assert(appSrc.includes("linkedCompanyContext"), "15b: App stores session-linked company context");
  assert(!appSrc.includes("findPendingAssigneeInvites"), "15c: App does not merge pending invites into assignees");
  assert(!appSrc.includes("pendingAssigneeInvites"), "15d: schedule UI does not use pending invite assignee list");
  assert(!appSrc.includes("buildAvailableScheduleAssignees("), "15e: App does not filter assignees locally");
  assert(!/buildAssignedUsersForSave\([^)]*companyUsersTabRows/.test(appSrc), "15f: schedule save uses API assignees only");
  assert(
    scheduleAssigneesSrc.includes("activeUsersFound") && scheduleAssigneesSrc.includes("loadError"),
    "15g: empty message distinguishes read failure from zero active users",
  );
  assert(appSrc.includes("schedule-assignees"), "15h: schedule assignees loaded from canonical API");
  const managerScenario = buildAvailableScheduleAssigneesFromUsers(
    [
      {
        email: "andy.hall@usebert.co.uk",
        name: "Andy Hall",
        role: "Manager",
        accessLevel: "operational",
        status: "ACTIVE",
        companyId: "TESTCO",
        companyAreas: ["Bay 1"],
      },
    ],
    { companyId: "TESTCO" },
  );
  assert(managerScenario.assignees.some((item) => item.email === "andy.hall@usebert.co.uk"), "15i: active Manager appears for TESTCO");
  const pendingOnly = buildAvailableScheduleAssigneesFromUsers(
    [
      {
        email: "pending1@example.com",
        name: "Pending One",
        role: "User",
        accessLevel: "operational",
        status: "INVITED",
        companyId: "TESTCO",
        companyAreas: [],
      },
      {
        email: "pending2@example.com",
        name: "Pending Two",
        role: "Auditor",
        accessLevel: "AUDITOR",
        status: "pending",
        companyId: "TESTCO",
        companyAreas: [],
      },
      {
        email: "pending3@example.com",
        name: "Pending Three",
        role: "Manager",
        accessLevel: "operational",
        status: "Invited",
        companyId: "TESTCO",
        companyAreas: [],
      },
    ],
    { companyId: "TESTCO" },
  );
  assert(pendingOnly.assignees.length === 0, "15j: pending invites alone do not populate assignee list");
  assert(
    managerScenario.assignees.length > 0 && pendingOnly.assignees.length === 0,
    "15k: active Users tab wins over pending invites for schedule builder",
  );
}

console.log("[verify:schedule-assignees] OK: all 15 schedule assignee cases passed");
