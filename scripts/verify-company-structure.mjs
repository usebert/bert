#!/usr/bin/env node
/**
 * Company structure access scopes verifier — Sites / Departments / Areas + person access.
 * Covers tab auto-create wiring, role gates, helpers, legacy blank=all, and non-regression.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accessScopeFromPersonRecord,
  canEditPersonAccess,
  canManageCompanyStructure,
  formatAccessSummary,
  hasAllAccess,
  normalizeAccessScope,
  normalizeStructureName,
  personHasAreaAccess,
  personHasDepartmentAccess,
  personHasSiteAccess,
  resolveStructureNames,
  scopeMatchesWorkItem,
  SITES_TAB,
  DEPARTMENTS_TAB,
  AREAS_TAB,
  SITES_COLUMNS,
  DEPARTMENTS_COLUMNS,
  AREAS_STRUCTURE_COLUMNS,
} from "../shared/company-structure-access.mjs";
import { SETUP_REQUIRED_TABS } from "../server/ensure-required-tabs.mjs";
import { USERS_TAB_COLUMNS, USERS_TAB_ACCESS_SCOPE_COLUMNS } from "../server/users-tab-constants.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`PASS [${caseCount}]: ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const structureSrc = read("server/company-structure.mjs");
const sharedSrc = read("shared/company-structure-access.mjs");
const serverSrc = read("server/server.mjs");
const panelSrc = read("src/components/admin/CompanyStructurePanel.tsx");
const cardSrc = read("src/components/admin/ActiveUserCard.tsx");
const peoplePanelSrc = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const serviceSrc = read("src/services/companyStructureService.ts");
const helpersSrc = read("src/utils/companyStructureAccess.ts");
const usersConsts = read("server/users-tab-constants.mjs");
const ensureTabs = read("server/ensure-required-tabs.mjs");
const briefingsSrc = read("server/briefings-service.mjs");
const scheduleAssigneesSrc = read("shared/schedule-assignees.mjs");
const liveDashSrc = read("shared/live-dashboard.mjs");
const companyUsersSrc = read("server/company-users.mjs");

assert(pkg.scripts["verify:company-structure"], "PKG: verify:company-structure registered");

/** 1–3: Tabs auto-created if missing (Sites, Departments, Areas). */
assert(SETUP_REQUIRED_TABS.includes("Sites"), "1: Sites tab in SETUP_REQUIRED_TABS");
assert(SETUP_REQUIRED_TABS.includes("Departments"), "2: Departments tab in SETUP_REQUIRED_TABS");
assert(SETUP_REQUIRED_TABS.includes("Areas"), "3: Areas tab in SETUP_REQUIRED_TABS");
assert(structureSrc.includes("ensureTabWithHeaders") || structureSrc.includes("ensureRequiredTabs"), "3b: structure ensures tabs/headers");
assert(SITES_TAB === "Sites" && DEPARTMENTS_TAB === "Departments" && AREAS_TAB === "Areas", "3c: tab name constants");
assert(SITES_COLUMNS.includes("SiteId") && SITES_COLUMNS.includes("SiteName"), "3d: Sites columns");
assert(DEPARTMENTS_COLUMNS.includes("DepartmentId"), "3e: Departments columns");
assert(AREAS_STRUCTURE_COLUMNS.includes("AreaName") && AREAS_STRUCTURE_COLUMNS.includes("SiteId"), "3f: Areas structure columns");

/** 4–8: Role gates — Admin/Master/Manager yes; Auditor no. */
assert(canManageCompanyStructure("Admin") === true, "4: Admin can create structure");
assert(canManageCompanyStructure("Master") === true, "4b: Master can create structure");
assert(canManageCompanyStructure("Manager") === true, "7: Manager can create structure");
assert(canManageCompanyStructure("Auditor") === false, "8: Auditor cannot create/edit structure");
assert(canEditPersonAccess("Manager") === true, "7b: Manager can edit person access");
assert(canEditPersonAccess("Admin") === true, "4c: Admin can edit person access");
assert(canEditPersonAccess("Auditor") === false, "8b: Auditor cannot edit person access");
assert(structureSrc.includes("rejectIfCannotManage"), "4d: server rejects non-managers");
assert(structureSrc.includes('"/api/companies/:companyFolderId/structure"'), "4e: GET structure route");
assert(structureSrc.includes('"/api/companies/:companyFolderId/structure/sites"'), "4f: POST sites route");
assert(structureSrc.includes('"/api/companies/:companyFolderId/structure/departments"'), "4g: POST departments route");
assert(structureSrc.includes('"/api/companies/:companyFolderId/structure/areas"'), "4h: POST areas route");
assert(structureSrc.includes('"/api/companies/:companyFolderId/people/:personId/access"'), "4i: PATCH person access route");
assert(serverSrc.includes("installCompanyStructureRoutes"), "4j: routes installed in server");

