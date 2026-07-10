import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import type { Answer } from "../types/reportsScreenProps";
import type {
  NonConformanceEvidence,
  NonConformanceRecord,
} from "../types/nonConformanceScreenProps";

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
  evidenceRefs?: unknown[];
};

function trim(value: unknown) {
  return String(value ?? "").trim();
}

function pickField(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const direct = String(record[key] || "").trim();
    if (direct) return direct;
    const match = Object.entries(record).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && String(match[1] || "").trim()) return String(match[1]).trim();
  }
  return "";
}

function sanitizeEvidenceRef(item: Record<string, unknown> = {}) {
  const driveLink = trim(item.driveLink || item.url || item.previewUrl);
  const safeDriveLink = driveLink.startsWith("data:") ? "" : driveLink;
  const next: Record<string, string> = {
    questionId: trim(item.questionId),
    evidenceId: trim(item.evidenceId || item.id),
    name: trim(item.name),
    mimeType: trim(item.mimeType) || "application/octet-stream",
    addedAt: trim(item.addedAt) || new Date().toISOString(),
  };
  const driveFileId = trim(item.driveFileId);
  if (driveFileId) {
    next.driveFileId = driveFileId;
  }
  if (safeDriveLink) {
    next.driveLink = safeDriveLink;
  }
  return next;
}

function sanitizeEvidenceRefs(evidenceRefs: unknown) {
  const items = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => sanitizeEvidenceRef(item))
    .filter((item) => item.evidenceId);
}

function filterEvidenceRefsForQuestion(evidenceRefs: unknown, questionId: string, options?: { fallbackToAll?: boolean }) {
  const target = trim(questionId);
  const items = sanitizeEvidenceRefs(evidenceRefs);
  if (!target) {
    return items;
  }
  const matched = items.filter((item) => trim(item.questionId) === target);
  if (matched.length > 0) {
    return matched;
  }
  const unscoped = items.filter((item) => !trim(item.questionId));
  if (unscoped.length > 0) {
    return unscoped;
  }
  if (options?.fallbackToAll !== false && items.length > 0) {
    return items;
  }
  return [];
}

function parseEvidenceRefs(raw: unknown) {
  if (Array.isArray(raw)) {
    return sanitizeEvidenceRefs(raw);
  }
  let text = trim(raw);
  if (!text) {
    return [];
  }
  if (text.startsWith("'")) {
    text = text.slice(1);
  }
  try {
    return sanitizeEvidenceRefs(JSON.parse(text));
  } catch {
    return [];
  }
}

