import { apiUrl } from "../config/apiBase";
import type {
  IncidentEvidenceItem,
  IncidentEvidenceFileAttachment,
  IncidentEvidenceUploadFile,
  IncidentRecord,
} from "../types/incidentsScreenProps";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";

export const COMPANY_INCIDENTS_LOAD_TIMEOUT_MS = 90_000;
export const COMPANY_INCIDENTS_LOAD_TIMEOUT_MESSAGE =
  "Loading incident reports timed out before the server finished reading your company workbook. Try again.";
export const COMPANY_INCIDENTS_USER_MESSAGE = "Could not load incident reports.";
export const COMPANY_INCIDENTS_SUBMIT_USER_MESSAGE = "Could not save incident report to the company workbook.";
export const COMPANY_INCIDENTS_EVIDENCE_UPLOAD_USER_MESSAGE = "Could not upload incident photo evidence to Google Drive.";

function sanitizeEvidenceItemForWorkbook(item: IncidentEvidenceItem): IncidentEvidenceItem {
  const preview = String(item.previewUrl || item.driveLink || "").trim();
  const driveLink = String(item.driveLink || "").trim();
  const safePreview = preview.startsWith("data:") ? driveLink : preview || driveLink;
  const next: IncidentEvidenceItem = {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    previewUrl: safePreview,
    addedAt: item.addedAt,
  };
  if (item.driveFileId) {
    next.driveFileId = item.driveFileId;
  }
  if (driveLink && !driveLink.startsWith("data:")) {
    next.driveLink = driveLink;
  }
  return next;
}

export function sanitizeEvidenceUrlsForWorkbook(evidenceUrls: IncidentEvidenceItem[]): IncidentEvidenceItem[] {
  return evidenceUrls
    .map((item) => sanitizeEvidenceItemForWorkbook(item))
    .filter((item) => item.id && !item.previewUrl.startsWith("data:"));
}

export function prepareSerializableEvidenceUploadFiles(
  files: Array<Partial<IncidentEvidenceUploadFile> & { dataUrl?: string }> = [],
): IncidentEvidenceUploadFile[] {
  return files
    .map((file, index) => {
      const dataUrl = String(file.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:")) {
        return null;
      }
      return {
        id: String(file.id || `incident-evidence-${index + 1}`).trim(),
        name: String(file.name || `photo-${index + 1}`).trim(),
        mimeType: String(file.mimeType || "application/octet-stream").trim(),
        size: Number(file.size) || 0,
        dataUrl,
        addedAt: String(file.addedAt || new Date().toISOString()).trim(),
      };
    })
    .filter((file): file is IncidentEvidenceUploadFile => Boolean(file));
}

export async function resolveIncidentEvidenceFilesForUpload(
  evidenceUrls: IncidentEvidenceItem[],
  evidenceFiles: IncidentEvidenceFileAttachment[] = [],
  fileMap: Record<string, File> = {},
): Promise<File[]> {
  const byId = new Map<string, File>();
  for (const entry of evidenceFiles) {
    if (entry?.id && entry.file) {
      byId.set(entry.id, entry.file);
    }
  }
  for (const [id, file] of Object.entries(fileMap)) {
    if (id && file) {
      byId.set(id, file);
    }
  }

  const resolved: File[] = [];
  for (const item of evidenceUrls) {
    const fromMap = byId.get(item.id);
    if (fromMap) {
      resolved.push(fromMap);
      continue;
    }
    if (item.previewUrl.startsWith("blob:")) {
      try {
        const blob = await fetch(item.previewUrl).then((response) => response.blob());
        resolved.push(new File([blob], item.name || "incident-photo.jpg", { type: item.mimeType || blob.type }));
      } catch {
        // Skip unreadable blob preview.
      }
    }
  }
  return resolved;
}

