/**
 * Incident evidence upload — Drive path: 03 - Evidence / Photos / Incidents / {incidentId}
 */
import {
  ensureCompanyFolderStructure,
  ensureIncidentEvidenceFolderId,
  INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX,
} from "./company-folder-structure.mjs";
import {
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";

export { INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX };

export const INCIDENT_EVIDENCE_UPLOAD_TIMEOUT_MS = Math.min(DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS, 75_000);

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

export function buildIncidentEvidenceFileName(incidentId, index, name, mimeType) {
  const ext = extensionFromFile(name, mimeType);
  return `${trim(incidentId)}-photo-${index + 1}.${ext}`;
}

export function sanitizeEvidenceItemForWorkbook(item = {}) {
  const preview = trim(item.previewUrl || item.driveLink || item.url);
  const driveLink = trim(item.driveLink || item.url);
  const safePreview = preview.startsWith("data:") ? driveLink : preview || driveLink;
  const safeDriveLink = driveLink.startsWith("data:") ? "" : driveLink;
  const next = {
    id: trim(item.id),
    name: trim(item.name),
    mimeType: trim(item.mimeType) || "application/octet-stream",
    previewUrl: safePreview,
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

export function sanitizeEvidenceUrlsForWorkbook(evidenceUrls) {
  const items = Array.isArray(evidenceUrls) ? evidenceUrls : [];
  return items
    .map((item) => sanitizeEvidenceItemForWorkbook(item))
    .filter((item) => item.id && !trim(item.previewUrl).startsWith("data:"));
}

async function uploadDataUrlToDrive(auth, google, folderId, fileName, mimeType, dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return { id: "", link: "" };
  }

  const [, parsedMimeType, encoded] = match;
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName || `evidence-${Date.now()}`,
      parents: [folderId],
      mimeType: mimeType || parsedMimeType,
    },
    media: {
      mimeType: mimeType || parsedMimeType,
      body: Buffer.from(encoded, "base64"),
    },
    fields: "id,webViewLink",
  });

  return {
    id: response.data.id || "",
    link: response.data.webViewLink || "",
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

export async function uploadIncidentEvidenceToDrive(auth, deps, input = {}) {
  const companyFolderId = trim(input.companyFolderId || input.companyId);
  const masterSheetId = trim(input.masterSheetId);
  const incidentId = trim(input.incidentId);
  const files = Array.isArray(input.files) ? input.files : [];

  if (!companyFolderId || !incidentId) {
    return {
      ok: false,
      code: "INCIDENT_EVIDENCE_INVALID",
      error: "Company folder and incident ID are required for evidence upload.",
      message: "Company folder and incident ID are required for evidence upload.",
      httpStatus: 400,
    };
  }

  const folderPath = `${INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX}/${incidentId}`;
  if (files.length === 0) {
    return { ok: true, evidenceUrls: [], folderPath, folderId: "" };
  }

  if (!deps?.google) {
    return {
      ok: false,
      code: "INCIDENT_EVIDENCE_UNAVAILABLE",
      error: "Google Drive is not configured for evidence upload.",
      message: "Google Drive is not configured for evidence upload.",
      httpStatus: 503,
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
        code: "INCIDENT_EVIDENCE_FOLDER_MISSING",
        error: "Could not find the company Photos evidence folder.",
        message: "Could not find the company Photos evidence folder.",
        httpStatus: 502,
      };
    }
    const drive = deps.google.drive({ version: "v3", auth });
    const ensured = await ensureIncidentEvidenceFolderId(drive, photosFolderId, incidentId);
    folderId = ensured.folderId;
    console.info("[incidents]", {
      phase: "evidence_folder_ready",
      companyId: companyFolderId,
      incidentId,
      folderId,
      folderPath: ensured.path,
    });
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "INCIDENT_EVIDENCE_FOLDER_FAILED",
      error: "Could not prepare the incident evidence folder in Google Drive.",
      message: "Could not prepare the incident evidence folder in Google Drive.",
      technicalError,
      httpStatus: 502,
    };
  }

  const evidenceUrls = [];
  const errors = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] || {};
    const dataUrl = trim(file.dataUrl);
    if (!dataUrl.startsWith("data:")) {
      errors.push(`File ${index + 1} is missing upload data.`);
      continue;
    }
    const displayName = trim(file.name) || `photo-${index + 1}`;
    const fileName = buildIncidentEvidenceFileName(incidentId, index, displayName, file.mimeType);
    try {
      const upload = await withOperationTimeout(
        uploadDataUrlToDrive(auth, deps.google, folderId, fileName, file.mimeType, dataUrl),
        "upload_incident_evidence_file",
        INCIDENT_EVIDENCE_UPLOAD_TIMEOUT_MS,
      );
      if (!upload.id) {
        errors.push(`Could not upload ${displayName}.`);
        continue;
      }
      evidenceUrls.push(
        sanitizeEvidenceItemForWorkbook({
          id: trim(file.id) || `incident-evidence-${incidentId}-${index + 1}`,
          name: fileName,
          mimeType: trim(file.mimeType) || "application/octet-stream",
          previewUrl: upload.link,
          driveLink: upload.link,
          driveFileId: upload.id,
          addedAt: trim(file.addedAt) || new Date().toISOString(),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Could not upload ${displayName}: ${message}`);
    }
  }

  const failed = errors.length > 0 && evidenceUrls.length === 0;
  const warning = errors.length > 0 ? errors.join(" ") : "";

  return {
    ok: !failed,
    evidenceUrls,
    folderPath,
    folderId,
    errors,
    partial: errors.length > 0 && evidenceUrls.length > 0,
    warning,
    error: failed ? warning || "Incident evidence upload failed." : "",
    message: failed ? warning || "Incident evidence upload failed." : "",
    httpStatus: failed ? 502 : 200,
  };
}
