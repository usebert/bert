/**
 * Document Control Drive folders + optional file upload.
 * Structure under company root:
 *   Document Control / Current | Drafts | Superseded | Archived
 */
import { Readable } from "node:stream";
import {
  DOCUMENT_CONTROL_DRIVE_FOLDERS,
  DOCUMENT_CONTROL_DRIVE_ROOT,
  isAllowedDocumentExtension,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_FILE_BYTES,
} from "../shared/document-control.mjs";
import {
  getDocumentControlFolderStructureCache,
  setDocumentControlFolderStructureCache,
} from "./document-control-list-cache.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

export function googleDriveErrorDetails(error) {
  const status = Number(error?.code || error?.response?.status || 0);
  const apiError = error?.response?.data?.error || {};
  return {
    googleErrorCode: status || undefined,
    googleErrorReason: trim(apiError.errors?.[0]?.reason) || undefined,
    googleErrorMessage: trim(apiError.message || error?.message) || "Google API request failed.",
    googleErrorStatus: trim(apiError.status) || undefined,
  };
}

export function logDocumentUploadTiming(meta = {}) {
  const payload = {
    stage: trim(meta.stage),
    documentId: trim(meta.documentId),
    revisionId: trim(meta.revisionId),
    companyFolderId: trim(meta.companyFolderId),
    masterSheetId: trim(meta.workbookId) || trim(meta.masterSheetId),
    workbookId: trim(meta.workbookId) || trim(meta.masterSheetId),
    targetFolderId: trim(meta.targetFolderId),
    mimeType: trim(meta.mimeType),
    fileSize: Number(meta.fileSize) || 0,
    durationMs: Number(meta.durationMs) || 0,
    totalMs: Number(meta.totalMs) || Number(meta.durationMs) || 0,
    ...(meta.failureStage ? { failureStage: trim(meta.failureStage) } : {}),
    ...(meta.googleErrorCode ? { googleErrorCode: meta.googleErrorCode } : {}),
    ...(meta.googleErrorReason ? { googleErrorReason: meta.googleErrorReason } : {}),
    ...(meta.patchAcknowledgedRows !== undefined ? { patchAcknowledgedRows: meta.patchAcknowledgedRows } : {}),
    ...(meta.readbackMatched !== undefined ? { readbackMatched: meta.readbackMatched } : {}),
    ...(meta.readbackFileId ? { readbackFileId: trim(meta.readbackFileId) } : {}),
    ...(meta.orphanCleanupDeleted !== undefined ? { orphanCleanupDeleted: meta.orphanCleanupDeleted } : {}),
  };
  console.info("[document:upload-timing]", payload);
}

export function logDocumentUploadFailure(meta = {}) {
  console.error("[document-control-upload] failed:", {
    operationStage: trim(meta.operationStage || meta.stage),
    documentId: trim(meta.documentId),
    revisionId: trim(meta.revisionId),
    companyFolderId: trim(meta.companyFolderId),
    workbookId: trim(meta.workbookId) || trim(meta.masterSheetId),
    targetFolderId: trim(meta.targetFolderId),
    mimeType: trim(meta.mimeType),
    fileSize: Number(meta.fileSize) || 0,
    code: trim(meta.code),
    httpStatus: Number(meta.httpStatus) || 500,
    googleErrorCode: meta.googleErrorCode,
    googleErrorReason: meta.googleErrorReason,
    patchAcknowledgedRows: meta.patchAcknowledgedRows,
    readbackMatched: meta.readbackMatched,
    readbackFileId: trim(meta.readbackFileId),
    orphanCleanupDeleted: meta.orphanCleanupDeleted,
  });
}

