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
  code?: string;
  error?: string;
  message?: string;
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

export async function fetchCompanyArchive(
  companyFolderId: string,
  options: { masterSheetId?: string } = {},
): Promise<ArchiveListResponse> {
  const params = new URLSearchParams();
  if (options.masterSheetId) params.set("masterSheetId", options.masterSheetId);
  const query = params.toString();
  return fetchJson<ArchiveListResponse>(
    apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/archive${query ? `?${query}` : ""}`),
  );
}

export async function archiveCompanyRecord(
  companyFolderId: string,
  payload: { type: string; id: string; reason?: string; masterSheetId?: string },
): Promise<ArchiveMutationResponse> {
  return fetchJson<ArchiveMutationResponse>(apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/archive`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function restoreCompanyRecord(
  companyFolderId: string,
  payload: { type: string; id: string; masterSheetId?: string },
): Promise<ArchiveMutationResponse> {
  return fetchJson<ArchiveMutationResponse>(apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/restore`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export const ARCHIVE_OFFLINE_MESSAGE = "Archiving needs a connection.";
export const RESTORE_OFFLINE_MESSAGE = "Restoring needs a connection.";
