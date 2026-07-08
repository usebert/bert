/**
 * Company structure access scopes — Sites, Departments, Areas.
 * Role = what someone can do; structure access = where they can do it.
 *
 * Blank / legacy empty scope ⇒ all sites · all departments · all areas.
 */

export const ALL_SCOPE_TOKEN = "__ALL__";

export const SITES_TAB = "Sites";
export const DEPARTMENTS_TAB = "Departments";
export const AREAS_TAB = "Areas";

export const SITES_COLUMNS = ["SiteId", "SiteName", "Status", "CreatedAt", "UpdatedAt"];
export const DEPARTMENTS_COLUMNS = [
  "DepartmentId",
  "DepartmentName",
  "Status",
  "CreatedAt",
  "UpdatedAt",
];
/** Preferred Areas headers — also accept legacy "Area ID" / "Name" via readers. */
export const AREAS_STRUCTURE_COLUMNS = [
  "AreaId",
  "AreaName",
  "SiteId",
  "DepartmentId",
  "Status",
  "CreatedAt",
  "UpdatedAt",
];

export const USERS_ACCESS_COLUMNS = ["SiteIds", "DepartmentIds", "AreaIds"];

function trim(value) {
  return String(value ?? "").trim();
}

export function normalizeStructureName(value) {
  return trim(value).replace(/\s+/g, " ").toLowerCase();
}

export function parseScopeIdList(value) {
  if (Array.isArray(value)) {
    return value.map((part) => trim(part)).filter(Boolean);
  }
  return trim(value)
    .split(/[,;|]/)
    .map((part) => trim(part))
    .filter(Boolean);
}

/**
 * Normalize a person/work access scope.
 * Empty / missing / explicit ALL token ⇒ allAccess for that dimension.
 */
export function normalizeAccessScope(raw = {}) {
  const siteIds = parseScopeIdList(raw.siteIds ?? raw.SiteIds ?? raw.sites ?? raw.Sites);
  const departmentIds = parseScopeIdList(
    raw.departmentIds ?? raw.DepartmentIds ?? raw.departments ?? raw.Departments,
  );
  const areaIds = parseScopeIdList(raw.areaIds ?? raw.AreaIds ?? raw.areas ?? raw.Areas);

  const sitesAll =
    siteIds.length === 0 || siteIds.some((id) => normalizeStructureName(id) === "all sites" || id === ALL_SCOPE_TOKEN);
  const departmentsAll =
    departmentIds.length === 0 ||
    departmentIds.some(
      (id) => normalizeStructureName(id) === "all departments" || id === ALL_SCOPE_TOKEN,
    );
  const areasAll =
    areaIds.length === 0 ||
    areaIds.some((id) => normalizeStructureName(id) === "all areas" || id === ALL_SCOPE_TOKEN);

  return {
    siteIds: sitesAll ? [] : uniquePreserve(siteIds.filter((id) => id !== ALL_SCOPE_TOKEN)),
    departmentIds: departmentsAll
      ? []
      : uniquePreserve(departmentIds.filter((id) => id !== ALL_SCOPE_TOKEN)),
    areaIds: areasAll ? [] : uniquePreserve(areaIds.filter((id) => id !== ALL_SCOPE_TOKEN)),
    allSites: sitesAll,
    allDepartments: departmentsAll,
    allAreas: areasAll,
  };
}

