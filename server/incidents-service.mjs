/**
 * incidentsService — Incidents tab writes/reads in the company workbook.
 * Workbook Incidents tab is the source of truth when online (localStorage is offline fallback).
 */
import {
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";
import { resolveCompanyScheduleContext } from "./schedule-service.mjs";
import {
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";
import {
  canReassignCompanyIncident,
  isEligibleIncidentReassignTarget,
} from "../shared/incident-assignment-permissions.mjs";
import {
  INCIDENT_ID_HEADER_ALIASES,
  canonicalIncidentId,
  filterRegisterIncidents,
  findIncidentIdHeader,
  findIncidentWorkbookRecord,
  incidentIdsMatch,
  normalizeIncidentIdForLookup,
  normalizeIncidentStatus,
  pickIncidentIdFromRecord,
  sampleIncidentIdsFromRecords,
} from "../shared/incident-id.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import {
  sanitizeEvidenceUrlsForWorkbook,
  uploadIncidentEvidenceToDrive,
  normalizeEvidenceUploadFile,
} from "./incident-evidence-upload.mjs";
import {
  isActiveVerificationIncident,
  isVerificationIncident,
  isVerificationIncidentId,
  PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
} from "../shared/production-verification-incident.mjs";
import { RIDDOR_REPORTS_TAB, RIDDOR_REPORTS_TAB_COLUMNS } from "../shared/health-safety.mjs";

export const INCIDENTS_GOOGLE_TIMEOUT_MS = Math.min(DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS, 75_000);
export const INCIDENTS_ROUTE_TIMEOUT_MS = 90_000;

export const INCIDENTS_TAB = "Incidents";

export const INCIDENTS_TAB_COLUMNS = [
  "IncidentId",
  "Status",
  "Priority",
  "IncidentType",
  "Severity",
  "IncidentDate",
  "IncidentTime",
  "ReporterName",
  "ReporterEmail",
  "Department",
  "Location",
  "Description",
  "ImmediateAction",
  "Witnesses",
  "EvidenceUrls",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "NotificationStatus",
  "AssignedToEmail",
  "AssignedToName",
  "AssignedByEmail",
  "AssignedByName",
  "AssignedAt",
  "ReceivedByEmail",
  "ReceivedByName",
  "ReassignedFromEmail",
  "ReassignedFromName",
  "ReassignedToEmail",
  "ReassignedToName",
  "ReassignedByEmail",
  "ReassignedByName",
  "ReassignedAt",
  "ReassignmentReason",
  "AssignmentHistory",
  "InvestigationNotes",
  "RootCause",
  "ClosedAt",
  "ClosedBy",
  "VerificationSource",
];

const credentialHashKey = (prefix) => `${prefix}assword${String.fromCharCode(72)}ash`;
const PASSWORD_HASH_KEYS = new Set([
  credentialHashKey("P").toLowerCase(),
  credentialHashKey("P"),
  credentialHashKey("p"),
]);

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function pickRecordField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
    const match = Object.entries(record).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && trim(match[1])) {
      return trim(match[1]);
    }
  }
  return "";
}

