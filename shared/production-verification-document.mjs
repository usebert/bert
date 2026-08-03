/**
 * Dedicated production smoke verification Document for Dovecote Manufacturing Ltd.
 */
import { getUkTodayKey } from "./uk-date-time.mjs";

export const PRODUCTION_VERIFICATION_DOCUMENT_ID_PREFIX = "bert-smoke-doc-";
export const PRODUCTION_VERIFICATION_DOCUMENT_NUMBER_PREFIX = "BERT-VERIFY-DOC-";
export const PRODUCTION_VERIFICATION_DOCUMENT_TITLE = "BERT Verification Document";
export const PRODUCTION_VERIFICATION_DOCUMENT_DESCRIPTION =
  "Automated production Document workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_DOCUMENT_TYPE = "procedure";
export const PRODUCTION_VERIFICATION_DOCUMENT_DEPARTMENT = "Verification";
export const PRODUCTION_VERIFICATION_DOCUMENT_MARKER = "verification";
export const PRODUCTION_VERIFICATION_DOCUMENT_SOURCE = "production-documents-workflow";
export const PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS = "verification-cleaned";
export const PRODUCTION_VERIFICATION_DOCUMENT_FILE_NAME_PREFIX = "bert-verify-doc-";
export const PRODUCTION_VERIFICATION_DOCUMENT_REVIEW_SUMMARY =
  "Production document smoke verification review";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function pickField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, "");
      if (normalizedHeader === normalizedKey || normalizedHeader.includes(normalizedKey)) {
        const text = trim(value);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

export function isVerificationDocumentId(documentId = "") {
  return trim(documentId).startsWith(PRODUCTION_VERIFICATION_DOCUMENT_ID_PREFIX);
}

export function isVerificationDocumentNumber(documentNumber = "") {
  return trim(documentNumber).toUpperCase().startsWith(PRODUCTION_VERIFICATION_DOCUMENT_NUMBER_PREFIX);
}

export function isVerificationDocument(record = {}) {
  const documentId = pickField(record, "documentId", "DocumentId", "id");
  if (isVerificationDocumentId(documentId)) {
    return true;
  }
  const documentNumber = pickField(record, "documentNumber", "DocumentNumber");
  if (isVerificationDocumentNumber(documentNumber)) {
    return true;
  }
  const verificationSource = pickField(record, "verificationSource", "VerificationSource");
  if (normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_DOCUMENT_SOURCE)) {
    return true;
  }
  const title = normalize(pickField(record, "title", "Title"));
  const keywords = normalize(pickField(record, "keywords", "Keywords"));
  if (title === normalize(PRODUCTION_VERIFICATION_DOCUMENT_TITLE)) {
    return true;
  }
  if (keywords.includes(PRODUCTION_VERIFICATION_DOCUMENT_MARKER) && keywords.includes("production-documents-workflow")) {
    return true;
  }
  return false;
}

export function isActiveVerificationDocument(record = {}) {
  if (!isVerificationDocument(record)) {
    return false;
  }
  const status = normalize(pickField(record, "documentStatus", "DocumentStatus", "status"));
  return status !== PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS && status !== "archived";
}

export function isOperationalDocument(record = {}) {
  return !isVerificationDocument(record);
}

export function mapWorkbookDocumentForOperationalCheck(record = {}) {
  return {
    documentId: pickField(record, "documentId", "DocumentId", "id"),
    documentNumber: pickField(record, "documentNumber", "DocumentNumber"),
    title: pickField(record, "title", "Title"),
    documentStatus: pickField(record, "documentStatus", "DocumentStatus", "status"),
    keywords: pickField(record, "keywords", "Keywords"),
    verificationSource: pickField(record, "verificationSource", "VerificationSource"),
  };
}

export function isOperationalWorkbookDocumentRow(record = {}) {
  return isOperationalDocument(mapWorkbookDocumentForOperationalCheck(record));
}

export function buildProductionVerificationDocumentId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_DOCUMENT_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationDocumentNumber(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_DOCUMENT_NUMBER_PREFIX}${runId}`;
}

export function buildProductionVerificationDocument(input = {}) {
  const runId = input.runId ?? Date.now();
  const documentId = trim(input.documentId) || buildProductionVerificationDocumentId(runId);
  const documentNumber = trim(input.documentNumber) || buildProductionVerificationDocumentNumber(runId);
  const ownerEmail = trim(input.ownerEmail);
  const ownerName = trim(input.ownerName) || "Smoke Verifier";
  const today = getUkTodayKey();
  const reviewDate = trim(input.nextReviewDate) || addDaysUk(today, 90);

  return {
    documentId,
    documentNumber,
    title: PRODUCTION_VERIFICATION_DOCUMENT_TITLE,
    documentType: PRODUCTION_VERIFICATION_DOCUMENT_TYPE,
    department: PRODUCTION_VERIFICATION_DOCUMENT_DEPARTMENT,
    description: PRODUCTION_VERIFICATION_DOCUMENT_DESCRIPTION,
    status: "draft",
    revision: "1",
    ownerEmail,
    ownerName,
    primaryStandard: "COMPANY",
    clauseReferences: ["COMPANY:VERIFICATION"],
    keywords: `${PRODUCTION_VERIFICATION_DOCUMENT_MARKER} ${PRODUCTION_VERIFICATION_DOCUMENT_SOURCE}`,
    verificationSource: PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
    nextReviewDate: reviewDate,
    changeSummary: "Initial verification revision.",
  };
}

function addDaysUk(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildVerificationFileDataUrl(runId = Date.now()) {
  const pdfBytes = Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
      "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj",
      "xref",
      "0 4",
      "0000000000 65535 f ",
      "0000000009 00000 n ",
      "0000000052 00000 n ",
      "0000000101 00000 n ",
      "trailer<</Size 4/Root 1 0 R>>",
      "startxref",
      "178",
      `%%EOF verification-run-${runId}`,
    ].join("\n"),
    "utf8",
  );
  const base64 = pdfBytes.toString("base64");
  return `data:application/pdf;base64,${base64}`;
}

export function buildVerificationFileName(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_DOCUMENT_FILE_NAME_PREFIX}${runId}.pdf`;
}

export function countDocumentBaselines(documents = []) {
  const list = Array.isArray(documents) ? documents : [];
  const operational = list.filter((item) => isOperationalDocument(item));
  const verification = list.filter((item) => isVerificationDocument(item));
  const activeVerification = list.filter((item) => isActiveVerificationDocument(item));

  return {
    visibleCount: list.length,
    operationalCount: operational.length,
    draftCount: operational.filter((item) => normalize(item.documentStatus) === "draft").length,
    awaitingApprovalCount: operational.filter((item) => normalize(item.documentStatus) === "awaiting_approval").length,
    currentCount: operational.filter((item) => normalize(item.documentStatus) === "current").length,
    archivedCount: operational.filter((item) => normalize(item.documentStatus) === "archived").length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
  };
}

export function listActiveVerificationDocuments(documents = []) {
  return (Array.isArray(documents) ? documents : []).filter((item) => isActiveVerificationDocument(item));
}

export function findDocumentById(documents = [], documentId = "") {
  const target = trim(documentId).toLowerCase();
  return (Array.isArray(documents) ? documents : []).find(
    (item) => trim(item.documentId || item.id).toLowerCase() === target,
  );
}
