/**
 * Production smoke verification reports — stable IDs, PDF helpers, and workbook markers.
 */
import { PRODUCTION_VERIFICATION_AUDIT_ID, PRODUCTION_VERIFICATION_AUDIT_NAME } from "./production-verification-audit.mjs";

export const PRODUCTION_VERIFICATION_REPORT_ID_PREFIX = "bert-smoke-report-";
export const PRODUCTION_VERIFICATION_REPORT_FILENAME_PREFIX = "BERT-Verification-";
export const PRODUCTION_VERIFICATION_REPORT_SOURCE = "production-reporting-workflow";
export const PRODUCTION_VERIFICATION_REPORTING_SOURCE_MODE = "production-reporting-workflow-source";
export const PRODUCTION_VERIFICATION_REPORT_MARKER = "verification";
export const PRODUCTION_VERIFICATION_REPORT_CLEANED_STATUS = "verification-cleaned";
export const PRODUCTION_VERIFICATION_REPORT_MIME = "application/pdf";
export const PRODUCTION_VERIFICATION_REPORT_MIN_BYTES = 128;

export const SUPPORTED_VERIFICATION_REPORT_TYPES = [
  "audit",
  "incident",
  "risk-assessment",
  "coshh",
  "loler",
];

export const OPTIONAL_UNSUPPORTED_REPORT_TYPES = [
  "action",
  "briefing",
  "risk-register",
  "document",
  "dashboard",
];

export const REPORTS_TAB = "Reports";
export const REPORTS_TAB_COLUMNS = [
  "Report ID",
  "Company ID",
  "Report Type",
  "Title",
  "Created By",
  "Created At",
  "Visible To",
  "Export Links",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
  "Source Type",
  "Source ID",
  "Verification Marker",
  "Verification Source",
  "Drive File ID",
  "Generated At",
  "Status",
];

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

export function normalizeVerificationReportType(reportType = "") {
  return normalize(reportType).replace(/_/g, "-");
}

export function isSupportedVerificationReportType(reportType = "") {
  return SUPPORTED_VERIFICATION_REPORT_TYPES.includes(normalizeVerificationReportType(reportType));
}

export function buildProductionVerificationReportId(runId = Date.now(), reportType = "audit") {
  return `${PRODUCTION_VERIFICATION_REPORT_ID_PREFIX}${runId}-${normalizeVerificationReportType(reportType)}`;
}

export function buildReportingAuditLocalSubmissionId(runId = Date.now()) {
  return `bert-smoke-report-audit-${runId}`;
}

export function buildProductionVerificationReportFilename(runId = Date.now(), reportType = "audit") {
  const typeSlug = normalizeVerificationReportType(reportType).replace(/-/g, "_");
  return `${PRODUCTION_VERIFICATION_REPORT_FILENAME_PREFIX}${typeSlug}-${runId}.pdf`;
}

export function isVerificationReportId(reportId = "") {
  return trim(reportId).startsWith(PRODUCTION_VERIFICATION_REPORT_ID_PREFIX);
}

export function isVerificationReport(record = {}) {
  const reportId = pickField(record, "reportId", "Report ID", "id");
  if (isVerificationReportId(reportId)) {
    return true;
  }
  const verificationSource = pickField(record, "verificationSource", "Verification Source");
  if (normalize(verificationSource) === normalize(PRODUCTION_VERIFICATION_REPORT_SOURCE)) {
    return true;
  }
  const marker = pickField(record, "verificationMarker", "Verification Marker");
  const title = pickField(record, "title", "Title");
  return (
    normalize(marker) === PRODUCTION_VERIFICATION_REPORT_MARKER &&
    (title.includes("BERT Verification") || title.includes("BERT Verification Report"))
  );
}

export function isActiveVerificationReport(record = {}) {
  if (!isVerificationReport(record)) {
    return false;
  }
  const status = normalize(pickField(record, "status", "Status", "sync status", "Sync Status"));
  return status !== PRODUCTION_VERIFICATION_REPORT_CLEANED_STATUS && status !== "archived";
}

export function isOperationalReport(record = {}) {
  return !isVerificationReport(record);
}

