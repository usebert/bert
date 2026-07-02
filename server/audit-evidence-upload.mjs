/**
 * Audit/check evidence upload — Drive path: 03 - Evidence / Photos / Audits / {resultId}
 */
import { Readable } from "node:stream";
import {
  ensureCompanyFolderStructure,
  ensureAuditEvidenceFolderId,
  AUDIT_EVIDENCE_DRIVE_PATH_PREFIX,
} from "./company-folder-structure.mjs";
import {
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";
import { normalizeEvidenceUploadFile } from "./incident-evidence-upload.mjs";

export { AUDIT_EVIDENCE_DRIVE_PATH_PREFIX };

export const AUDIT_EVIDENCE_UPLOAD_TIMEOUT_MS = Math.min(DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS, 75_000);

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value) {
  return trim(value).toLowerCase();
}

function extensionFromFile(name, mimeType) {
  const base = trim(name);
  const dot = base.lastIndexOf(".");
  if (dot > 0 && dot < base.length - 1) {
    const ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (ext) {
      return ext;
    }
  }
  const mime = safeLower(mimeType);
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "jpg";
}

export function buildAuditEvidenceFileName(resultId, index, name, mimeType) {
  const ext = extensionFromFile(name, mimeType);
  return `${trim(resultId)}-photo-${index + 1}.${ext}`;
}