function evidenceRefsToClientEvidence(evidenceRefs: Record<string, string>[]): NonConformanceEvidence[] {
  return evidenceRefs.map((ref) => {
    const driveLink = trim(ref.driveLink);
    const driveFileId = trim(ref.driveFileId);
    const previewUrl =
      driveLink ||
      (driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view` : "");
    return {
      id: ref.evidenceId,
      name: ref.name || ref.evidenceId || "Evidence file",
      previewUrl,
      addedAt: ref.addedAt || "",
      driveFileId: driveFileId || undefined,
      driveLink: driveLink || undefined,
      questionId: ref.questionId || undefined,
      mimeType: ref.mimeType || undefined,
      uploadStatus: previewUrl ? ("uploaded" as const) : ("pending" as const),
    };
  });
}

function mergeEvidenceLists(
  primary: NonConformanceEvidence[] = [],
  secondary: NonConformanceEvidence[] = [],
): NonConformanceEvidence[] {
  const merged: NonConformanceEvidence[] = [];
  const seen = new Map<string, NonConformanceEvidence>();
  for (const item of [...primary, ...secondary]) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = trim(item.id);
    const key = id || `${trim(item.name)}::${trim(item.previewUrl || item.driveLink)}`;
    if (!key) {
      continue;
    }
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      merged.push(item);
      continue;
    }
    const richer: NonConformanceEvidence = {
      ...existing,
      ...item,
      previewUrl: trim(item.previewUrl) || trim(existing.previewUrl) || "",
      driveLink: trim(item.driveLink) || trim(existing.driveLink) || undefined,
      driveFileId: trim(item.driveFileId) || trim(existing.driveFileId) || undefined,
      name: trim(item.name) || trim(existing.name) || "Evidence file",
      uploadStatus:
        item.uploadStatus === "uploaded" || existing.uploadStatus === "uploaded"
          ? "uploaded"
          : item.uploadStatus || existing.uploadStatus || "pending",
    };
    seen.set(key, richer);
    const index = merged.findIndex((entry) => {
      const entryKey = trim(entry.id) || `${trim(entry.name)}::${trim(entry.previewUrl || entry.driveLink)}`;
      return entryKey === key;
    });
    if (index >= 0) {
      merged[index] = richer;
    }
  }
  return merged;
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

function resolveEvidenceUploadStatus(
  evidence: NonConformanceEvidence[],
): NonConformanceRecord["evidenceUploadStatus"] {
  if (!evidence.length) {
    return "none";
  }
  if (evidence.some((item) => item.uploadStatus === "failed")) {
    return "failed";
  }
  const isUploaded = (item: NonConformanceEvidence) =>
    Boolean(item.driveLink || item.driveFileId) ||
    (Boolean(item.previewUrl) &&
      !item.previewUrl.startsWith("blob:") &&
      !item.previewUrl.startsWith("data:") &&
      item.uploadStatus !== "pending");
  if (evidence.every(isUploaded)) {
    return "uploaded";
  }
  return "pending";
}

export function auditEvidenceToNcrEvidence(
  evidenceRefs: unknown[] | null | undefined,
  questionId = "",
): NonConformanceEvidence[] {
  const scoped = filterEvidenceRefsForQuestion(evidenceRefs || [], questionId, { fallbackToAll: true });
  return evidenceRefsToClientEvidence(scoped);
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
      const questionId = pickField(record, ["Source Question ID", "Question ID"]);
      let evidence = auditEvidenceToNcrEvidence(
        parseEvidenceRefs(pickField(record, ["Evidence Refs", "EvidenceRefs"])),
        questionId,
      );
      const evidenceCountRaw = Number(pickField(record, ["Evidence Count", "EvidenceCount"]) || 0);
      if (evidence.length === 0 && Number.isFinite(evidenceCountRaw) && evidenceCountRaw > 0) {
        evidence = Array.from({ length: evidenceCountRaw }, (_, index) => ({
          id: `${reference}-pending-${index + 1}`,
          name: `Evidence ${index + 1}`,
          previewUrl: "",
          addedAt: "",
          uploadStatus: "pending" as const,
        }));
      }
      return {
        id: pickField(record, ["NCR ID"]) || reference,
        reference,
        auditId: pickField(record, ["Source Audit ID", "Audit ID"]),
        auditName,
        auditQuestionId: questionId,
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
        evidence,
        resultId: pickField(record, ["Result ID", "Source Result ID"]) || undefined,
        evidenceUploadStatus: resolveEvidenceUploadStatus(evidence),
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
  resultId?: string;
  evidence?: unknown[];
  evidenceRefs?: unknown[];
  evidenceCount?: number;
};

export function mergeSheetNcrsIntoState(
  current: NonConformanceRecord[],
  sheetRecords: Record<string, string>[],
  companyFolderId: string,
): NonConformanceRecord[] {
  const fromSheet = parseCompanySheetNcrs(sheetRecords, companyFolderId);
  const localByReference = new Map(current.map((item) => [item.reference, item]));
  const mergedFromSheet = fromSheet.map((sheetItem) => {
    const local = localByReference.get(sheetItem.reference);
    if (!local) {
      return sheetItem;
    }
    // Prefer richer local evidence (blob previews / pending stubs) over empty sheet rows.
    const evidence = mergeEvidenceLists(local.evidence, sheetItem.evidence);
    return {
      ...sheetItem,
      ...local,
      ...sheetItem,
      evidence,
      evidenceUploadStatus: resolveEvidenceUploadStatus(evidence),
      resultId: sheetItem.resultId || local.resultId,
      investigationNotes: sheetItem.investigationNotes || local.investigationNotes,
      auditQuestion: sheetItem.auditQuestion || local.auditQuestion,
    };
  });
  const localForFolder = current.filter(
    (item) => !fromSheet.some((sheetItem) => sheetItem.reference === item.reference),
  );
  return mergeNonConformancesWithSheet(localForFolder, mergedFromSheet);
}

/** Collect local + server evidence for an NCR, falling back to all check evidence. */
export function collectNcrEvidenceFromSources(input: {
  questionId: string;
  evidenceMap?: Record<string, Array<{ id: string; name: string; previewUrl: string; addedAt: string; mimeType?: string }>>;
  evidenceRefs?: unknown[];
  serverEvidence?: unknown[];
  evidenceUploadFailed?: boolean;
}): NonConformanceEvidence[] {
  const questionId = trim(input.questionId);
  const fromServer = Array.isArray(input.serverEvidence)
    ? (input.serverEvidence as Array<Record<string, unknown>>).map((item) => ({
        id: String(item.id || item.name || `evidence-${questionId}`).trim(),
        name: String(item.name || item.id || "Evidence file").trim(),
        previewUrl: String(item.previewUrl || item.driveLink || "").trim(),
        addedAt: String(item.addedAt || "").trim(),
        driveFileId: String(item.driveFileId || "").trim() || undefined,
        driveLink: String(item.driveLink || "").trim() || undefined,
        questionId: String(item.questionId || questionId).trim() || questionId,
        mimeType: String(item.mimeType || "").trim() || undefined,
        uploadStatus:
          item.uploadStatus === "failed" || item.uploadStatus === "pending" || item.uploadStatus === "uploaded"
            ? (item.uploadStatus as NonConformanceEvidence["uploadStatus"])
            : String(item.previewUrl || item.driveLink || item.driveFileId || "").trim()
              ? ("uploaded" as const)
              : ("pending" as const),
      }))
    : auditEvidenceToNcrEvidence(input.evidenceRefs, questionId);
  const fromPayload = auditEvidenceToNcrEvidence(input.evidenceRefs, questionId);
  const map = input.evidenceMap || {};
  const localForQuestion = map[questionId] || [];
  const localAll = Object.values(map).flat();
  const localSource = localForQuestion.length > 0 ? localForQuestion : localAll;
  const localItems: NonConformanceEvidence[] = localSource.map((item) => ({
    id: item.id,
    name: item.name,
    previewUrl: item.previewUrl,
    addedAt: item.addedAt,
    questionId,
    mimeType: item.mimeType,
    uploadStatus:
      input.evidenceUploadFailed
        ? ("failed" as const)
        : item.previewUrl && !item.previewUrl.startsWith("blob:")
          ? ("uploaded" as const)
          : ("pending" as const),
  }));
  return mergeEvidenceLists(mergeEvidenceLists(fromServer, fromPayload), localItems);
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
  resultId?: string;
  evidence?: NonConformanceEvidence[];
  evidenceUploadStatus?: NonConformanceRecord["evidenceUploadStatus"];
};

export function buildNonConformanceFromCompletionContext(
  context: BuildCompletionNcrContext,
): NonConformanceRecord {
  const note = String(context.note || "").trim();
  const questionText = String(context.questionText || "").trim();
  const evidence = Array.isArray(context.evidence) ? context.evidence : [];
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
    evidence,
    resultId: context.resultId,
    evidenceUploadStatus: context.evidenceUploadStatus || resolveEvidenceUploadStatus(evidence),
  };
}

export function mergeCompletionNcrsIntoState(
  current: NonConformanceRecord[],
  records: NonConformanceRecord[],
): NonConformanceRecord[] {
  if (records.length === 0) {
    return current;
  }
  const byReference = new Map(current.map((item) => [item.reference, item]));
  for (const record of records) {
    if (!record.reference) {
      continue;
    }
    const existing = byReference.get(record.reference);
    if (!existing) {
      byReference.set(record.reference, record);
      continue;
    }
    const evidence = mergeEvidenceLists(record.evidence, existing.evidence);
    byReference.set(record.reference, {
      ...existing,
      ...record,
      evidence,
      evidenceUploadStatus: resolveEvidenceUploadStatus(evidence),
      resultId: record.resultId || existing.resultId,
    });
  }
  return Array.from(byReference.values()).sort((left, right) => right.raisedAt.localeCompare(left.raisedAt));
}

export function attachEvidenceRefsToNcrs(
  ncrs: NonConformanceRecord[],
  evidenceRefs: unknown[] | null | undefined,
  options?: { resultId?: string; evidenceUploadStatus?: NonConformanceRecord["evidenceUploadStatus"] },
): NonConformanceRecord[] {
  if (!Array.isArray(ncrs) || ncrs.length === 0) {
    return ncrs;
  }
  return ncrs.map((ncr) => {
    const fromRefs = auditEvidenceToNcrEvidence(evidenceRefs, ncr.auditQuestionId);
    const evidence = mergeEvidenceLists(fromRefs, ncr.evidence);
    return {
      ...ncr,
      resultId: options?.resultId || ncr.resultId,
      evidence,
      evidenceUploadStatus: options?.evidenceUploadStatus || resolveEvidenceUploadStatus(evidence),
    };
  });
}

export function resolveNcrEvidenceFromAuditResult(input: {
  ncr: NonConformanceRecord;
  auditEvidenceRefs?: unknown[] | null;
}): NonConformanceEvidence[] {
  const direct = Array.isArray(input.ncr.evidence) ? input.ncr.evidence : [];
  const fromAudit = auditEvidenceToNcrEvidence(input.auditEvidenceRefs, input.ncr.auditQuestionId);
  return mergeEvidenceLists(direct, fromAudit);
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
    evidenceLinkedCount: parsedFromSheet.filter((item) => item.evidence.length > 0).length,
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
  NCR_EVIDENCE_LINK_FAILED: "Non-conformance recorded, but evidence could not be linked yet.",
  EVIDENCE_UPLOAD_FAILED: "Evidence could not be uploaded. Please add evidence from this NCR.",
  EVIDENCE_PENDING_UPLOAD: "Evidence upload pending.",
  EVIDENCE_FILE_NOT_FOUND: "Evidence file could not be found.",
} as const;

export function ncrSafeErrorMessage(code?: string, fallback?: string) {
  if (code && code in NCR_SAFE_ERROR_CODES) {
    return NCR_SAFE_ERROR_CODES[code as keyof typeof NCR_SAFE_ERROR_CODES];
  }
  return fallback || NCR_SAFE_ERROR_CODES.NCR_WRITE_FAILED;
}

export const NCR_EVIDENCE_PENDING_MESSAGE = "Evidence upload pending";
export const NCR_EVIDENCE_FAILED_MESSAGE =
  "Evidence could not be uploaded. Please add evidence from this NCR.";
export const CHECK_EVIDENCE_STILL_UPLOADING_MESSAGE = "Evidence is still uploading.";
