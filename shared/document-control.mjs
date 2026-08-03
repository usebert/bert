/**
 * Bert Document Control — shared tab names, columns, numbering, review helpers.
 * Dedicated module: never touches Schedules, Audits, LOLER, Calendar, or Messages sheets.
 */

export const CONTROLLED_DOCUMENTS_TAB = "ControlledDocuments";
export const DOCUMENT_REVISIONS_TAB = "DocumentRevisions";
export const DOCUMENT_CONTROL_INDEX_TAB = "DocumentControlIndex";

export const CONTROLLED_DOCUMENTS_TAB_COLUMNS = [
  "DocumentId",
  "DocumentNumber",
  "Title",
  "DocumentType",
  "Department",
  "OwnerPersonId",
  "OwnerName",
  "OwnerEmail",
  "PrimaryStandard",
  "ClauseReferences",
  "Keywords",
  "CurrentRevisionId",
  "CurrentRevision",
  "DocumentStatus",
  "IssueDate",
  "EffectiveDate",
  "NextReviewDate",
  "ApprovalRequired",
  "CreatedAt",
  "CreatedBy",
  "UpdatedAt",
  "UpdatedBy",
  "ArchivedAt",
  "ArchivedBy",
  "VerificationSource",
];

export const DOCUMENT_REVISIONS_TAB_COLUMNS = [
  "RevisionId",
  "DocumentId",
  "DocumentNumber",
  "Revision",
  "RevisionSequence",
  "FileId",
  "FileName",
  "FileUrl",
  "MimeType",
  "FileSize",
  "RevisionStatus",
  "ChangeSummary",
  "PreparedBy",
  "PreparedAt",
  "ReviewedBy",
  "ReviewedAt",
  "ApprovedBy",
  "ApprovedAt",
  "IssueDate",
  "EffectiveDate",
  "SupersededAt",
  "SupersededByRevisionId",
  "CreatedAt",
  "CreatedBy",
  "ChangeLog",
];

export const DOCUMENT_CONTROL_INDEX_TAB_COLUMNS = [
  "DocumentNumber",
  "Title",
  "DocumentType",
  "Department",
  "Owner",
  "Standard",
  "ClauseReferences",
  "CurrentRevision",
  "IssueDate",
  "EffectiveDate",
  "NextReviewDate",
  "ApprovalStatus",
  "DocumentStatus",
  "CurrentFileUrl",
  "LastUpdatedAt",
  "LastUpdatedBy",
];

/** Stored document statuses. */
export const DOCUMENT_STATUSES = ["draft", "awaiting_approval", "current", "superseded", "archived", "verification-cleaned"];

/** Stored revision statuses. */
export const REVISION_STATUSES = [
  "draft",
  "awaiting_approval",
  "current",
  "superseded",
  "rejected",
  "archived",
];

export const DOCUMENT_TYPES = [
  "policy",
  "procedure",
  "work_instruction",
  "form",
  "manual",
  "record_template",
  "other",
];

export const DOCUMENT_TYPE_PREFIXES = {
  policy: "POL",
  procedure: "PRO",
  work_instruction: "WI",
  form: "FRM",
  manual: "MAN",
  record_template: "REC",
  other: "DOC",
};

/** Stable standard codes (not display labels). */
export const DOCUMENT_STANDARDS = [
  "ISO9001",
  "ISO14001",
  "ISO45001",
  "IMS",
  "COMPANY",
];

export const DOCUMENT_REVIEW_DUE_SOON_DAYS = 30;

export const DOCUMENT_CONTROL_DRIVE_ROOT = "Document Control";
export const DOCUMENT_CONTROL_DRIVE_FOLDERS = ["Current", "Drafts", "Superseded", "Archived"];

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
];

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
];

export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

function trim(value) {
  return String(value ?? "").trim();
}

export function normalizeDocumentType(value) {
  const raw = trim(value).toLowerCase().replace(/\s+/g, "_");
  if (DOCUMENT_TYPES.includes(raw)) {
    return raw;
  }
  const aliases = {
    policy: "policy",
    procedure: "procedure",
    "work instruction": "work_instruction",
    workinstruction: "work_instruction",
    wi: "work_instruction",
    form: "form",
    manual: "manual",
    "record template": "record_template",
    recordtemplate: "record_template",
    other: "other",
    doc: "other",
  };
  return aliases[raw] || "";
}

export function prefixForDocumentType(documentType) {
  const type = normalizeDocumentType(documentType);
  return DOCUMENT_TYPE_PREFIXES[type] || DOCUMENT_TYPE_PREFIXES.other;
}

export function formatDocumentNumber(prefix, sequence) {
  const safePrefix = trim(prefix).toUpperCase() || "DOC";
  const seq = Number(sequence);
  if (!Number.isInteger(seq) || seq < 1) {
    return "";
  }
  return `${safePrefix}-${String(seq).padStart(3, "0")}`;
}

