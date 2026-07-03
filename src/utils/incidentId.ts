export const INCIDENT_ID_HEADER_ALIASES = ["IncidentId", "Incident ID", "incidentId"];

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeIncidentHeaderKey(value: unknown): string {
  return trim(value).toLowerCase().replace(/\s+/g, "");
}

export function normalizeIncidentIdForLookup(value: unknown): string {
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

export function canonicalIncidentId(value: unknown): string {
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

export function incidentIdsMatch(left: unknown, right: unknown): boolean {
  const leftText = trim(left);
  const rightText = trim(right);
  if (!leftText || !rightText) {
    return false;
  }
  return normalizeIncidentIdForLookup(leftText) === normalizeIncidentIdForLookup(rightText);
}

function pickDirectOrHeader(record: Record<string, unknown>, key: string): string {
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

export function pickIncidentIdFromRecord(record: Record<string, unknown> = {}): string {
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

export const INCIDENT_NOT_IN_WORKBOOK_MESSAGE =
  "This incident is not in the company workbook yet. Refresh the register to sync incidents, then try again.";
