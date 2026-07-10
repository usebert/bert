/**
 * Non-conformance (NCR) workbook helpers — shared server + client.
 */

export const NCR_TAB = "NCRs";

export const NCR_TAB_COLUMNS = [
  "NCR ID",
  "Reference",
  "Company ID",
  "Company Folder ID",
  "Source Audit ID",
  "Source Audit Name",
  "Source Question ID",
  "Source Question Text",
  "Selected Answer",
  "Title",
  "Description",
  "Status",
  "Site",
  "Auditor Name",
  "Auditor User ID",
  "Assigned Line Manager",
  "Assigned Line Manager Email",
  "Raised At",
  "Created At",
  "Updated At",
  "Created By",
  "Archived",
  "Archived At",
  "Archived By",
  "Archive Reason",
  "Result ID",
  "Local Submission ID",
  "Evidence Refs",
  "Evidence Count",
];

const CLOSED_STATUSES = new Set(["closed", "resolved", "complete", "completed", "cancelled", "verified"]);

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, keys = []) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) return direct;
    const match = Object.entries(record).find(([header]) => safeLower(header) === safeLower(key));
    if (match && trim(match[1])) return trim(match[1]);
  }
  return "";
}

export function parseNcrReferenceSequence(reference) {
  const match = trim(reference).match(/^NCR-(\d+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function formatNcrReference(sequence) {
  return `NCR-${String(sequence).padStart(4, "0")}`;
}

export function nextNcrReferenceFromRows(rows = []) {
  const maxValue = rows.reduce((max, row) => {
    const parsed = parseNcrReferenceSequence(pickField(row, ["Reference", "NCR ID"]));
    if (parsed === null) return max;
    return Math.max(max, parsed);
  }, 0);
  return formatNcrReference(maxValue + 1);
}

export function normalizeNcrWorkbookStatus(status) {
  const normalized = safeLower(status);
  if (!normalized || normalized === "open") return "Open";
  if (normalized === "raised") return "Raised";
  if (normalized === "in progress" || normalized === "in_progress") return "In Progress";
  if (CLOSED_STATUSES.has(normalized)) return "Completed";
  return trim(status) || "Open";
}

export function ncrWorkbookRowIsOpen(record = {}) {
  const status = safeLower(pickField(record, ["Status", "status"]));
  if (!status) return true;
  return !CLOSED_STATUSES.has(status);
}

export function isNcrFindingAnswer(answer) {
  const normalized = safeLower(answer);
  return normalized === "fail" || normalized === "nc" || normalized === "non conformance" || normalized === "non-conformance";
}

export function sanitizeNcrEvidenceRef(item = {}) {
  const driveLink = trim(item.driveLink || item.url || item.previewUrl);
  const safeDriveLink = driveLink.startsWith("data:") ? "" : driveLink;
  const next = {
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

export function sanitizeNcrEvidenceRefs(evidenceRefs) {
  const items = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  return items
    .map((item) => sanitizeNcrEvidenceRef(item))
    .filter((item) => item.evidenceId);
}

export function filterEvidenceRefsForQuestion(evidenceRefs, questionId) {
  const target = trim(questionId);
  const items = sanitizeNcrEvidenceRefs(evidenceRefs);
  if (!target) {
    return items;
  }
  const matched = items.filter((item) => trim(item.questionId) === target);
  // If refs exist but none are question-scoped (legacy), keep them for the NCR.
  return matched.length > 0 ? matched : items.filter((item) => !trim(item.questionId));
}

export function serializeNcrEvidenceRefs(evidenceRefs) {
  return JSON.stringify(sanitizeNcrEvidenceRefs(evidenceRefs));
}

export function parseNcrEvidenceRefs(raw) {
  if (Array.isArray(raw)) {
    return sanitizeNcrEvidenceRefs(raw);
  }
  const text = trim(raw);
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return sanitizeNcrEvidenceRefs(parsed);
  } catch {
    return [];
  }
}

export function ncrEvidenceRefsToClientEvidence(evidenceRefs = []) {
  return sanitizeNcrEvidenceRefs(evidenceRefs).map((ref) => {
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
      uploadStatus: previewUrl ? "uploaded" : "pending",
    };
  });
}

export function mergeNcrEvidenceLists(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = trim(item.id || item.evidenceId);
    const key = id || `${trim(item.name)}::${trim(item.previewUrl || item.driveLink)}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function buildNcrWorkbookRow(input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const reference = trim(input.reference) || trim(input.ncrId);
  const ncrId = trim(input.ncrId) || reference;
  const raisedAt = trim(input.raisedAt) || trim(input.createdAt) || new Date().toISOString();
  const status = normalizeNcrWorkbookStatus(input.status || "Open");
  const questionText = trim(input.questionText || input.title);
  const note = trim(input.note || input.description);
  const questionId = trim(input.questionId);
  const evidenceRefs = filterEvidenceRefsForQuestion(input.evidenceRefs ?? input.evidence, questionId);

  return {
    "NCR ID": ncrId,
    Reference: reference,
    "Company ID": companyFolderId,
    "Company Folder ID": companyFolderId,
    "Source Audit ID": trim(input.auditId),
    "Source Audit Name": trim(input.auditName),
    "Source Question ID": questionId,
    "Source Question Text": questionText,
    "Selected Answer": trim(input.answer),
    Title: questionText,
    Description: note,
    Status: status,
    Site: trim(input.site),
    "Auditor Name": trim(input.auditorName),
    "Auditor User ID": trim(input.auditorUserId),
    "Assigned Line Manager": trim(input.assignedLineManager),
    "Assigned Line Manager Email": trim(input.assignedLineManagerEmail),
    "Raised At": raisedAt,
    "Created At": trim(input.createdAt) || raisedAt,
    "Updated At": trim(input.updatedAt) || raisedAt,
    "Created By": trim(input.createdBy || input.auditorUserId),
    Archived: trim(input.archived) || "false",
    "Archived At": "",
    "Archived By": "",
    "Archive Reason": "",
    "Result ID": trim(input.resultId),
    "Local Submission ID": trim(input.localSubmissionId),
    "Evidence Refs": serializeNcrEvidenceRefs(evidenceRefs),
    "Evidence Count": String(evidenceRefs.length),
  };
}

export function mapNcrWorkbookRowToClient(record = {}, companyFolderId = "") {
  const reference = pickField(record, ["Reference", "NCR ID"]);
  const status = normalizeNcrWorkbookStatus(pickField(record, ["Status", "status"]));
  const clientStatus = status === "Completed" ? "Completed" : status === "In Progress" ? "In Progress" : "Raised";
  const auditName = pickField(record, ["Source Audit Name", "Audit Name"]);
  const questionText = pickField(record, ["Source Question Text", "Title"]);
  const description = pickField(record, ["Description"]);
  const auditQuestion =
    questionText ||
    (auditName && description ? `${auditName} - ${description}` : auditName || description);
  const questionId = pickField(record, ["Source Question ID", "Question ID"]);
  const evidenceRefs = filterEvidenceRefsForQuestion(
    parseNcrEvidenceRefs(pickField(record, ["Evidence Refs", "EvidenceRefs"])),
    questionId,
  );
  return {
    id: pickField(record, ["NCR ID"]) || reference || `ncr-${Math.random().toString(36).slice(2, 9)}`,
    reference,
    auditId: pickField(record, ["Source Audit ID", "Audit ID"]),
    auditName,
    auditQuestionId: questionId,
    auditQuestion,
    selectedAnswer: (pickField(record, ["Selected Answer", "Answer"]) || "nc").toLowerCase(),
    auditorName: pickField(record, ["Auditor Name", "Created By"]),
    auditorUserId: pickField(record, ["Auditor User ID", "Created By"]),
    site: pickField(record, ["Site", "Location"]),
    raisedAt: pickField(record, ["Raised At", "Created At"]),
    status: clientStatus,
    assignedLineManager: pickField(record, ["Assigned Line Manager"]),
    assignedLineManagerUserId: pickField(record, ["Assigned Line Manager User ID"]),
    assignedLineManagerEmail: pickField(record, ["Assigned Line Manager Email"]),
    investigationIsoClause: "",
    investigationNotes: pickField(record, ["Description"]),
    rootCause: "",
    correctiveAction: "",
    investigationExtraNotes: "",
    evidence: ncrEvidenceRefsToClientEvidence(evidenceRefs),
    resultId: pickField(record, ["Result ID", "Source Result ID"]),
    companyFolderId: pickField(record, ["Company Folder ID", "Company ID"]) || companyFolderId,
  };
}
