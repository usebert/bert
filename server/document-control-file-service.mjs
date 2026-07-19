/**
 * Document Control Drive folders + optional file upload.
 * Structure under company root:
 *   Document Control / Current | Drafts | Superseded | Archived
 */
import {
  DOCUMENT_CONTROL_DRIVE_FOLDERS,
  DOCUMENT_CONTROL_DRIVE_ROOT,
  isAllowedDocumentExtension,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_FILE_BYTES,
} from "../shared/document-control.mjs";

function trim(value) {
  return String(value ?? "").trim();
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

/**
 * Ensures Document Control/{Current,Drafts,Superseded,Archived} under company root.
 * @returns {{ rootFolderId: string, folders: Record<string,string> }}
 */
export async function ensureDocumentControlFolderStructure(drive, companyRootFolderId) {
  const rootId = trim(companyRootFolderId);
  if (!rootId) {
    throw new Error("Company root folder is required for Document Control.");
  }
  const root = await ensureNamedFolder(drive, DOCUMENT_CONTROL_DRIVE_ROOT, rootId);
  const folders = {};
  for (const name of DOCUMENT_CONTROL_DRIVE_FOLDERS) {
    const ensured = await ensureNamedFolder(drive, name, root.folder.id);
    folders[name] = ensured.folder.id;
  }
  return { rootFolderId: root.folder.id, folders };
}

function parseDataUrl(dataUrl) {
  const raw = trim(dataUrl);
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

/**
 * Upload a revision file into the given Document Control subfolder.
 * Does not overwrite previous revision files — always creates a new Drive file.
 */
export async function uploadDocumentControlFile(drive, input = {}) {
  const folderId = trim(input.folderId);
  const fileName = trim(input.fileName) || "document";
  const dataUrl = input.fileDataUrl;
  if (!folderId) {
    throw new Error("Document Control folder is required for upload.");
  }
  if (!isAllowedDocumentExtension(fileName) && !trim(input.mimeType)) {
    throw new Error("File type is not allowed.");
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("Invalid file data.");
  }
  if (parsed.buffer.length > MAX_DOCUMENT_FILE_BYTES) {
    throw new Error("File is too large.");
  }
  const mimeType = trim(input.mimeType) || parsed.mimeType;
  if (mimeType && !isAllowedDocumentMimeType(mimeType)) {
    throw new Error("MIME type is not allowed.");
  }
  const { Readable } = await import("node:stream");
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: mimeType || undefined,
    },
    media: {
      mimeType: mimeType || "application/octet-stream",
      body: Readable.from(parsed.buffer),
    },
    fields: "id,name,mimeType,size,webViewLink,webContentLink",
  });
  const file = created.data || {};
  return {
    fileId: file.id,
    fileName: file.name || fileName,
    fileUrl: file.webViewLink || file.webContentLink || "",
    mimeType: file.mimeType || mimeType,
    fileSize: String(file.size || parsed.buffer.length),
  };
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