function uniquePreserve(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = normalizeStructureName(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function hasAllAccess(scope) {
  const normalized = normalizeAccessScope(scope);
  return normalized.allSites && normalized.allDepartments && normalized.allAreas;
}

function matchesIdOrName(allowed, candidateId, candidateName) {
  const id = trim(candidateId);
  const name = normalizeStructureName(candidateName);
  return allowed.some((entry) => {
    const e = trim(entry);
    if (!e) {
      return false;
    }
    if (id && e === id) {
      return true;
    }
    if (name && normalizeStructureName(e) === name) {
      return true;
    }
    return false;
  });
}

export function personHasSiteAccess(personOrScope, siteId, siteName = "") {
  const scope = normalizeAccessScope(personOrScope);
  if (scope.allSites) {
    return true;
  }
  return matchesIdOrName(scope.siteIds, siteId, siteName);
}

export function personHasDepartmentAccess(personOrScope, departmentId, departmentName = "") {
  const scope = normalizeAccessScope(personOrScope);
  if (scope.allDepartments) {
    return true;
  }
  return matchesIdOrName(scope.departmentIds, departmentId, departmentName);
}

export function personHasAreaAccess(personOrScope, areaId, areaName = "") {
  const scope = normalizeAccessScope(personOrScope);
  if (scope.allAreas) {
    return true;
  }
  return matchesIdOrName(scope.areaIds, areaId, areaName);
}

/**
 * Resolve IDs → friendly names for display.
 * Falls back to the stored token when no catalog match.
 */
export function resolveStructureNames(scope, catalogs = {}) {
  const normalized = normalizeAccessScope(scope);
  const sites = Array.isArray(catalogs.sites) ? catalogs.sites : [];
  const departments = Array.isArray(catalogs.departments) ? catalogs.departments : [];
  const areas = Array.isArray(catalogs.areas) ? catalogs.areas : [];

  const resolve = (ids, list, nameKeys) =>
    ids.map((id) => {
      const match = list.find((item) => {
        const itemId = trim(item.id || item.siteId || item.departmentId || item.areaId);
        if (itemId && itemId === id) {
          return true;
        }
        return nameKeys.some((key) => normalizeStructureName(item[key]) === normalizeStructureName(id));
      });
      if (!match) {
        return id;
      }
      for (const key of nameKeys) {
        const name = trim(match[key]);
        if (name) {
          return name;
        }
      }
      return id;
    });

  return {
    siteNames: normalized.allSites
      ? ["All sites"]
      : resolve(normalized.siteIds, sites, ["name", "siteName", "SiteName"]),
    departmentNames: normalized.allDepartments
      ? ["All departments"]
      : resolve(normalized.departmentIds, departments, ["name", "departmentName", "DepartmentName"]),
    areaNames: normalized.allAreas
      ? ["All areas"]
      : resolve(normalized.areaIds, areas, ["name", "areaName", "AreaName", "Name"]),
    allSites: normalized.allSites,
    allDepartments: normalized.allDepartments,
    allAreas: normalized.allAreas,
  };
}

export function formatAccessSummary(scope, catalogs = {}) {
  const resolved = resolveStructureNames(scope, catalogs);
  const sites = resolved.siteNames.join(", ") || "All sites";
  const departments = resolved.departmentNames.join(", ") || "All departments";
  const areas = resolved.areaNames.join(", ") || "All areas";
  return `Access: ${sites} · ${departments} · ${areas}`;
}

/**
 * Work items may carry siteId/departmentId/areaId (and optional names).
 * Blank work-item scope does not restrict; person still needs matching access when set.
 */
export function scopeMatchesWorkItem(personOrScope, workItem = {}) {
  const scope = normalizeAccessScope(personOrScope);
  const siteId = trim(workItem.siteId || workItem.SiteId || "");
  const siteName = trim(workItem.siteName || workItem.SiteName || workItem.site || "");
  const departmentId = trim(workItem.departmentId || workItem.DepartmentId || "");
  const departmentName = trim(
    workItem.departmentName || workItem.DepartmentName || workItem.department || "",
  );
  const areaId = trim(workItem.areaId || workItem.AreaId || workItem["Area ID"] || "");
  const areaName = trim(workItem.areaName || workItem.AreaName || workItem.area || workItem.Name || "");

  if (siteId || siteName) {
    if (!personHasSiteAccess(scope, siteId, siteName)) {
      return false;
    }
  }
  if (departmentId || departmentName) {
    if (!personHasDepartmentAccess(scope, departmentId, departmentName)) {
      return false;
    }
  }
  if (areaId || areaName) {
    if (!personHasAreaAccess(scope, areaId, areaName)) {
      return false;
    }
  }
  return true;
}

/**
 * Derive person access from Users-tab fields including legacy CompanyAreas.
 * Blank SiteIds / DepartmentIds / AreaIds + blank CompanyAreas ⇒ all access.
 * Legacy CompanyAreas names (without AreaIds) remain selected area access.
 */
export function accessScopeFromPersonRecord(person = {}) {
  const siteIds = parseScopeIdList(person.siteIds ?? person.SiteIds ?? "");
  const departmentIds = parseScopeIdList(person.departmentIds ?? person.DepartmentIds ?? "");
  const areaIdsRaw = parseScopeIdList(person.areaIds ?? person.AreaIds ?? "");
  const companyAreas = Array.isArray(person.companyAreas)
    ? person.companyAreas.map((part) => trim(part)).filter(Boolean)
    : parseScopeIdList(person.companyAreasRaw ?? person.CompanyAreas ?? "");

  const areaIds = areaIdsRaw.length > 0 ? areaIdsRaw : companyAreas;

  return normalizeAccessScope({
    siteIds,
    departmentIds,
    areaIds,
  });
}

export function serializeScopeIds(ids, allAccess) {
  if (allAccess) {
    return "";
  }
  return uniquePreserve(parseScopeIdList(ids)).join(", ");
}

/**
 * Roles that may create/edit company structure and person access.
 * Matches current canManageCompanyMembers / canManageAreas (Master + Admin).
 * Manager is not elevated here — existing people-manage rules do not allow it.
 */
export function canManageCompanyStructure(role) {
  const normalized = normalizeStructureName(role);
  return (
    normalized === "master" ||
    normalized === "admin" ||
    normalized === "company admin" ||
    normalized === "administrator"
  );
}

export function canEditPersonAccess(role) {
  return canManageCompanyStructure(role);
}
