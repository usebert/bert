/** Canonical incident workbook ID helpers — shared by server and verify scripts. */

export const INCIDENT_ID_HEADER_ALIASES = ["IncidentId", "Incident ID", "incidentId"];

function trim(value) {
  return String(value ?? "").trim();
}

export function normalizeIncidentHeaderKey(value) {
  return trim(value).toLowerCase().replace(/\s+/g, "");
}

/** Canonical INC-YYYY-NNN form for reliable lookup (pads sequence to 3 digits). */
export function normalizeIncidentIdForLookup(value) {
  const text = trim(value);
  const match = text.match(/^INC-(\d{4})-(\d+)$/i);
  if (!match) {
    return text.toLowerCase();
  }
  const year = match[1];
  const sequence = Number.parseInt(match[2], 10);
  if (!Number.isFinite(sequence)) {
    return text.toLowerCase();
  }
  return `inc-${year}-${String(sequence).padStart(3, "0")}`;
}

export function canonicalIncidentId(value) {
  const normalized = normalizeIncidentIdForLookup(value);
  if (!normalized.startsWith("inc-")) {
    return trim(value);
  }
  const match = normalized.match(/^inc-(\d{4})-(\d+)$/);
  if (!match) {
    return trim(value);
  }
  return `INC-${match[1]}-${match[2]}`;
}

export function incidentIdsMatch(left, right) {
  const leftText = trim(left);
  const rightText = trim(right);
  if (!leftText || !rightText) {
    return false;
  }
  return normalizeIncidentIdForLookup(leftText) === normalizeIncidentIdForLookup(rightText);
}

function pickDirectOrHeader(record, key) {
  const direct = trim(record[key]);
  if (direct) {
    return direct;
  }
  const want = normalizeIncidentHeaderKey(key);
  for (const [header, value] of Object.entries(record)) {
    if (normalizeIncidentHeaderKey(header) === want && trim(value)) {
      return trim(value);
    }
  }
  return "";
}

export function pickIncidentIdFromRecord(record = {}) {
  for (const key of INCIDENT_ID_HEADER_ALIASES) {
    const value = pickDirectOrHeader(record, key);
    if (value) {
      return value;
    }
  }
  for (const [header, value] of Object.entries(record)) {
    const normalized = normalizeIncidentHeaderKey(header);
    if ((normalized === "incidentid" || normalized === "id") && trim(value)) {
      return trim(value);
    }
  }
  return "";
}

export function findIncidentIdHeader(headers = []) {
  const normalizedAliases = new Set(INCIDENT_ID_HEADER_ALIASES.map((entry) => normalizeIncidentHeaderKey(entry)));
  for (const header of headers) {
    const normalized = normalizeIncidentHeaderKey(header);
    if (normalizedAliases.has(normalized)) {
      return trim(header);
    }
  }
  for (const header of headers) {
    const normalized = normalizeIncidentHeaderKey(header);
    if (normalized.includes("incident") && normalized.includes("id")) {
      return trim(header);
    }
  }
  return "IncidentId";
}

export function findIncidentWorkbookRecord(records = [], requestedIncidentId) {
  const requested = trim(requestedIncidentId);
  if (!requested) {
    return null;
  }
  for (const record of records) {
    const workbookIncidentId = pickIncidentIdFromRecord(record);
    if (workbookIncidentId && incidentIdsMatch(workbookIncidentId, requested)) {
      return { record, workbookIncidentId };
    }
  }
  return null;
}

export function sampleIncidentIdsFromRecords(records = [], limit = 5) {
  const sample = [];
  for (const record of records) {
    const incidentId = pickIncidentIdFromRecord(record);
    if (!incidentId) {
      continue;
    }
    sample.push(incidentId);
    if (sample.length >= limit) {
      break;
    }
  }
  return sample;
}

/** INC-YYYY-NNN or INC-YYYY-NNNN — canonical register incident IDs. */
export const REGISTER_INCIDENT_ID_PATTERN = /^INC-\d{4}-\d{3,4}$/i;

/** Stable slug IDs written by demo/history seeders (e.g. midlands-inc-001). */
export const WORKBOOK_SLUG_INCIDENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i;

const NON_REGISTER_INCIDENT_ID_VALUES = new Set([
  "open",
  "closed",
  "under investigation",
  "underinvestigation",
  "investigating",
  "pending",
  "draft",
  "minor",
  "major incident",
  "fatality",
  "near miss",
  "accident",
]);

export function isWorkbookRegisterIncidentId(value) {
  const text = trim(value);
  if (!text) {
    return false;
  }
  const lowered = text.toLowerCase();
  if (NON_REGISTER_INCIDENT_ID_VALUES.has(lowered)) {
    return false;
  }
  if (/^inc-/i.test(text)) {
    return REGISTER_INCIDENT_ID_PATTERN.test(text);
  }
  return WORKBOOK_SLUG_INCIDENT_ID_PATTERN.test(text) && text.length >= 8;
}

