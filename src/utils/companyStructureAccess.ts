/**
 * Company structure access scopes — client copy of shared/company-structure-access.mjs.
 * Keep behaviour in sync with the shared module (blank legacy = all access).
 */

export type AccessScope = {
  siteIds: string[];
  departmentIds: string[];
  areaIds: string[];
  allSites: boolean;
  allDepartments: boolean;
  allAreas: boolean;
};

export const ALL_SCOPE_TOKEN = "__ALL__";

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeStructureName(value: unknown): string {
  return trim(value).replace(/\s+/g, " ").toLowerCase();
}

export function parseScopeIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((part) => trim(part)).filter(Boolean);
  }
  return trim(value)
    .split(/[,;|]/)
    .map((part) => trim(part))
    .filter(Boolean);
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
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

export function normalizeAccessScope(raw: Record<string, unknown> = {}): AccessScope {
  const siteIds = parseScopeIdList(raw.siteIds ?? raw.SiteIds ?? raw.sites ?? raw.Sites);
  const departmentIds = parseScopeIdList(
    raw.departmentIds ?? raw.DepartmentIds ?? raw.departments ?? raw.Departments,
  );
  const areaIds = parseScopeIdList(raw.areaIds ?? raw.AreaIds ?? raw.areas ?? raw.Areas);

  const sitesAll =
    siteIds.length === 0 ||
    siteIds.some((id) => normalizeStructureName(id) === "all sites" || id === ALL_SCOPE_TOKEN);
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

export function hasAllAccess(scope: unknown): boolean {
  const normalized = normalizeAccessScope((scope || {}) as Record<string, unknown>);
  return normalized.allSites && normalized.allDepartments && normalized.allAreas;
}

function matchesIdOrName(allowed: string[], candidateId: string, candidateName: string): boolean {
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

export function personHasSiteAccess(personOrScope: unknown, siteId: string, siteName = ""): boolean {
  const scope = normalizeAccessScope((personOrScope || {}) as Record<string, unknown>);
  if (scope.allSites) {
    return true;
  }
  return matchesIdOrName(scope.siteIds, siteId, siteName);
}

export function personHasDepartmentAccess(
  personOrScope: unknown,
  departmentId: string,
  departmentName = "",
): boolean {
  const scope = normalizeAccessScope((personOrScope || {}) as Record<string, unknown>);
  if (scope.allDepartments) {
    return true;
  }
  return matchesIdOrName(scope.departmentIds, departmentId, departmentName);
}

export function personHasAreaAccess(personOrScope: unknown, areaId: string, areaName = ""): boolean {
  const scope = normalizeAccessScope((personOrScope || {}) as Record<string, unknown>);
  if (scope.allAreas) {
    return true;
  }
  return matchesIdOrName(scope.areaIds, areaId, areaName);
}

export function resolveStructureNames(
  scope: unknown,
  catalogs: {
    sites?: Array<{ id?: string; name?: string; siteId?: string; siteName?: string }>;
    departments?: Array<{
      id?: string;
      name?: string;
      departmentId?: string;
      departmentName?: string;
    }>;
    areas?: Array<{ id?: string; name?: string; areaId?: string; areaName?: string; Name?: string }>;
  } = {},
) {
  const normalized = normalizeAccessScope((scope || {}) as Record<string, unknown>);
  const sites = catalogs.sites || [];
  const departments = catalogs.departments || [];
  const areas = catalogs.areas || [];

  const resolve = (
    ids: string[],
    list: Array<Record<string, unknown>>,
    nameKeys: string[],
  ): string[] =>
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
      : resolve(normalized.siteIds, sites as Array<Record<string, unknown>>, ["name", "siteName", "SiteName"]),
    departmentNames: normalized.allDepartments
      ? ["All departments"]
      : resolve(normalized.departmentIds, departments as Array<Record<string, unknown>>, [
          "name",
          "departmentName",
          "DepartmentName",
        ]),
    areaNames: normalized.allAreas
      ? ["All areas"]
      : resolve(normalized.areaIds, areas as Array<Record<string, unknown>>, [
          "name",
          "areaName",
          "AreaName",
          "Name",
        ]),
    allSites: normalized.allSites,
    allDepartments: normalized.allDepartments,
    allAreas: normalized.allAreas,
  };
}

export function formatAccessSummary(
  scope: unknown,
  catalogs: {
    sites?: Array<{ id?: string; name?: string }>;
    departments?: Array<{ id?: string; name?: string }>;
    areas?: Array<{ id?: string; name?: string }>;
  } = {},
): string {
  const resolved = resolveStructureNames(scope, catalogs);
  const sites = resolved.siteNames.join(", ") || "All sites";
  const departments = resolved.departmentNames.join(", ") || "All departments";
  const areas = resolved.areaNames.join(", ") || "All areas";
  return `Access: ${sites} · ${departments} · ${areas}`;
}

export function scopeMatchesWorkItem(
  personOrScope: unknown,
  workItem: Record<string, unknown> = {},
): boolean {
  const scope = normalizeAccessScope((personOrScope || {}) as Record<string, unknown>);
  const siteId = trim(workItem.siteId || workItem.SiteId || "");
  const siteName = trim(workItem.siteName || workItem.SiteName || workItem.site || "");
  const departmentId = trim(workItem.departmentId || workItem.DepartmentId || "");
  const departmentName = trim(
    workItem.departmentName || workItem.DepartmentName || workItem.department || "",
  );
  const areaId = trim(workItem.areaId || workItem.AreaId || workItem["Area ID"] || "");
  const areaName = trim(workItem.areaName || workItem.AreaName || workItem.area || workItem.Name || "");

  if ((siteId || siteName) && !personHasSiteAccess(scope, siteId, siteName)) {
    return false;
  }
  if ((departmentId || departmentName) && !personHasDepartmentAccess(scope, departmentId, departmentName)) {
    return false;
  }
  if ((areaId || areaName) && !personHasAreaAccess(scope, areaId, areaName)) {
    return false;
  }
  return true;
}

export function accessScopeFromPersonRecord(person: Record<string, unknown> = {}): AccessScope {
  const siteIds = parseScopeIdList(person.siteIds ?? person.SiteIds ?? "");
  const departmentIds = parseScopeIdList(person.departmentIds ?? person.DepartmentIds ?? "");
  const areaIdsRaw = parseScopeIdList(person.areaIds ?? person.AreaIds ?? "");
  const companyAreas = Array.isArray(person.companyAreas)
    ? (person.companyAreas as unknown[]).map((part) => trim(part)).filter(Boolean)
    : parseScopeIdList(person.companyAreasRaw ?? person.CompanyAreas ?? "");
  const areaIds = areaIdsRaw.length > 0 ? areaIdsRaw : companyAreas;
  return normalizeAccessScope({ siteIds, departmentIds, areaIds });
}

export function canManageCompanyStructure(role: string): boolean {
  const normalized = normalizeStructureName(role);
  return (
    normalized === "master" ||
    normalized === "admin" ||
    normalized === "company admin" ||
    normalized === "administrator"
  );
}

export function canEditPersonAccess(role: string): boolean {
  return canManageCompanyStructure(role);
}
