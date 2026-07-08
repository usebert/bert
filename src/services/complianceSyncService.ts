import { apiUrl } from "../config/apiBase";
import { googleSheetsService } from "./googleSheetsService";
import type { AuditSubmissionSyncPayload } from "../types/complianceLoop";
import type { ActionItem } from "../types/reportsScreenProps";
import type { ReportItem } from "../types/reports";

type JsonResponse = Record<string, unknown> & { ok?: boolean; error?: string };

async function postJson<T extends JsonResponse>(path: string, body: Record<string, unknown>) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T;
  if (!response.ok || payload.ok === false) {
    const code = String((payload as { code?: unknown }).code || "").trim();
    const message = String(payload.error || (payload as { message?: unknown }).message || "Sync request failed.").trim();
    throw new Error(code ? `${code}: ${message}` : message);
  }
  return payload;
}

export async function syncAuditSubmissionToSheet(input: {
  sheetId: string;
  companyFolderId: string;
  evidenceFolderId?: string;
  submission: AuditSubmissionSyncPayload;
  sheetResult: Record<string, string>;
  sheetFindings: Record<string, string>[];
  sheetEvidence: Record<string, string>[];
  sheetSyncLog: Record<string, string>;
  localSubmissionId?: string;
}) {
  const { sheetId, companyFolderId, evidenceFolderId, sheetResult, sheetFindings, sheetEvidence, sheetSyncLog, localSubmissionId } = input;
  return googleSheetsService.syncAuditBundle(sheetId, {
    companyFolderId,
    evidenceFolderId: evidenceFolderId || "",
    localSubmissionId: localSubmissionId || "",
    results: [{ ...sheetResult, "Local Submission ID": localSubmissionId || sheetResult["Result ID"] || "" }],
    findings: sheetFindings.map((row) => ({ ...row, "Local Submission ID": localSubmissionId || "" })),
    evidence: sheetEvidence.map((row) => ({ ...row, "Local Submission ID": localSubmissionId || "" })),
    syncLogs: [{ ...sheetSyncLog, "Local Submission ID": localSubmissionId || "" }],
  });
}

export async function persistActionsToSheet(companyFolderId: string, actions: ActionItem[], masterSheetId = "") {
  const folderId = String(companyFolderId || "").trim();
  if (!folderId) {
    throw new Error("Company folder ID is required before saving actions.");
  }
  return postJson(`/api/companies/${encodeURIComponent(folderId)}/actions`, {
    companyFolderId: folderId,
    ...(masterSheetId ? { masterSheetId } : {}),
    actions,
  });
}

export async function persistReportToSheet(
  sheetId: string,
  companyFolderId: string,
  report: ReportItem,
  exportLink = "",
) {
  const timestamp = report.createdAt || new Date().toISOString();
  return postJson(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}/reports`, {
    companyFolderId,
    reports: [
      {
        "Report ID": report.id,
        "Company ID": companyFolderId,
        "Report Type": report.type,
        Title: report.title,
        "Created By": report.createdBy,
        "Created At": timestamp,
        "Visible To": (report.visibleTo || []).join(", "),
        "Export Links": exportLink,
        "Sync Status": "Synced",
        "Sync Attempts": 0,
        "Last Sync Error": "",
        "Remote Row ID": "",
        "Schema Version": "3.0.0",
      },
    ],
  });
}

export async function uploadEvidenceFilesToSheet(input: {
  sheetId: string;
  companyFolderId: string;
  evidenceFolderId?: string;
  records: Record<string, string>[];
}) {
  return googleSheetsService.appendEvidence(input.sheetId, input.companyFolderId, input.records);
}
