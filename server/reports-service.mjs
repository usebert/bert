/**
 * Company compliance report generation — verification reports and workbook metadata.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { canViewReportsDashboard } from "../shared/reports-dashboard.mjs";
import {
  buildProductionVerificationReportFilename,
  buildVerificationReportPdfBuffer,
  buildWorkbookReportRow,
  findReportById,
  isActiveVerificationReport,
  isOperationalReport,
  isSupportedVerificationReportType,
  isValidVerificationPdfBuffer,
  isVerificationReport,
  isVerificationReportId,
  listActiveVerificationReports,
  mapWorkbookReportRecord,
  normalizeVerificationReportType,
  OPTIONAL_UNSUPPORTED_REPORT_TYPES,
  PRODUCTION_VERIFICATION_REPORT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_REPORT_SOURCE,
  REPORTS_TAB,
  REPORTS_TAB_COLUMNS,
  SUPPORTED_VERIFICATION_REPORT_TYPES,
  verificationReportContentMarkers,
} from "../shared/production-verification-report.mjs";
import { withOperationTimeout } from "./ensure-required-tabs.mjs";
import {
  appendTabRows as workbookAppendTabRows,
  ensureTabColumns as workbookEnsureTabColumns,
  patchTabRowByHeader as workbookPatchTabRowByHeader,
  readTabRecords as workbookReadTabRecords,
} from "./workbook-service.mjs";

export const REPORTS_ROUTE_TIMEOUT_MS = 120_000;
export const REPORTS_GENERATION_TIMEOUT_MS = 180_000;

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function reportsApiFailure(code, error, httpStatus = 400, details = {}) {
  return {
    ok: false,
    code,
    error,
    message: error,
    httpStatus,
    ...details,
  };
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveAppendTabRows(deps) {
  return typeof deps?.appendTabRows === "function" ? deps.appendTabRows : workbookAppendTabRows;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
}

function resolvePatchTabRowByHeader(deps) {
  return typeof deps?.patchTabRowByHeader === "function" ? deps.patchTabRowByHeader : workbookPatchTabRowByHeader;
}

function reportStoreRoot(sessionDir) {
  return path.join(sessionDir, "verification-reports");
}

function reportFilePath(sessionDir, companyFolderId, reportId) {
  return path.join(reportStoreRoot(sessionDir), companyFolderId, `${reportId}.pdf`);
}

async function ensureReportDir(sessionDir, companyFolderId) {
  await fs.mkdir(path.join(reportStoreRoot(sessionDir), companyFolderId), { recursive: true });
}

export function canManageCompanyReports(actor) {
  const role = trim(actor?.role);
  return role === "Admin" || role === "Master" || role === "Manager";
}

export function canViewCompanyReports(actor, companyFolderId, alternateIds = []) {
  return canViewReportsDashboard(actor, companyFolderId, alternateIds) || canManageCompanyReports(actor);
}

export async function readCompanyReportsTab(auth, deps, masterSheetId) {
  const readTabRecords = resolveReadTabRecords(deps);
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, masterSheetId, REPORTS_TAB, REPORTS_TAB_COLUMNS);
  const result = await readTabRecords(auth, deps, masterSheetId, REPORTS_TAB, {
    expectedHeaders: REPORTS_TAB_COLUMNS,
  });
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    records: Array.isArray(result.records) ? result.records : [],
  };
}

export function listSupportedReportTypes() {
  return {
    supported: [...SUPPORTED_VERIFICATION_REPORT_TYPES],
    unsupported: [...OPTIONAL_UNSUPPORTED_REPORT_TYPES],
  };
}

export async function listCompanyReports(auth, deps, resolved, actor = {}) {
  const readResult = await readCompanyReportsTab(auth, deps, resolved.masterSheetId);
  if (!readResult.ok) {
    return reportsApiFailure(readResult.code || "REPORTS_LIST_FAILED", readResult.error || "Could not list reports.", readResult.httpStatus || 500);
  }
  const reports = readResult.records
    .map(mapWorkbookReportRecord)
    .filter((item) => trim(item.companyId) === resolved.companyFolderId || !trim(item.companyId));
  return {
    ok: true,
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
    supportedTypes: listSupportedReportTypes(),
    reports: reports.map((item) => ({
      reportId: item.reportId,
      reportType: item.reportType,
      title: item.title,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      generatedAt: item.generatedAt,
      status: item.status,
      verification: isVerificationReport(item),
    })),
  };
}

async function writeReportFile(sessionDir, companyFolderId, reportId, buffer) {
  await ensureReportDir(sessionDir, companyFolderId);
  const filePath = reportFilePath(sessionDir, companyFolderId, reportId);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function readReportFile(sessionDir, companyFolderId, reportId) {
  try {
    return await fs.readFile(reportFilePath(sessionDir, companyFolderId, reportId));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function deleteReportFile(sessionDir, companyFolderId, reportId) {
  try {
    await fs.unlink(reportFilePath(sessionDir, companyFolderId, reportId));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function uploadReportToExportsFolder(auth, deps, resolved, fileName, buffer) {
  const exportsFolderId = trim(resolved?.exportsFolderId || resolved?.isoFolders?.exportsFolderId);
  if (!exportsFolderId || !deps?.google || !auth) {
    return { ok: false, skipped: true };
  }
  try {
    const drive = deps.google.drive({ version: "v3", auth });
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [exportsFolderId],
        mimeType: "application/pdf",
      },
      media: {
        mimeType: "application/pdf",
        body: Readable.from(buffer),
      },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });
    return {
      ok: true,
      driveFileId: trim(response?.data?.id),
      exportLink: trim(response?.data?.webViewLink),
    };
  } catch (error) {
    return {
      ok: false,
      code: "REPORT_DRIVE_UPLOAD_FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateVerificationReport(auth, deps, resolved, actor, input = {}) {
  const reportType = normalizeVerificationReportType(input.reportType);
  const reportId = trim(input.reportId);
  const sourceId = trim(input.sourceId);
  const sessionDir = trim(deps?.sessionDir);
  if (!isSupportedVerificationReportType(reportType)) {
    return reportsApiFailure("REPORT_TYPE_UNSUPPORTED", `Report type '${reportType}' is not supported.`, 400);
  }
  if (!isVerificationReportId(reportId)) {
    return reportsApiFailure("REPORT_ID_INVALID", "Report ID must use the bert-smoke-report- verification prefix.", 400);
  }
  if (!sourceId) {
    return reportsApiFailure("REPORT_SOURCE_REQUIRED", "Source record ID is required.", 400);
  }
  if (!sessionDir) {
    return reportsApiFailure("REPORT_STORAGE_UNAVAILABLE", "Report storage is not configured.", 503);
  }
  if (!canManageCompanyReports(actor)) {
    return reportsApiFailure("REPORT_FORBIDDEN", "You do not have permission to generate reports.", 403);
  }

  const readResult = await readCompanyReportsTab(auth, deps, resolved.masterSheetId);
  if (!readResult.ok) {
    return reportsApiFailure(readResult.code || "REPORTS_READ_FAILED", readResult.error || "Could not read reports tab.", readResult.httpStatus || 500);
  }
  const existing = findReportById(readResult.records, reportId);
  if (existing && isActiveVerificationReport(existing)) {
    const buffer = await readReportFile(sessionDir, resolved.companyFolderId, reportId);
    if (buffer && isValidVerificationPdfBuffer(buffer)) {
      return {
        ok: true,
        idempotent: true,
        reportId,
        reportType,
        sourceId,
        fileName: buildProductionVerificationReportFilename(input.runId, reportType),
        fileSize: buffer.length,
        pageCount: 1,
        mimeType: "application/pdf",
        driveFileId: trim(existing.driveFileId),
        generatedAt: trim(existing.generatedAt),
      };
    }
  }

  const generatedAt = nowIso();
  const buffer = buildVerificationReportPdfBuffer({
    reportType,
    reportId,
    sourceId,
    companyName: trim(resolved.companyName) || "Dovecote Demo",
    generatedAt,
    status: "verification",
  });
  if (!isValidVerificationPdfBuffer(buffer)) {
    return reportsApiFailure("REPORT_PDF_INVALID", "Generated report PDF failed integrity checks.", 500);
  }

  const fileName = buildProductionVerificationReportFilename(input.runId, reportType);
  await writeReportFile(sessionDir, resolved.companyFolderId, reportId, buffer);
  const driveUpload = await uploadReportToExportsFolder(auth, deps, resolved, fileName, buffer);
  const exportLinks = driveUpload.ok ? trim(driveUpload.exportLink) : "";
  const driveFileId = driveUpload.ok ? trim(driveUpload.driveFileId) : "";

  const row = buildWorkbookReportRow({
    reportId,
    companyFolderId: resolved.companyFolderId,
    reportType,
    createdBy: trim(actor?.email || actor?.name),
    createdAt: generatedAt,
    sourceId,
    exportLinks,
    driveFileId,
    generatedAt,
    status: "active",
  });

  const appendTabRows = resolveAppendTabRows(deps);
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  if (existing) {
    const patch = {
      ...row,
      Status: "active",
      "Sync Status": "Synced",
    };
    const patched = await patchTabRowByHeader(auth, deps, resolved.masterSheetId, REPORTS_TAB, "Report ID", reportId, patch);
    if (!patched.ok) {
      return reportsApiFailure(patched.code || "REPORT_METADATA_WRITE_FAILED", patched.error || "Could not update report metadata.", patched.httpStatus || 500);
    }
  } else {
    const appended = await appendTabRows(auth, deps, resolved.masterSheetId, REPORTS_TAB, [row], {
      expectedHeaders: REPORTS_TAB_COLUMNS,
    });
    if (!appended.ok) {
      return reportsApiFailure(appended.code || "REPORT_METADATA_WRITE_FAILED", appended.error || "Could not write report metadata.", appended.httpStatus || 500);
    }
  }

  return {
    ok: true,
    idempotent: false,
    reportId,
    reportType,
    sourceId,
    fileName,
    fileSize: buffer.length,
    pageCount: 1,
    mimeType: "application/pdf",
    driveFileId,
    exportLinks,
    generatedAt,
    markers: verificationReportContentMarkers({ reportType, reportId, sourceId }),
    driveUploadSkipped: driveUpload.skipped === true,
  };
}

export async function getVerificationReport(auth, deps, resolved, actor, reportId) {
  const readResult = await readCompanyReportsTab(auth, deps, resolved.masterSheetId);
  if (!readResult.ok) {
    return reportsApiFailure(readResult.code || "REPORTS_READ_FAILED", readResult.error || "Could not read reports tab.", readResult.httpStatus || 500);
  }
  const report = findReportById(readResult.records, reportId);
  if (!report) {
    return reportsApiFailure("REPORT_NOT_FOUND", "Report not found.", 404);
  }
  if (!canViewCompanyReports(actor, resolved.companyFolderId, resolved.alternateIds || [])) {
    return reportsApiFailure("REPORT_FORBIDDEN", "You do not have permission to view this report.", 403);
  }
  return {
    ok: true,
    report: {
      ...report,
      verification: isVerificationReport(report),
      markers: verificationReportContentMarkers({
        reportType: report.reportType,
        reportId: report.reportId,
        sourceId: report.sourceId,
      }),
    },
  };
}

export async function downloadVerificationReport(auth, deps, resolved, actor, reportId) {
  const metadata = await getVerificationReport(auth, deps, resolved, actor, reportId);
  if (!metadata.ok) {
    return metadata;
  }
  const sessionDir = trim(deps?.sessionDir);
  if (!sessionDir) {
    return reportsApiFailure("REPORT_STORAGE_UNAVAILABLE", "Report storage is not configured.", 503);
  }
  const buffer = await readReportFile(sessionDir, resolved.companyFolderId, reportId);
  if (!buffer || !isValidVerificationPdfBuffer(buffer)) {
    return reportsApiFailure("REPORT_FILE_MISSING", "Report file is missing or invalid.", 404);
  }
  return {
    ok: true,
    reportId,
    fileName: buildProductionVerificationReportFilename(reportId.split("-").slice(-2)[0] || Date.now(), metadata.report.reportType),
    mimeType: "application/pdf",
    fileSize: buffer.length,
    buffer,
  };
}

export async function cleanupVerificationReport(auth, deps, resolved, actor, reportId, input = {}) {
  if (!isVerificationReportId(reportId)) {
    return reportsApiFailure("REPORT_CLEANUP_REJECTED", "Only verification report IDs may be cleaned.", 400);
  }
  if (!canManageCompanyReports(actor)) {
    return reportsApiFailure("REPORT_CLEANUP_FORBIDDEN", "You do not have permission to clean verification reports.", 403);
  }
  const readResult = await readCompanyReportsTab(auth, deps, resolved.masterSheetId);
  if (!readResult.ok) {
    return reportsApiFailure(readResult.code || "REPORTS_READ_FAILED", readResult.error || "Could not read reports tab.", readResult.httpStatus || 500);
  }
  const report = findReportById(readResult.records, reportId);
  if (!report) {
    return { ok: true, reportId, cleaned: false, alreadyClean: true };
  }
  if (isOperationalReport(report)) {
    return reportsApiFailure("REPORT_CLEANUP_REJECTED", "Ordinary customer reports cannot be cleaned by the verification gate.", 400);
  }
  const patchTabRowByHeader = resolvePatchTabRowByHeader(deps);
  const patched = await patchTabRowByHeader(auth, deps, resolved.masterSheetId, REPORTS_TAB, "Report ID", reportId, {
    Status: PRODUCTION_VERIFICATION_REPORT_CLEANED_STATUS,
    "Sync Status": PRODUCTION_VERIFICATION_REPORT_CLEANED_STATUS,
    "Export Links": "",
    "Drive File ID": "",
    "Verification Marker": PRODUCTION_VERIFICATION_REPORT_CLEANED_STATUS,
    "Verification Source": PRODUCTION_VERIFICATION_REPORT_SOURCE,
  });
  if (!patched.ok) {
    return reportsApiFailure(patched.code || "REPORT_CLEANUP_FAILED", patched.error || "Could not clean report metadata.", patched.httpStatus || 500);
  }
  const sessionDir = trim(deps?.sessionDir);
  if (sessionDir) {
    await deleteReportFile(sessionDir, resolved.companyFolderId, reportId);
  }
  return {
    ok: true,
    reportId,
    cleaned: true,
    alreadyClean: false,
  };
}

export async function cleanupStaleVerificationReports(auth, deps, resolved, actor, input = {}) {
  const readResult = await readCompanyReportsTab(auth, deps, resolved.masterSheetId);
  if (!readResult.ok) {
    return reportsApiFailure(readResult.code || "REPORTS_READ_FAILED", readResult.error || "Could not read reports tab.", readResult.httpStatus || 500);
  }
  const stale = listActiveVerificationReports(readResult.records);
  const results = [];
  for (const report of stale) {
    if (input.reportRunId && !trim(report.reportId).includes(trim(input.reportRunId))) {
      const keepCurrentRun = trim(input.keepCurrentRunId);
      if (keepCurrentRun && trim(report.reportId).includes(keepCurrentRun)) {
        continue;
      }
    }
    const cleaned = await cleanupVerificationReport(auth, deps, resolved, actor, report.reportId, input);
    results.push({
      reportId: report.reportId,
      ok: cleaned.ok,
      cleaned: cleaned.cleaned === true,
      alreadyClean: cleaned.alreadyClean === true,
      code: cleaned.code,
    });
  }
  return {
    ok: true,
    companyFolderId: resolved.companyFolderId,
    masterSheetId: resolved.masterSheetId,
    cleanedCount: results.filter((item) => item.cleaned).length,
    results,
  };
}

export function logReportingMutationTiming(operation, stage, details = {}) {
  console.info("[reporting:timing]", {
    operation,
    stage,
    reportType: trim(details.reportType) || undefined,
    reportId: trim(details.reportId) || undefined,
    sourceId: trim(details.sourceId) || undefined,
    fileSize: details.fileSize ?? undefined,
    pageCount: details.pageCount ?? undefined,
    durationMs: details.durationMs ?? undefined,
    totalMs: details.totalMs ?? undefined,
  });
}

export async function withReportingTimeout(promise, label, timeoutMs = REPORTS_ROUTE_TIMEOUT_MS) {
  return withOperationTimeout(promise, label, timeoutMs);
}
