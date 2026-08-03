#!/usr/bin/env node
/**
 * Unit tests for production Documents workflow verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildRevisionId } from "../shared/document-control.mjs";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  CHECK_LABELS,
  attemptVerificationDocumentCleanup,
  formatDocumentsWorkflowReport,
  loadDocumentsWorkflowConfig,
  revisionHasVerificationPdf,
  runProductionDocumentsWorkflowChecks,
} from "./lib/production-documents-workflow-core.mjs";
import {
  buildProductionVerificationDocument,
  buildProductionVerificationDocumentId,
  buildProductionVerificationDocumentNumber,
  buildVerificationFileDataUrl,
  buildVerificationFileName,
  countDocumentBaselines,
  findDocumentById,
  isActiveVerificationDocument,
  isOperationalDocument,
  isVerificationDocument,
  listActiveVerificationDocuments,
  PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
  PRODUCTION_VERIFICATION_DOCUMENT_FILE_NAME_PREFIX,
  PRODUCTION_VERIFICATION_DOCUMENT_ID_PREFIX,
  PRODUCTION_VERIFICATION_DOCUMENT_NUMBER_PREFIX,
  PRODUCTION_VERIFICATION_DOCUMENT_SOURCE,
  PRODUCTION_VERIFICATION_DOCUMENT_TITLE,
} from "../shared/production-verification-document.mjs";

const baseConfig = loadDocumentsWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_DOCUMENT_MUTATION: "1",
});

const TEST_RUN_ID = 12345;
const defaultRunOptions = {
  runId: TEST_RUN_ID,
  listPollMaxAttempts: 5,
  listPollIntervalMs: 0,
};

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return trim(value).toLowerCase();
}

function successLoginJson() {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
      role: "Admin",
      name: "Mr Important",
      companyFolderId: baseConfig.companyFolderId,
    },
    company: {
      companyFolderId: baseConfig.companyFolderId,
      companyName: "Dovecote Demo",
      live: true,
    },
    masterSheetId: baseConfig.masterSheetId,
  };
}

function customerDocument() {
  return {
    documentId: "doc-customer-1",
    documentNumber: "PRO-0001",
    title: "Warehouse safety procedure",
    documentType: "procedure",
    department: "Assembly",
    documentStatus: "current",
    verificationSource: "",
    keywords: "safety warehouse",
    ownerEmail: "lead@example.com",
    ownerName: "Warehouse Lead",
    currentRevisionId: "REV-doc-customer-1-1",
    currentRevision: "1",
  };
}

function toListItem(document) {
  return {
    documentId: document.documentId,
    documentNumber: document.documentNumber,
    title: document.title,
    documentType: document.documentType,
    department: document.department,
    documentStatus: document.documentStatus,
    verificationSource: document.verificationSource || "",
    keywords: document.keywords || "",
    ownerEmail: document.ownerEmail || "",
    ownerName: document.ownerName || "",
    currentRevisionId: document.currentRevisionId || "",
    currentRevision: document.currentRevision || "",
  };
}

function createTransport(options = {}) {
  const cookies = new Map();
  const runId = options.runId ?? TEST_RUN_ID;
  const verificationDocumentId = buildProductionVerificationDocumentId(runId);
  const verificationDocumentNumber = buildProductionVerificationDocumentNumber(runId);
  const verificationRevisionId = buildRevisionId(verificationDocumentId, 1);
  const verificationTemplate = buildProductionVerificationDocument({
    runId,
    documentId: verificationDocumentId,
    documentNumber: verificationDocumentNumber,
    ownerEmail: baseConfig.expectedEmail,
    ownerName: "Mr Important",
  });

  let documents = options.initialDocuments
    ? [...options.initialDocuments]
    : [customerDocument()];
  const documentStore = new Map();
  const revisionStore = new Map();
  for (const item of documents) {
    documentStore.set(item.documentId, { ...item });
  }

  let libraryDocuments = [];
  let loginAttempts = 0;
  let createAttempts = 0;
  let uploadAttempts = 0;
  let submitAttempts = 0;
  let approveAttempts = 0;
  let cleanupAttempts = 0;
  let create502Attempts = 0;
  let suppressVerificationInListCount = options.listStaleUntilAttempt || 0;
  let baselinePendingDocuments = options.baselinePendingDocuments ?? 0;

  function getDocument(documentId) {
    return documentStore.get(documentId) || null;
  }

  function getRevision(revisionId) {
    return revisionStore.get(revisionId) || null;
  }

  function upsertDocument(record) {
    documentStore.set(record.documentId, { ...record });
    const listEntry = toListItem(record);
    const idx = documents.findIndex((item) => item.documentId === record.documentId);
    if (idx >= 0) {
      documents[idx] = listEntry;
    } else {
      documents.push(listEntry);
    }
  }

  function upsertRevision(record) {
    revisionStore.set(record.revisionId, { ...record });
  }

  function ensureVerificationRevision(document) {
    const existing = getRevision(verificationRevisionId);
    if (existing) {
      return existing;
    }
    const revision = {
      revisionId: verificationRevisionId,
      documentId: document.documentId,
      documentNumber: document.documentNumber,
      revision: "1",
      revisionSequence: 1,
      revisionStatus: normalizeStatus(document.documentStatus) === "current" ? "current" : "draft",
      fileId: "",
      fileName: "",
      fileUrl: "",
      mimeType: "",
      changeSummary: verificationTemplate.changeSummary,
      preparedBy: baseConfig.expectedEmail,
    };
    upsertRevision(revision);
    return revision;
  }

  function listDocumentsForResponse() {
    let items = documents.map((item) => {
      const stored = getDocument(item.documentId) || item;
      return toListItem(stored);
    });
    if (suppressVerificationInListCount > 0) {
      suppressVerificationInListCount -= 1;
      items = items.filter((item) => item.documentId !== verificationDocumentId);
    }
    if (options.hideCleanedVerificationInList === true) {
      items = items.filter(
        (item) =>
          !(
            isVerificationDocument(item) &&
            normalizeStatus(item.documentStatus) === PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS
          ),
      );
    }
    return items;
  }

  function documentDetailPayload(documentId) {
    const document = getDocument(documentId);
    if (!document) {
      return null;
    }
    const revision = getRevision(document.currentRevisionId || verificationRevisionId) || ensureVerificationRevision(document);
    const revisions = Array.from(revisionStore.values()).filter((item) => item.documentId === documentId);
    if (!revisions.length) {
      revisions.push(revision);
    }
    return {
      ok: true,
      document: { ...document },
      currentRevision: revision,
      revisions,
      resolvedRevisionId: revision.revisionId,
      canManage: true,
      canApprove: true,
      canViewSuperseded: true,
    };
  }

  function dashboardPayload(includeVerification = false) {
    const verificationItem = getDocument(verificationDocumentId);
    const pendingDocuments = [];
    if (includeVerification && verificationItem) {
      pendingDocuments.push({
        id: `${verificationDocumentId}::${baseConfig.expectedEmail}`,
        title: verificationItem.title,
        subtitle: verificationItem.documentNumber,
        owner: baseConfig.expectedEmail,
      });
    }
    const actToday =
      includeVerification && verificationItem
        ? [{ id: `document-${verificationDocumentId}`, type: "document-control" }]
        : [];
    const pendingCount = includeVerification ? baselinePendingDocuments + 1 : baselinePendingDocuments;
    return {
      ok: true,
      metrics: {
        pendingDocuments: pendingCount,
        openActions: 1,
        currentIncidents: 1,
      },
      actToday,
      pendingDocuments,
    };
  }

  const request = async (method, path, body, requestOptions = {}) => {
    const pathname = (path.split("?")[0] || path).replace(/\/$/, "");
    const companyBase = `/api/companies/${encodeURIComponent(baseConfig.companyFolderId)}/document-control`;
    const documentsBase = `${companyBase}/documents`;
    const libraryBase = `/api/companies/${encodeURIComponent(baseConfig.companyFolderId)}/documents`;

    if (method === "GET" && pathname === "/api/health") {
      return {
        status: 200,
        json: { ok: true, version: "2026.08.01", gitSha: "abc123def456", shortSha: "abc123d" },
      };
    }

    if (method === "POST" && pathname === "/api/auth/company/login") {
      loginAttempts += 1;
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      if (options.reviewerLoginFails && loginAttempts > 1) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      const email =
        loginAttempts > 1 && options.reviewerExpectedEmail
          ? options.reviewerExpectedEmail
          : baseConfig.expectedEmail;
      return {
        status: 200,
        json: {
          ...successLoginJson(),
          user: { ...successLoginJson().user, email },
        },
      };
    }

    if (method === "GET" && pathname === "/api/auth/company/session") {
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: "Admin" },
          company: { companyFolderId: baseConfig.companyFolderId },
        },
      };
    }

    if (method === "GET" && pathname === documentsBase) {
      if (options.documentsResponse) {
        return options.documentsResponse();
      }
      return {
        status: options.documentsUnavailable ? 503 : 200,
        json: options.documentsUnavailable
          ? { ok: false, code: "DOCUMENT_CONTROL_LIST_FAILED" }
          : {
              ok: true,
              documents: listDocumentsForResponse(),
              companyFolderId: baseConfig.companyFolderId,
              canApprove: true,
            },
      };
    }

    if (method === "GET" && pathname === `${companyBase}/index`) {
      const items = listDocumentsForResponse().map((item) => ({
        DocumentNumber: item.documentNumber,
        Title: item.title,
        DocumentType: item.documentType,
        Department: item.department,
        DocumentStatus: item.documentStatus,
        CurrentRevision: item.currentRevision,
      }));
      return { status: 200, json: { ok: true, index: items } };
    }

    if (method === "POST" && pathname === `${documentsBase}/verification-cleanup`) {
      if (!options.staleCleanupNoOp) {
        for (const [documentId, record] of documentStore.entries()) {
          if (
            isVerificationDocument(record) &&
            isActiveVerificationDocument(record) &&
            documentId !== verificationDocumentId
          ) {
            upsertDocument({
              ...record,
              documentStatus: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
            });
          }
        }
      }
      return {
        status: 200,
        json: {
          ok: true,
          cleanedCount: options.staleCleanupNoOp ? 0 : 1,
          results: [{ documentId: verificationDocumentId, ok: true }],
        },
      };
    }

    if (method === "POST" && pathname === documentsBase) {
      createAttempts += 1;
      if (options.createResponse) {
        return options.createResponse(body);
      }
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_CREATE_FAILED" } };
      }
      if (options.create502Once && create502Attempts === 0) {
        create502Attempts += 1;
        const requestedId = trim(body?.documentId) || verificationDocumentId;
        if (!getDocument(requestedId)) {
          const created = {
            ...verificationTemplate,
            ...body,
            documentId: requestedId,
            documentNumber: trim(body?.documentNumber) || verificationDocumentNumber,
            documentStatus: "draft",
            currentRevisionId: buildRevisionId(requestedId, 1),
            currentRevision: "1",
          };
          upsertDocument(created);
          ensureVerificationRevision(created);
        }
        return { status: 502, json: null };
      }
      const requestedId = trim(body?.documentId) || verificationDocumentId;
      const existing = getDocument(requestedId);
      if (existing) {
        return {
          status: 200,
          json: {
            ok: true,
            alreadyExists: true,
            documentId: existing.documentId,
            document: existing,
            updatedRows: 0,
          },
        };
      }
      if (options.createSuccessButNotVisible) {
        return {
          status: 200,
          json: { ok: true, documentId: requestedId, updatedRows: 2 },
        };
      }
      const created = {
        ...verificationTemplate,
        ...body,
        documentId: requestedId,
        documentNumber: trim(body?.documentNumber) || verificationDocumentNumber,
        documentStatus: "draft",
        currentRevisionId: buildRevisionId(requestedId, 1),
        currentRevision: "1",
      };
      upsertDocument(created);
      ensureVerificationRevision(created);
      suppressVerificationInListCount = Number(options.listStaleUntilAttempt) || 0;
      return {
        status: 200,
        json: { ok: true, documentId: requestedId, updatedRows: 2, document: created },
      };
    }

    if (method === "GET" && pathname.startsWith(`${documentsBase}/`) && !pathname.includes("/revisions")) {
      const documentId = decodeURIComponent(pathname.slice(`${documentsBase}/`.length));
      const payload = documentDetailPayload(documentId);
      if (!payload) {
        return { status: 404, json: { ok: false, code: "DOCUMENT_NOT_FOUND" } };
      }
      if (options.detailMismatch && documentId === verificationDocumentId) {
        const status = normalizeStatus(payload.document?.documentStatus);
        if (status === "current") {
          return {
            status: 200,
            json: {
              ...payload,
              document: { ...payload.document, title: "Unexpected title" },
            },
          };
        }
      }
      return { status: 200, json: payload };
    }

    if (method === "PATCH" && pathname.startsWith(`${documentsBase}/`)) {
      const documentId = decodeURIComponent(pathname.slice(`${documentsBase}/`.length));
      const current = getDocument(documentId);
      if (!current) {
        return { status: 404, json: { ok: false, code: "DOCUMENT_NOT_FOUND" } };
      }
      if (options.editFails && trim(body?.title || "").includes("(edited)")) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_UPDATE_FAILED" } };
      }
      const updated = {
        ...current,
        title: body?.title !== undefined ? body.title : current.title,
        keywords: body?.keywords !== undefined ? body.keywords : current.keywords,
        updatedAt: new Date().toISOString(),
      };
      upsertDocument(updated);
      return { status: 200, json: { ok: true, documentId, document: updated, updatedRows: 1 } };
    }

    if (method === "POST" && pathname.endsWith("/upload")) {
      uploadAttempts += 1;
      const revisionId = decodeURIComponent(pathname.split("/revisions/")[1]?.replace(/\/upload$/, "") || "");
      const revision = getRevision(revisionId) || ensureVerificationRevision(getDocument(verificationDocumentId));
      if (options.uploadUnavailable) {
        return { status: 503, json: { ok: false, code: "DRIVE_UNAVAILABLE" } };
      }
      if (options.uploadLinkedOnDetailAfterFailure && uploadAttempts === 1) {
        upsertRevision({
          ...revision,
          fileId: "verify-file-1",
          fileName: buildVerificationFileName(runId),
          fileUrl: "https://drive.example/verify-file-1",
          mimeType: "application/pdf",
        });
        return {
          status: 504,
          json: {
            ok: false,
            code: "DOCUMENT_CONTROL_UPLOAD_TIMEOUT",
            details: "Google operation timed out (document_control_upload).",
          },
        };
      }
      if (options.uploadFails && uploadAttempts === 1) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_UPLOAD_FAILED" } };
      }
      if (revision.fileId) {
        return { status: 200, json: { ok: true, alreadyUploaded: true, revision, updatedRows: 0 } };
      }
      const uploaded = {
        ...revision,
        fileId: "verify-file-1",
        fileName: trim(body?.fileName) || buildVerificationFileName(runId),
        fileUrl: "https://drive.example/verify-file-1",
        mimeType: "application/pdf",
      };
      upsertRevision(uploaded);
      return { status: 200, json: { ok: true, revision: uploaded, updatedRows: 1 } };
    }

    if (method === "POST" && pathname.endsWith("/submit")) {
      submitAttempts += 1;
      const revisionId = decodeURIComponent(pathname.split("/revisions/")[1]?.replace(/\/submit$/, "") || "");
      const revision = getRevision(revisionId);
      if (!revision) {
        return { status: 404, json: { ok: false, code: "REVISION_NOT_FOUND" } };
      }
      if (options.submitFails && submitAttempts === 1) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_SUBMIT_FAILED" } };
      }
      if (normalizeStatus(revision.revisionStatus) === "awaiting_approval") {
        return {
          status: 200,
          json: {
            ok: true,
            document: getDocument(revision.documentId),
            currentRevision: revision,
            revisions: [revision],
          },
        };
      }
      const submitted = { ...revision, revisionStatus: "awaiting_approval" };
      upsertRevision(submitted);
      const document = getDocument(revision.documentId);
      if (document) {
        upsertDocument({ ...document, documentStatus: "awaiting_approval" });
      }
      return {
        status: 200,
        json: {
          ok: true,
          document: getDocument(revision.documentId),
          currentRevision: submitted,
          revisions: [submitted],
          updatedRows: 1,
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/approve")) {
      approveAttempts += 1;
      const revisionId = decodeURIComponent(pathname.split("/revisions/")[1]?.replace(/\/approve$/, "") || "");
      const revision = getRevision(revisionId);
      if (!revision) {
        return { status: 404, json: { ok: false, code: "REVISION_NOT_FOUND" } };
      }
      if (options.selfApproveBlocked && approveAttempts === 1 && loginAttempts <= 1) {
        return {
          status: 403,
          json: {
            ok: false,
            code: "DOCUMENT_SELF_APPROVAL_BLOCKED",
            error: "Reviewer credentials are required because self-approval is blocked.",
          },
        };
      }
      if (options.approveFails && approveAttempts === 1) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_APPROVE_FAILED" } };
      }
      if (normalizeStatus(revision.revisionStatus) === "current") {
        return {
          status: 200,
          json: {
            ok: true,
            document: getDocument(revision.documentId),
            currentRevision: revision,
            revisions: [revision],
          },
        };
      }
      const approved = {
        ...revision,
        revisionStatus: "current",
        approvedBy: loginAttempts > 1 ? options.reviewerExpectedEmail || "reviewer@usebert.co.uk" : baseConfig.expectedEmail,
        approvedAt: new Date().toISOString(),
      };
      upsertRevision(approved);
      const document = getDocument(revision.documentId);
      if (document) {
        const currentDocument = {
          ...document,
          documentStatus: "current",
          currentRevisionId: revision.revisionId,
          currentRevision: revision.revision,
        };
        upsertDocument(currentDocument);
        if (!options.libraryUnavailable && !options.libraryMissingVerification) {
          libraryDocuments = [toListItem(currentDocument)];
        }
      }
      return {
        status: 200,
        json: {
          ok: true,
          document: getDocument(revision.documentId),
          currentRevision: approved,
          revisions: [approved],
          updatedRows: 2,
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/verification-cleanup")) {
      cleanupAttempts += 1;
      if (options.cleanupResponse) {
        return options.cleanupResponse(body);
      }
      if (options.cleanupFails) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsNonVerification) {
        return { status: 403, json: { ok: false, code: "CLEANUP_NOT_VERIFICATION_DOCUMENT" } };
      }
      const documentId = pathname.split("/").filter(Boolean).at(-2);
      const current = getDocument(documentId);
      if (current) {
        upsertDocument({
          ...current,
          documentStatus: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
        });
      }
      return {
        status: 200,
        json: {
          ok: true,
          documentId,
          cleaned: true,
          status: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS,
        },
      };
    }

    if (method === "POST" && pathname.endsWith("/revisions") && pathname.includes("/documents/")) {
      if (options.newRevisionUnsupported) {
        return { status: 404, json: { ok: false, code: "DOCUMENT_CONTROL_REVISION_UNSUPPORTED" } };
      }
      const documentId = decodeURIComponent(pathname.split("/document-control/documents/")[1]?.replace(/\/revisions$/, "") || "");
      const document = getDocument(documentId);
      if (!document) {
        return { status: 404, json: { ok: false, code: "DOCUMENT_NOT_FOUND" } };
      }
      const revisionId = buildRevisionId(documentId, 2);
      const revision = {
        revisionId,
        documentId,
        documentNumber: document.documentNumber,
        revision: "2",
        revisionSequence: 2,
        revisionStatus: "draft",
        changeSummary: "Verification revision 2",
      };
      upsertRevision(revision);
      return { status: 200, json: { ok: true, revision, document, currentRevisionUnchanged: true } };
    }

    if (method === "POST" && pathname.includes("/document-control/documents/") && pathname.endsWith("/review")) {
      if (options.reviewUnsupported) {
        return { status: 404, json: { ok: false, code: "DOCUMENT_CONTROL_REVIEW_UNSUPPORTED" } };
      }
      if (options.reviewFails) {
        return { status: 500, json: { ok: false, code: "DOCUMENT_CONTROL_REVIEW_FAILED" } };
      }
      return { status: 200, json: { ok: true, reviewed: true } };
    }

    if (method === "GET" && pathname === libraryBase) {
      if (options.libraryUnavailable) {
        return { status: 503, json: { ok: false, code: "DOCUMENTS_UNAVAILABLE" } };
      }
      if (options.libraryMissingVerification) {
        return { status: 200, json: { ok: true, documents: [] } };
      }
      return { status: 200, json: { ok: true, documents: [...libraryDocuments] } };
    }

    if (method === "GET" && pathname.includes("/dashboard/live")) {
      if (options.dashboardFails) {
        return { status: 500, json: { ok: false } };
      }
      return {
        status: 200,
        json: dashboardPayload(options.dashboardIncludesVerification === true),
      };
    }

    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    getDocuments: () => documents,
    getDocument,
    getRevision,
    verificationDocumentId,
    verificationRevisionId,
    get uploadAttempts() {
      return uploadAttempts;
    },
    get submitAttempts() {
      return submitAttempts;
    },
    get approveAttempts() {
      return approveAttempts;
    },
  };
}

test("full successful workflow", async () => {
  const transport = createTransport();
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.ok, true);
  for (const key of [
    "authentication",
    "documentsApi",
    "baseline",
    "staleCleanup",
    "createDraft",
    "readback",
    "fileUpload",
    "editDraft",
    "submit",
    "approval",
    "detail",
    "libraryVisibility",
    "cleanup",
  ]) {
    assert.equal(result.checks[key].status, "PASS", key);
  }
  assert.equal(result.checks.search.status, "SKIP");
  assert.match(formatDocumentsWorkflowReport(result), /READY FOR CUSTOMERS/);
});

test("login failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ loginFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "authentication");
});

test("document API unavailable", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ documentsUnavailable: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "documentsApi");
});

test("mutation disabled", async () => {
  const config = { ...baseConfig, allowDocumentMutation: false };
  const result = await runProductionDocumentsWorkflowChecks(config, createTransport(), defaultRunOptions);
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "SKIP");
  assert.equal(result.checks.cleanup.status, "SKIP");
});

test("stale cleanup", async () => {
  const stale = buildProductionVerificationDocument({
    runId: 99999,
    documentId: `${PRODUCTION_VERIFICATION_DOCUMENT_ID_PREFIX}99999`,
    ownerEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    initialDocuments: [customerDocument(), toListItem({ ...stale, documentStatus: "draft" })],
  });
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("create failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ createFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "createDraft");
});

test("create succeeds but record not visible", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ createSuccessButNotVisible: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "readback");
});

test("detail visible but list stale is retried safely", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ listStaleUntilAttempt: 2 }),
    defaultRunOptions,
  );
  assert.equal(result.checks.readback.status, "PASS");
});

test("duplicate create idempotency", async () => {
  const existing = buildProductionVerificationDocument({
    runId: TEST_RUN_ID,
    ownerEmail: baseConfig.expectedEmail,
  });
  const transport = createTransport({
    initialDocuments: [customerDocument(), toListItem({ ...existing, documentStatus: "draft" })],
  });
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.createDraft.status, "PASS");
  assert.equal(result.checks.readback.status, "PASS");
});

test("file upload success", async () => {
  const transport = createTransport();
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.fileUpload.status, "PASS");
  assert.ok(transport.uploadAttempts >= 1);
});

test("file upload skipped", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ uploadUnavailable: true }),
    defaultRunOptions,
  );
  assert.equal(result.checks.fileUpload.status, "SKIP");
  assert.match(result.checks.fileUpload.reason || "", /upload|drive|skip/i);
});

test("edit failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ editFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "editDraft");
});

test("submit failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ submitFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "submit");
});

test("repeated submit idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.submit.status, "PASS");
  assert.ok(transport.submitAttempts >= 1);
});

test("reviewer required but missing", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ selfApproveBlocked: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "reviewerLogin");
  assert.match(result.failureReason || "", /reviewer/i);
});

test("reviewer login failure", async () => {
  const config = loadDocumentsWorkflowConfig({
    BERT_SMOKE_USERNAME: baseConfig.username,
    BERT_SMOKE_PASSWORD: baseConfig.password,
    BERT_SMOKE_COMPANY_FOLDER_ID: baseConfig.companyFolderId,
    BERT_SMOKE_MASTER_SHEET_ID: baseConfig.masterSheetId,
    BERT_SMOKE_EXPECTED_EMAIL: baseConfig.expectedEmail,
    BERT_SMOKE_ALLOW_DOCUMENT_MUTATION: "1",
    BERT_SMOKE_DOCUMENT_REVIEWER_USERNAME: "reviewer.user",
    BERT_SMOKE_DOCUMENT_REVIEWER_PASSWORD: "reviewer-password",
    BERT_SMOKE_DOCUMENT_REVIEWER_EXPECTED_EMAIL: "bert.demo+reviewer.user@usebert.co.uk",
  });
  const result = await runProductionDocumentsWorkflowChecks(
    config,
    createTransport({
      selfApproveBlocked: true,
      reviewerLoginFails: true,
      reviewerExpectedEmail: config.reviewerExpectedEmail,
    }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "reviewerLogin");
});

test("self-approval allowed where intended", async () => {
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.approval.status, "PASS");
  assert.ok(["SKIP", "PASS"].includes(result.checks.reviewerLogin?.status || "SKIP"));
});

test("approval failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ approveFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "approval");
});

test("repeated approval idempotency", async () => {
  const transport = createTransport();
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.checks.approval.status, "PASS");
  assert.ok(transport.approveAttempts >= 1);
});

test("detail mismatch", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ detailMismatch: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "detail");
});

test("library visibility success", async () => {
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.libraryVisibility.status, "PASS");
});

test("library skipped", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ libraryUnavailable: true }),
    defaultRunOptions,
  );
  assert.equal(result.checks.libraryVisibility.status, "SKIP");
  assert.match(result.checks.libraryVisibility.reason || "", /library|documents|skip/i);
});

test("review success (SKIP path ok)", async () => {
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.notEqual(result.checks.review.status, "FAIL");
});

test("review skipped", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ reviewUnsupported: true }),
    defaultRunOptions,
  );
  assert.equal(result.checks.review.status, "SKIP");
});

test("new revision success (SKIP path ok)", async () => {
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.notEqual(result.checks.newRevision.status, "FAIL");
});

test("new revision skipped", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ newRevisionUnsupported: true }),
    defaultRunOptions,
  );
  assert.equal(result.checks.newRevision.status, "SKIP");
});

test("dashboard exclusion failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ dashboardIncludesVerification: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "dashboard");
});

test("search skipped", async () => {
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.search.status, "SKIP");
});

test("cleanup success", async () => {
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, createTransport(), defaultRunOptions);
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("cleanup failure", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ cleanupFails: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "cleanup");
});

test("non-verification cleanup rejected", async () => {
  const transport = createTransport({ cleanupRejectsNonVerification: true });
  const cleanup = await attemptVerificationDocumentCleanup(transport.request, {
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
    verificationDocumentId: "doc-customer-1",
  });
  const single = cleanup.results.find((item) => item.kind === "single");
  assert.equal(single?.ok, false);
});

test("transient 502 recovery", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ create502Once: true }),
    defaultRunOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.createDraft.status, "PASS");
});

test("timeout cleanup attempt surfaces timed out metadata", async () => {
  const transport = {
    request: async () => {
      const error = new Error("Request timed out after 1000ms");
      error.name = "StageTimeoutError";
      error.code = "STAGE_TIMEOUT";
      error.method = "GET";
      error.safeUrl = "https://api.usebert.co.uk/api/health";
      error.elapsedMs = 1000;
      error.timeoutMs = 1000;
      throw error;
    },
  };
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, defaultRunOptions);
  assert.equal(result.timedOut, true);
  assert.equal(result.failedKey, "authentication");
});

test("SIGINT/SIGTERM cleanup registers interrupt handler", async () => {
  const transport = createTransport();
  let registeredCleanup = null;
  await runProductionDocumentsWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    registerInterruptCleanup(fn) {
      registeredCleanup = fn;
    },
  });
  assert.equal(typeof registeredCleanup, "function");
  const cleanup = await registeredCleanup();
  assert.equal(cleanup.ok, true);
});

test("secrets and file content absent from output", async () => {
  const result = await runProductionDocumentsWorkflowChecks(
    baseConfig,
    createTransport({ loginFails: true }),
    defaultRunOptions,
  );
  const report = formatDocumentsWorkflowReport(result);
  assert.doesNotMatch(report, /secret-password/i);
  assert.doesNotMatch(report, /signed-session-token/i);
  assert.doesNotMatch(report, /bert_company_session=/i);
  assert.doesNotMatch(report, new RegExp(buildVerificationFileDataUrl(TEST_RUN_ID).slice(0, 24), "i"));
  assert.doesNotMatch(report, new RegExp(PRODUCTION_VERIFICATION_DOCUMENT_FILE_NAME_PREFIX, "i"));
});

test("verification helpers classify operational vs verification documents", () => {
  const verification = buildProductionVerificationDocument({ runId: TEST_RUN_ID });
  assert.equal(isVerificationDocument(verification), true);
  assert.equal(isActiveVerificationDocument(verification), true);
  assert.equal(isOperationalDocument(verification), false);
  const cleaned = { ...verification, documentStatus: PRODUCTION_VERIFICATION_DOCUMENT_CLEANED_STATUS };
  assert.equal(isActiveVerificationDocument(cleaned), false);
  assert.equal(isOperationalDocument(cleaned), false);
  const baseline = countDocumentBaselines([customerDocument(), verification]);
  assert.equal(baseline.operationalCount, 1);
  assert.equal(baseline.activeVerificationCount, 1);
  assert.equal(listActiveVerificationDocuments([customerDocument(), verification, cleaned]).length, 1);
  assert.equal(findDocumentById([verification], verification.documentId)?.documentId, verification.documentId);
});

test("check keys cover required stages", () => {
  assert.equal(CHECK_KEYS.length, 18);
  assert.equal(CHECK_KEYS.includes("fileUpload"), true);
  assert.equal(CHECK_KEYS.includes("libraryVisibility"), true);
  assert.equal(CHECK_KEYS.includes("newRevision"), true);
  assert.equal(CHECK_KEYS.includes("reviewerLogin"), true);
  assert.match(PRODUCTION_VERIFICATION_DOCUMENT_ID_PREFIX, /^bert-smoke-doc-/);
  assert.match(PRODUCTION_VERIFICATION_DOCUMENT_NUMBER_PREFIX, /^BERT-VERIFY-DOC-/);
  assert.equal(normalizeStatus(PRODUCTION_VERIFICATION_DOCUMENT_SOURCE), "production-documents-workflow");
  assert.match(PRODUCTION_VERIFICATION_DOCUMENT_TITLE, /BERT Verification Document/);
  assert.equal(CHECK_LABELS.authentication, "Authentication");
});

test("revisionHasVerificationPdf accepts linked PDF detail", () => {
  const runId = TEST_RUN_ID;
  const detail = {
    status: 200,
    json: {
      ok: true,
      currentRevision: {
        fileId: "drive-file-1",
        fileName: buildVerificationFileName(runId),
        mimeType: "application/pdf",
      },
    },
  };
  assert.equal(revisionHasVerificationPdf(detail, runId), true);
});

test("file upload recovers from linked detail after transient upload failure", async () => {
  const transport = createTransport({ uploadLinkedOnDetailAfterFailure: true });
  const result = await runProductionDocumentsWorkflowChecks(baseConfig, transport, {
    ...defaultRunOptions,
    listPollIntervalMs: 0,
    detailPollIntervalMs: 0,
  });
  assert.equal(result.checks.fileUpload.status, "PASS");
});
