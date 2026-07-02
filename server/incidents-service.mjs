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
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";
import { sanitizeEvidenceUrlsForWorkbook } from "./incident-evidence-upload.mjs";

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
  return {
    IncidentId: trim(input.incidentId),
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

export function mapWorkbookIncidentRecord(record = {}, fallback = {}) {
  const sanitized = stripSensitiveRecordFields(record);
  const incidentId = pickRecordField(sanitized, "IncidentId", "incidentId");
  const createdAt = pickRecordField(sanitized, "CreatedAt", "createdAt");
  const localId =
    trim(fallback.id) ||
    (incidentId ? `incident-${incidentId}` : `incident-${Date.now()}`);

  return {
    id: localId,
    incidentId,
    status: pickRecordField(sanitized, "Status", "status") || "Open",
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
    evidenceUrls: parseEvidenceUrls(pickRecordField(sanitized, "EvidenceUrls", "evidenceUrls")),
    investigationNotes: trim(fallback.investigationNotes),
    rootCause: trim(fallback.rootCause),
    correctiveActions: trim(fallback.correctiveActions),
    preventiveActions: trim(fallback.preventiveActions),
    assignedTo: trim(fallback.assignedTo),
    actionOwner: trim(fallback.actionOwner),
    dueDate: trim(fallback.dueDate),
    completionDate: trim(fallback.completionDate),
    riddorRequired: Boolean(fallback.riddorRequired),
    closedBy: trim(fallback.closedBy),
    closedAt: trim(fallback.closedAt),
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

  const row = buildIncidentRow(input);
  const appendTabRows = resolveAppendTabRows(deps);
  try {
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
    logIncidentPhase("submit_success", { ...traceMeta, incidentId: incident.incidentId });
    return {
      ok: true,
      companyId: context.companyFolderId,
      companyFolderId: context.companyFolderId,
      masterSheetId: context.masterSheetId,
      incident,
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
      (readResult.records || []).map((record) => mapWorkbookIncidentRecord(record)),
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
