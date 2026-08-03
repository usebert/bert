/**
 * Dedicated production smoke verification Incident for Dovecote Manufacturing Ltd.
 * Stable markers — safe to rerun; identifies verification-only workbook rows.
 */
import { getUkTodayKey } from "./uk-date-time.mjs";

export const PRODUCTION_VERIFICATION_INCIDENT_ID_PREFIX = "bert-smoke-inc-";
export const PRODUCTION_VERIFICATION_INCIDENT_TITLE = "BERT Verification Incident";
export const PRODUCTION_VERIFICATION_INCIDENT_DESCRIPTION =
  "Automated production Incident workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_INCIDENT_TYPE = "Near Miss";
export const PRODUCTION_VERIFICATION_INCIDENT_SEVERITY = "Minor";
export const PRODUCTION_VERIFICATION_INCIDENT_MARKER = "verification";
export const PRODUCTION_VERIFICATION_INCIDENT_SOURCE = "production-incident-workflow";
export const PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS = "verification-cleaned";
export const PRODUCTION_VERIFICATION_INCIDENT_INVESTIGATION_SUMMARY =
  "Production smoke verification investigation summary.";
export const PRODUCTION_VERIFICATION_INCIDENT_RIDDOR_REASON =
  "Verification near miss; no reportable injury or dangerous occurrence.";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, "");
      if (normalizedHeader === normalizedKey || normalizedHeader.includes(normalizedKey)) {
        const text = trim(value);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

export function isVerificationIncidentId(incidentId = "") {
  return trim(incidentId).startsWith(PRODUCTION_VERIFICATION_INCIDENT_ID_PREFIX);
}

export function isVerificationIncident(record = {}) {
  const incidentId = pickField(record, "incidentId", "IncidentId", "id");
  if (isVerificationIncidentId(incidentId)) {
    return true;
  }

  const verificationSource = pickField(record, "verificationSource", "VerificationSource");
  if (normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_INCIDENT_SOURCE)) {
    return true;
  }

  const description = normalize(pickField(record, "description", "Description"));
  const title = normalize(pickField(record, "title", "Title", "summary", "Summary"));
  const incidentType = normalize(pickField(record, "incidentType", "IncidentType"));
  const marker = normalize(pickField(record, "witnesses", "Witnesses"));

  if (title === normalize(PRODUCTION_VERIFICATION_INCIDENT_TITLE)) {
    return true;
  }
  if (
    marker === PRODUCTION_VERIFICATION_INCIDENT_MARKER &&
    normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_INCIDENT_SOURCE)
  ) {
    return true;
  }
  if (
    incidentType === normalize(PRODUCTION_VERIFICATION_INCIDENT_TYPE) &&
    description.includes("automated production incident workflow verification")
  ) {
    return true;
  }

  return false;
}

export function isActiveVerificationIncident(record = {}) {
  if (!isVerificationIncident(record)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status !== PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS;
}

export function isOperationalIncident(record = {}) {
  if (!isVerificationIncident(record)) {
    return true;
  }
  const status = normalize(pickField(record, "status", "Status"));
  return status === PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS;
}

export function buildProductionVerificationIncidentId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_INCIDENT_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationIncident(input = {}) {
  const runId = input.runId ?? Date.now();
  const incidentId = trim(input.incidentId) || buildProductionVerificationIncidentId(runId);
  const today = trim(input.incidentDate) || getUkTodayKey();
  const reporterName = trim(input.reporterName) || "Smoke Verifier";
  const reporterEmail = trim(input.reporterEmail);

  return {
    incidentId,
    status: trim(input.status) || "Open",
    priority: "Normal",
    incidentType: PRODUCTION_VERIFICATION_INCIDENT_TYPE,
    severity: PRODUCTION_VERIFICATION_INCIDENT_SEVERITY,
    incidentDate: today,
    incidentTime: trim(input.incidentTime) || "12:00",
    reporterName,
    reporterEmail,
    department: trim(input.department) || "Production / Assembly",
    location: trim(input.location) || "Verification area",
    description: PRODUCTION_VERIFICATION_INCIDENT_DESCRIPTION,
    immediateAction: trim(input.immediateAction) || "No operational action required.",
    witnesses: PRODUCTION_VERIFICATION_INCIDENT_MARKER,
    verificationSource: PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
    notificationStatus: "Skipped",
    createdBy: reporterName,
    investigationNotes: trim(input.investigationNotes),
    rootCause: trim(input.rootCause) || "Other",
  };
}

export function countIncidentBaselines(incidents = []) {
  const list = Array.isArray(incidents) ? incidents : [];
  const operational = list.filter((item) => isOperationalIncident(item));
  const verification = list.filter((item) => isVerificationIncident(item));
  const activeVerification = list.filter((item) => isActiveVerificationIncident(item));

  return {
    visibleCount: list.length,
    operationalCount: operational.length,
    openCount: operational.filter((item) => normalize(item.status) !== "closed").length,
    nearMissCount: operational.filter((item) => normalize(item.incidentType) === "near miss").length,
    investigationCount: operational.filter((item) => normalize(item.status) === "under investigation").length,
    closedCount: operational.filter((item) => normalize(item.status) === "closed").length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
  };
}

export function listActiveVerificationIncidents(incidents = []) {
  return (Array.isArray(incidents) ? incidents : []).filter((item) => isActiveVerificationIncident(item));
}

export function findIncidentById(incidents = [], incidentId = "") {
  const target = trim(incidentId).toLowerCase();
  return (Array.isArray(incidents) ? incidents : []).find(
    (item) => trim(item.incidentId || item.id).toLowerCase() === target,
  );
}