/**
 * Parse POL-001 → { prefix: "POL", sequence: 1 }.
 * Returns null when not a valid allocated number.
 */
export function parseDocumentNumber(documentNumber) {
  const match = trim(documentNumber)
    .toUpperCase()
    .match(/^([A-Z]{2,8})-(\d{1,6})$/);
  if (!match) {
    return null;
  }
  const sequence = Number(match[2]);
  if (!Number.isInteger(sequence) || sequence < 1) {
    return null;
  }
  return { prefix: match[1], sequence };
}

/**
 * Highest allocated sequence for a prefix among existing document numbers.
 * Includes archived / withdrawn numbers (never reuse).
 */
export function highestSequenceForPrefix(documentNumbers, prefix) {
  const safePrefix = trim(prefix).toUpperCase();
  let highest = 0;
  for (const entry of documentNumbers || []) {
    const parsed = parseDocumentNumber(entry);
    if (!parsed || parsed.prefix !== safePrefix) {
      continue;
    }
    if (parsed.sequence > highest) {
      highest = parsed.sequence;
    }
  }
  return highest;
}

export function nextDocumentNumberForPrefix(documentNumbers, prefix) {
  const next = highestSequenceForPrefix(documentNumbers, prefix) + 1;
  return formatDocumentNumber(prefix, next);
}

export function documentNumberAlreadyUsed(documentNumbers, documentNumber) {
  const target = trim(documentNumber).toUpperCase();
  if (!target) {
    return false;
  }
  return (documentNumbers || []).some((entry) => trim(entry).toUpperCase() === target);
}

/** Normalize clause list: "ISO9001:7.5, ISO14001:7.5" or array → sorted unique codes. */
export function normalizeClauseReferences(value) {
  const raw = Array.isArray(value) ? value.join(",") : trim(value);
  if (!raw) {
    return [];
  }
  const parts = raw
    .split(/[,;|]/)
    .map((part) => trim(part).toUpperCase().replace(/\s+/g, ""))
    .filter(Boolean);
  return [...new Set(parts)].sort();
}

export function formatClauseReferences(value) {
  return normalizeClauseReferences(value).join(",");
}

export function normalizePrimaryStandard(value) {
  const raw = trim(value).toUpperCase().replace(/\s+/g, "");
  if (DOCUMENT_STANDARDS.includes(raw)) {
    return raw;
  }
  const aliases = {
    "ISO 9001": "ISO9001",
    ISO9001: "ISO9001",
    "ISO 14001": "ISO14001",
    ISO14001: "ISO14001",
    "ISO 45001": "ISO45001",
    ISO45001: "ISO45001",
    IMS: "IMS",
    INTEGRATED: "IMS",
    "INTEGRATEDMANAGEMENTSYSTEM": "IMS",
    COMPANY: "COMPANY",
    "NON-STANDARD": "COMPANY",
    NONSTANDARD: "COMPANY",
  };
  return aliases[trim(value).toUpperCase()] || aliases[raw] || "";
}