/** @deprecated Prefer isWorkbookRegisterIncidentId — kept for existing imports. */
export function isValidRegisterIncidentId(value) {
  return isWorkbookRegisterIncidentId(value);
}

export function describeRegisterIncidentExclusion(incident = {}) {
  const incidentId = trim(incident.incidentId || pickIncidentIdFromRecord(incident));
  if (!incidentId) {
    return { incidentId: "", reason: "missing_incident_id" };
  }
  if (NON_REGISTER_INCIDENT_ID_VALUES.has(incidentId.toLowerCase())) {
    return { incidentId, reason: "status_value_in_id_column" };
  }
  if (REGISTER_INCIDENT_ID_PATTERN.test(incidentId) || WORKBOOK_SLUG_INCIDENT_ID_PATTERN.test(incidentId)) {
    return { incidentId, reason: "valid" };
  }
  return { incidentId, reason: "unrecognized_id_format" };
}

export function filterRegisterIncidents(incidents = [], options = {}) {
  const input = Array.isArray(incidents) ? incidents : [];
  const valid = [];
  const excluded = [];
  for (const incident of input) {
    if (isWorkbookRegisterIncidentId(incident?.incidentId)) {
      valid.push(incident);
      continue;
    }
    excluded.push(describeRegisterIncidentExclusion(incident));
  }
  if (options.log !== false && input.length > 0) {
    console.info("[incidents]", {
      phase: options.phase || "incident_register_filter",
      label: options.label || "register",
      totalRows: input.length,
      validIncidentRows: valid.length,
      invalidIncidentRows: excluded.length,
      excludedSample: excluded.slice(0, 5),
    });
  }
  return valid;
}

export function incidentSiteNames(incident = {}) {
  const department = trim(incident.department);
  if (department.includes(" / ")) {
    const [siteName, areaName] = department.split(" / ", 2);
    return { siteName: trim(siteName), areaName: trim(areaName) };
  }
  return { siteName: trim(incident.location) || department, areaName: "" };
}

function normalizeSiteLabel(value = "") {
  return trim(value).toLowerCase();
}

export function incidentMatchesAssignedSite(incident, allowedSiteNames = new Set()) {
  if (!(allowedSiteNames instanceof Set) || allowedSiteNames.size === 0) {
    return true;
  }
  const { siteName } = incidentSiteNames(incident);
  const normalized = normalizeSiteLabel(siteName);
  if (!normalized) {
    return false;
  }
  for (const allowed of allowedSiteNames) {
    const allowedNormalized = normalizeSiteLabel(allowed);
    if (!allowedNormalized) {
      continue;
    }
    if (
      normalized === allowedNormalized ||
      normalized.includes(allowedNormalized) ||
      allowedNormalized.includes(normalized)
    ) {
      return true;
    }
  }
  return false;
}

export function filterIncidentsByAssignedSites(incidents = [], allowedSiteIds = null, sites = []) {
  if (!allowedSiteIds || !(allowedSiteIds instanceof Set) || allowedSiteIds.size === 0) {
    return Array.isArray(incidents) ? incidents : [];
  }
  const allowedNames = new Set(
    (Array.isArray(sites) ? sites : [])
      .filter((site) => {
        const siteId = trim(site.id || site.SiteId);
        const active =
          site.active !== false && String(site.Status || "Active").trim().toLowerCase() !== "inactive";
        return allowedSiteIds.has(siteId) && active;
      })
      .map((site) => trim(site.name || site.SiteName))
      .filter(Boolean),
  );
  if (allowedNames.size === 0) {
    return [];
  }
  return (Array.isArray(incidents) ? incidents : []).filter((incident) =>
    incidentMatchesAssignedSite(incident, allowedNames),
  );
}

export function normalizeIncidentStatus(value = "") {
  const text = trim(value);
  const lowered = text.toLowerCase();
  if (!text) {
    return "Open";
  }
  if (lowered === "investigating" || lowered === "under investigation" || lowered === "underinvestigation") {
    return "Under Investigation";
  }
  if (lowered === "closed") {
    return "Closed";
  }
  if (lowered === "open") {
    return "Open";
  }
  return text;
}

export function isOpenIncidentStatus(status = "") {
  return normalizeIncidentStatus(status).toLowerCase() !== "closed";
}

export function filterIncidentsForRegisterTab(incidents = [], tab = "incidents") {
  const rows = Array.isArray(incidents) ? incidents : [];
  switch (tab) {
    case "near-misses":
      return rows.filter((item) => item.incidentType === "Near Miss" && item.status !== "Closed");
    case "investigations":
      return rows.filter((item) => item.status === "Under Investigation");
    case "closed":
      return rows.filter((item) => item.status === "Closed");
    case "incidents":
    default:
      return rows.filter((item) => item.incidentType !== "Near Miss" && item.status !== "Closed");
  }
}

export function countDashboardOpenIncidents(incidents = []) {
  return (Array.isArray(incidents) ? incidents : []).filter((incident) => isOpenIncidentStatus(incident.status)).length;
}
