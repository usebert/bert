import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import type { ArchiveSectionId } from "../types/archive";

export type ArchivedListItem = {
  id: string;
  type: string;
  title: string;
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  status?: string;
  formNumber?: string;
  revisionNumber?: string;
  site?: string;
  department?: string;
  email?: string;
  role?: string;
};

export type ArchiveListResponse = {
  ok: boolean;
  sections?: Partial<Record<ArchiveSectionId, ArchivedListItem[]>>;
  counts?: Partial<Record<ArchiveSectionId, number>>;
  companyFolderId?: string;
  masterSheetId?: string;
  diagnostics?: ArchiveListDiagnostics;
  code?: string;
  error?: string;
  message?: string;
};

export type ArchiveListDiagnostics = {
  workbookAuditRows?: number;
  sessionAuditRows?: number;
  returnedAuditRows?: number;
  sectionKey?: string;
  masterSheetIdPresent?: boolean;
};

export type ArchiveMutationResponse = {
  ok: boolean;
  type?: string;
  id?: string;
  archived?: boolean;
  restored?: boolean;
  reactivated?: boolean;
  code?: string;
  error?: string;
  message?: string;
};

function unwrapArchivePayload<T extends { ok?: boolean; error?: string; message?: string; code?: string }>(
  result: Awaited<ReturnType<typeof fetchJson<T>>>,
  fallbackMessage: string,
): T {
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      error: result.message || fallbackMessage,
      message: result.message || fallbackMessage,
    } as T;
  }
  const payload = result.data || ({} as T);
  if (!result.response.ok || payload.ok === false) {
    return {
      ...payload,
      ok: false,
      code: payload.code,
      error: payload.error || payload.message || fallbackMessage,
      message: payload.message || payload.error || fallbackMessage,
    };
  }
  return { ...payload, ok: true };
}

export async function fetchCompanyArchive(
  companyFolderId: string,
  options: { masterSheetId?: string; debugArchive?: boolean } = {},
): Promise<ArchiveListResponse> {
  const params = new URLSearchParams();
  if (options.masterSheetId) params.set("masterSheetId", options.masterSheetId);
  if (options.debugArchive) params.set("debugArchive", "1");
  const query = params.toString();
  const result = await fetchJson<ArchiveListResponse>(
    apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/archive${query ? `?${query}` : ""}`),
  );
  return unwrapArchivePayload(result, "Could not load archived records.");
}

export async function archiveCompanyRecord(
  companyFolderId: string,
  payload: { type: string; id: string; reason?: string; masterSheetId?: string },
): Promise<ArchiveMutationResponse> {
  const result = await fetchJson<ArchiveMutationResponse>(
    apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/archive`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return unwrapArchivePayload(result, "Could not archive item. Try again.");
}

export async function restoreCompanyRecord(
  companyFolderId: string,
  payload: { type: string; id: string; masterSheetId?: string },
): Promise<ArchiveMutationResponse> {
  const result = await fetchJson<ArchiveMutationResponse>(
    apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/restore`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return unwrapArchivePayload(result, "Could not restore item. Try again.");
}

export const ARCHIVE_OFFLINE_MESSAGE = "Archiving needs a connection.";
export const RESTORE_OFFLINE_MESSAGE = "Restoring needs a connection.";
