import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import type { Answer } from "../types/reportsScreenProps";
import type { NonConformanceRecord } from "../types/nonConformanceScreenProps";

export type PersistNcrInput = {
  reference: string;
  auditId: string;
  auditName: string;
  questionId: string;
  questionText: string;
  answer: string;
  note?: string;
  site?: string;
  auditorName: string;
  auditorUserId: string;
  assignedLineManager?: string;
  assignedLineManagerEmail?: string;
  raisedAt: string;
  resultId?: string;
  localSubmissionId?: string;
  status?: string;
};

function pickField(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const direct = String(record[key] || "").trim();
    if (direct) return direct;
    const match = Object.entries(record).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && String(match[1] || "").trim()) return String(match[1]).trim();
  }
  return "";
}

function normalizeClientNcrStatus(status: string): NonConformanceRecord["status"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "completed" || normalized === "closed" || normalized === "resolved") {
    return "Completed";
  }
  if (normalized === "in progress" || normalized === "in_progress") {
    return "In Progress";
  }
  return "Raised";
}

export function parseCompanySheetNcrs(
  records: Record<string, string>[],
  companyFolderId: string,
): NonConformanceRecord[] {
  return records
    .map((record) => {
      const rowCompany = pickField(record, ["Company Folder ID", "Company ID"]);
      if (rowCompany && rowCompany !== companyFolderId) {
        return null;
      }
      const archived = pickField(record, ["Archived"]).toLowerCase();
      if (archived === "true" || archived === "yes" || archived === "1") {
        return null;
      }
      const reference = pickField(record, ["Reference", "NCR ID"]);
      if (!reference) {
        return null;
      }
      const answer = pickField(record, ["Selected Answer", "Answer"]).toLowerCase();
      return {
        id: pickField(record, ["NCR ID"]) || reference,
        reference,
        auditId: pickField(record, ["Source Audit ID", "Audit ID"]),
        auditName: pickField(record, ["Source Audit Name", "Audit Name"]),
        auditQuestionId: pickField(record, ["Source Question ID", "Question ID"]),
        auditQuestion: pickField(record, ["Source Question Text", "Title"]) || pickField(record, ["Description"]),
        selectedAnswer: (answer === "fail" || answer === "nc" ? answer : "nc") as Answer,
        auditorName: pickField(record, ["Auditor Name", "Created By"]),
        auditorUserId: pickField(record, ["Auditor User ID", "Created By"]),
        site: pickField(record, ["Site", "Location"]),
        raisedAt: pickField(record, ["Raised At", "Created At"]),
        status: normalizeClientNcrStatus(pickField(record, ["Status"]) || "Raised"),
        assignedLineManager: pickField(record, ["Assigned Line Manager"]),
        assignedLineManagerUserId: pickField(record, ["Assigned Line Manager User ID"]),
        assignedLineManagerEmail: pickField(record, ["Assigned Line Manager Email"]),
        investigationIsoClause: "",
        investigationNotes: pickField(record, ["Description"]),
        rootCause: "",
        correctiveAction: "",
        investigationExtraNotes: "",
        evidence: [],
      } satisfies NonConformanceRecord;
    })
    .filter(Boolean) as NonConformanceRecord[];
}

export function mergeNonConformancesWithSheet(
  local: NonConformanceRecord[],
  fromSheet: NonConformanceRecord[],
): NonConformanceRecord[] {
  const sheetByReference = new Map(fromSheet.map((item) => [item.reference, item]));
  const merged = [...fromSheet];
  for (const item of local) {
    if (sheetByReference.has(item.reference)) {
      continue;
    }
    const duplicate = fromSheet.some(
      (sheetItem) => sheetItem.auditId === item.auditId && sheetItem.auditQuestionId === item.auditQuestionId,
    );
    if (duplicate) {
      continue;
    }
    merged.push(item);
  }
  return merged.sort((left, right) => right.raisedAt.localeCompare(left.raisedAt));
}

export async function persistNcrsToSheet(
  companyFolderId: string,
  ncrs: PersistNcrInput[],
  masterSheetId = "",
): Promise<{ ok: boolean; error?: string; code?: string }> {
  if (!companyFolderId.trim() || ncrs.length === 0) {
    return { ok: true };
  }
  try {
    const result = await fetchJson<{ ok?: boolean; error?: string; code?: string; message?: string }>(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/ncrs`),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ncrs, masterSheetId }),
      },
    );
    if (!result.ok) {
      return {
        ok: false,
        error: result.message || "Could not save non-conformance records.",
        code: "NCR_WRITE_FAILED",
      };
    }
    const payload = result.data;
    if (!payload.ok) {
      return {
        ok: false,
        error: payload.message || payload.error || "Could not save non-conformance records.",
        code: payload.code,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save non-conformance records.", code: "NCR_WRITE_FAILED" };
  }
}

export const NCR_SAFE_ERROR_CODES = {
  NCR_WRITE_FAILED: "Could not save the non-conformance record. Try again.",
  NCR_TAB_MISSING_HEADERS: "The company workbook NCR tab needs updating before records can be saved.",
  NCR_PAYLOAD_INVALID: "Non-conformance details were incomplete.",
  COMPANY_WORKBOOK_NOT_FOUND: "Company workbook is not linked.",
} as const;

export function ncrSafeErrorMessage(code?: string, fallback?: string) {
  if (code && code in NCR_SAFE_ERROR_CODES) {
    return NCR_SAFE_ERROR_CODES[code as keyof typeof NCR_SAFE_ERROR_CODES];
  }
  return fallback || NCR_SAFE_ERROR_CODES.NCR_WRITE_FAILED;
}
