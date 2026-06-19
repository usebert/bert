import type { Site } from "../types/adminScreenProps";

export function activeAreas(sites: Site[]) {
  return sites.filter((site) => site.active);
}

export function isSingleWorkspaceMode(areaRestrictionsEnabled: boolean, sites: Site[]) {
  if (!areaRestrictionsEnabled) {
    return true;
  }
  return activeAreas(sites).length === 0;
}

/** Show per-user area assignment when restrictions are on or multiple active areas exist. */
export function shouldShowAreaAssignment(areaRestrictionsEnabled: boolean, sites: Site[]) {
  if (areaRestrictionsEnabled) {
    return activeAreas(sites).length > 0;
  }
  return activeAreas(sites).length > 1;
}

export function areaAssignmentHelpText(areaRestrictionsEnabled: boolean, sites: Site[]) {
  if (!areaRestrictionsEnabled && activeAreas(sites).length <= 1) {
    return "Area restrictions are off. Users can access the whole workspace.";
  }
  return "For Managers and Auditors: leave all boxes unchecked to allow every active area. Check one or more areas to restrict their workspace.";
}

export function mergeAreasFromServer(local: Site[], remote: Site[]) {
  const byId = new Map<string, Site>();
  local.forEach((site) => byId.set(site.id, site));
  remote.forEach((site) => byId.set(site.id, { ...byId.get(site.id), ...site }));
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function createLocalAreaId() {
  return `area-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAreaLabel(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mirrors server invite-target reserved labels — not valid company areas. */
export function isReservedAreaName(name: string) {
  const normalized = normalizeAreaLabel(name);
  return (
    normalized === "archive" ||
    normalized === "archived" ||
    normalized === "live companies" ||
    normalized === "master control" ||
    normalized === "companies" ||
    normalized === "company"
  );
}