/** 9: Duplicate active names prevented. */
assert(structureSrc.includes("hasDuplicateActiveName"), "9: duplicate name guard");
assert(structureSrc.includes("already exists"), "9b: duplicate error messaging");
assert(normalizeStructureName("Rugby") === normalizeStructureName("rugby"), "9c: name normalize case-insensitive");
assert(normalizeStructureName("RUGBY ") === "rugby", "9d: name normalize trims");

/** 10–13: Person assignment + reset to all. */
{
  const selected = normalizeAccessScope({
    siteIds: ["site-rugby"],
    departmentIds: ["dept-ops"],
    areaIds: ["area-yard", "area-bay"],
  });
  assert(selected.allSites === false && selected.siteIds.includes("site-rugby"), "10: person selected sites");
  assert(selected.allDepartments === false && selected.departmentIds.includes("dept-ops"), "11: person selected departments");
  assert(selected.allAreas === false && selected.areaIds.length === 2, "12: person selected areas");

  const reset = normalizeAccessScope({ siteIds: [], departmentIds: [], areaIds: [] });
  assert(hasAllAccess(reset), "13: reset empty lists ⇒ all sites/departments/areas");
  assert(structureSrc.includes("allSites") && structureSrc.includes("serializeScopeIds"), "13b: access PATCH supports all flags");
}

/** 14: Blank legacy scope means all access. */
{
  const legacy = accessScopeFromPersonRecord({ companyAreas: [], SiteIds: "", DepartmentIds: "", AreaIds: "" });
  assert(hasAllAccess(legacy), "14: blank legacy ⇒ all access");
  assert(legacy.allSites && legacy.allDepartments && legacy.allAreas, "14b: blank all flags true");
}

/** 15: Existing All areas users still load (CompanyAreas empty or names). */
{
  const allAreasUser = accessScopeFromPersonRecord({ companyAreas: [] });
  assert(allAreasUser.allAreas === true, "15: empty CompanyAreas ⇒ all areas");
  const named = accessScopeFromPersonRecord({ companyAreas: ["Yard", "Loading Bay"] });
  assert(named.allAreas === false && named.areaIds.includes("Yard"), "15b: named CompanyAreas still selected");
  assert(USERS_TAB_ACCESS_SCOPE_COLUMNS.every((col) => USERS_TAB_COLUMNS.includes(col)), "15c: SiteIds/DepartmentIds/AreaIds on Users columns");
  assert(usersConsts.includes("SiteIds") && companyUsersSrc.includes("patch.SiteIds"), "15d: user write supports SiteIds");
}

/** 16–18: Briefings / schedules / dashboard still wired (non-regression). */
assert(briefingsSrc.includes("expandBriefingRecipient") || briefingsSrc.includes("BRIEFING_RECIPIENT"), "16: briefings recipients still present");
assert(scheduleAssigneesSrc.includes("parseCompanyAreasList"), "17: schedule assignees still use company areas");
assert(liveDashSrc.includes("LIVE_DASHBOARD_TABS") && liveDashSrc.includes('"Sites"'), "18: live dashboard still reads Sites");
assert(ensureTabs.includes('"Departments"'), "18b: Departments required tab");

/** 19: No cross-company leakage — folder checks on structure routes. */
assert(structureSrc.includes("actorFolder") || structureSrc.includes("own company workspace"), "19: cross-company folder guard");
assert(structureSrc.includes("resolveCompanyFromFolder"), "19b: folder-first workbook resolve");

