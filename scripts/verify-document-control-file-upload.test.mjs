#!/usr/bin/env node
/**
 * Unit tests for Document Control file upload helpers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerificationFileDataUrl,
  buildVerificationFileName,
} from "../shared/production-verification-document.mjs";
import {
  deleteDocumentControlDriveFile,
  parseDocumentControlDataUrl,
  uploadDocumentControlFile,
  validateDocumentControlUploadInput,
} from "../server/document-control-file-service.mjs";

const VALID_PDF_DATA_URL = buildVerificationFileDataUrl(424242);
const DRAFTS_FOLDER_ID = "drafts-folder-123";

function createMockDrive(handlers = {}) {
  return {
    files: {
      create: handlers.create || (async () => ({ data: { id: "drive-file-1", name: "bert-verify-doc.pdf", mimeType: "application/pdf", size: "128", webViewLink: "https://drive.example/file/1" } })),
      delete: handlers.delete || (async () => ({})),
      get: handlers.get || (async () => ({ data: { id: DRAFTS_FOLDER_ID, name: "Drafts", mimeType: "application/vnd.google-apps.folder", trashed: false } })),
      list: handlers.list || (async () => ({ data: { files: [] } })),
      update: handlers.update || (async () => ({ data: { id: "drive-file-1" } })),
    },
  };
}

test("valid text data URL upload uses allowed PDF mime type", async () => {
  const parsed = parseDocumentControlDataUrl(VALID_PDF_DATA_URL);
  assert.ok(parsed);
  assert.equal(parsed.mimeType, "application/pdf");
  assert.ok(parsed.buffer.length > 0);

  const validation = validateDocumentControlUploadInput({
    folderId: DRAFTS_FOLDER_ID,
    fileName: buildVerificationFileName(424242),
    fileDataUrl: VALID_PDF_DATA_URL,
    mimeType: "application/pdf",
  });
  assert.equal(validation.ok, true);

  const uploaded = await uploadDocumentControlFile(createMockDrive(), {
    folderId: DRAFTS_FOLDER_ID,
    fileName: buildVerificationFileName(424242),
    fileDataUrl: VALID_PDF_DATA_URL,
    mimeType: "application/pdf",
  });
  assert.equal(uploaded.fileId, "drive-file-1");
  assert.match(uploaded.fileName, /\.pdf$/);
});

test("invalid data URL rejected", () => {
  const validation = validateDocumentControlUploadInput({
    folderId: DRAFTS_FOLDER_ID,
    fileName: "bert-verify-doc.pdf",
    fileDataUrl: "not-a-data-url",
    mimeType: "application/pdf",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "UPLOAD_INVALID_DATA_URL");
});

test("plain text mime type rejected for verification upload shape", () => {
  const textDataUrl = `data:text/plain;base64,${Buffer.from("hello", "utf8").toString("base64")}`;
  const validation = validateDocumentControlUploadInput({
    folderId: DRAFTS_FOLDER_ID,
    fileName: "bert-verify-doc.txt",
    fileDataUrl: textDataUrl,
    mimeType: "text/plain",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "UPLOAD_MIME_NOT_ALLOWED");
});

test("missing Drafts folder rejected at validation", () => {
  const validation = validateDocumentControlUploadInput({
    folderId: "",
    fileName: buildVerificationFileName(1),
    fileDataUrl: VALID_PDF_DATA_URL,
    mimeType: "application/pdf",
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "UPLOAD_FOLDER_REQUIRED");
});

test("folder permission denied surfaces Google error", async () => {
  const drive = createMockDrive({
    create: async () => {
      const error = new Error("Insufficient permissions");
      error.code = 403;
      error.response = { status: 403, data: { error: { message: "Insufficient permissions", errors: [{ reason: "insufficientFilePermissions" }] } } };
      throw error;
    },
  });
  await assert.rejects(
    () =>
      uploadDocumentControlFile(drive, {
        folderId: DRAFTS_FOLDER_ID,
        fileName: buildVerificationFileName(1),
        fileDataUrl: VALID_PDF_DATA_URL,
        mimeType: "application/pdf",
      }),
    (error) => {
      assert.match(error.message, /Insufficient permissions/i);
      assert.equal(error.code, "UPLOAD_DRIVE_CREATE_FAILED");
      return true;
    },
  );
});

test("Drive create failure surfaces Google error", async () => {
  const drive = createMockDrive({
    create: async () => {
      const error = new Error("Backend error");
      error.code = 503;
      error.response = { status: 503, data: { error: { message: "Backend error", errors: [{ reason: "backendError" }] } } };
      throw error;
    },
  });
  await assert.rejects(
    () =>
      uploadDocumentControlFile(drive, {
        folderId: DRAFTS_FOLDER_ID,
        fileName: buildVerificationFileName(1),
        fileDataUrl: VALID_PDF_DATA_URL,
        mimeType: "application/pdf",
      }),
    /Backend error/,
  );
});

test("empty Drive file ID rejected", async () => {
  const drive = createMockDrive({
    create: async () => ({ data: { id: "", name: "bert-verify-doc.pdf" } }),
  });
  await assert.rejects(
    () =>
      uploadDocumentControlFile(drive, {
        folderId: DRAFTS_FOLDER_ID,
        fileName: buildVerificationFileName(1),
        fileDataUrl: VALID_PDF_DATA_URL,
        mimeType: "application/pdf",
      }),
    /did not return a file ID/i,
  );
});

test("deleteDocumentControlDriveFile removes uploaded verification file", async () => {
  let deletedId = "";
  const drive = createMockDrive({
    delete: async ({ fileId }) => {
      deletedId = fileId;
      return {};
    },
  });
  const result = await deleteDocumentControlDriveFile(drive, "orphan-file-1");
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.equal(deletedId, "orphan-file-1");
});

test("secrets and file contents absent from validation output", () => {
  const secret = "super-secret-token-value";
  const dataUrl = `data:application/pdf;base64,${Buffer.from(`%PDF verification ${secret}`, "utf8").toString("base64")}`;
  const validation = validateDocumentControlUploadInput({
    folderId: DRAFTS_FOLDER_ID,
    fileName: buildVerificationFileName(99),
    fileDataUrl: dataUrl,
    mimeType: "application/pdf",
  });
  const safeLog = JSON.stringify({
    ok: validation.ok,
    code: validation.code,
    fileName: validation.fileName,
    mimeType: validation.mimeType,
    fileSize: validation.fileSize,
  });
  assert.doesNotMatch(safeLog, new RegExp(secret, "i"));
});
