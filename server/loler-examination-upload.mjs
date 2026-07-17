/**
 * LOLER examination report/certificate upload.
 * Drive path: LOLER / Equipment / {AssetId} / Examinations
 * Parallel to incident/audit evidence — does not alter those modules.
 */
import { Readable } from "node:stream";
import {
  ensureCompanyFolderStructure,
  ensureLolerExaminationFolderId,
  LOLER_EXAMINATIONS_DRIVE_PATH_PREFIX,
} from "./company-folder-structure.mjs";
import { normalizeEvidenceUploadFile } from "./incident-evidence-upload.mjs";
import {
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";

export { LOLER_EXAMINATIONS_DRIVE_PATH_PREFIX };

export const LOLER_EXAMINATION_UPLOAD_TIMEOUT_MS = Math.min(DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS, 75_000);

const ALLOWED_MIME_PREFIXES = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/pjpeg"];

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value) {
  return trim(value).toLowerCase();
}

function isAllowedMime(mimeType) {
  const mime = safeLower(mimeType);
  return ALLOWED_MIME_PREFIXES.some((allowed) => mime === allowed || mime.startsWith(`${allowed};`));
}

function extensionFromFile(name, mimeType) {
  const base = trim(name);
  const dot = base.lastIndexOf(".");
  if (dot > 0 && dot < base.length - 1) {
    const ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (["pdf", "jpg", "jpeg", "png"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  }
  const mime = safeLower(mimeType);
  if (mime.includes("png")) return "png";
  if (mime.includes("pdf")) return "pdf";
  return "jpg";
}

function buildReportFileName(examinationId, name, mimeType) {
  const ext = extensionFromFile(name, mimeType);
  return `${trim(examinationId) || "exam"}-report.${ext}`;
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const match = raw.match(/^data:([^;,]+)(?:;[^,]*)*;base64,([\s\S]+)$/);
  if (!match) {
    return null;
  }
  const mimeType = trim(match[1]) || "application/octet-stream";
  const encoded = String(match[2] || "").replace(/\s/g, "");
  if (!encoded) {
    return null;
  }
  const body = Buffer.from(encoded, "base64");
  if (!body.length) {
    return null;
  }
  return { mimeType, body };
}

async function uploadDataUrlToDrive(auth, google, folderId, fileName, mimeType, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return { id: "", link: "", error: "Invalid or missing data URL payload." };
  }
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName || `loler-report-${Date.now()}`,
      parents: [folderId],
      mimeType: mimeType || parsed.mimeType,
    },
    media: {
      mimeType: mimeType || parsed.mimeType,
      body: Readable.from(parsed.body),
    },
    fields: "id,webViewLink,name",
  });
  return {
    id: response.data.id || "",
    link: response.data.webViewLink || "",
    name: response.data.name || fileName,
    error: "",
  };
}

function buildFolderStructureDeps(deps = {}) {
  return {
    google: deps.google,
    ensureTabExists: deps.ensureTabExists,
    ensureColumns: deps.ensureColumns,
    getWorkbook: deps.getWorkbook,
    getTabValues: deps.getTabValues,
    withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
    safeLower: deps.safeLower || safeLower,
  };
}

/**
 * Upload one examination report/certificate (PDF/JPG/PNG).
 * input.file may be a single evidence-style object with dataUrl/base64.
 */
export async function uploadLolerExaminationReportToDrive(auth, deps, input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);
  const examinationId = trim(input.examinationId);
  const assetId = trim(input.assetId) || "unknown-asset";
  const file = input.file
    ? normalizeEvidenceUploadFile(input.file, 0)
    : Array.isArray(input.files) && input.files[0]
      ? normalizeEvidenceUploadFile(input.files[0], 0)
      : null;

  if (!companyFolderId || !examinationId) {
    return {
      ok: false,
      code: "LOLER_REPORT_INVALID",
      error: "Company folder and examination ID are required for report upload.",
      message: "Company folder and examination ID are required for report upload.",
      httpStatus: 400,
    };
  }

  if (!file || !file.dataUrl?.startsWith("data:")) {
    return { ok: true, skipped: true, reportFileId: "", reportFileName: "", reportFileUrl: "" };
  }

  if (!isAllowedMime(file.mimeType)) {
    return {
      ok: false,
      code: "LOLER_REPORT_TYPE_REJECTED",
      error: "Examination reports must be PDF, JPG, or PNG.",
      message: "Examination reports must be PDF, JPG, or PNG.",
      httpStatus: 400,
    };
  }

  if (!deps?.google) {
    return {
      ok: false,
      code: "LOLER_REPORT_UNAVAILABLE",
      error: "Google Drive is not configured for examination report upload.",
      message: "Google Drive is not configured for examination report upload.",
      httpStatus: 503,
    };
  }

  try {
    await ensureCompanyFolderStructure(buildFolderStructureDeps(deps), auth, {
      companyRootFolderId: companyFolderId,
      masterSheetId,
      syncWorkbookTab: false,
      placeFiles: false,
    });
    const drive = deps.google.drive({ version: "v3", auth });
    const folder = await ensureLolerExaminationFolderId(drive, companyFolderId, assetId);
    const fileName = buildReportFileName(examinationId, file.name, file.mimeType);
    const uploaded = await withOperationTimeout(
      uploadDataUrlToDrive(auth, deps.google, folder.folderId, fileName, file.mimeType, file.dataUrl),
      "loler_examination_report_upload",
      LOLER_EXAMINATION_UPLOAD_TIMEOUT_MS,
    );
    if (!uploaded.id) {
      return {
        ok: false,
        code: "LOLER_REPORT_UPLOAD_FAILED",
        error: uploaded.error || "Could not upload examination report.",
        message: uploaded.error || "Could not upload examination report.",
        httpStatus: 502,
      };
    }
    return {
      ok: true,
      reportFileId: uploaded.id,
      reportFileName: uploaded.name || fileName,
      reportFileUrl: uploaded.link,
      folderPath: folder.path,
      folderId: folder.folderId,
    };
  } catch (error) {
    return {
      ok: false,
      code: "LOLER_REPORT_UPLOAD_FAILED",
      error: error instanceof Error ? error.message : String(error),
      message: "Could not upload examination report.",
      httpStatus: 502,
    };
  }
}
