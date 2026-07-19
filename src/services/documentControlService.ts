/**
 * Document Control client service — company-scoped reads with in-flight dedupe
 * and a small in-memory cache. Never preloaded at login.
 */
import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  CreateControlledDocumentInput,
  CreateDocumentRevisionInput,
  DocumentControlDocumentResponse,
  DocumentControlDocumentsListResponse,
  DocumentControlIndexResponse,
  DocumentControlIndexRow,
  DocumentRevisionFileResponse,
  RejectDocumentRevisionInput,
  UpdateControlledDocumentInput,
} from "../types/documentControl";

export const DOCUMENT_CONTROL_LOAD_USER_MESSAGE = "Could not load controlled documents.";
export const DOCUMENT_CONTROL_OFFLINE_WRITE_MESSAGE =
  "You appear to be offline. Document Control changes need a connection — please try again when you are back online.";

async function documentControlRequest(path: string, init?: RequestInit) {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const baseMessage = String(payload?.error || payload?.message || "Request failed.");
    const details = String(payload?.details || "").trim();
    const error = new Error(details ? `${baseMessage} ${details}` : baseMessage) as Error & {
      code?: string;
      warning?: DocumentRevisionFileResponse["warning"];
    };
    error.code = String(payload?.code || "");
    if (payload?.warning) {
      error.warning = payload.warning;
    }
    throw error;
  }
  return payload;
}

type CachedList<T> = { companyFolderId: string; data: T };

const documentsCache = new Map<string, CachedList<DocumentControlDocumentsListResponse>>();
const indexCache = new Map<string, CachedList<DocumentControlIndexResponse>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

function mapIndexRow(raw: Record<string, unknown>): DocumentControlIndexRow {
  return {
    documentNumber: String(raw.DocumentNumber || raw.documentNumber || ""),
    title: String(raw.Title || raw.title || ""),
    documentType: String(raw.DocumentType || raw.documentType || ""),
    department: String(raw.Department || raw.department || ""),
    owner: String(raw.Owner || raw.owner || ""),
    standard: String(raw.Standard || raw.standard || ""),
    clauseReferences: String(raw.ClauseReferences || raw.clauseReferences || ""),
    currentRevision: String(raw.CurrentRevision || raw.currentRevision || ""),
    issueDate: String(raw.IssueDate || raw.issueDate || ""),
    effectiveDate: String(raw.EffectiveDate || raw.effectiveDate || ""),
    nextReviewDate: String(raw.NextReviewDate || raw.nextReviewDate || ""),
    approvalStatus: String(raw.ApprovalStatus || raw.approvalStatus || ""),
    documentStatus: String(raw.DocumentStatus || raw.documentStatus || ""),
    currentFileUrl: String(raw.CurrentFileUrl || raw.currentFileUrl || ""),
    lastUpdatedAt: String(raw.LastUpdatedAt || raw.lastUpdatedAt || ""),
    lastUpdatedBy: String(raw.LastUpdatedBy || raw.lastUpdatedBy || ""),
  };
}

/** Last successful document list for this company, or null. Never crosses companies. */
export function readCachedDocumentControlDocuments(companyFolderId: string): DocumentControlDocumentsListResponse | null {
  const entry = documentsCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function invalidateDocumentControlCache(companyFolderId?: string) {
  if (companyFolderId === undefined) {
    documentsCache.clear();
    indexCache.clear();
    return;
  }
  const key = cacheKey(companyFolderId);
  documentsCache.delete(key);
  indexCache.delete(key);
}

export async function fetchDocumentControlDocuments(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean; status?: string; includeArchived?: boolean } = {},
): Promise<DocumentControlDocumentsListResponse> {
  const folderId = cacheKey(companyFolderId);
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.includeArchived) {
    params.set("includeArchived", "1");
  }
  const query = params.toString();
  const path = `/api/companies/${encodeURIComponent(folderId)}/document-control/documents${query ? `?${query}` : ""}`;
  const run = async () => {
    const payload = (await documentControlRequest(path, { signal: options.signal })) as DocumentControlDocumentsListResponse;
    documentsCache.set(folderId, { companyFolderId: folderId, data: payload });
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<DocumentControlDocumentsListResponse>;
}

export async function fetchDocumentControlDocument(
  companyFolderId: string,
  documentId: string,
): Promise<DocumentControlDocumentResponse> {
  return documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}`,
  ) as Promise<DocumentControlDocumentResponse>;
}

export async function createControlledDocument(companyFolderId: string, input: CreateControlledDocumentInput) {
  const result = (await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents`,
    { method: "POST", body: JSON.stringify(input) },
  )) as DocumentControlDocumentResponse;
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function updateControlledDocument(
  companyFolderId: string,
  documentId: string,
  input: UpdateControlledDocumentInput,
) {
  const result = (await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  )) as DocumentControlDocumentResponse;
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function archiveControlledDocument(companyFolderId: string, documentId: string) {
  const result = (await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}/archive`,
    { method: "POST", body: JSON.stringify({}) },
  )) as DocumentControlDocumentResponse;
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function restoreControlledDocument(companyFolderId: string, documentId: string) {
  const result = (await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}/restore`,
    { method: "POST", body: JSON.stringify({}) },
  )) as DocumentControlDocumentResponse;
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function createDocumentRevision(
  companyFolderId: string,
  documentId: string,
  input: CreateDocumentRevisionInput,
) {
  const result = await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/documents/${encodeURIComponent(documentId)}/revisions`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function submitDocumentRevision(companyFolderId: string, revisionId: string) {
  const result = await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/submit`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function approveDocumentRevision(companyFolderId: string, revisionId: string) {
  const result = await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/approve`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function rejectDocumentRevision(
  companyFolderId: string,
  revisionId: string,
  input: RejectDocumentRevisionInput = {},
) {
  const result = await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/reject`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateDocumentControlCache(companyFolderId);
  return result;
}

export async function fetchDocumentRevisionFile(
  companyFolderId: string,
  revisionId: string,
  options: { acknowledge?: boolean } = {},
): Promise<DocumentRevisionFileResponse> {
  const params = options.acknowledge ? "?acknowledge=1" : "";
  return documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/revisions/${encodeURIComponent(revisionId)}/file${params}`,
  ) as Promise<DocumentRevisionFileResponse>;
}

export async function fetchDocumentControlIndex(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<DocumentControlIndexResponse> {
  const folderId = cacheKey(companyFolderId);
  const path = `/api/companies/${encodeURIComponent(folderId)}/document-control/index`;
  const run = async () => {
    const payload = (await documentControlRequest(path, { signal: options.signal })) as DocumentControlIndexResponse & {
      index?: Record<string, unknown>[];
    };
    const mapped = {
      ...payload,
      index: (payload.index || []).map((row) => mapIndexRow(row)),
    };
    indexCache.set(folderId, { companyFolderId: folderId, data: mapped });
    return mapped;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<DocumentControlIndexResponse>;
}

export async function rebuildDocumentControlIndex(companyFolderId: string) {
  const payload = (await documentControlRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/document-control/index/rebuild`,
    { method: "POST", body: JSON.stringify({}) },
  )) as DocumentControlIndexResponse & { index?: Record<string, unknown>[] };
  const mapped = {
    ...payload,
    index: (payload.index || []).map((row) => mapIndexRow(row)),
  };
  invalidateDocumentControlCache(companyFolderId);
  indexCache.set(cacheKey(companyFolderId), { companyFolderId: cacheKey(companyFolderId), data: mapped });
  return mapped;
}