export async function buildIncidentEvidenceUploadPayload(
  evidenceUrls: IncidentEvidenceItem[],
  evidenceFiles: IncidentEvidenceFileAttachment[] = [],
  fileMap: Record<string, File> = {},
): Promise<IncidentEvidenceUploadFile[]> {
  const byId = new Map<string, File>();
  for (const entry of evidenceFiles) {
    if (entry?.id && entry.file) {
      byId.set(entry.id, entry.file);
    }
  }
  for (const [id, file] of Object.entries(fileMap)) {
    if (id && file) {
      byId.set(id, file);
    }
  }

  const payload: IncidentEvidenceUploadFile[] = [];
  for (const item of evidenceUrls) {
    let file = byId.get(item.id);
    if (!file && item.previewUrl.startsWith("blob:")) {
      try {
        const blob = await fetch(item.previewUrl).then((response) => response.blob());
        file = new File([blob], item.name || "incident-photo.jpg", { type: item.mimeType || blob.type });
      } catch {
        file = undefined;
      }
    }
    if (!file) {
      continue;
    }
    payload.push({
      id: item.id,
      name: item.name,
      mimeType: item.mimeType || file.type || "application/octet-stream",
      size: file.size || 0,
      addedAt: item.addedAt,
      dataUrl: await readFileAsDataUrl(file),
    });
  }
  return prepareSerializableEvidenceUploadFiles(payload);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read file."));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

const credentialHashKey = (prefix: "P" | "p") => `${prefix}assword${String.fromCharCode(72)}ash`;
const PASSWORD_HASH_FIELD_NAMES = [credentialHashKey("P"), credentialHashKey("p")] as const;

function pickRecordField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = String(record[key] ?? "").trim();
    if (direct) {
      return direct;
    }
    const match = Object.entries(record).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && String(match[1] ?? "").trim()) {
      return String(match[1]).trim();
    }
  }
  return "";
}

function stripSensitiveFields<T extends Record<string, unknown>>(record: T): T {
  const sanitized = { ...record };
  for (const key of PASSWORD_HASH_FIELD_NAMES) {
    delete sanitized[key];
  }
  return sanitized;
}

function parseEvidenceUrls(raw: unknown): IncidentEvidenceItem[] {
  if (Array.isArray(raw)) {
    return raw as IncidentEvidenceItem[];
  }
  const text = String(raw ?? "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as IncidentEvidenceItem[]) : [];
  } catch {
    return [];
  }
}

