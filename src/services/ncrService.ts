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
  if (
    !normalized ||
    normalized === "open" ||
    normalized === "raised" ||
    normalized === "logged" ||
    normalized === "pending"
  ) {
    return "Raised";
  }
  return "Raised";
}

function deriveNcrQuestionLabel(
  record: Record<string, string>,
  auditName = "",
  questionText = "",
  description = "",
): string {
  const trimmedQuestion = questionText.trim();
  if (trimmedQuestion) {
    return trimmedQuestion;
  }
  const trimmedAudit = auditName.trim() || pickField(record, ["Source Audit Name", "Audit Name"]);
  const trimmedDescription = description.trim() || pickField(record, ["Description"]);
  if (trimmedAudit && trimmedDescription) {
    return `${trimmedAudit} - ${trimmedDescription}`;
  }
  if (trimmedAudit) {
    return trimmedAudit;
  }
  return trimmedDescription;
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
      const status = pickField(record, ["Status"]).toLowerCase();
      if (archived === "true" || archived === "yes" || archived === "1") {
        return null;
      }
      if (status === "archived") {
        return null;
      }
      const reference = pickField(record, ["Reference", "NCR ID"]);
      if (!reference) {
        return null;
      }
      const answer = pickField(record, ["Selected Answer", "Answer"]).toLowerCase();
      const auditName = pickField(record, ["Source Audit Name", "Audit Name"]);
      const questionText = pickField(record, ["Source Question Text", "Title"]);
      const description = pickField(record, ["Description"]);
      return {
        id: pickField(record, ["NCR ID"]) || reference,
        reference,
        auditId: pickField(record, ["Source Audit ID", "Audit ID"]),
        auditName,
        auditQuestionId: pickField(record, ["Source Question ID", "Question ID"]),
        auditQuestion: deriveNcrQuestionLabel(record, auditName, questionText, description),
        selectedAnswer: (answer === "fail" || answer === "nc" ? answer : "nc") as Answer,
        auditorName: pickField(record, ["Auditor Name", "Created By"]),
        auditorUserId: pickField(record, ["Auditor User ID", "Created By"]),
        site: pickField(record, ["Site", "Location"]),
        raisedAt: pickField(record, ["Raised At", "Created At"]),
        status: normalizeClientNcrStatus(pickField(record, ["Status"]) || "Open"),
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

export type CompletionNcrSummary = {
  ncrId?: string;
  reference?: string;
  auditId?: string;
  questionId?: string;
  status?: string;
};

export function mergeSheetNcrsIntoState(
  current: NonConformanceRecord[],
  sheetRecords: Record<string, string>[],
  companyFolderId: string,
): NonConformanceRecord[] {
  const fromSheet = parseCompanySheetNcrs(sheetRecords, companyFolderId);
  const localForFolder = current.filter(
    (item) => !fromSheet.some((sheetItem) => sheetItem.reference === item.reference),
  );
  return mergeNonConformancesWithSheet(localForFolder, fromSheet);
}

export type BuildCompletionNcrContext = {
  auditId: string;
  auditName: string;
  siteArea?: string;
  questionId: string;
  questionText?: string;
  answer: Answer;
  note?: string;
  auditorName: string;
  auditorUserId: string;
  assignedLineManager: string;
  assignedLineManagerUserId: string;
  assignedLineManagerEmail: string;
  raisedAt: string;
  reference: string;
  entryAuditId?: string;
};

export function buildNonConformanceFromCompletionContext(
  context: BuildCompletionNcrContext,
): NonConformanceRecord {
  const note = String(context.note || "").trim();
  const questionText = String(context.questionText || "").trim();
  return {
    id: context.reference,
    reference: context.reference,
    auditId: String(context.entryAuditId || context.auditId).trim() || context.auditId,
    auditName: context.auditName,
    auditQuestionId: context.questionId,
    auditQuestion:
      questionText || (context.auditName ? `${context.auditName}${note ? ` - ${note}` : ""}` : note),
    selectedAnswer: context.answer,
    auditorName: context.auditorName,
    auditorUserId: context.auditorUserId,
    site: context.siteArea || "",
    raisedAt: context.raisedAt,
    status: "Raised",
    assignedLineManager: context.assignedLineManager,
    assignedLineManagerUserId: context.assignedLineManagerUserId,
    assignedLineManagerEmail: context.assignedLineManagerEmail,
    investigationIsoClause: "",
    investigationNotes: note,
    rootCause: "",
    correctiveAction: "",
    investigationExtraNotes: "",
    evidence: [],
  };
}

export function mergeCompletionNcrsIntoState(
  current: NonConformanceRecord[],
  records: NonConformanceRecord[],
): NonConformanceRecord[] {
  if (records.length === 0) {
    return current;
  }
  const existingReferences = new Set(current.map((item) => item.reference));
  const next = [...current];
  for (const record of records) {
    if (!record.reference || existingReferences.has(record.reference)) {
      continue;
    }
    next.unshift(record);
    existingReferences.add(record.reference);
  }
  return next.sort((left, right) => right.raisedAt.localeCompare(left.raisedAt));
}

/** Verifier/dev helper — safe counts only, no row payloads. */
export function summarizeNcrVisibilityPipeline(input: {
  sheetRecords: Record<string, string>[];
  companyFolderId: string;
  merged: NonConformanceRecord[];
  visible: NonConformanceRecord[];
}) {
  const parsedFromSheet = parseCompanySheetNcrs(input.sheetRecords, input.companyFolderId);
  return {
    sheetRowCount: input.sheetRecords.length,
    parsedFromSheetCount: parsedFromSheet.length,
    mergedStateCount: input.merged.length,
    visibleAfterFilterCount: input.visible.length,
  };
}

export function resolveNcrCompletionOutcome(input: {
  issuesFound: number;
  localCreatedCount: number;
  serverNcrs?: CompletionNcrSummary[];
  ncrWriteWarning?: string;
}): { ncrsRecorded: number; ncrWriteFailed: boolean } {
  const serverCount = Array.isArray(input.serverNcrs) ? input.serverNcrs.length : 0;
  const ncrsRecorded = Math.max(input.localCreatedCount, serverCount);
  const ncrWriteFailed =
    input.issuesFound > 0 &&
    ncrsRecorded === 0 &&
    (Boolean(String(input.ncrWriteWarning || "").trim()) || serverCount === 0);
  return { ncrsRecorded, ncrWriteFailed };
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
  NCR_DUPLICATE_SKIPPED: "This non-conformance was already recorded for this check.",
} as const;

export function ncrSafeErrorMessage(code?: string, fallback?: string) {
  if (code && code in NCR_SAFE_ERROR_CODES) {
    return NCR_SAFE_ERROR_CODES[code as keyof typeof NCR_SAFE_ERROR_CODES];
  }
  return fallback || NCR_SAFE_ERROR_CODES.NCR_WRITE_FAILED;
}
