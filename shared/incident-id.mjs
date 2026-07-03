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