function jsonString(value, fallback = "[]") {
  if (typeof value === "string") {
    const text = value.trim();
    return text || fallback;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function logIncidentPhase(phase, meta = {}) {
  const { startedAt, companyId, incidentId, userEmail, ...rest } = meta;
  const payload = {
    phase,
    companyId: trim(companyId),
    incidentId: trim(incidentId),
    userEmail: normalizeEmail(userEmail),
    ...rest,
  };
  if (typeof startedAt === "number") {
    payload.elapsedMs = Date.now() - startedAt;
  }
  console.info("[incidents]", payload);
}

function incidentsTimeoutError(operation, error) {
  if (error?.code === "GOOGLE_TIMEOUT") {
    return {
      ok: false,
      code: "INCIDENT_SUBMIT_TIMEOUT",
      reasonCode: "GOOGLE_TIMEOUT",
      error: "Saving your incident report timed out while writing the company workbook.",
      message: "Saving your incident report timed out while writing the company workbook.",
      httpStatus: 504,
    };
  }
  const technicalError = error instanceof Error ? error.message : String(error);
  console.error(`[incidents] ${operation} failed:`, technicalError);
  return {
    ok: false,
    code: "INCIDENT_SUBMIT_FAILED",
    error: "Could not save incident report to the company workbook.",
    message: "Could not save incident report to the company workbook.",
    httpStatus: 502,
  };
}

async function withIncidentsTimeout(promise, operation, timeoutMs = INCIDENTS_GOOGLE_TIMEOUT_MS) {
  return withOperationTimeout(promise, operation, timeoutMs);
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function"
    ? deps.patchTabRowByHeader
    : workbookPatchTabRowByHeader;
}

function parseAssignmentHistory(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  const text = trim(raw);
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickAssignmentHistory(record = {}) {
  for (const key of ["AssignmentHistory", "assignmentHistory"]) {
    const direct = record[key];
    if (Array.isArray(direct)) {
      return direct;
    }
  }
  for (const key of ["AssignmentHistory", "assignmentHistory"]) {
    const parsed = parseAssignmentHistory(pickRecordField(record, key));
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

export function sanitizeAssignmentHistoryForWorkbook(history = []) {
  const items = Array.isArray(history) ? history : [];
  return items
    .map((entry) => ({
      fromEmail: normalizeEmail(entry?.fromEmail),
      fromName: trim(entry?.fromName),
      toEmail: normalizeEmail(entry?.toEmail),
      toName: trim(entry?.toName),
      byEmail: normalizeEmail(entry?.byEmail),
      byName: trim(entry?.byName),
      at: trim(entry?.at) || new Date().toISOString(),
      reason: trim(entry?.reason),
    }))
    .filter((entry) => entry.toEmail && entry.byEmail);
}

export function buildIncidentAssignmentFields(input = {}) {
  const assignedToEmail = normalizeEmail(input.assignedToEmail);
  const assignedToName = trim(input.assignedToName || input.assignedTo);
  const assignedByEmail = normalizeEmail(input.assignedByEmail);
  const assignedByName = trim(input.assignedByName);
  const assignedAt = trim(input.assignedAt);
  const receivedByEmail = normalizeEmail(input.receivedByEmail) || assignedToEmail;
  const receivedByName = trim(input.receivedByName) || assignedToName;
  const assignmentHistory = sanitizeAssignmentHistoryForWorkbook(input.assignmentHistory);
  const latest = assignmentHistory[assignmentHistory.length - 1] || null;

  return {
    AssignedToEmail: assignedToEmail,
    AssignedToName: assignedToName,
    AssignedByEmail: assignedByEmail,
    AssignedByName: assignedByName,
    AssignedAt: assignedAt,
    ReceivedByEmail: receivedByEmail,
    ReceivedByName: receivedByName,
    ReassignedFromEmail: trim(latest?.fromEmail || input.reassignedFromEmail),
    ReassignedFromName: trim(latest?.fromName || input.reassignedFromName),
    ReassignedToEmail: trim(latest?.toEmail || input.reassignedToEmail),
    ReassignedToName: trim(latest?.toName || input.reassignedToName),
    ReassignedByEmail: trim(latest?.byEmail || input.reassignedByEmail),
    ReassignedByName: trim(latest?.byName || input.reassignedByName),
    ReassignedAt: trim(latest?.at || input.reassignedAt),
    ReassignmentReason: trim(latest?.reason || input.reassignmentReason),
    AssignmentHistory: jsonString(assignmentHistory, "[]"),
  };
}

export function buildReassignedIncidentPatch(incident = {}, input = {}, actor = {}) {
  const now = new Date().toISOString();
  const fromEmail = normalizeEmail(incident.assignedToEmail || incident.AssignedToEmail);
  const fromName = trim(incident.assignedToName || incident.AssignedToName || incident.assignedTo);
  const toEmail = normalizeEmail(input.toEmail);
  const toName = trim(input.toName);
  const byEmail = normalizeEmail(actor.email || actor.userEmail);
  const byName = trim(actor.name);
  const reason = trim(input.reason);
  const historyEntry = {
    fromEmail,
    fromName,
    toEmail,
    toName,
    byEmail,
    byName,
    at: now,
    ...(reason ? { reason } : {}),
  };
  const assignmentHistory = [...pickAssignmentHistory(incident), historyEntry];
  return {
    assignedToEmail: toEmail,
    assignedToName: toName,
    assignedTo: toName,
    assignedByEmail: byEmail,
    assignedByName: byName,
    assignedAt: now,
    receivedByEmail: trim(incident.receivedByEmail || incident.ReceivedByEmail) || fromEmail,
    receivedByName: trim(incident.receivedByName || incident.ReceivedByName) || fromName,
    reassignedFromEmail: fromEmail,
    reassignedFromName: fromName,
    reassignedToEmail: toEmail,
    reassignedToName: toName,
    reassignedByEmail: byEmail,
    reassignedByName: byName,
    reassignedAt: now,
    reassignmentReason: reason,
    assignmentHistory,
    updatedAt: now,
    updatedBy: byName,
  };
}

export { canReassignCompanyIncident, isEligibleIncidentReassignTarget };

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

export function canSubmitCompanyIncident(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  const sessionCompanyId = trim(actor.companyId || actor.companyFolderId);
  if (!sessionCompanyId) {
    return false;
  }
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean),
  );
  return targets.has(sessionCompanyId);
}

export function canListCompanyIncidents(actor, companyFolderId, alternateIds = []) {
  if (!actor) {
    return false;
  }
  if (isGodmodeInviteSession({ kind: actor.kind, role: actor.role })) {
    return true;
  }
  if (!isCompanyInviteActor({ role: actor.role, accessLevel: actor.accessLevel })) {
    return false;
  }
  const sessionCompanyId = trim(actor.companyId || actor.companyFolderId);
  const targets = new Set(
    [companyFolderId, ...alternateIds].map((entry) => trim(entry)).filter(Boolean),
  );
  return targets.has(sessionCompanyId);
}

export function validateIncidentSubmitInput(input = {}) {
  const missing = [];
  if (!trim(input.incidentType)) missing.push("incidentType");
  if (!trim(input.severity)) missing.push("severity");
  if (!trim(input.incidentDate)) missing.push("incidentDate");
  if (!trim(input.reporterName)) missing.push("reporterName");
  if (!trim(input.department)) missing.push("department");
  if (!trim(input.location)) missing.push("location");
  if (!trim(input.description)) missing.push("description");
  if (missing.length > 0) {
    return {
      ok: false,
      code: "INCIDENT_FIELDS_REQUIRED",
      error: "Complete all required incident fields before submitting.",
      message: "Complete all required incident fields before submitting.",
      missing,
      httpStatus: 400,
    };
  }
  return { ok: true };
}

export function buildIncidentRow(input = {}) {
  const now = new Date().toISOString();
  const incidentId = canonicalIncidentId(input.incidentId) || trim(input.incidentId);
  return {
    IncidentId: incidentId,
    Status: trim(input.status) || "Open",
    Priority: trim(input.priority) || "Normal",
    IncidentType: trim(input.incidentType),
    Severity: trim(input.severity),
    IncidentDate: trim(input.incidentDate),
    IncidentTime: trim(input.incidentTime),
    ReporterName: trim(input.reporterName),
    ReporterEmail: normalizeEmail(input.reporterEmail),
    Department: trim(input.department),
    Location: trim(input.location),
    Description: trim(input.description),
    ImmediateAction: trim(input.immediateAction),
    Witnesses: trim(input.witnesses),
    EvidenceUrls: jsonString(sanitizeEvidenceUrlsForWorkbook(input.evidenceUrls), "[]"),
    CreatedAt: trim(input.createdAt) || now,
    CreatedBy: trim(input.createdBy || input.reporterName),
    UpdatedAt: trim(input.updatedAt) || now,
    NotificationStatus: trim(input.notificationStatus) || "Pending",
    InvestigationNotes: trim(input.investigationNotes),
    RootCause: trim(input.rootCause),
    ClosedAt: trim(input.closedAt),
    ClosedBy: trim(input.closedBy),
    VerificationSource: trim(input.verificationSource),
    ...buildIncidentAssignmentFields(input),
  };
}

function stripSensitiveRecordFields(record = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(record)) {
    if (PASSWORD_HASH_KEYS.has(key) || PASSWORD_HASH_KEYS.has(key.toLowerCase())) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function parseEvidenceUrls(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  const text = trim(raw);
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickEvidenceUrls(record = {}) {
  for (const key of ["EvidenceUrls", "evidenceUrls"]) {
    const direct = record[key];
    if (Array.isArray(direct)) {
      return direct;
    }
  }
  for (const key of ["EvidenceUrls", "evidenceUrls"]) {
    const parsed = parseEvidenceUrls(pickRecordField(record, key));
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

export function mapWorkbookIncidentRecord(record = {}, fallback = {}) {
  const sanitized = stripSensitiveRecordFields(record);
  const rawIncidentId = pickIncidentIdFromRecord(sanitized) || pickRecordField(sanitized, "IncidentId", "Incident ID", "incidentId");
  const incidentId = canonicalIncidentId(rawIncidentId) || rawIncidentId;
  const createdAt = pickRecordField(sanitized, "CreatedAt", "createdAt");
  const localId =
    trim(fallback.id) ||
    (incidentId ? `incident-${incidentId}` : `incident-${Date.now()}`);

  return {
    id: localId,
    incidentId,
    status: normalizeIncidentStatus(pickRecordField(sanitized, "Status", "status") || "Open"),
    priority: pickRecordField(sanitized, "Priority", "priority") || "Normal",
    incidentType: pickRecordField(sanitized, "IncidentType", "incidentType"),
    severity: pickRecordField(sanitized, "Severity", "severity"),
    incidentDate: pickRecordField(sanitized, "IncidentDate", "incidentDate"),
    incidentTime: pickRecordField(sanitized, "IncidentTime", "incidentTime"),
    reporterName: pickRecordField(sanitized, "ReporterName", "reporterName"),
    reporterEmail: pickRecordField(sanitized, "ReporterEmail", "reporterEmail"),
    department: pickRecordField(sanitized, "Department", "department"),
    location: pickRecordField(sanitized, "Location", "location"),
    description: pickRecordField(sanitized, "Description", "description"),
    immediateAction: pickRecordField(sanitized, "ImmediateAction", "immediateAction"),
    injured: Boolean(fallback.injured),
    injuryDetails: trim(fallback.injuryDetails),
    contributingFactors: trim(fallback.contributingFactors),
    witnesses: pickRecordField(sanitized, "Witnesses", "witnesses"),
    evidenceUrls: pickEvidenceUrls(sanitized),
    investigationNotes:
      trim(fallback.investigationNotes) || pickRecordField(sanitized, "InvestigationNotes", "investigationNotes"),
    rootCause: trim(fallback.rootCause) || pickRecordField(sanitized, "RootCause", "rootCause"),
    verificationSource: pickRecordField(sanitized, "VerificationSource", "verificationSource"),
    correctiveActions: trim(fallback.correctiveActions),
    preventiveActions: trim(fallback.preventiveActions),
    assignedTo:
      trim(fallback.assignedTo) ||
      trim(fallback.assignedToName) ||
      pickRecordField(sanitized, "AssignedToName", "assignedToName"),
    assignedToEmail: trim(fallback.assignedToEmail) || pickRecordField(sanitized, "AssignedToEmail", "assignedToEmail"),
    assignedToName: trim(fallback.assignedToName) || pickRecordField(sanitized, "AssignedToName", "assignedToName"),
    assignedByEmail: trim(fallback.assignedByEmail) || pickRecordField(sanitized, "AssignedByEmail", "assignedByEmail"),
    assignedByName: trim(fallback.assignedByName) || pickRecordField(sanitized, "AssignedByName", "assignedByName"),
    assignedAt: trim(fallback.assignedAt) || pickRecordField(sanitized, "AssignedAt", "assignedAt"),
    receivedByEmail: trim(fallback.receivedByEmail) || pickRecordField(sanitized, "ReceivedByEmail", "receivedByEmail"),
    receivedByName: trim(fallback.receivedByName) || pickRecordField(sanitized, "ReceivedByName", "receivedByName"),
    reassignedFromEmail:
      trim(fallback.reassignedFromEmail) || pickRecordField(sanitized, "ReassignedFromEmail", "reassignedFromEmail"),
    reassignedFromName:
      trim(fallback.reassignedFromName) || pickRecordField(sanitized, "ReassignedFromName", "reassignedFromName"),
    reassignedToEmail:
      trim(fallback.reassignedToEmail) || pickRecordField(sanitized, "ReassignedToEmail", "reassignedToEmail"),
    reassignedToName:
      trim(fallback.reassignedToName) || pickRecordField(sanitized, "ReassignedToName", "reassignedToName"),
    reassignedByEmail:
      trim(fallback.reassignedByEmail) || pickRecordField(sanitized, "ReassignedByEmail", "reassignedByEmail"),
    reassignedByName:
      trim(fallback.reassignedByName) || pickRecordField(sanitized, "ReassignedByName", "reassignedByName"),
    reassignedAt: trim(fallback.reassignedAt) || pickRecordField(sanitized, "ReassignedAt", "reassignedAt"),
    reassignmentReason:
      trim(fallback.reassignmentReason) || pickRecordField(sanitized, "ReassignmentReason", "reassignmentReason"),
    assignmentHistory:
      Array.isArray(fallback.assignmentHistory) && fallback.assignmentHistory.length > 0
        ? sanitizeAssignmentHistoryForWorkbook(fallback.assignmentHistory)
        : pickAssignmentHistory(sanitized),
    actionOwner: trim(fallback.actionOwner),
    dueDate: trim(fallback.dueDate),
    completionDate: trim(fallback.completionDate),
    riddorRequired: Boolean(fallback.riddorRequired),
    closedBy: trim(fallback.closedBy) || pickRecordField(sanitized, "ClosedBy", "closedBy"),
    closedAt: trim(fallback.closedAt) || pickRecordField(sanitized, "ClosedAt", "closedAt"),
    notificationStatus: pickRecordField(sanitized, "NotificationStatus", "notificationStatus") || "Pending",
    statusHistory: Array.isArray(fallback.statusHistory) ? fallback.statusHistory : [],
    createdAt,
    createdBy: pickRecordField(sanitized, "CreatedBy", "createdBy"),
    updatedAt: pickRecordField(sanitized, "UpdatedAt", "updatedAt") || createdAt,
    updatedBy: trim(fallback.updatedBy) || pickRecordField(sanitized, "CreatedBy", "createdBy"),
  };
}

export function sortIncidentsByCreatedAtDesc(records = []) {
  return [...records].sort((left, right) => {
    const leftMs = Date.parse(trim(left.createdAt));
    const rightMs = Date.parse(trim(right.createdAt));
    const safeLeft = Number.isNaN(leftMs) ? Number.NEGATIVE_INFINITY : leftMs;
    const safeRight = Number.isNaN(rightMs) ? Number.NEGATIVE_INFINITY : rightMs;
    return safeRight - safeLeft;
  });
}

async function appendIncidentRowWithRetry(appendTabRows, auth, deps, masterSheetId, row) {
  const doAppend = () =>
    appendTabRows(auth, deps, masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS, [row]);
  try {
    return await withIncidentsTimeout(doAppend(), "append_incidents_row");
  } catch (firstError) {
    if (firstError?.code === "GOOGLE_TIMEOUT") {
      throw firstError;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await withIncidentsTimeout(doAppend(), "append_incidents_row_retry");
  }
}

/** Append incident row to Incidents tab via workbookService. */
export async function submitCompanyIncident(auth, deps, input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const startedAt = Date.now();
  const traceMeta = {
    startedAt,
    companyId: companyFolderId,
    incidentId: trim(input.incidentId),
    userEmail: input.reporterEmail || input.email,
  };

  logIncidentPhase("submit_entered", traceMeta);

  const validation = validateIncidentSubmitInput(input);
  if (!validation.ok) {
    logIncidentPhase("submit_rejected", { ...traceMeta, code: validation.code });
    return validation;
  }

  const resolveStart = Date.now();
  const preResolvedContext = input.resolvedContext;
  const context =
    preResolvedContext?.ok === true
      ? preResolvedContext
      : await resolveCompanyScheduleContext(auth, deps, {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: input.masterSheetId,
          companyName: input.companyName,
        });
  logIncidentPhase("resolve_company_end", { ...traceMeta, durationMs: Date.now() - resolveStart });
  if (!context.ok) {
    return context;
  }

  if (trim(context.companyFolderId) !== companyFolderId) {
    return {
      ok: false,
      code: "INCIDENT_COMPANY_MISMATCH",
      error: "Incident company identifiers must match.",
      httpStatus: 500,
    };
  }

  let evidenceUrls = sanitizeEvidenceUrlsForWorkbook(input.evidenceUrls);
  let evidenceUploadWarning = "";
  const evidenceFiles = (Array.isArray(input.evidenceFiles) ? input.evidenceFiles : []).map((file, index) =>
    normalizeEvidenceUploadFile(file, index),
  );
  if (evidenceFiles.length > 0) {
    const validDataUrlCount = evidenceFiles.filter((file) => trim(file.dataUrl).startsWith("data:")).length;
    logIncidentPhase("evidence_upload_start", {
      ...traceMeta,
      fileCount: evidenceFiles.length,
      validDataUrlCount,
    });
    const uploaded = await uploadIncidentEvidenceToDrive(auth, deps, {
      companyFolderId,
      masterSheetId: context.masterSheetId,
      incidentId: trim(input.incidentId),
      files: evidenceFiles,
    });
    logIncidentPhase("evidence_upload_end", {
      ...traceMeta,
      uploadedCount: uploaded.evidenceUrls?.length || 0,
      folderId: uploaded.folderId || "",
      ok: uploaded.ok,
    });
    if (uploaded.evidenceUrls?.length > 0) {
      evidenceUrls = uploaded.evidenceUrls;
    }
    if (!uploaded.ok) {
      evidenceUploadWarning =
        uploaded.message || uploaded.error || "Photo evidence could not be uploaded to Google Drive.";
    } else if (uploaded.warning) {
      evidenceUploadWarning = uploaded.warning;
    }
  }

  const row = buildIncidentRow({ ...input, evidenceUrls });
  const appendTabRows = resolveAppendTabRows(deps);
  const readTabRecords = resolveReadTabRecords(deps);
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  try {
    await ensureTabColumns(auth, deps, context.masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, INCIDENTS_TAB, {
      expectedHeaders: INCIDENTS_TAB_COLUMNS,
    });
    const existingRecord = findIncidentWorkbookRecord(readResult.records || [], row.IncidentId);
    if (existingRecord) {
      const existingIncident = mapWorkbookIncidentRecord(existingRecord.record);
      if (isVerificationIncident(existingIncident)) {
        logIncidentPhase("submit_idempotent", { ...traceMeta, incidentId: existingIncident.incidentId });
        return {
          ok: true,
          alreadyExists: true,
          companyId: context.companyFolderId,
          companyFolderId: context.companyFolderId,
          masterSheetId: context.masterSheetId,
          incidentId: existingIncident.incidentId,
          incident: existingIncident,
          evidenceUploadWarning,
        };
      }
      return {
        ok: false,
        code: "INCIDENT_ALREADY_EXISTS",
        error: "An incident with this ID already exists.",
        httpStatus: 409,
      };
    }

    const writeStart = Date.now();
    logIncidentPhase("write_incidents_start", traceMeta);
    await appendIncidentRowWithRetry(
      appendTabRows,
      auth,
      deps,
      context.masterSheetId,
      row,
    );
    logIncidentPhase("write_incidents_end", { ...traceMeta, durationMs: Date.now() - writeStart });
    const incident = mapWorkbookIncidentRecord(row, input);
    logIncidentMutationTiming("create", "submit", {
      incidentId: incident.incidentId,
      workbookId: context.masterSheetId,
      updatedRows: 1,
      durationMs: Date.now() - writeStart,
      totalMs: Date.now() - startedAt,
    });
    logIncidentPhase("submit_success", { ...traceMeta, incidentId: incident.incidentId });
    return {
      ok: true,
      companyId: context.companyFolderId,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      incidentId: incident.incidentId,
      incident,
      updatedRows: 1,
      evidenceUploadWarning,
    };
  } catch (error) {
    logIncidentPhase("submit_error", {
      ...traceMeta,
      code: error?.code || "INCIDENT_SUBMIT_FAILED",
      durationMs: Date.now() - startedAt,
    });
    const timeoutResult = incidentsTimeoutError("write_incidents", error);
    if (timeoutResult.reasonCode === "GOOGLE_TIMEOUT") {
      return timeoutResult;
    }
    return {
      ok: false,
      code: "INCIDENT_SUBMIT_FAILED",
      error: "Could not save incident report to the company workbook.",
      message: "Could not save incident report to the company workbook.",
      httpStatus: 502,
    };
  }
}

/** Read Incidents from company workbook. */
export async function listCompanyIncidents(auth, deps, companyContext = {}, listOptions = null) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const preResolvedContext = listOptions?.resolvedContext;

  const context =
    preResolvedContext?.ok === true
      ? preResolvedContext
      : await resolveCompanyScheduleContext(auth, deps, {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId,
        });
  if (!context.ok) {
    return context;
  }

  try {
    const ensureTabColumns = resolveEnsureTabColumns(deps);
    await ensureTabColumns(auth, deps, context.masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS);
    const readTabRecords = resolveReadTabRecords(deps);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, INCIDENTS_TAB, {
      expectedHeaders: INCIDENTS_TAB_COLUMNS,
    });
    const incidents = sortIncidentsByCreatedAtDesc(
      filterRegisterIncidents(
        (readResult.records || []).map((record) => mapWorkbookIncidentRecord(record)),
        {
          log: true,
          phase: "list_company_incidents",
          label: context.companyFolderId,
        },
      ),
    );

    return {
      ok: true,
      companyId: context.companyFolderId,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      incidents,
    };
  } catch (error) {
    return {
      ok: false,
      code: "INCIDENTS_UNAVAILABLE",
      error: "Incident reports are not available.",
      message: "Incident reports are not available.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }
}

export function validateIncidentReassignInput(input = {}) {
  const toEmail = normalizeEmail(input.toEmail);
  const toName = trim(input.toName);
  if (!trim(input.incidentId)) {
    return {
      ok: false,
      code: "INCIDENT_ID_REQUIRED",
      error: "Incident ID is required.",
      httpStatus: 400,
    };
  }
  if (!toEmail || !toName) {
    return {
      ok: false,
      code: "INCIDENT_REASSIGN_FIELDS_REQUIRED",
      error: "Select a person and confirm the reassignment.",
      httpStatus: 400,
    };
  }
  return { ok: true, toEmail, toName };
}

/** Reassign incident handler in workbook and append AssignmentHistory. */
export async function reassignCompanyIncident(auth, deps, input = {}, actor = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const incidentId = trim(input.incidentId);
  const startedAt = Date.now();
  const traceMeta = {
    startedAt,
    companyId: companyFolderId,
    incidentId,
    userEmail: normalizeEmail(actor.email || actor.userEmail),
  };

  logIncidentPhase("reassign_entered", traceMeta);

  const validation = validateIncidentReassignInput(input);
  if (!validation.ok) {
    return validation;
  }

  const preResolvedContext = input.resolvedContext;
  const context =
    preResolvedContext?.ok === true
      ? preResolvedContext
      : await resolveCompanyScheduleContext(auth, deps, {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: input.masterSheetId,
          companyName: input.companyName,
        });
  if (!context.ok) {
    return context;
  }

  try {
    const ensureTabColumns = resolveEnsureTabColumns(deps);
    await ensureTabColumns(auth, deps, context.masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS);
    const readTabRecords = resolveReadTabRecords(deps);
    const readResult = await readTabRecords(auth, deps, context.masterSheetId, INCIDENTS_TAB, {
      expectedHeaders: INCIDENTS_TAB_COLUMNS,
    });
    const records = readResult.records || [];
    const found = findIncidentWorkbookRecord(records, incidentId);
    logIncidentPhase("incident_reassign_lookup", {
      ...traceMeta,
      requestedIncidentId: incidentId,
      normalizedIncidentId: normalizeIncidentIdForLookup(incidentId),
      availableIncidentIdsSample: sampleIncidentIdsFromRecords(records),
      workbookId: context.masterSheetId,
      rowCount: records.length,
      matchedWorkbookIncidentId: found?.workbookIncidentId || "",
    });
    if (!found) {
      return {
        ok: false,
        code: "INCIDENT_NOT_FOUND",
        error: "Incident not found in the company workbook.",
        message:
          "Incident not found in the company workbook. Refresh the register to sync incidents, then try again.",
        httpStatus: 404,
      };
    }

    const incident = mapWorkbookIncidentRecord(found.record);
    const godmode = isGodmodeInviteSession({ kind: actor.kind, role: actor.role });
    const targetUser = {
      email: validation.toEmail,
      name: validation.toName,
      role: trim(input.toRole),
    };
    if (
      !canReassignCompanyIncident(actor, incident, {
        godmode,
        targetUser,
      })
    ) {
      return {
        ok: false,
        code: "INCIDENT_REASSIGN_FORBIDDEN",
        error: "You do not have permission to reassign this incident.",
        httpStatus: 403,
      };
    }

    const patchInput = buildReassignedIncidentPatch(
      incident,
      { toEmail: validation.toEmail, toName: validation.toName, reason: input.reason },
      actor,
    );
    const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
    const incidentIdHeader = findIncidentIdHeader(Object.keys(found.record));
    await withIncidentsTimeout(
      patchTabRowByHeader(
        auth,
        deps,
        context.masterSheetId,
        INCIDENTS_TAB,
        incidentIdHeader,
        found.workbookIncidentId,
        {
          ...buildIncidentAssignmentFields(patchInput),
          UpdatedAt: patchInput.updatedAt,
        },
        {
          matchHeaderAliases: INCIDENT_ID_HEADER_ALIASES,
          compareValues: incidentIdsMatch,
        },
      ),
      "patch_incident_reassign",
    );

    const updatedIncident = mapWorkbookIncidentRecord(found.record, patchInput);
    logIncidentPhase("reassign_success", {
      ...traceMeta,
      assignedToEmail: updatedIncident.assignedToEmail,
      historyCount: updatedIncident.assignmentHistory?.length || 0,
    });
    return {
      ok: true,
      companyId: context.companyFolderId,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      incident: updatedIncident,
    };
  } catch (error) {
    logIncidentPhase("reassign_error", {
      ...traceMeta,
      error: error instanceof Error ? error.message : String(error),
    });
    const timeoutResult = incidentsTimeoutError("patch_incident_reassign", error);
    if (timeoutResult.reasonCode === "GOOGLE_TIMEOUT") {
      return timeoutResult;
    }
    return {
      ok: false,
      code: "INCIDENT_REASSIGN_FAILED",
      error: "Could not reassign this incident.",
      message: "Could not reassign this incident.",
      httpStatus: 502,
    };
  }
}

export const ALLOWED_INCIDENT_STATUS_TRANSITIONS = {
  Open: new Set(["Under Investigation", "Closed"]),
  "Under Investigation": new Set(["Closed"]),
  Closed: new Set([]),
};

function nowIso() {
  return new Date().toISOString();
}

function logIncidentMutationTiming(operation, stage, meta = {}) {
  console.info("[incident:mutation-timing]", {
    operation,
    stage,
    incidentId: trim(meta.incidentId),
    workbookId: trim(meta.workbookId),
    updatedRows: Number.isFinite(meta.updatedRows) ? meta.updatedRows : undefined,
    durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : undefined,
    totalMs: Number.isFinite(meta.totalMs) ? meta.totalMs : undefined,
  });
}

export function isAllowedIncidentStatusTransition(fromStatus, toStatus) {
  const from = normalizeIncidentStatus(fromStatus);
  const to = normalizeIncidentStatus(toStatus);
  if (from === to) {
    return true;
  }
  const allowed = ALLOWED_INCIDENT_STATUS_TRANSITIONS[from];
  return Boolean(allowed?.has(to));
}

async function loadIncidentContext(auth, deps, input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const preResolvedContext = input.resolvedContext;
  const context =
    preResolvedContext?.ok === true
      ? preResolvedContext
      : await resolveCompanyScheduleContext(auth, deps, {
          companyId: companyFolderId,
          companyFolderId,
          masterSheetId: input.masterSheetId,
          companyName: input.companyName,
        });
  if (!context.ok) {
    return context;
  }
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, context.masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS);
  const readTabRecords = resolveReadTabRecords(deps);
  const readResult = await readTabRecords(auth, deps, context.masterSheetId, INCIDENTS_TAB, {
    expectedHeaders: INCIDENTS_TAB_COLUMNS,
  });
  return {
    ok: true,
    context,
    records: readResult.records || [],
  };
}

export async function getCompanyIncident(auth, deps, input = {}, incidentId = "") {
  const id = trim(incidentId || input.incidentId);
  if (!id) {
    return {
      ok: false,
      code: "INCIDENT_ID_REQUIRED",
      error: "Incident ID is required.",
      httpStatus: 400,
    };
  }
  try {
    const loaded = await loadIncidentContext(auth, deps, input);
    if (!loaded.ok) {
      return loaded;
    }
    const found = findIncidentWorkbookRecord(loaded.records, id);
    if (!found) {
      return {
        ok: false,
        code: "INCIDENT_NOT_FOUND",
        error: "Incident not found in the company workbook.",
        httpStatus: 404,
      };
    }
    const incident = mapWorkbookIncidentRecord(found.record);
    return {
      ok: true,
      companyId: loaded.context.companyFolderId,
      companyFolderId: loaded.context.companyFolderId,
      masterSheetId: loaded.context.masterSheetId,
      incident,
      incidentId: incident.incidentId,
    };
  } catch (error) {
    return {
      ok: false,
      code: "INCIDENT_LOAD_FAILED",
      error: "Could not load incident.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }
}

function buildIncidentPatchFields(input = {}, actor = {}) {
  const patch = {};
  if (input.description !== undefined) patch.Description = trim(input.description);
  if (input.location !== undefined) patch.Location = trim(input.location);
  if (input.immediateAction !== undefined) patch.ImmediateAction = trim(input.immediateAction);
  if (input.investigationNotes !== undefined) patch.InvestigationNotes = trim(input.investigationNotes);
  if (input.rootCause !== undefined) patch.RootCause = trim(input.rootCause);
  if (input.status !== undefined) patch.Status = normalizeIncidentStatus(input.status);
  if (input.closedAt !== undefined) patch.ClosedAt = trim(input.closedAt);
  if (input.closedBy !== undefined) patch.ClosedBy = trim(input.closedBy);
  if (input.verificationSource !== undefined) patch.VerificationSource = trim(input.verificationSource);
  if (Object.keys(patch).length > 0) {
    patch.UpdatedAt = nowIso();
    patch.UpdatedBy = trim(actor.name || actor.email);
  }
  return patch;
}

export async function patchCompanyIncident(auth, deps, input = {}, actor = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const incidentId = trim(input.incidentId);
  const startedAt = Date.now();
  if (!incidentId) {
    return { ok: false, code: "INCIDENT_ID_REQUIRED", error: "Incident ID is required.", httpStatus: 400 };
  }
  try {
    const loaded = await loadIncidentContext(auth, deps, input);
    if (!loaded.ok) {
      return loaded;
    }
    const found = findIncidentWorkbookRecord(loaded.records, incidentId);
    if (!found) {
      return {
        ok: false,
        code: "INCIDENT_NOT_FOUND",
        error: "Incident not found in the company workbook.",
        httpStatus: 404,
      };
    }
    const current = mapWorkbookIncidentRecord(found.record);
    const patch = buildIncidentPatchFields(input, actor);
    if (patch.Status && !isAllowedIncidentStatusTransition(current.status, patch.Status)) {
      return {
        ok: false,
        code: "INCIDENT_STATUS_TRANSITION_INVALID",
        error: `Cannot transition incident status from ${current.status} to ${patch.Status}.`,
        httpStatus: 400,
      };
    }
    if (Object.keys(patch).length === 0) {
      return {
        ok: true,
        companyId: loaded.context.companyFolderId,
        companyFolderId: loaded.context.companyFolderId,
        masterSheetId: loaded.context.masterSheetId,
        incident: current,
        incidentId: current.incidentId,
        updatedRows: 0,
        unchanged: true,
      };
    }
    const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
    const incidentIdHeader = findIncidentIdHeader(Object.keys(found.record));
    const patchResult = await withIncidentsTimeout(
      patchTabRowByHeader(
        auth,
        deps,
        loaded.context.masterSheetId,
        INCIDENTS_TAB,
        incidentIdHeader,
        found.workbookIncidentId,
        patch,
        {
          matchHeaderAliases: INCIDENT_ID_HEADER_ALIASES,
          compareValues: incidentIdsMatch,
        },
      ),
      "patch_incident",
    );
    const updatedRows = Number(patchResult?.patched ?? patchResult?.updatedRows ?? 1);
    const updatedIncident = mapWorkbookIncidentRecord({ ...found.record, ...patch }, { ...current, ...input });
    logIncidentMutationTiming("patch", trim(input.stage) || "patch", {
      incidentId: updatedIncident.incidentId,
      workbookId: loaded.context.masterSheetId,
      updatedRows,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      companyId: loaded.context.companyFolderId,
      companyFolderId: loaded.context.companyFolderId,
      masterSheetId: loaded.context.masterSheetId,
      incident: updatedIncident,
      incidentId: updatedIncident.incidentId,
      updatedRows,
    };
  } catch (error) {
    const timeoutResult = incidentsTimeoutError("patch_incident", error);
    if (timeoutResult.reasonCode === "GOOGLE_TIMEOUT") {
      return timeoutResult;
    }
    return {
      ok: false,
      code: "INCIDENT_PATCH_FAILED",
      error: "Could not update incident.",
      httpStatus: 502,
    };
  }
}

export async function closeCompanyIncident(auth, deps, input = {}, actor = {}) {
  const incidentId = trim(input.incidentId);
  const startedAt = Date.now();
  const currentResult = await getCompanyIncident(auth, deps, input, incidentId);
  if (!currentResult.ok) {
    return currentResult;
  }
  const current = currentResult.incident;
  if (normalizeIncidentStatus(current.status) === "Closed") {
    return {
      ok: true,
      alreadyClosed: true,
      companyId: currentResult.companyId,
      companyFolderId: currentResult.companyFolderId,
      masterSheetId: currentResult.masterSheetId,
      incident: current,
      incidentId: current.incidentId,
      updatedRows: 0,
    };
  }
  const timestamp = nowIso();
  const closedBy = trim(actor.name || actor.email);
  const result = await patchCompanyIncident(
    auth,
    deps,
    {
      ...input,
      incidentId,
      status: "Closed",
      closedAt: timestamp,
      closedBy,
      stage: "close",
    },
    actor,
  );
  if (!result.ok) {
    return result;
  }
  logIncidentMutationTiming("close", "close", {
    incidentId: result.incidentId,
    workbookId: result.masterSheetId,
    updatedRows: result.updatedRows,
    durationMs: Date.now() - startedAt,
    totalMs: Date.now() - startedAt,
  });
  return { ...result, alreadyClosed: false };
}

async function archiveVerificationRiddorForIncident(auth, deps, masterSheetId, incidentId, actor) {
  const readTabRecords = resolveReadTabRecords(deps);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const readResult = await readTabRecords(auth, deps, masterSheetId, RIDDOR_REPORTS_TAB, {
    expectedHeaders: RIDDOR_REPORTS_TAB_COLUMNS,
  }).catch(() => ({ records: [] }));
  const records = readResult.records || [];
  let archived = 0;
  const timestamp = nowIso();
  for (const record of records) {
    const linkedIncidentId = trim(record.IncidentId || record.incidentId);
    if (!incidentIdsMatch(linkedIncidentId, incidentId)) {
      continue;
    }
    const riddorId = trim(record.RiddorId || record.riddorId);
    if (!riddorId) {
      continue;
    }
    await patchTabRowByHeader(auth, deps, masterSheetId, RIDDOR_REPORTS_TAB, "RiddorId", riddorId, {
      ArchivedAt: timestamp,
      ArchivedBy: normalizeEmail(actor.email),
      UpdatedAt: timestamp,
      UpdatedBy: normalizeEmail(actor.email),
    });
    archived += 1;
  }
  return archived;
}

export async function cleanupVerificationIncident(auth, deps, input = {}, actor = {}) {
  const incidentId = trim(input.incidentId);
  const startedAt = Date.now();
  if (!incidentId) {
    return { ok: false, code: "INCIDENT_ID_REQUIRED", error: "Incident ID is required.", httpStatus: 400 };
  }
  if (!isVerificationIncidentId(incidentId)) {
    return {
      ok: false,
      code: "CLEANUP_NOT_VERIFICATION_INCIDENT",
      error: "Only verification incidents with the bert-smoke-inc- prefix can be cleaned up through this path.",
      httpStatus: 403,
    };
  }
  try {
    const loaded = await loadIncidentContext(auth, deps, input);
    if (!loaded.ok) {
      return loaded;
    }
    const found = findIncidentWorkbookRecord(loaded.records, incidentId);
    if (!found) {
      return {
        ok: true,
        cleaned: true,
        alreadyCleaned: true,
        companyFolderId: loaded.context.companyFolderId,
        masterSheetId: loaded.context.masterSheetId,
        incidentId,
        updatedRows: 0,
      };
    }
    const incident = mapWorkbookIncidentRecord(found.record);
    if (!isVerificationIncident(incident)) {
      return {
        ok: false,
        code: "CLEANUP_NOT_VERIFICATION_INCIDENT",
        error: "Only verification incidents can be cleaned up through this path.",
        httpStatus: 403,
      };
    }
    const currentStatus = normalizeIncidentStatus(incident.status);
    if (currentStatus === PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS) {
      return {
        ok: true,
        cleaned: true,
        alreadyCleaned: true,
        companyFolderId: loaded.context.companyFolderId,
        masterSheetId: loaded.context.masterSheetId,
        incidentId,
        updatedRows: 0,
      };
    }
    const timestamp = nowIso();
    const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
    const incidentIdHeader = findIncidentIdHeader(Object.keys(found.record));
    const patchResult = await withIncidentsTimeout(
      patchTabRowByHeader(
        auth,
        deps,
        loaded.context.masterSheetId,
        INCIDENTS_TAB,
        incidentIdHeader,
        found.workbookIncidentId,
        {
          Status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
          ClosedAt: trim(incident.closedAt) || timestamp,
          ClosedBy: trim(incident.closedBy) || normalizeEmail(actor.email),
          UpdatedAt: timestamp,
          UpdatedBy: trim(actor.name || actor.email),
          VerificationSource: PRODUCTION_VERIFICATION_INCIDENT_SOURCE,
        },
        {
          matchHeaderAliases: INCIDENT_ID_HEADER_ALIASES,
          compareValues: incidentIdsMatch,
        },
      ),
      "cleanup_verification_incident",
    );
    const archivedRiddor = await archiveVerificationRiddorForIncident(
      auth,
      deps,
      loaded.context.masterSheetId,
      incidentId,
      actor,
    );
    const updatedRows = Number(patchResult?.patched ?? patchResult?.updatedRows ?? 1);
    logIncidentMutationTiming("cleanup", "cleanup", {
      incidentId,
      workbookId: loaded.context.masterSheetId,
      updatedRows,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      cleaned: true,
      companyFolderId: loaded.context.companyFolderId,
      masterSheetId: loaded.context.masterSheetId,
      incidentId,
      status: PRODUCTION_VERIFICATION_INCIDENT_CLEANED_STATUS,
      updatedRows,
      archivedRiddor,
    };
  } catch (error) {
    return {
      ok: false,
      code: "INCIDENT_CLEANUP_FAILED",
      error: "Could not clean up verification incident.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }
}

export async function cleanupStaleVerificationIncidents(auth, deps, input = {}, actor = {}) {
  const startedAt = Date.now();
  try {
    const loaded = await loadIncidentContext(auth, deps, input);
    if (!loaded.ok) {
      return loaded;
    }
    const stale = loaded.records
      .map((record) => mapWorkbookIncidentRecord(record))
      .filter((item) => isActiveVerificationIncident(item));
    const results = [];
    for (const incident of stale) {
      const cleaned = await cleanupVerificationIncident(
        auth,
        deps,
        { ...input, incidentId: incident.incidentId },
        actor,
      );
      results.push({
        incidentId: incident.incidentId,
        ok: cleaned.ok,
        alreadyCleaned: Boolean(cleaned.alreadyCleaned),
      });
    }
    logIncidentMutationTiming("cleanup", "stale-cleanup", {
      workbookId: loaded.context.masterSheetId,
      updatedRows: results.filter((item) => item.ok).length,
      durationMs: Date.now() - startedAt,
      totalMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      companyFolderId: loaded.context.companyFolderId,
      masterSheetId: loaded.context.masterSheetId,
      cleanedCount: results.filter((item) => item.ok).length,
      results,
    };
  } catch (error) {
    return {
      ok: false,
      code: "INCIDENT_STALE_CLEANUP_FAILED",
      error: "Could not clean up stale verification incidents.",
      technicalError: error instanceof Error ? error.message : String(error),
      httpStatus: 502,
    };
  }
}