export function normalizeDocumentDateKey(value) {
  const raw = trim(value);
  if (!raw) {
    return "";
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  let year;
  let month;
  let day;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    year = Number(dmy[3]);
    month = Number(dmy[2]);
    day = Number(dmy[1]);
  } else {
    return "";
  }
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return "";
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysBetweenDateKeys(fromKey, toKey) {
  const from = normalizeDocumentDateKey(fromKey);
  const to = normalizeDocumentDateKey(toKey);
  if (!from || !to) {
    return null;
  }
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Derived review warning only — does not change DocumentStatus.
 * @returns {"review_overdue"|"review_due_soon"|"review_current"|""}
 */
export function documentReviewDerivedStatus(nextReviewDate, todayKey, dueSoonDays = DOCUMENT_REVIEW_DUE_SOON_DAYS) {
  const review = normalizeDocumentDateKey(nextReviewDate);
  const today = normalizeDocumentDateKey(todayKey);
  if (!review || !today) {
    return "";
  }
  const days = daysBetweenDateKeys(today, review);
  if (days === null) {
    return "";
  }
  if (days < 0) {
    return "review_overdue";
  }
  if (days <= Number(dueSoonDays) || days === 0) {
    return "review_due_soon";
  }
  return "review_current";
}

export function buildDocumentId(companyFolderId, seed = Date.now()) {
  const safeCompany = trim(companyFolderId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "co";
  return `DOC-${safeCompany}-${seed}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildRevisionId(documentId, sequence) {
  return `REV-${trim(documentId)}-${Number(sequence) || 1}`;
}

/** Numeric revision scheme: 1, 2, 3… */
export function formatRevisionLabel(sequence) {
  const seq = Number(sequence);
  if (!Number.isInteger(seq) || seq < 1) {
    return "1";
  }
  return String(seq);
}

export function appendChangeLog(existing, entry) {
  const base = trim(existing);
  const line = trim(entry);
  if (!line) {
    return base;
  }
  return base ? `${base}\n${line}` : line;
}

export function formatChangeLogEntry(action, actorEmail, extras = {}) {
  const parts = [
    new Date().toISOString(),
    trim(action),
    trim(actorEmail) || "unknown",
  ];
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined && value !== null && trim(value) !== "") {
      parts.push(`${key}=${trim(value)}`);
    }
  }
  return parts.join(" | ");
}

/**
 * Validate create-document input (metadata). File may be file reference or upload meta.
 */
export function validateControlledDocumentInput(input = {}, options = {}) {
  const errors = [];
  const title = trim(input.title);
  const documentType = normalizeDocumentType(input.documentType || input.type);
  const department = trim(input.department);
  const ownerName = trim(input.ownerName || input.owner);
  const ownerEmail = trim(input.ownerEmail).toLowerCase();
  const ownerPersonId = trim(input.ownerPersonId);
  const primaryStandard = normalizePrimaryStandard(input.primaryStandard || input.standard);
  const clauseReferences = normalizeClauseReferences(input.clauseReferences || input.clauses);
  const keywords = trim(input.keywords);
  const issueDate = normalizeDocumentDateKey(input.issueDate);
  const effectiveDate = normalizeDocumentDateKey(input.effectiveDate);
  const nextReviewDate = normalizeDocumentDateKey(input.nextReviewDate);
  const changeSummary = trim(input.changeSummary);
  const fileId = trim(input.fileId);
  const fileName = trim(input.fileName);
  const fileUrl = trim(input.fileUrl);
  const mimeType = trim(input.mimeType);
  const fileSize = trim(input.fileSize);
  const hasFile = Boolean(fileId || fileUrl || fileName || input.fileDataUrl);
  const migrationNumber = trim(input.documentNumber);

  if (!title) errors.push("Title is required.");
  if (!documentType) errors.push("Document type is required.");
  if (!department) errors.push("Department is required.");
  if (!ownerName && !ownerEmail && !ownerPersonId) errors.push("Owner is required.");
  if (!primaryStandard) errors.push("Standard or company classification is required.");
  if (!clauseReferences.length) errors.push("At least one clause or classification is required.");
  if (!hasFile && !options.allowMissingFile) errors.push("A file upload or Google document reference is required.");

  if (migrationNumber) {
    const parsed = parseDocumentNumber(migrationNumber);
    if (!parsed) {
      errors.push("Document number format is invalid.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      title,
      documentType,
      department,
      ownerPersonId,
      ownerName,
      ownerEmail,
      primaryStandard,
      clauseReferences,
      keywords,
      issueDate,
      effectiveDate,
      nextReviewDate,
      changeSummary,
      fileId,
      fileName,
      fileUrl,
      mimeType,
      fileSize,
      documentNumber: migrationNumber.toUpperCase(),
      approvalRequired: input.approvalRequired === false || input.approvalRequired === "false" ? "false" : "true",
    },
  };
}

export function mapControlledDocumentRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const documentId = trim(record.DocumentId || record.documentId);
  if (!documentId) {
    return null;
  }
  return {
    documentId,
    documentNumber: trim(record.DocumentNumber),
    title: trim(record.Title),
    documentType: normalizeDocumentType(record.DocumentType) || trim(record.DocumentType).toLowerCase(),
    department: trim(record.Department),
    ownerPersonId: trim(record.OwnerPersonId),
    ownerName: trim(record.OwnerName),
    ownerEmail: trim(record.OwnerEmail).toLowerCase(),
    primaryStandard: normalizePrimaryStandard(record.PrimaryStandard) || trim(record.PrimaryStandard),
    clauseReferences: normalizeClauseReferences(record.ClauseReferences),
    keywords: trim(record.Keywords),
    verificationSource: trim(record.VerificationSource),
    currentRevisionId: trim(record.CurrentRevisionId),
    currentRevision: trim(record.CurrentRevision),
    documentStatus: trim(record.DocumentStatus).toLowerCase() || "draft",
    issueDate: normalizeDocumentDateKey(record.IssueDate) || trim(record.IssueDate),
    effectiveDate: normalizeDocumentDateKey(record.EffectiveDate) || trim(record.EffectiveDate),
    nextReviewDate: normalizeDocumentDateKey(record.NextReviewDate) || trim(record.NextReviewDate),
    approvalRequired: trim(record.ApprovalRequired).toLowerCase() !== "false",
    createdAt: trim(record.CreatedAt),
    createdBy: trim(record.CreatedBy),
    updatedAt: trim(record.UpdatedAt),
    updatedBy: trim(record.UpdatedBy),
    archivedAt: trim(record.ArchivedAt),
    archivedBy: trim(record.ArchivedBy),
  };
}

export function mapDocumentRevisionRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const revisionId = trim(record.RevisionId || record.revisionId);
  if (!revisionId) {
    return null;
  }
  return {
    revisionId,
    documentId: trim(record.DocumentId),
    documentNumber: trim(record.DocumentNumber),
    revision: trim(record.Revision) || formatRevisionLabel(record.RevisionSequence),
    revisionSequence: Number(record.RevisionSequence) || Number(record.Revision) || 1,
    fileId: trim(record.FileId),
    fileName: trim(record.FileName),
    fileUrl: trim(record.FileUrl),
    mimeType: trim(record.MimeType),
    fileSize: trim(record.FileSize),
    revisionStatus: trim(record.RevisionStatus).toLowerCase() || "draft",
    changeSummary: trim(record.ChangeSummary),
    preparedBy: trim(record.PreparedBy),
    preparedAt: trim(record.PreparedAt),
    reviewedBy: trim(record.ReviewedBy),
    reviewedAt: trim(record.ReviewedAt),
    approvedBy: trim(record.ApprovedBy),
    approvedAt: trim(record.ApprovedAt),
    issueDate: trim(record.IssueDate),
    effectiveDate: trim(record.EffectiveDate),
    supersededAt: trim(record.SupersededAt),
    supersededByRevisionId: trim(record.SupersededByRevisionId),
    createdAt: trim(record.CreatedAt),
    createdBy: trim(record.CreatedBy),
    changeLog: trim(record.ChangeLog),
  };
}

export function buildIndexRowFromDocument(document, currentRevision) {
  if (!document) {
    return null;
  }
  return {
    DocumentNumber: document.documentNumber,
    Title: document.title,
    DocumentType: document.documentType,
    Department: document.department,
    Owner: document.ownerName || document.ownerEmail || document.ownerPersonId,
    Standard: document.primaryStandard,
    ClauseReferences: formatClauseReferences(document.clauseReferences),
    CurrentRevision: document.currentRevision || currentRevision?.revision || "",
    IssueDate: document.issueDate || currentRevision?.issueDate || "",
    EffectiveDate: document.effectiveDate || currentRevision?.effectiveDate || "",
    NextReviewDate: document.nextReviewDate || "",
    ApprovalStatus: currentRevision?.revisionStatus || document.documentStatus,
    DocumentStatus: document.documentStatus,
    CurrentFileUrl: currentRevision?.fileUrl || "",
    LastUpdatedAt: document.updatedAt || "",
    LastUpdatedBy: document.updatedBy || "",
  };
}

/**
 * Clause browser groups documents by clause code without duplicating stored rows.
 * Returns { clauseCode, documents: [...] } where documents are references (same DocumentId may appear in multiple groups).
 */
export function groupDocumentsByClause(documents = []) {
  const groups = new Map();
  for (const doc of documents) {
    const clauses = doc.clauseReferences?.length ? doc.clauseReferences : ["UNCLASSIFIED"];
    for (const clause of clauses) {
      if (!groups.has(clause)) {
        groups.set(clause, []);
      }
      groups.get(clause).push(doc);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clauseCode, docs]) => ({ clauseCode, documents: docs }));
}

export function summarizeDocumentControl(documents = [], todayKey = "") {
  let current = 0;
  let awaitingApproval = 0;
  let drafts = 0;
  let archived = 0;
  let reviewsDue = 0;
  for (const doc of documents) {
    const status = trim(doc.documentStatus).toLowerCase();
    if (status === "current") current += 1;
    else if (status === "awaiting_approval") awaitingApproval += 1;
    else if (status === "draft") drafts += 1;
    else if (status === "archived") archived += 1;
    const review = documentReviewDerivedStatus(doc.nextReviewDate, todayKey);
    if (review === "review_overdue" || review === "review_due_soon") {
      if (status !== "archived") reviewsDue += 1;
    }
  }
  return { current, awaitingApproval, drafts, reviewsDue, archived, total: documents.length };
}

export function isAllowedDocumentExtension(fileName) {
  const ext = trim(fileName).split(".").pop()?.toLowerCase() || "";
  return ALLOWED_DOCUMENT_EXTENSIONS.includes(ext);
}

export function isAllowedDocumentMimeType(mimeType) {
  const mime = trim(mimeType).toLowerCase();
  if (!mime) {
    return true;
  }
  return ALLOWED_DOCUMENT_MIME_TYPES.includes(mime);
}