export function mapWorkbookReportRecord(record = {}) {
  return {
    reportId: pickField(record, "reportId", "Report ID", "id"),
    companyId: pickField(record, "companyId", "Company ID"),
    reportType: pickField(record, "reportType", "Report Type"),
    title: pickField(record, "title", "Title"),
    createdBy: pickField(record, "createdBy", "Created By"),
    createdAt: pickField(record, "createdAt", "Created At"),
    exportLinks: pickField(record, "exportLinks", "Export Links"),
    sourceType: pickField(record, "sourceType", "Source Type"),
    sourceId: pickField(record, "sourceId", "Source ID"),
    verificationMarker: pickField(record, "verificationMarker", "Verification Marker"),
    verificationSource: pickField(record, "verificationSource", "Verification Source"),
    driveFileId: pickField(record, "driveFileId", "Drive File ID"),
    generatedAt: pickField(record, "generatedAt", "Generated At"),
    status: pickField(record, "status", "Status", "sync status", "Sync Status"),
  };
}

export function countReportBaselines(reports = []) {
  const list = Array.isArray(reports) ? reports.map(mapWorkbookReportRecord) : [];
  const verification = list.filter((item) => isVerificationReport(item));
  const activeVerification = list.filter((item) => isActiveVerificationReport(item));
  const operational = list.filter((item) => isOperationalReport(item));
  return {
    visibleCount: list.length,
    operationalCount: operational.length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
    storedFileCount: list.filter((item) => trim(item.driveFileId) || trim(item.exportLinks)).length,
    historyCount: list.length,
  };
}

export function buildVerificationReportBaselineCounts(records = [], companyFolderId = "") {
  const companyId = trim(companyFolderId);
  const list = (Array.isArray(records) ? records : [])
    .map(mapWorkbookReportRecord)
    .filter((item) => !companyId || trim(item.companyId) === companyId || !trim(item.companyId));
  const verification = list.filter((item) => isVerificationReport(item));
  const activeVerification = list.filter((item) => isActiveVerificationReport(item));
  const operational = list.filter((item) => isOperationalReport(item));
  return {
    totalRows: list.length,
    operationalCount: operational.length,
    verificationCount: verification.length,
    activeVerificationCount: activeVerification.length,
    storedFileCount: list.filter((item) => trim(item.driveFileId) || trim(item.exportLinks)).length,
    historyCount: list.length,
  };
}

export function listActiveVerificationReports(reports = []) {
  return (Array.isArray(reports) ? reports : [])
    .map(mapWorkbookReportRecord)
    .filter((item) => isActiveVerificationReport(item));
}

export function findReportById(reports = [], reportId = "") {
  const target = trim(reportId).toLowerCase();
  return (Array.isArray(reports) ? reports : [])
    .map(mapWorkbookReportRecord)
    .find((item) => trim(item.reportId).toLowerCase() === target);
}

export function verificationReportTitle(reportType = "audit") {
  const labels = {
    audit: "BERT Verification Audit Report",
    incident: "BERT Verification Incident Report",
    "risk-assessment": "BERT Verification Risk Assessment Report",
    coshh: "BERT Verification COSHH Report",
    loler: "BERT Verification LOLER Report",
  };
  return labels[normalizeVerificationReportType(reportType)] || "BERT Verification Report";
}

export function defaultVerificationSourceId(reportType = "audit") {
  const type = normalizeVerificationReportType(reportType);
  if (type === "audit") {
    return PRODUCTION_VERIFICATION_AUDIT_ID;
  }
  return "";
}

export function buildVerificationReportContentLines(input = {}) {
  const reportType = normalizeVerificationReportType(input.reportType || "audit");
  const reportId = trim(input.reportId);
  const sourceId = trim(input.sourceId) || defaultVerificationSourceId(reportType);
  const companyName = trim(input.companyName) || "Dovecote Demo";
  const generatedAt = trim(input.generatedAt) || new Date().toISOString();
  const status = trim(input.status) || "verification";
  return [
    `Report Type: ${reportType}`,
    `Report ID: ${reportId}`,
    `Source ID: ${sourceId}`,
    `Verification Marker: ${PRODUCTION_VERIFICATION_REPORT_MARKER}`,
    `Verification Source: ${PRODUCTION_VERIFICATION_REPORT_SOURCE}`,
    `Title: ${verificationReportTitle(reportType)}`,
    `Company: ${companyName}`,
    `Generated At: ${generatedAt}`,
    `Status: ${status}`,
    `Audit Name: ${PRODUCTION_VERIFICATION_AUDIT_NAME}`,
  ];
}

