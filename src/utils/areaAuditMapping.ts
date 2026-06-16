import { activeAreas, isSingleWorkspaceMode } from "./companyAreas";
import { isAuditorCompletableAccess, normalizeAuditAccessLevel } from "./auditAccess";
import type { AuditAccessLevel } from "../types/auditsScreenProps";
import type { Site } from "../types/adminScreenProps";

export const SINGLE_WORKSPACE_AREA_ID = "area-main";

export type AreaAuditMapping = {
  areaId: string;
  auditId: string;
  status: "active" | "inactive";
  frequencyOverride?: string;
  notes?: string;
};

export type UserAuditAccessRow = {
  email: string;
  auditId: string;
  access: string;
  uiAccess?: AuditAccessLevel;
};

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isAreaAuditMappingConfigured(areaAudits: AreaAuditMapping[]) {
  return areaAudits.some((row) => row.status === "active");
}

export function resolveEffectiveAreaId(areaRestrictionsEnabled: boolean, sites: Site[]) {
  if (isSingleWorkspaceMode(areaRestrictionsEnabled, sites) || activeAreas(sites).length === 0) {
    return SINGLE_WORKSPACE_AREA_ID;
  }
  return null;
}

export function resolveAreaIdForSiteName(sites: Site[], siteArea = "") {
  const normalized = normalizeKey(siteArea);
  if (!normalized) return null;
  const match = sites.find((site) => normalizeKey(site.name) === normalized);
  return match?.id || null;
}

export function resolveAuditAreaId(
  audit: { siteArea?: string; areaId?: string },
  sites: Site[],
  areaRestrictionsEnabled: boolean,
) {
  if (audit.areaId) {
    return audit.areaId;
  }
  const fromSite = resolveAreaIdForSiteName(sites, audit.siteArea);
  if (fromSite) {
    return fromSite;
  }
  if (isSingleWorkspaceMode(areaRestrictionsEnabled, sites) || activeAreas(sites).length === 0) {
    return SINGLE_WORKSPACE_AREA_ID;
  }
  return null;
}

export function isAuditActiveForArea(
  areaAudits: AreaAuditMapping[],
  areaId: string,
  auditId: string,
  options?: { areaRestrictionsEnabled?: boolean; sites?: Site[] },
) {
  if (!isAreaAuditMappingConfigured(areaAudits)) {
    return true;
  }
  const effectiveAreaId =
    areaId ||
    resolveEffectiveAreaId(options?.areaRestrictionsEnabled ?? false, options?.sites ?? []) ||
    SINGLE_WORKSPACE_AREA_ID;
  return areaAudits.some(
    (row) => row.status === "active" && row.areaId === effectiveAreaId && row.auditId === auditId,
  );
}

export function enabledAuditIdsForArea(areaAudits: AreaAuditMapping[], areaId: string) {
  return areaAudits
    .filter((row) => row.status === "active" && row.areaId === areaId)
    .map((row) => row.auditId);
}

export function filterItemsByAreaAuditMapping<T extends { id: string; siteArea?: string; areaId?: string }>(
  items: T[],
  areaAudits: AreaAuditMapping[],
  sites: Site[],
  areaRestrictionsEnabled: boolean,
  allowedSiteIds: Set<string> | null,
): T[] {
  if (!isAreaAuditMappingConfigured(areaAudits)) {
    return items;
  }

  const activeSiteIds = new Set(activeAreas(sites).map((site) => site.id));
  const singleWorkspace = isSingleWorkspaceMode(areaRestrictionsEnabled, sites);

  return items.filter((item) => {
    let areaId = resolveAuditAreaId(item, sites, areaRestrictionsEnabled);
    if (!areaId && singleWorkspace) {
      areaId = SINGLE_WORKSPACE_AREA_ID;
    }
    if (!areaId) {
      return false;
    }
    if (allowedSiteIds && !singleWorkspace && activeSiteIds.has(areaId) && !allowedSiteIds.has(areaId)) {
      return false;
    }
    return isAuditActiveForArea(areaAudits, areaId, item.id, { areaRestrictionsEnabled, sites });
  });
}

export function mergeUserAreaAccessIntoAssignments(
  rows: Array<{ email: string; areaId: string; access?: string }>,
): Record<string, string[]> {
  const assignments: Record<string, string[]> = {};
  rows.forEach((row) => {
    const email = normalizeKey(row.email);
    if (!email || row.access === "denied") return;
    if (!assignments[email]) assignments[email] = [];
    if (!assignments[email].includes(row.areaId)) {
      assignments[email].push(row.areaId);
    }
  });
  return assignments;
}

export function mergeUserAuditAccessIntoOverrides(
  rows: UserAuditAccessRow[],
): Record<string, AuditAccessLevel> {
  const overrides: Record<string, AuditAccessLevel> = {};
  rows.forEach((row) => {
    const email = normalizeKey(row.email);
    if (!email) return;
    const access = normalizeAuditAccessLevel((row.uiAccess || row.access) as AuditAccessLevel);
    if (!isAuditorCompletableAccess(access) && access !== "Full access" && access !== "Oversight") {
      overrides[`${email}::${row.auditId}`] = "No access";
      return;
    }
    overrides[`${email}::${row.auditId}`] = access;
  });
  return overrides;
}

export function buildUserAreaAccessRows(assignments: Record<string, string[]>) {
  const rows: Array<{ email: string; areaId: string; access: string }> = [];
  Object.entries(assignments).forEach(([email, areaIds]) => {
    areaIds.forEach((areaId) => {
      rows.push({ email, areaId, access: "allowed" });
    });
  });
  return rows;
}

export function buildUserAuditAccessRows(overrides: Record<string, AuditAccessLevel>) {
  const rows: Array<{ email: string; auditId: string; access: AuditAccessLevel }> = [];
  Object.entries(overrides).forEach(([key, access]) => {
    const [email, auditId] = key.split("::");
    if (!email || !auditId) return;
    rows.push({ email, auditId, access: normalizeAuditAccessLevel(access) });
  });
  return rows;
}