export function parseDocumentControlDataUrl(dataUrl) {
  const raw = trim(dataUrl);
  const match = raw.match(/^data:([^;,]+)(?:;[^,]*)*;base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const mimeType = trim(match[1]) || "application/octet-stream";
  const encoded = String(match[2] || "").replace(/\s/g, "");
  if (!encoded) {
    return null;
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) {
    return null;
  }
  return { mimeType, buffer };
}

export function validateDocumentControlUploadInput(input = {}) {
  const folderId = trim(input.folderId);
  const fileName = trim(input.fileName) || "document";
  const explicitMimeType = trim(input.mimeType);
  if (!folderId) {
    return { ok: false, code: "UPLOAD_FOLDER_REQUIRED", message: "Document Control folder is required for upload." };
  }
  const parsed = parseDocumentControlDataUrl(input.fileDataUrl);
  if (!parsed) {
    return { ok: false, code: "UPLOAD_INVALID_DATA_URL", message: "Invalid file data URL." };
  }
  if (parsed.buffer.length > MAX_DOCUMENT_FILE_BYTES) {
    return { ok: false, code: "UPLOAD_FILE_TOO_LARGE", message: "File is too large." };
  }
  if (!isAllowedDocumentExtension(fileName) && !explicitMimeType) {
    return { ok: false, code: "UPLOAD_EXTENSION_NOT_ALLOWED", message: "File type is not allowed." };
  }
  const mimeType = explicitMimeType || parsed.mimeType;
  if (mimeType && !isAllowedDocumentMimeType(mimeType)) {
    return {
      ok: false,
      code: "UPLOAD_MIME_NOT_ALLOWED",
      message: `MIME type is not allowed: ${mimeType}`,
      mimeType,
      fileName,
    };
  }
  return {
    ok: true,
    folderId,
    fileName,
    mimeType,
    fileSize: parsed.buffer.length,
    buffer: parsed.buffer,
  };
}

export class DocumentControlUploadError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "DocumentControlUploadError";
    this.code = meta.code || "DOCUMENT_CONTROL_UPLOAD_FAILED";
    this.stage = meta.stage || "upload";
    this.httpStatus = Number(meta.httpStatus) || 500;
    this.google = meta.google || null;
    this.diagnostics = meta.diagnostics || {};
  }
}

async function ensureNamedFolder(drive, name, parentId) {
  const existing = await findFolderByExactName(drive, parentId, name);
  if (existing?.id) {
    return { folder: existing, created: false };
  }
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name,createdTime",
  });
  return { folder: created.data, created: true };
}

async function findFolderByExactName(drive, parentId, name) {
  const safeName = String(name || "").replace(/'/g, "\\'");
  const response = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response?.data?.files?.[0] || null;
}

export async function verifyDocumentControlFolder(drive, folderId, context = {}) {
  const id = trim(folderId);
  if (!id) {
    return { ok: false, message: "Folder ID is missing." };
  }
  try {
    const response = await drive.files.get({
      fileId: id,
      supportsAllDrives: true,
      fields: "id,name,mimeType,trashed",
    });
    const file = response.data || {};
    if (file.trashed) {
      return { ok: false, message: `Drive folder "${trim(file.name) || id}" is in trash.` };
    }
    if (file.mimeType && file.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, message: `Drive item ${id} is not a folder.` };
    }
    return { ok: true, folderId: id, folderName: trim(file.name) };
  } catch (error) {
    const google = googleDriveErrorDetails(error);
    return {
      ok: false,
      message: google.googleErrorMessage,
      google,
    };
  }
}

/**
 * Ensures Document Control/{Current,Drafts,Superseded,Archived} under company root.
 * @returns {{ rootFolderId: string, folders: Record<string,string> }}
 */
export async function ensureDocumentControlFolderStructure(drive, companyRootFolderId, options = {}) {
  const rootId = trim(companyRootFolderId);
  if (!rootId) {
    throw new DocumentControlUploadError("Company root folder is required for Document Control.", {
      code: "UPLOAD_COMPANY_FOLDER_REQUIRED",
      stage: options.stage || "company_resolution",
      httpStatus: 400,
    });
  }
  const parentCheck = await verifyDocumentControlFolder(drive, rootId, { stage: "company_folder_check" });
  if (!parentCheck.ok) {
    throw new DocumentControlUploadError(parentCheck.message || "Company root folder is not accessible.", {
      code: "UPLOAD_COMPANY_FOLDER_INACCESSIBLE",
      stage: "company_folder_check",
      httpStatus: 403,
      google: parentCheck.google,
      diagnostics: { companyFolderId: rootId },
    });
  }
  const root = await ensureNamedFolder(drive, DOCUMENT_CONTROL_DRIVE_ROOT, rootId);
  const folders = {};
  for (const name of DOCUMENT_CONTROL_DRIVE_FOLDERS) {
    const ensured = await ensureNamedFolder(drive, name, root.folder.id);
    folders[name] = ensured.folder.id;
  }
  return { rootFolderId: root.folder.id, folders };
}