function pickEvidenceUrls(record: Record<string, unknown>): IncidentEvidenceItem[] {
  for (const key of ["EvidenceUrls", "evidenceUrls"]) {
    const direct = record[key];
    if (Array.isArray(direct)) {
      return direct as IncidentEvidenceItem[];
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

function parseAssignmentHistory(raw: unknown): IncidentRecord["assignmentHistory"] {
  if (Array.isArray(raw)) {
    return raw as IncidentRecord["assignmentHistory"];
  }
  const text = String(raw ?? "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as IncidentRecord["assignmentHistory"]) : [];
  } catch {
    return [];
  }
}

function pickAssignmentHistory(record: Record<string, unknown>): IncidentRecord["assignmentHistory"] {
  for (const key of ["AssignmentHistory", "assignmentHistory"]) {
    const direct = record[key];
    if (Array.isArray(direct)) {
      return direct as IncidentRecord["assignmentHistory"];
    }
  }
  for (const key of ["AssignmentHistory", "assignmentHistory"]) {
    const parsed = parseAssignmentHistory(pickRecordField(record, key));
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

export function mapWorkbookIncidentRecord(
  record: Record<string, unknown>,
  fallback: Partial<IncidentRecord> = {},
): IncidentRecord {
  const sanitized = stripSensitiveFields(record);
  const incidentId = pickRecordField(sanitized, "IncidentId", "incidentId");
  const createdAt = pickRecordField(sanitized, "CreatedAt", "createdAt");
  const localId = String(fallback.id || "").trim() || (incidentId ? `incident-${incidentId}` : `incident-${Date.now()}`);

  return {
    id: localId,
    incidentId,
    status: (pickRecordField(sanitized, "Status", "status") || "Open") as IncidentRecord["status"],
    priority: (pickRecordField(sanitized, "Priority", "priority") || "Normal") as IncidentRecord["priority"],
    incidentType: pickRecordField(sanitized, "IncidentType", "incidentType") as IncidentRecord["incidentType"],
    severity: pickRecordField(sanitized, "Severity", "severity") as IncidentRecord["severity"],
    incidentDate: pickRecordField(sanitized, "IncidentDate", "incidentDate"),
    incidentTime: pickRecordField(sanitized, "IncidentTime", "incidentTime"),
    reporterName: pickRecordField(sanitized, "ReporterName", "reporterName"),
    reporterEmail: pickRecordField(sanitized, "ReporterEmail", "reporterEmail"),
    department: pickRecordField(sanitized, "Department", "department"),
    location: pickRecordField(sanitized, "Location", "location"),
    description: pickRecordField(sanitized, "Description", "description"),
    immediateAction: pickRecordField(sanitized, "ImmediateAction", "immediateAction"),
    injured: Boolean(fallback.injured),
    injuryDetails: String(fallback.injuryDetails || ""),
    contributingFactors: String(fallback.contributingFactors || ""),
    witnesses: pickRecordField(sanitized, "Witnesses", "witnesses"),
    evidenceUrls: pickEvidenceUrls(sanitized),
    investigationNotes: String(fallback.investigationNotes || ""),
    rootCause: String(fallback.rootCause || ""),
    correctiveActions: String(fallback.correctiveActions || ""),
    preventiveActions: String(fallback.preventiveActions || ""),
    assignedTo:
      String(fallback.assignedTo || "").trim() ||
      String(fallback.assignedToName || "").trim() ||
      pickRecordField(sanitized, "AssignedToName", "assignedToName"),
    assignedToEmail:
      String(fallback.assignedToEmail || "").trim() ||
      pickRecordField(sanitized, "AssignedToEmail", "assignedToEmail"),
    assignedToName:
      String(fallback.assignedToName || "").trim() ||
      pickRecordField(sanitized, "AssignedToName", "assignedToName"),
    assignedByEmail:
      String(fallback.assignedByEmail || "").trim() ||
      pickRecordField(sanitized, "AssignedByEmail", "assignedByEmail"),
    assignedByName:
      String(fallback.assignedByName || "").trim() ||
      pickRecordField(sanitized, "AssignedByName", "assignedByName"),
    assignedAt: String(fallback.assignedAt || "").trim() || pickRecordField(sanitized, "AssignedAt", "assignedAt"),
    receivedByEmail:
      String(fallback.receivedByEmail || "").trim() ||
      pickRecordField(sanitized, "ReceivedByEmail", "receivedByEmail"),
    receivedByName:
      String(fallback.receivedByName || "").trim() ||
      pickRecordField(sanitized, "ReceivedByName", "receivedByName"),
    reassignedFromEmail:
      String(fallback.reassignedFromEmail || "").trim() ||
      pickRecordField(sanitized, "ReassignedFromEmail", "reassignedFromEmail"),
    reassignedFromName:
      String(fallback.reassignedFromName || "").trim() ||
      pickRecordField(sanitized, "ReassignedFromName", "reassignedFromName"),
    reassignedToEmail:
      String(fallback.reassignedToEmail || "").trim() ||
      pickRecordField(sanitized, "ReassignedToEmail", "reassignedToEmail"),
    reassignedToName:
      String(fallback.reassignedToName || "").trim() ||
      pickRecordField(sanitized, "ReassignedToName", "reassignedToName"),
    reassignedByEmail:
      String(fallback.reassignedByEmail || "").trim() ||
      pickRecordField(sanitized, "ReassignedByEmail", "reassignedByEmail"),
    reassignedByName:
      String(fallback.reassignedByName || "").trim() ||
      pickRecordField(sanitized, "ReassignedByName", "reassignedByName"),
    reassignedAt:
      String(fallback.reassignedAt || "").trim() || pickRecordField(sanitized, "ReassignedAt", "reassignedAt"),
    reassignmentReason:
      String(fallback.reassignmentReason || "").trim() ||
      pickRecordField(sanitized, "ReassignmentReason", "reassignmentReason"),
    assignmentHistory:
      Array.isArray(fallback.assignmentHistory) && fallback.assignmentHistory.length > 0
        ? parseAssignmentHistory(fallback.assignmentHistory)
        : pickAssignmentHistory(sanitized),
    actionOwner: String(fallback.actionOwner || ""),
    dueDate: String(fallback.dueDate || ""),
    completionDate: String(fallback.completionDate || ""),
    riddorRequired: Boolean(fallback.riddorRequired),
    closedBy: String(fallback.closedBy || ""),
    closedAt: String(fallback.closedAt || ""),
    notificationStatus: pickRecordField(sanitized, "NotificationStatus", "notificationStatus") || "Pending",
    statusHistory: Array.isArray(fallback.statusHistory) ? fallback.statusHistory : [],
    createdAt,
    createdBy: pickRecordField(sanitized, "CreatedBy", "createdBy"),
    updatedAt: pickRecordField(sanitized, "UpdatedAt", "updatedAt") || createdAt,
    updatedBy: String(fallback.updatedBy || pickRecordField(sanitized, "CreatedBy", "createdBy")),
  };
}

export type FetchCompanyIncidentsResult = {
  ok: boolean;
  incidents: IncidentRecord[];
  loadError?: string;
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
};

export async function fetchCompanyIncidents(
  companyFolderId: string,
  options?: { signal?: AbortSignal; masterSheetId?: string },
): Promise<FetchCompanyIncidentsResult> {
  const companyId = String(companyFolderId || "").trim();
  if (!companyId) {
    return { ok: false, incidents: [], loadError: COMPANY_INCIDENTS_USER_MESSAGE };
  }

  const masterSheetId = String(options?.masterSheetId || "").trim();
  const query = masterSheetId ? `?masterSheetId=${encodeURIComponent(masterSheetId)}` : "";

  try {
    const requestUrl = apiUrl(`/api/companies/${encodeURIComponent(companyId)}/incidents${query}`);
    const response = await dedupeInFlight(requestDedupeKey("GET", requestUrl), () =>
      fetch(requestUrl, {
        credentials: "include",
        signal: options?.signal,
      }),
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      incidents?: Record<string, unknown>[];
      message?: string;
      error?: string;
      companyId?: string;
      companyFolderId?: string;
      masterSheetId?: string;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        incidents: [],
        loadError: payload.message || payload.error || COMPANY_INCIDENTS_USER_MESSAGE,
      };
    }

    const incidents = Array.isArray(payload.incidents)
      ? payload.incidents.map((record) => mapWorkbookIncidentRecord(record))
      : [];

    return {
      ok: true,
      incidents,
      companyId: payload.companyId,
      companyFolderId: payload.companyFolderId,
      masterSheetId: payload.masterSheetId,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      incidents: [],
      loadError: error instanceof Error ? error.message : COMPANY_INCIDENTS_USER_MESSAGE,
    };
  }
}

export type SubmitCompanyIncidentInput = {
  id: string;
  incidentId: string;
  status: IncidentRecord["status"];
  priority: IncidentRecord["priority"];
  incidentType: IncidentRecord["incidentType"];
  severity: IncidentRecord["severity"];
  incidentDate: string;
  incidentTime: string;
  reporterName: string;
  reporterEmail: string;
  department: string;
  location: string;
  description: string;
  immediateAction: string;
  injured: boolean;
  injuryDetails: string;
  contributingFactors: string;
  witnesses: string;
  evidenceUrls: IncidentEvidenceItem[];
  evidenceFiles?: IncidentEvidenceUploadFile[];
  assignedTo: string;
  assignedToEmail?: string;
  assignedToName?: string;
  assignedByEmail?: string;
  assignedByName?: string;
  assignedAt?: string;
  receivedByEmail?: string;
  receivedByName?: string;
  assignmentHistory?: IncidentRecord["assignmentHistory"];
  notificationStatus: string;
  statusHistory: IncidentRecord["statusHistory"];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  companyFolderId: string;
  masterSheetId?: string;
  companyName?: string;
};

export type SubmitCompanyIncidentResult = {
  ok: boolean;
  incident?: IncidentRecord;
  submitError?: string;
  evidenceUploadWarning?: string;
  companyFolderId?: string;
  masterSheetId?: string;
};

export type UploadIncidentEvidenceInput = {
  companyFolderId: string;
  incidentId: string;
  masterSheetId?: string;
  companyName?: string;
  files: Array<{ id: string; name: string; mimeType: string; dataUrl: string; addedAt: string }>;
};

export type UploadIncidentEvidenceResult = {
  ok: boolean;
  evidenceUrls: IncidentEvidenceItem[];
  uploadError?: string;
  warning?: string;
  partial?: boolean;
  folderPath?: string;
};

export async function uploadIncidentEvidence(
  input: UploadIncidentEvidenceInput,
): Promise<UploadIncidentEvidenceResult> {
  const companyFolderId = String(input.companyFolderId || "").trim();
  const incidentId = String(input.incidentId || "").trim();
  if (!companyFolderId || !incidentId) {
    return {
      ok: false,
      evidenceUrls: [],
      uploadError: COMPANY_INCIDENTS_EVIDENCE_UPLOAD_USER_MESSAGE,
    };
  }

  if (!input.files.length) {
    return { ok: true, evidenceUrls: [] };
  }

  try {
    const response = await fetch(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}/evidence`),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyFolderId,
          masterSheetId: input.masterSheetId,
          companyName: input.companyName,
          files: input.files,
        }),
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      evidenceUrls?: IncidentEvidenceItem[];
      message?: string;
      error?: string;
      warning?: string;
      partial?: boolean;
      folderPath?: string;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        evidenceUrls: [],
        uploadError: payload.message || payload.error || COMPANY_INCIDENTS_EVIDENCE_UPLOAD_USER_MESSAGE,
      };
    }

    const evidenceUrls = sanitizeEvidenceUrlsForWorkbook(
      Array.isArray(payload.evidenceUrls) ? payload.evidenceUrls : [],
    );
    return {
      ok: true,
      evidenceUrls,
      warning: payload.warning,
      partial: payload.partial,
      folderPath: payload.folderPath,
    };
  } catch (error) {
    return {
      ok: false,
      evidenceUrls: [],
      uploadError: error instanceof Error ? error.message : COMPANY_INCIDENTS_EVIDENCE_UPLOAD_USER_MESSAGE,
    };
  }
}

export async function submitCompanyIncident(
  input: SubmitCompanyIncidentInput,
): Promise<SubmitCompanyIncidentResult> {
  const companyFolderId = String(input.companyFolderId || "").trim();
  if (!companyFolderId) {
    return { ok: false, submitError: COMPANY_INCIDENTS_SUBMIT_USER_MESSAGE };
  }

  try {
    const serializableEvidenceFiles = prepareSerializableEvidenceUploadFiles(input.evidenceFiles);
    console.info("[incidents]", {
      phase: "client_submit_request",
      incidentId: input.incidentId,
      evidenceFileCount: serializableEvidenceFiles.length,
      evidenceDataUrlLengths: serializableEvidenceFiles.map((file) => file.dataUrl.length),
    });
    const response = await fetch(apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/incidents`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: input.id,
        incidentId: input.incidentId,
        status: input.status,
        priority: input.priority,
        incidentType: input.incidentType,
        severity: input.severity,
        incidentDate: input.incidentDate,
        incidentTime: input.incidentTime,
        reporterName: input.reporterName,
        reporterEmail: input.reporterEmail,
        department: input.department,
        location: input.location,
        description: input.description,
        immediateAction: input.immediateAction,
        witnesses: input.witnesses,
        evidenceUrls: sanitizeEvidenceUrlsForWorkbook(input.evidenceUrls),
        evidenceFiles: serializableEvidenceFiles,
        notificationStatus: input.notificationStatus,
        createdAt: input.createdAt,
        createdBy: input.createdBy,
        updatedAt: input.updatedAt,
        injured: input.injured,
        injuryDetails: input.injuryDetails,
        contributingFactors: input.contributingFactors,
        assignedTo: input.assignedTo,
        assignedToEmail: input.assignedToEmail,
        assignedToName: input.assignedToName || input.assignedTo,
        assignedByEmail: input.assignedByEmail,
        assignedByName: input.assignedByName,
        assignedAt: input.assignedAt,
        receivedByEmail: input.receivedByEmail,
        receivedByName: input.receivedByName,
        assignmentHistory: input.assignmentHistory || [],
        updatedBy: input.updatedBy,
        companyFolderId,
        masterSheetId: input.masterSheetId,
        companyName: input.companyName,
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      incident?: Record<string, unknown>;
      message?: string;
      error?: string;
      companyFolderId?: string;
      masterSheetId?: string;
      evidenceUploadWarning?: string;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        submitError: payload.message || payload.error || COMPANY_INCIDENTS_SUBMIT_USER_MESSAGE,
      };
    }

    const incident = payload.incident
      ? mapWorkbookIncidentRecord(payload.incident, input)
      : mapWorkbookIncidentRecord({}, input);

    return {
      ok: true,
      incident,
      evidenceUploadWarning: payload.evidenceUploadWarning,
      companyFolderId: payload.companyFolderId || companyFolderId,
      masterSheetId: payload.masterSheetId,
    };
  } catch (error) {
    return {
      ok: false,
      submitError: error instanceof Error ? error.message : COMPANY_INCIDENTS_SUBMIT_USER_MESSAGE,
    };
  }
}

export function mergeWorkbookAndLocalIncidents(
  workbookIncidents: IncidentRecord[],
  localIncidents: IncidentRecord[],
): IncidentRecord[] {
  const workbookIncidentIds = new Set(workbookIncidents.map((item) => item.incidentId).filter(Boolean));
  const pendingLocal = localIncidents.filter((item) => item.incidentId && !workbookIncidentIds.has(item.incidentId));
  const merged = [...workbookIncidents, ...pendingLocal];
  return merged.sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
}

/** @deprecated Prefer mergeWorkbookAndLocalIncidents */
export const mergeWorkbookIncidentsWithLocal = mergeWorkbookAndLocalIncidents;

export type ReassignCompanyIncidentInput = {
  companyFolderId: string;
  incidentId: string;
  toEmail: string;
  toName: string;
  toRole: string;
  reason?: string;
  masterSheetId?: string;
  companyName?: string;
};

export type ReassignCompanyIncidentResult = {
  ok: boolean;
  incident?: IncidentRecord;
  error?: string;
};

export async function reassignCompanyIncident(
  input: ReassignCompanyIncidentInput,
): Promise<ReassignCompanyIncidentResult> {
  const companyFolderId = String(input.companyFolderId || "").trim();
  const incidentId = String(input.incidentId || "").trim();
  if (!companyFolderId || !incidentId) {
    return { ok: false, error: "Incident context is required." };
  }

  try {
    const response = await fetch(
      apiUrl(
        `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}/reassign`,
      ),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyFolderId,
          incidentId,
          toEmail: input.toEmail,
          toName: input.toName,
          toRole: input.toRole,
          reason: input.reason || "",
          masterSheetId: input.masterSheetId,
          companyName: input.companyName,
        }),
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      incident?: Record<string, unknown>;
      message?: string;
      error?: string;
    };
    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        error: payload.message || payload.error || "Could not reassign this incident.",
      };
    }
    return {
      ok: true,
      incident: payload.incident ? mapWorkbookIncidentRecord(payload.incident) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reassign this incident.",
    };
  }
}