/** 20: Role + access helper functions behave correctly. */
{
  const managerRugby = normalizeAccessScope({
    siteIds: ["site-rugby"],
    departmentIds: ["dept-ops"],
    areaIds: [],
  });
  assert(personHasSiteAccess(managerRugby, "site-rugby", "Rugby") === true, "20a: site access match");
  assert(personHasSiteAccess(managerRugby, "site-blackburn", "Blackburn") === false, "20b: site access deny");
  assert(personHasDepartmentAccess(managerRugby, "dept-ops", "Operations") === true, "20c: department access");
  assert(personHasAreaAccess(managerRugby, "area-x", "Yard") === true, "20d: all areas when blank");
  assert(
    scopeMatchesWorkItem(managerRugby, { siteId: "site-rugby", departmentId: "dept-ops", areaId: "area-yard" }) === true,
    "20e: work item matches",
  );
  assert(
    scopeMatchesWorkItem(managerRugby, { siteId: "site-blackburn", areaId: "area-yard" }) === false,
    "20f: work item blocked by site",
  );
  const names = resolveStructureNames(managerRugby, {
    sites: [{ id: "site-rugby", name: "Rugby" }],
    departments: [{ id: "dept-ops", name: "Operations" }],
    areas: [],
  });
  assert(names.siteNames[0] === "Rugby", "20g: resolveStructureNames");
  assert(formatAccessSummary(managerRugby, {
    sites: [{ id: "site-rugby", name: "Rugby" }],
    departments: [{ id: "dept-ops", name: "Operations" }],
  }).includes("Access: Rugby"), "20h: formatAccessSummary");
  assert(sharedSrc.includes("normalizeAccessScope") && helpersSrc.includes("normalizeAccessScope"), "20i: helpers exported client+shared");
}

/** UI wiring */
assert(peoplePanelSrc.includes("CompanyStructurePanel"), "UI: People panel embeds Company Structure");
assert(panelSrc.includes("Add site") && panelSrc.includes("Add department") && panelSrc.includes("Add area"), "UI: structure create controls");
assert(cardSrc.includes("Edit Access") && cardSrc.includes("Access:"), "UI: person card Edit Access + Access wording");
assert(cardSrc.includes("All sites") && cardSrc.includes("All departments") && cardSrc.includes("All areas"), "UI: all-scope options");
assert(serviceSrc.includes("/structure") && serviceSrc.includes("/people/"), "UI: client structure + access API");
assert(panelSrc.includes("Archive"), "UI: archive not hard delete");

/** Department-create regression checks. */
assert(structureSrc.includes('"/api/companies/:companyFolderId/structure/departments"'), "D1: manager department route exists");
assert(structureSrc.includes("requireGoogleWorkspaceSession"), "D1b: department route requires signed-in workspace session");
assert(
  structureSrc.includes('"/api/companies/:companyFolderId/structure/departments",\n    requireGoogleWorkspaceSession,\n    async'),
  "D1c: manager not blocked by admin-only middleware",
);
assert(
  structureSrc.includes('const name = trim(req.body?.name || req.body?.departmentName') ||
    structureSrc.includes('const name = trim(req.body?.name || req.body?.departmentName || req.body?.title)'),
  "D3: backend accepts department name payload",
);
assert(serviceSrc.includes("departmentName"), "D3b: frontend sends departmentName payload");
assert(serviceSrc.includes("name: normalizedName"), "D3c: frontend sends normalized name payload");
assert(ensureTabs.includes('"Departments"') && structureSrc.includes("ensureTabWithHeaders"), "D2: departments tab auto-create + headers");
assert(structureSrc.includes("hasDuplicateActiveName(structure.departments"), "D4: duplicate department names blocked");
assert(structureSrc.includes('An active department named "${name}" already exists.'), "D4b: duplicate department clear error");
assert(canManageCompanyStructure("Auditor") === false, "D5: auditor blocked from department create");
assert(structureSrc.includes("departments: [...structure.departments, department]"), "D6: create response returns updated departments list");
assert(structureSrc.includes("departments: dedupe(departments)"), "D7: departments persist in structure reads");
assert(serviceSrc.includes("safeDetail") && serviceSrc.includes("throw new Error"), "D8: frontend surfaces backend safe error message");
assert(panelSrc.includes("setError(err instanceof Error ? err.message"), "D8b: UI shows backend department error message");
assert(panelSrc.includes("createCompanyStructureArea") && panelSrc.includes("departmentId"), "A1: add area still supports optional site/department links");
assert(panelSrc.includes("createCompanySite"), "S1: site creation path remains wired");

console.log(`\nverify:company-structure passed (${caseCount} checks).`);