/**
 * Resolve Document Control folder structure with a short-lived in-memory cache.
 */
export async function resolveDocumentControlFolderStructure(drive, companyRootFolderId, options = {}) {
  const rootId = trim(companyRootFolderId);
  if (!options.skipCache) {
    const cached = getDocumentControlFolderStructureCache(rootId);
    if (cached?.folders?.Drafts) {
      return {
        rootFolderId: cached.rootFolderId,
        folders: cached.folders,
        cacheHit: true,
      };
    }
  }
  const structure = await ensureDocumentControlFolderStructure(drive, rootId, options);
  setDocumentControlFolderStructureCache(rootId, structure);
  return { ...structure, cacheHit: false };
}

/**
 * Upload a revision file into the given Document Control subfolder.
 * Does not overwrite previous revision files — always creates a new Drive file.
 */
export async function uploadDocumentControlFile(drive, input = {}) {
  const validation = validateDocumentControlUploadInput(input);
  if (!validation.ok) {
    throw new DocumentControlUploadError(validation.message, {
      code: validation.code,
      stage: "file_validation",
      httpStatus: validation.code === "UPLOAD_FILE_TOO_LARGE" ? 413 : 400,
      diagnostics: {
        fileName: trim(input.fileName),
        mimeType: validation.mimeType,
      },
    });
  }

  let created;
  try {
    created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: validation.fileName,
        parents: [validation.folderId],
        mimeType: validation.mimeType || undefined,
      },
      media: {
        mimeType: validation.mimeType || "application/octet-stream",
        body: Readable.from(validation.buffer),
      },
      fields: "id,name,mimeType,size,webViewLink,webContentLink,parents",
    });
  } catch (error) {
    const google = googleDriveErrorDetails(error);
    throw new DocumentControlUploadError(google.googleErrorMessage, {
      code: "UPLOAD_DRIVE_CREATE_FAILED",
      stage: "drive_create",
      httpStatus: google.googleErrorCode && google.googleErrorCode >= 400 ? google.googleErrorCode : 502,
      google,
      diagnostics: {
        targetFolderId: validation.folderId,
        mimeType: validation.mimeType,
        fileSize: validation.fileSize,
      },
    });
  }

  const file = created.data || {};
  if (!trim(file.id)) {
    throw new DocumentControlUploadError("Google Drive did not return a file ID.", {
      code: "UPLOAD_EMPTY_DRIVE_FILE_ID",
      stage: "drive_create_ack",
      httpStatus: 502,
      diagnostics: {
        targetFolderId: validation.folderId,
        mimeType: validation.mimeType,
        fileSize: validation.fileSize,
      },
    });
  }

  return {
    fileId: file.id,
    fileName: file.name || validation.fileName,
    fileUrl: file.webViewLink || file.webContentLink || "",
    mimeType: file.mimeType || validation.mimeType,
    fileSize: String(file.size || validation.fileSize),
    parentFolderIds: Array.isArray(file.parents) ? file.parents : [validation.folderId],
  };
}

export async function deleteDocumentControlDriveFile(drive, fileId) {
  const id = trim(fileId);
  if (!id || !drive) {
    return { ok: false, deleted: false };
  }
  try {
    await drive.files.delete({ fileId: id, supportsAllDrives: true });
    return { ok: true, deleted: true, fileId: id };
  } catch (error) {
    const google = googleDriveErrorDetails(error);
    return { ok: false, deleted: false, fileId: id, google };
  }
}

/**
 * Move (or copy-associate) a file into another Document Control subfolder.
 * Prefer updating parents without deleting the previous revision file identity
 * when the caller already created a new FileId per revision.
 */
export async function moveDocumentControlFile(drive, fileId, targetFolderId, previousParents = []) {
  const id = trim(fileId);
  const target = trim(targetFolderId);
  if (!id || !target) {
    return { ok: false };
  }
  const removeParents = (previousParents || []).map((entry) => trim(entry)).filter(Boolean).join(",");
  await drive.files.update({
    fileId: id,
    addParents: target,
    removeParents: removeParents || undefined,
    supportsAllDrives: true,
    fields: "id,parents",
  });
  return { ok: true };
}
