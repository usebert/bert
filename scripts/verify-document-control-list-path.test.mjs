#!/usr/bin/env node
/**
 * Document Control list path optimisation tests.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_DOCUMENTS_TAB,
  DOCUMENT_REVISIONS_TAB,
} from "../shared/document-control.mjs";
import {
  createControlledDocument,
  getDocumentControlDocument,
  listDocumentControlDocuments,
} from "../server/document-control-service.mjs";
import {
  documentControlListCacheKey,
  invalidateDocumentControlListCache,
  peekDocumentControlListCache,
} from "../server/document-control-list-cache.mjs";
import {
  pollDocumentDetailForId,
  pollDocumentListForId,
} from "./lib/production-documents-workflow-core.mjs";

const companyFolderId = "company-folder-test";
const masterSheetId = "sheet-doc-control-list";
const manager = { kind: "company", email: "manager@example.com", role: "Manager" };
const auditor = { kind: "company", email: "auditor@example.com", role: "Auditor" };
const resolved = { companyFolderId, masterSheetId, companyId: companyFolderId };

const baseInput = {
  title: "Quality Policy",
  documentType: "policy",
  department: "Quality",
  ownerName: "Jane Owner",
  ownerEmail: "jane@example.com",
  primaryStandard: "ISO9001",
  clauseReferences: "ISO9001:7.5,ISO9001:5.2",
  fileName: "quality-policy.pdf",
  fileUrl: "https://drive.example/file1",
  fileId: "file-1",
  changeSummary: "Initial issue",
};

function createWorkbookMock() {
  const tabs = new Map();
  const key = (sheetId, tab) => `${sheetId}:${tab}`;
  const ensure = (sheetId, tab, headers = []) => {
    const k = key(sheetId, tab);
    if (!tabs.has(k)) {
      tabs.set(k, { headers: [...headers], rows: [] });
    }
    return tabs.get(k);
  };

  let ensureTabColumnsCalls = 0;
  let readTabRecordsCalls = 0;
  let driveCalls = 0;
  const readTabs = [];

  const deps = {
    _documentControlIndex: null,
    ensureTabColumns: async (_auth, _deps, sheetId, tab, headers) => {
      ensureTabColumnsCalls += 1;
      ensure(sheetId, tab, headers);
      return { addedColumns: [], headers };
    },
    readTabRecords: async (_auth, _deps, sheetId, tab, options = {}) => {
      readTabRecordsCalls += 1;
      readTabs.push(tab);
      const entry = ensure(sheetId, tab, options.expectedHeaders || []);
      return { ok: true, records: entry.rows.map((row) => ({ ...row })), rowCount: entry.rows.length };
    },
    appendTabRows: async (_auth, _deps, sheetId, tab, headers, rowObjects = []) => {
      const entry = ensure(sheetId, tab, headers);
      for (const row of rowObjects) {
        const normalized = {};
        for (const header of headers) {
          normalized[header] = String(row[header] ?? "").trim();
        }
        entry.rows.push(normalized);
      }
      return { ok: true, written: rowObjects.length };
    },
    patchTabRowByHeader: async () => ({ ok: true, updatedRows: 1 }),
    replaceTabRows: async (_auth, _deps, sheetId, tab, headers, rows = []) => {
      const entry = ensure(sheetId, tab, headers);
      entry.rows = rows.map((row) => {
        const normalized = {};
        for (const header of headers) {
          normalized[header] = String(row[header] ?? "").trim();
        }
        return normalized;
      });
      return { ok: true, written: rows.length };
    },
    google: {
      drive: () => {
        driveCalls += 1;
        throw new Error("Drive should not be called on list/detail reads");
      },
    },
    get counters() {
      return { ensureTabColumnsCalls, readTabRecordsCalls, driveCalls, readTabs: [...readTabs] };
    },
    resetCounters() {
      ensureTabColumnsCalls = 0;
      readTabRecordsCalls = 0;
      driveCalls = 0;
      readTabs.length = 0;
    },
  };

  return deps;
}

test("list does not read revisions tab or build full detail per document", async () => {
  invalidateDocumentControlListCache();
  const deps = createWorkbookMock();
  const created = await createControlledDocument(null, deps, resolved, manager, {
    ...baseInput,
    title: "Procedure A",
  });
  assert.equal(created.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  deps.resetCounters();

  const list = await listDocumentControlDocuments(null, deps, resolved, manager, { skipCache: true });
  assert.equal(list.ok, true);
  assert.equal(list.documents.length, 1);
  assert.equal(list.documents[0].documentId, created.document.documentId);
  assert.ok(!("revisions" in list.documents[0]));
  assert.ok(typeof list.documents[0].currentRevision === "string");

  const revisionReads = deps.counters.readTabs.filter((tab) => tab === DOCUMENT_REVISIONS_TAB).length;
  assert.equal(revisionReads, 0, "list must not read DocumentRevisions tab");
  assert.ok(deps.counters.readTabs.every((tab) => tab === CONTROLLED_DOCUMENTS_TAB), "list only reads ControlledDocuments");
  assert.equal(deps.counters.driveCalls, 0, "list must not call Drive");
});

test("detail loads revisions for one document without per-document Drive calls", async () => {
  invalidateDocumentControlListCache();
  const deps = createWorkbookMock();
  const created = await createControlledDocument(null, deps, resolved, manager, {
    ...baseInput,
    title: "Procedure B",
    fileId: "file-2",
    fileName: "procedure-b.pdf",
  });
  deps.resetCounters();

  const detail = await getDocumentControlDocument(null, deps, resolved, manager, created.document.documentId, {
    skipCache: true,
  });
  assert.equal(detail.ok, true);
  assert.equal(detail.document.documentId, created.document.documentId);
  assert.ok(Array.isArray(detail.revisions));
  assert.equal(detail.revisions.length, 1);
  assert.equal(deps.counters.driveCalls, 0);
  assert.ok(deps.counters.readTabRecordsCalls >= 2, "detail reads documents and revisions tabs");
});

test("create invalidates list cache", async () => {
  invalidateDocumentControlListCache();
  const deps = createWorkbookMock();
  const warm = await listDocumentControlDocuments(null, deps, resolved, manager);
  assert.equal(warm.ok, true);
  assert.equal(warm.documents.length, 0);

  const cacheKey = documentControlListCacheKey(resolved, manager, {});
  assert.ok(peekDocumentControlListCache(cacheKey));

  await createControlledDocument(null, deps, resolved, manager, {
    ...baseInput,
    title: "Procedure C",
    fileId: "file-3",
    fileName: "procedure-c.pdf",
  });

  assert.equal(peekDocumentControlListCache(cacheKey), null);

  const refreshed = await listDocumentControlDocuments(null, deps, resolved, manager);
  assert.equal(refreshed.documents.length, 1);
});

test("warm list uses cache on second request", async () => {
  invalidateDocumentControlListCache();
  const deps = createWorkbookMock();
  await createControlledDocument(null, deps, resolved, manager, {
    ...baseInput,
    title: "Procedure D",
    fileId: "file-4",
    fileName: "procedure-d.pdf",
  });
  deps.resetCounters();

  const first = await listDocumentControlDocuments(null, deps, resolved, manager);
  assert.equal(first.documents.length, 1);
  const readsAfterFirst = deps.counters.readTabRecordsCalls;

  const second = await listDocumentControlDocuments(null, deps, resolved, manager);
  assert.equal(second.documents.length, 1);
  assert.equal(deps.counters.readTabRecordsCalls, readsAfterFirst, "cached list should not re-read tabs");
});

test("auditor list filtering unchanged", async () => {
  invalidateDocumentControlListCache();
  const deps = createWorkbookMock();
  const draft = await createControlledDocument(null, deps, resolved, manager, {
    ...baseInput,
    title: "Draft Only",
    fileId: "file-5",
    fileName: "draft-only.pdf",
  });
  assert.equal(draft.ok, true);

  const managerList = await listDocumentControlDocuments(null, deps, resolved, manager, { skipCache: true });
  const auditorList = await listDocumentControlDocuments(null, deps, resolved, auditor, { skipCache: true });
  assert.equal(managerList.documents.length, 1);
  assert.equal(auditorList.documents.length, 0);
});

test("readback polls detail before list and retries stale empty list safely", async () => {
  const documentId = "bert-smoke-doc-12345";
  let listAttempts = 0;
  const request = async (method, path) => {
    if (method === "GET" && path.includes(`/documents/${encodeURIComponent(documentId)}`)) {
      return {
        status: 200,
        json: {
          ok: true,
          document: { documentId, documentStatus: "draft", title: "Verify" },
          currentRevision: { revisionId: `${documentId}-rev-1` },
          revisions: [{ revisionId: `${documentId}-rev-1` }],
        },
      };
    }
    if (method === "GET" && path.includes("/document-control/documents") && !path.includes(`/documents/${encodeURIComponent(documentId)}`)) {
      listAttempts += 1;
      const documents =
        listAttempts < 3
          ? []
          : [{ documentId, id: documentId, documentStatus: "draft", title: "Verify" }];
      return { status: 200, json: { ok: true, documents } };
    }
    throw new Error(`Unexpected ${method} ${path}`);
  };

  const detailPoll = await pollDocumentDetailForId(request, "company", "sheet", documentId, {
    maxAttempts: 2,
    intervalMs: 0,
  });
  assert.equal(detailPoll.ok, true);

  const listPoll = await pollDocumentListForId(request, "company", "sheet", documentId, {
    maxAttempts: 5,
    intervalMs: 0,
  });
  assert.equal(listPoll.ok, true);
  assert.equal(listAttempts, 3);
});

test("detail confirms created document directly", async () => {
  const documentId = "bert-smoke-doc-999";
  const request = async (method, path) => {
    if (method === "GET" && path.includes(`/documents/${encodeURIComponent(documentId)}`)) {
      return { status: 200, json: { ok: true, document: { documentId, documentStatus: "draft" } } };
    }
    return { status: 200, json: { ok: true, documents: [{ documentId }] } };
  };
  const detailPoll = await pollDocumentDetailForId(request, "company", "sheet", documentId, {
    maxAttempts: 1,
    intervalMs: 0,
  });
  assert.equal(detailPoll.ok, true);
  assert.equal(detailPoll.detailResponse.json.document.documentId, documentId);
});