function escapePdfText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildVerificationReportPdfBuffer(input = {}) {
  const lines = buildVerificationReportContentLines(input);
  const textOps = ["BT", "/F1 12 Tf", "50 740 Td", "14 TL"];
  lines.forEach((line, index) => {
    if (index > 0) {
      textOps.push("T*");
    }
    textOps.push(`(${escapePdfText(line)}) Tj`);
  });
  textOps.push("ET");
  const stream = `${textOps.join("\n")}\n`;
  const streamLength = Buffer.byteLength(stream, "utf8");
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    `5 0 obj<</Length ${streamLength}>>stream\n${stream}endstream\nendobj`,
  ];
  let offset = 0;
  const parts = ["%PDF-1.4\n"];
  const xref = ["xref", "0 6", "0000000000 65535 f "];
  for (const object of objects) {
    offset = Buffer.byteLength(parts.join(""), "utf8");
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
    parts.push(`${object}\n`);
  }
  const startxref = Buffer.byteLength(parts.join(""), "utf8");
  parts.push(`${xref.join("\n")}\n`);
  parts.push(`trailer<</Size 6/Root 1 0 R>>\n`);
  parts.push(`startxref\n${startxref}\n%%EOF`);
  return Buffer.from(parts.join(""), "utf8");
}

export function isValidVerificationPdfBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return false;
  }
  if (buffer.length < PRODUCTION_VERIFICATION_REPORT_MIN_BYTES) {
    return false;
  }
  if (buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    return false;
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 32)).toString("utf8");
  if (!tail.includes("%%EOF")) {
    return false;
  }
  const text = buffer.toString("utf8", 0, Math.min(buffer.length, 4096)).toLowerCase();
  if (text.includes("<html") || text.includes("<!doctype")) {
    return false;
  }
  return true;
}

export function estimatePdfPageCount(buffer) {
  if (!isValidVerificationPdfBuffer(buffer)) {
    return 0;
  }
  const text = buffer.toString("utf8");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length || 1;
}

export function verificationReportContentMarkers(input = {}) {
  const reportType = normalizeVerificationReportType(input.reportType || "audit");
  const reportId = trim(input.reportId);
  const sourceId = trim(input.sourceId) || defaultVerificationSourceId(reportType);
  return {
    reportType,
    reportId,
    sourceId,
    title: verificationReportTitle(reportType),
    marker: PRODUCTION_VERIFICATION_REPORT_MARKER,
    source: PRODUCTION_VERIFICATION_REPORT_SOURCE,
  };
}

export function buildWorkbookReportRow(input = {}) {
  const reportId = trim(input.reportId);
  const reportType = normalizeVerificationReportType(input.reportType || "audit");
  const createdAt = trim(input.createdAt) || new Date().toISOString();
  return {
    "Report ID": reportId,
    "Company ID": trim(input.companyFolderId),
    "Report Type": reportType,
    Title: verificationReportTitle(reportType),
    "Created By": trim(input.createdBy),
    "Created At": createdAt,
    "Visible To": trim(input.visibleTo) || "Admin",
    "Export Links": trim(input.exportLinks),
    "Sync Status": trim(input.status) || "Synced",
    "Sync Attempts": "0",
    "Last Sync Error": "",
    "Remote Row ID": "",
    "Schema Version": "3.0.0",
    "Source Type": reportType,
    "Source ID": trim(input.sourceId),
    "Verification Marker": PRODUCTION_VERIFICATION_REPORT_MARKER,
    "Verification Source": PRODUCTION_VERIFICATION_REPORT_SOURCE,
    "Drive File ID": trim(input.driveFileId),
    "Generated At": trim(input.generatedAt) || createdAt,
    Status: trim(input.status) || "active",
  };
}
