#!/usr/bin/env node
/**
 * Server-side regression tests for production verification Document markers and cleanup guards.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildRevisionId, summarizeDocumentControl } from "../shared/document-control.mjs";
import {
  buildProductionVerificationDocument,
  buildProductionVerificationDocumentId,
  buildProductionVerificationDocumentNumber,
  buildVerificationFileDataUrl,
  buildVerificationFileName,
  countDocumentBaselines,
  isActiveVerificationDocument,
  isOperationalDocument,
  isOperationalWorkbookDocumentRow,
  isVerificationDocument,
  PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
  PRODUCTION_VERIFICATION_DOCUMENT_TITLE,
} from "../shared/production-verification-document.mjs";
import {
  approveDocumentRevision,
  cleanupVerificationDocument,
  CONTROLLED_DOCUMENTS_TAB,
  CONTROLLED_DOCUMENTS_TAB_COLUMNS,
  createDraftVerificationDocument,
  DOCUMENT_REVISIONS_TAB,
  DOCUMENT_REVISIONS_TAB_COLUMNS,
  submitDocumentRevision,
  uploadVerificationRevisionFile,
} from "../server/document-control-service.mjs";

const companyFolderId = "folder-abc";
const masterSheetId = "sheet-xyz";
const runId = 424242;

const actor = {
  kind: "company",
  email: "bert.demo+mr.important@usebert.co.uk",
  role: "Admin",
  companyFolderId,
  companyId: companyFolderId,
  name: "Mr Important",
};

function customerDocumentRow() {
  return {
    DocumentId: "doc-customer-1",
    DocumentNumber: "PRO-0001",
    Title: "Warehouse safety procedure",
    DocumentType: "procedure",
    Department: "Assembly",
    OwnerName: "Warehouse Lead",
    OwnerEmail: "lead@example.com",
    PrimaryStandard: "COMPANY",
    ClauseReferences: "COMPANY:SAFETY",
    Keywords: "safety warehouse",
    CurrentRevisionId: "REV-doc-customer-1-1",
    CurrentRevision: "1",
    DocumentStatus: "current",
    IssueDate: "2026-01-15",
    EffectiveDate: "2026-01-15",
    NextReviewDate: "2027-01-15",
    VerificationSource: "",
    CreatedAt: "2026-01-15T09:30:00.000Z",
    CreatedBy: "lead@example.com",
    UpdatedAt: "2026-01-15T09:30:00.000Z",
    UpdatedBy: "lead@example.com",
    ArchivedAt: "",
    ArchivedBy: "",
  };
}

function verificationDocumentRow(overrides = {}) {
  const document = buildProductionVerificationDocument({
    runId,
    documentId: buildProductionVerificationDocumentId(runId),
    documentNumber: buildProductionVerificationDocumentNumber(runId),
    ownerEmail: actor.email,
    ownerName: actor.name,
  });
  const documentId = document.documentId;
  const revisionId = buildRevisionId(documentId, 1);
  return {
    documentRow: {
      DocumentId: documentId,
      DocumentNumber: document.documentNumber,
      Title: document.title,
      DocumentType: document.documentType,
      Department: document.department,
      OwnerName: document.ownerName,
      OwnerEmail: document.ownerEmail,
      PrimaryStandard: document.primaryStandard,
      ClauseReferences: "COMPANY:VERIFICATION",
      Keywords: document.keywords,
      VerificationSource: PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
      CurrentRevisionId: revisionId,
      CurrentRevision: "1",
      DocumentStatus: "draft",
      IssueDate: "",
      EffectiveDate: "",
      NextReviewDate: document.nextReviewDate,
      CreatedAt: new Date().toISOString(),
      CreatedBy: actor.email,
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: actor.email,
      ArchivedAt: "",
      ArchivedBy: "",
      ...overrides.documentRow,
    },
    revisionRow: {
      RevisionId: revisionId,
      DocumentId: documentId,
      DocumentNumber: document.documentNumber,
      Revision: "1",
      RevisionSequence: "1",
      FileId: "",
      FileName: "",
      FileUrl: "",
      MimeType: "",
      FileSize: "",
      RevisionStatus: "draft",
      ChangeSummary: document.changeSummary,
      PreparedBy: actor.email,
      PreparedAt: new Date().toISOString(),
      ReviewedBy: "",
      ReviewedAt: "",
      ApprovedBy: "",
      ApprovedAt: "",
      IssueDate: "",
      EffectiveDate: "",
      SupersededAt: "",
      SupersededByRevisionId: "",
      CreatedAt: new Date().toISOString(),
      CreatedBy: actor.email,
      ChangeLog: "",
      ...overrides.revisionRow,
    },
    documentId,
    revisionId,
  };
}

function createDocumentDeps(initialRowsByTab = {}) {
  const rowsByTab = {
    [CONTROLLED_DOCUMENTS_TAB]: (initialRowsByTab[CONTROLLED_DOCUMENTS_TAB] || []).map((row) => ({ ...row })),
    [DOCUMENT_REVISIONS_TAB]: (initialRowsByTab[DOCUMENT_REVISIONS_TAB] || []).map((row) => ({ ...row })),
  };

  return {
    rowsByTab,
    resolveCompanyScheduleContext: async () => ({
      ok: true,
      companyFolderId,
      companyId: companyFolderId,
      masterSheetId,
      alternateIds: [],
    }),
    readTabRecords: async (_auth, _deps, _sheetId, tabName) => ({
      records: (rowsByTab[tabName] || []).map((row) => ({ ...row })),
    }),
    appendTabRows: async (_auth, _deps, _sheetId, tabName, _columns, newRows) => {
      rowsByTab[tabName].push(...newRows.map((row) => ({ ...row })));
      return { ok: true, updatedRows: newRows.length };
    },
    patchTabRowByHeader: async (_auth, _deps, _sheetId, tabName, header, matchValue, patch) => {
      const records = rowsByTab[tabName] || [];
      const index = records.findIndex((row) => String(row[header] || row.DocumentId || row.RevisionId) === String(matchValue));
      if (index === -1) {
        return { ok: false, patched: 0, updatedRows: 0 };
      }
      rowsByTab[tabName][index] = { ...records[index], ...patch };
      return { ok: true, patched: 1, updatedRows: 1 };
    },
    ensureTabColumns: async () => ({ ok: true }),
    getRows: (tabName) => rowsByTab[tabName] || [],
  };
}

function draftPayload(overrides = {}) {
  const document = buildProductionVerificationDocument({
    runId,
    createdByEmail: actor.email,
    ownerEmail: actor.email,
    ownerName: actor.name,
    ...overrides,
  });
  return {
    documentId: document.documentId,
    documentNumber: document.documentNumber,
    title: document.title,
    documentType: document.documentType,
    department: document.department,
    description: document.description,
    ownerEmail: document.ownerEmail,
    ownerName: document.ownerName,
    primaryStandard: document.primaryStandard,
    clauseReferences: document.clauseReferences,
    keywords: document.keywords,
    verificationSource: document.verificationSource,
    nextReviewDate: document.nextReviewDate,
    changeSummary: document.changeSummary,
    ...overrides,
  };
}

async function attachRevisionFile(deps, revisionId) {
  await deps.patchTabRowByHeader(
    null,
    deps,
    masterSheetId,
    DOCUMENT_REVISIONS_TAB,
    "RevisionId",
    revisionId,
    {
      FileId: "verify-file-1",
      FileName: "bert-verify-doc.pdf",
      FileUrl: "https://drive.example/verify-file-1",
      MimeType: "application/pdf",
      FileSize: "128",
    },
  );
}

async function createSubmittedVerificationDocument(deps, overrides = {}) {
  const payload = draftPayload(overrides);
  const created = await createDraftVerificationDocument(null, deps, { masterSheetId, companyFolderId }, actor, payload);
  assert.equal(created.ok, true);
  const revisionId = buildRevisionId(payload.documentId, 1);
  await attachRevisionFile(deps, revisionId);
  const submitted = await submitDocumentRevision(null, deps, { masterSheetId, companyFolderId }, actor, revisionId);
  assert.equal(submitted.ok, true);
  return { documentId: payload.documentId, revisionId };
}

test("verification marker recognition", () => {
  const { documentRow } = verificationDocumentRow();
  const mapped = {
    documentId: documentRow.DocumentId,
    documentNumber: documentRow.DocumentNumber,
    title: documentRow.Title,
    verificationSource: documentRow.VerificationSource,
    keywords: documentRow.Keywords,
    documentStatus: documentRow.DocumentStatus,
  };
  assert.equal(isVerificationDocument(mapped), true);
  assert.equal(isActiveVerificationDocument(mapped), true);
  assert.equal(isOperationalDocument(mapped), false);
  assert.equal(isOperationalWorkbookDocumentRow(documentRow), false);
});

test("verification-only cleanup", async () => {
  const { documentRow, revisionRow } = verificationDocumentRow({
    documentRow: { DocumentStatus: "current" },
    revisionRow: { RevisionStatus: "current", FileId: "file-1", FileName: "bert-verify-doc.pdf" },
  });
  const deps = createDocumentDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow(), documentRow],
    [DOCUMENT_REVISIONS_TAB]: [revisionRow],
  });
  const result = await cleanupVerificationDocument(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    documentRow.DocumentId,
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS);
  assert.equal(result.updatedRows >= 1, true);
  assert.equal(deps.getRows(CONTROLLED_DOCUMENTS_TAB)[1].DocumentStatus, PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS);
});

test("ordinary document cleanup rejection", async () => {
  const deps = createDocumentDeps({ [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow()] });
  const denied = await cleanupVerificationDocument(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    "doc-customer-1",
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.httpStatus, 403);
  assert.equal(denied.code, "CLEANUP_NOT_VERIFICATION_DOCUMENT");
});

test("createDraftVerificationDocument idempotency", async () => {
  const deps = createDocumentDeps({ [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow()] });
  const payload = draftPayload();
  const first = await createDraftVerificationDocument(null, deps, { masterSheetId, companyFolderId }, actor, payload);
  const second = await createDraftVerificationDocument(null, deps, { masterSheetId, companyFolderId }, actor, payload);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyExists, true);
  assert.equal(second.updatedRows, 0);
  assert.equal(deps.getRows(CONTROLLED_DOCUMENTS_TAB).filter((row) => row.DocumentId === payload.documentId).length, 1);
});

test("submit idempotency", async () => {
  const deps = createDocumentDeps({ [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow()] });
  const { revisionId } = await createSubmittedVerificationDocument(deps);
  const second = await submitDocumentRevision(null, deps, { masterSheetId, companyFolderId }, actor, revisionId);
  assert.equal(second.ok, true);
  assert.equal(deps.getRows(DOCUMENT_REVISIONS_TAB)[0].RevisionStatus, "awaiting_approval");
});

test("approve idempotency", async () => {
  const deps = createDocumentDeps({ [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow()] });
  const { revisionId } = await createSubmittedVerificationDocument(deps);
  const first = await approveDocumentRevision(null, deps, { masterSheetId, companyFolderId }, actor, revisionId);
  const second = await approveDocumentRevision(null, deps, { masterSheetId, companyFolderId }, actor, revisionId);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(deps.getRows(DOCUMENT_REVISIONS_TAB)[0].RevisionStatus, "current");
  assert.equal(deps.getRows(CONTROLLED_DOCUMENTS_TAB).find((row) => row.DocumentId === first.document?.documentId)?.DocumentStatus, "current");
});

test("operational dashboard exclusion helpers", () => {
  const customer = customerDocumentRow();
  const { documentRow } = verificationDocumentRow({ documentRow: { DocumentStatus: "current" } });
  const customerMapped = {
    documentId: customer.DocumentId,
    documentNumber: customer.DocumentNumber,
    title: customer.Title,
    verificationSource: customer.VerificationSource,
    keywords: customer.Keywords,
    documentStatus: customer.DocumentStatus,
  };
  const verificationMapped = {
    documentId: documentRow.DocumentId,
    documentNumber: documentRow.DocumentNumber,
    title: documentRow.Title,
    verificationSource: documentRow.VerificationSource,
    keywords: documentRow.Keywords,
    documentStatus: documentRow.DocumentStatus,
  };
  assert.equal(isOperationalDocument(verificationMapped), false);
  const baseline = countDocumentBaselines([customerMapped, verificationMapped]);
  assert.equal(baseline.operationalCount, 1);
  assert.equal(baseline.activeVerificationCount, 1);
  const operationalSummary = summarizeDocumentControl([customerMapped, verificationMapped].filter(isOperationalDocument));
  assert.equal(operationalSummary.total, 1);
  assert.equal(operationalSummary.current, 1);
  assert.match(PRODUCTION_VERIFICATION_DOCUMENT_TITLE, /BERT Verification Document/);
});

function createUploadDeps(initialRowsByTab = {}, driveHandlers = {}) {
  const deps = createDocumentDeps(initialRowsByTab);
  let deletedFileId = "";
  const drive = {
    files: {
      create: driveHandlers.create || (async () => ({
        data: {
          id: "drive-file-1",
          name: buildVerificationFileName(runId),
          mimeType: "application/pdf",
          size: "256",
          webViewLink: "https://drive.example/verify-file-1",
          parents: ["drafts-folder-1"],
        },
      })),
      delete: driveHandlers.delete || (async ({ fileId }) => {
        deletedFileId = fileId;
        return {};
      }),
      get: driveHandlers.get || (async ({ fileId }) => ({
        data: {
          id: fileId,
          name: fileId === "drafts-folder-1" ? "Drafts" : "Document Control",
          mimeType: "application/vnd.google-apps.folder",
          trashed: false,
        },
      })),
      list:
        driveHandlers.list ||
        (async () => ({
          data: {
            files: [{ id: "drafts-folder-1", name: "Drafts" }],
          },
        })),
      update: driveHandlers.update || (async () => ({ data: { id: "drive-file-1" } })),
    },
  };
  deps.google = { drive: () => drive };
  deps.getDeletedFileId = () => deletedFileId;
  return deps;
}

test("uploadVerificationRevisionFile persists PDF metadata", async () => {
  const { documentRow, revisionRow, revisionId } = verificationDocumentRow();
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow(), documentRow],
    [DOCUMENT_REVISIONS_TAB]: [revisionRow],
  });
  const uploaded = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: buildVerificationFileName(runId),
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.updatedRows, 1);
  assert.equal(deps.getRows(DOCUMENT_REVISIONS_TAB)[0].FileId, "drive-file-1");
  assert.match(deps.getRows(DOCUMENT_REVISIONS_TAB)[0].FileName, /\.pdf$/);
});

test("uploadVerificationRevisionFile is idempotent for same revision", async () => {
  const { documentRow, revisionRow, revisionId } = verificationDocumentRow();
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow(), documentRow],
    [DOCUMENT_REVISIONS_TAB]: [revisionRow],
  });
  const first = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: buildVerificationFileName(runId),
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  const second = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: buildVerificationFileName(runId),
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyUploaded, true);
  assert.equal(second.updatedRows, 0);
});

test("uploadVerificationRevisionFile rejects non-verification document", async () => {
  const customer = customerDocumentRow();
  const revisionId = "REV-doc-customer-1-1";
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customer],
    [DOCUMENT_REVISIONS_TAB]: [
      {
        RevisionId: revisionId,
        DocumentId: customer.DocumentId,
        DocumentNumber: customer.DocumentNumber,
        Revision: "1",
        RevisionSequence: "1",
        RevisionStatus: "draft",
      },
    ],
  });
  const denied = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: "customer.pdf",
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "DOCUMENT_NOT_VERIFICATION");
});

test("uploadVerificationRevisionFile cleans up Drive file when metadata patch fails", async () => {
  const { documentRow, revisionRow, revisionId } = verificationDocumentRow();
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow(), documentRow],
    [DOCUMENT_REVISIONS_TAB]: [revisionRow],
  });
  const originalPatch = deps.patchTabRowByHeader;
  deps.patchTabRowByHeader = async (...args) => {
    if (args[3] === DOCUMENT_REVISIONS_TAB) {
      return { ok: false, patched: 0, updatedRows: 0 };
    }
    return originalPatch(...args);
  };
  const failed = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: buildVerificationFileName(runId),
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "UPLOAD_METADATA_PATCH_FAILED");
  assert.equal(deps.getDeletedFileId(), "drive-file-1");
});

test("createDraftVerificationDocument skips synchronous index rebuild", async () => {
  let indexRebuildCalls = 0;
  const { documentRow, revisionRow } = verificationDocumentRow();
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow()],
    [DOCUMENT_REVISIONS_TAB]: [],
  });
  deps.replaceTabRows = async (...args) => {
    indexRebuildCalls += 1;
    return { ok: true, written: args[5]?.length || 0 };
  };
  const created = await createDraftVerificationDocument(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    {
      documentId: documentRow.DocumentId,
      documentNumber: documentRow.DocumentNumber,
      title: documentRow.Title,
      verificationSource: documentRow.VerificationSource,
    },
  );
  assert.equal(created.ok, true);
  assert.equal(indexRebuildCalls, 0);
});

test("uploadVerificationRevisionFile accepts workbook patch ok without updatedRows", async () => {
  const { documentRow, revisionRow, revisionId } = verificationDocumentRow();
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow(), documentRow],
    [DOCUMENT_REVISIONS_TAB]: [revisionRow],
  });
  const originalPatch = deps.patchTabRowByHeader;
  deps.patchTabRowByHeader = async (...args) => {
    if (args[3] === DOCUMENT_REVISIONS_TAB) {
      await originalPatch(...args);
      return { ok: true, rowIndex: 2, tabName: DOCUMENT_REVISIONS_TAB };
    }
    return originalPatch(...args);
  };
  const uploaded = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: buildVerificationFileName(runId),
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.updatedRows, 1);
});

test("uploadVerificationRevisionFile skips index rebuild during upload", async () => {
  let indexRebuildCalls = 0;
  const { documentRow, revisionRow, revisionId } = verificationDocumentRow();
  const deps = createUploadDeps({
    [CONTROLLED_DOCUMENTS_TAB]: [customerDocumentRow(), documentRow],
    [DOCUMENT_REVISIONS_TAB]: [revisionRow],
  });
  deps.replaceTabRows = async (...args) => {
    indexRebuildCalls += 1;
    return { ok: true, written: args[5]?.length || 0 };
  };
  const uploaded = await uploadVerificationRevisionFile(
    null,
    deps,
    { masterSheetId, companyFolderId },
    actor,
    revisionId,
    {
      fileName: buildVerificationFileName(runId),
      fileDataUrl: buildVerificationFileDataUrl(runId),
      mimeType: "application/pdf",
    },
  );
  assert.equal(uploaded.ok, true);
  assert.equal(indexRebuildCalls, 0);
});
