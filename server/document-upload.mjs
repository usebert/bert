/**
 * Controlled Documents — Drive upload helper.
 */
import {
  isAllowedDocumentExtension,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_FILE_BYTES,
} from "../shared/document-schema.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function parseDataUrl(dataUrl) {
  const raw = trim(dataUrl);
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function uploadControlledDocumentFile(drive, input = {}) {
  const folderId = trim(input.folderId);
  const fileName = trim(input.fileName) || "document";
  const dataUrl = input.fileDataUrl;
  if (!folderId) {
    throw new Error("Folder is required for document upload.");
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
    googleFileId: file.id,
    googleFileName: file.name || fileName,
    fileUrl: file.webViewLink || file.webContentLink || "",
    mimeType: file.mimeType || mimeType,
    fileSize: String(file.size || parsed.buffer.length),
  };
}

export async function deleteDriveFileQuietly(drive, fileId) {
  const id = trim(fileId);
  if (!id) {
    return;
  }
  try {
    await drive.files.delete({ fileId: id, supportsAllDrives: true });
  } catch {
    /* best effort cleanup */
  }
}
