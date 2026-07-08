import { apiUrl } from "../config/apiBase";

type JsonResponse = Record<string, unknown> & { ok?: boolean; error?: string };

async function parseResponse<T extends JsonResponse>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Google Sheets request failed.");
  }
  return payload;
}

async function postJson<T extends JsonResponse>(path: string, body: Record<string, unknown>) {
  return parseResponse<T>(
    await fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export const googleSheetsService = {
  validateWorkspace<T extends JsonResponse>(sheetId: string, body: Record<string, unknown>) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/validate`, body);
  },
  repairWorkspace<T extends JsonResponse>(sheetId: string, body: Record<string, unknown>) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/repair`, body);
  },
  saveSchedules<T extends JsonResponse>(sheetId: string, companyFolderId: string, schedules: unknown[]) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/schedules`, {
      companyFolderId,
      schedules,
    });
  },
  saveActions<T extends JsonResponse>(companyFolderId: string, actions: unknown[], masterSheetId = "") {
    const folderId = String(companyFolderId || "").trim();
    return postJson<T>(`/api/companies/${encodeURIComponent(folderId)}/actions`, {
      companyFolderId: folderId,
      ...(masterSheetId ? { masterSheetId } : {}),
      actions,
    });
  },
  appendActionComments<T extends JsonResponse>(sheetId: string, companyFolderId: string, comments: unknown[]) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/action-comments`, {
      companyFolderId,
      comments,
    });
  },
  appendAuditResults<T extends JsonResponse>(sheetId: string, companyFolderId: string, results: unknown[]) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/audit-results`, {
      companyFolderId,
      results,
    });
  },
  appendAuditFindings<T extends JsonResponse>(sheetId: string, companyFolderId: string, findings: unknown[]) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/audit-findings`, {
      companyFolderId,
      findings,
    });
  },
  appendEvidence<T extends JsonResponse>(
    sheetId: string,
    companyFolderId: string,
    evidence: unknown[],
    evidenceFolderId = "",
  ) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/evidence`, {
      companyFolderId,
      evidence,
      evidenceFolderId,
    });
  },
  appendSyncLog<T extends JsonResponse>(sheetId: string, companyFolderId: string, entries: unknown[]) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/sync-log`, {
      companyFolderId,
      entries,
    });
  },
  appendReports<T extends JsonResponse>(sheetId: string, companyFolderId: string, reports: unknown[]) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/reports`, {
      companyFolderId,
      reports,
    });
  },
  syncAuditBundle<T extends JsonResponse>(
    sheetId: string,
    body: {
      companyFolderId: string;
      evidenceFolderId?: string;
      localSubmissionId?: string;
      results: unknown[];
      findings: unknown[];
      evidence: unknown[];
      actionComments?: unknown[];
      syncLogs?: unknown[];
    },
  ) {
    return postJson<T>(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/audit-bundle`, body);
  },
};