export function sanitizeAuditEvidenceRefForWorkbook(item = {}) {
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

export function sanitizeAuditEvidenceRefsForWorkbook(evidenceRefs) {
  const items = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  return items
    .map((item) => sanitizeAuditEvidenceRefForWorkbook(item))
    .filter((item) => item.evidenceId && item.questionId);
}

export function normalizeAuditEvidenceUploadFile(file = {}, index = 0) {
  const base = normalizeEvidenceUploadFile(file, index);
  return {
    ...base,
    evidenceId: trim(file.evidenceId || file.id) || base.id,
    questionId: trim(file.questionId),
  };
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
      name: fileName || `evidence-${Date.now()}`,
      parents: [folderId],
      mimeType: mimeType || parsed.mimeType,
    },
    media: {
      mimeType: mimeType || parsed.mimeType,
      body: Readable.from(parsed.body),
    },
    fields: "id,webViewLink",
  });

  return {
    id: response.data.id || "",
    link: response.data.webViewLink || "",
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

export async function uploadAuditEvidenceToDrive(auth, deps, input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);
  const resultId = trim(input.resultId);
  const files = (Array.isArray(input.files) ? input.files : []).map((file, index) =>
    normalizeAuditEvidenceUploadFile(file, index),
  );
  const validDataUrlCount = files.filter((file) => file.dataUrl.startsWith("data:")).length;
  console.info("[audit-evidence]", {
    phase: "audit_evidence_upload_start",
    companyId: companyFolderId,
    resultId,
    fileCount: files.length,
    validDataUrlCount,
  });

  if (!companyFolderId || !resultId) {
    return {
      ok: false,
      code: "AUDIT_EVIDENCE_INVALID",
      error: "Company folder and result ID are required for evidence upload.",
      message: "Company folder and result ID are required for evidence upload.",
      httpStatus: 400,
      evidenceRefs: [],
    };
  }

  const folderPath = `${AUDIT_EVIDENCE_DRIVE_PATH_PREFIX}/${resultId}`;
  if (files.length === 0) {
    return { ok: true, evidenceRefs: [], folderPath, folderId: "" };
  }

  if (!deps?.google) {
    return {
      ok: false,
      code: "AUDIT_EVIDENCE_UNAVAILABLE",
      error: "Google Drive is not configured for evidence upload.",
      message: "Google Drive is not configured for evidence upload.",
      httpStatus: 503,
      evidenceRefs: [],
    };
  }

  let folderId = "";
  try {
    const structure = await ensureCompanyFolderStructure(buildFolderStructureDeps(deps), auth, {
      companyRootFolderId: companyFolderId,
      masterSheetId,
      syncWorkbookTab: false,
      placeFiles: false,
    });
    const photosFolderId = structure.folderIds.EVIDENCE_PHOTOS;
    if (!photosFolderId) {
      return {
        ok: false,
        code: "AUDIT_EVIDENCE_FOLDER_MISSING",
        error: "Could not find the company Photos evidence folder.",
        message: "Could not find the company Photos evidence folder.",
        httpStatus: 502,
        evidenceRefs: [],
      };
    }
    const drive = deps.google.drive({ version: "v3", auth });
    const ensured = await ensureAuditEvidenceFolderId(drive, photosFolderId, resultId);
    folderId = ensured.folderId;
    console.info("[audit-evidence]", {
      phase: "audit_evidence_folder_ready",
      companyId: companyFolderId,
      resultId,
      folderId,
      folderPath: ensured.path,
    });
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "AUDIT_EVIDENCE_FOLDER_FAILED",
      error: "Could not prepare the audit evidence folder in Google Drive.",
      message: "Could not prepare the audit evidence folder in Google Drive.",
      technicalError,
      httpStatus: 502,
      evidenceRefs: [],
    };
  }

  const evidenceRefs = [];
  const errors = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] || {};
    const dataUrl = trim(file.dataUrl);
    const displayName = trim(file.name) || `photo-${index + 1}`;
    const fileName = buildAuditEvidenceFileName(resultId, index, displayName, file.mimeType);
    if (!dataUrl.startsWith("data:")) {
      const message = `File ${index + 1} is missing upload data.`;
      console.info("[audit-evidence]", {
        phase: "audit_evidence_file_error",
        resultId,
        fileName: displayName,
        mimeType: file.mimeType,
        size: file.size || 0,
        error: message,
      });
      errors.push(message);
      continue;
    }
    console.info("[audit-evidence]", {
      phase: "audit_evidence_file_start",
      resultId,
      fileName: displayName,
      mimeType: file.mimeType,
      size: file.size || 0,
      dataUrlLength: dataUrl.length,
    });
    try {
      const upload = await withOperationTimeout(
        uploadDataUrlToDrive(auth, deps.google, folderId, fileName, file.mimeType, dataUrl),
        "upload_audit_evidence_file",
        AUDIT_EVIDENCE_UPLOAD_TIMEOUT_MS,
      );
      if (!upload.id) {
        const message = upload.error || `Could not upload ${displayName}.`;
        console.info("[audit-evidence]", {
          phase: "audit_evidence_file_error",
          resultId,
          fileName: displayName,
          mimeType: file.mimeType,
          size: file.size || 0,
          error: message,
        });
        errors.push(message);
        continue;
      }
      console.info("[audit-evidence]", {
        phase: "audit_evidence_file_success",
        resultId,
        fileName: displayName,
        driveFileId: upload.id,
      });
      evidenceRefs.push(
        sanitizeAuditEvidenceRefForWorkbook({
          questionId: file.questionId,
          evidenceId: trim(file.evidenceId) || trim(file.id) || `audit-evidence-${resultId}-${index + 1}`,
          name: fileName,
          mimeType: trim(file.mimeType) || "application/octet-stream",
          driveLink: upload.link,
          driveFileId: upload.id,
          addedAt: trim(file.addedAt) || new Date().toISOString(),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.info("[audit-evidence]", {
        phase: "audit_evidence_file_error",
        resultId,
        fileName: displayName,
        mimeType: file.mimeType,
        size: file.size || 0,
        error: message,
      });
      errors.push(`Could not upload ${displayName}: ${message}`);
    }
  }

  const failed = errors.length > 0 && evidenceRefs.length === 0;
  const warning = errors.length > 0 ? errors.join(" ") : "";

  return {
    ok: !failed,
    evidenceRefs,
    folderPath,
    folderId,
    errors,
    partial: errors.length > 0 && evidenceRefs.length > 0,
    warning,
    error: failed ? warning || "Audit evidence upload failed." : "",
    message: failed ? warning || "Audit evidence upload failed." : "",
    httpStatus: failed ? 502 : 200,
  };
}
