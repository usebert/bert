import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  ControlledCompanyDocument,
  CreateDocumentInput,
  DocumentFolder,
  DocumentRevisionRecord,
  DocumentsListResponse,
  DocumentSettings,
  MasterDocumentIndexRow,
} from "../types/documents";

const cache = new Map<string, { at: number; data: DocumentsListResponse }>();
const CACHE_TTL_MS = 30_000;

function companyKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

async function documentsRequest(path: string, init?: RequestInit) {
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
    throw new Error(String(payload?.error || payload?.message || "Request failed."));
  }
  return payload;
}

export function invalidateDocumentsCache(companyFolderId: string) {
  cache.delete(companyKey(companyFolderId));
}

export async function fetchDocuments(
  companyFolderId: string,
  options: { folderRecordId?: string; includeArchived?: boolean; force?: boolean } = {},
): Promise<DocumentsListResponse> {
  const key = companyKey(companyFolderId);
  if (!options.force) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.data;
    }
  }
  const params = new URLSearchParams();
  if (options.folderRecordId) {
    params.set("folderRecordId", options.folderRecordId);
  }
  if (options.includeArchived) {
    params.set("includeArchived", "1");
  }
  const query = params.toString();
  const path = `/api/companies/${encodeURIComponent(key)}/documents${query ? `?${query}` : ""}`;
  const dedupeKey = requestDedupeKey("GET", path);
  const payload = (await dedupeInFlight(dedupeKey, () => documentsRequest(path))) as DocumentsListResponse;
  cache.set(key, { at: Date.now(), data: payload });
  return payload;
}

export async function searchDocuments(
  companyFolderId: string,
  query: string,
  options: { includeArchived?: boolean } = {},
): Promise<DocumentsListResponse & { query: string }> {
  const params = new URLSearchParams({ q: query });
  if (options.includeArchived) {
    params.set("includeArchived", "1");
  }
  const key = companyKey(companyFolderId);
  return documentsRequest(`/api/companies/${encodeURIComponent(key)}/documents/search?${params.toString()}`);
}

export async function fetchDocumentDetail(companyFolderId: string, documentId: string) {
  const key = companyKey(companyFolderId);
  return documentsRequest(`/api/companies/${encodeURIComponent(key)}/documents/${encodeURIComponent(documentId)}`) as Promise<{
    ok: true;
    document: ControlledCompanyDocument;
    revisions: DocumentRevisionRecord[];
    settings: DocumentSettings;
  }>;
}

export async function openDocumentFile(companyFolderId: string, documentId: string) {
  const key = companyKey(companyFolderId);
  return documentsRequest(
    `/api/companies/${encodeURIComponent(key)}/documents/${encodeURIComponent(documentId)}/file`,
  ) as Promise<{ ok: true; openUrl: string; fileName: string; mimeType: string; fileId: string }>;
}

export async function provisionDocumentFolders(companyFolderId: string) {
  const key = companyKey(companyFolderId);
  return documentsRequest(`/api/companies/${encodeURIComponent(key)}/document-folders/provision`, {
    method: "POST",
    body: JSON.stringify({}),
  }) as Promise<{ ok: true; summary: Record<string, number>; folders: DocumentFolder[] }>;
}

export async function createDocument(companyFolderId: string, input: CreateDocumentInput) {
  const key = companyKey(companyFolderId);
  const payload = await documentsRequest(`/api/companies/${encodeURIComponent(key)}/documents`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  invalidateDocumentsCache(key);
  return payload as { ok: true; document: ControlledCompanyDocument; revision: DocumentRevisionRecord };
}

export type { MasterDocumentIndexRow, DocumentFolder, ControlledCompanyDocument };
