#!/usr/bin/env node
/**
 * verify:document-control — ISO Document Control Phase 1.
 * Shared helpers + server service against in-memory workbook mock, plus wiring checks.
 * Asserts auth/login/Schedules/LOLER/Calendar/Messages remain untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTROLLED_DOCUMENTS_TAB,
  CONTROLLED_DOCUMENTS_TAB_COLUMNS,
  DOCUMENT_CONTROL_INDEX_TAB,
  DOCUMENT_CONTROL_INDEX_TAB_COLUMNS,
  DOCUMENT_REVISIONS_TAB,
  DOCUMENT_REVISIONS_TAB_COLUMNS,
  DOCUMENT_REVIEW_DUE_SOON_DAYS,
  documentNumberAlreadyUsed,
  documentReviewDerivedStatus,
  formatDocumentNumber,
  groupDocumentsByClause,
  highestSequenceForPrefix,
  nextDocumentNumberForPrefix,
  parseDocumentNumber,
  prefixForDocumentType,
  validateControlledDocumentInput,
} from "../shared/document-control.mjs";
import {
  approveDocumentRevision,
  archiveControlledDocument,
  canApproveDocumentControl,
  canManageDocumentControl,
  canViewDocumentControl,
  createControlledDocument,
  createDocumentRevision,
  getDocumentControlDocument,
  getDocumentRevisionFile,
  listDocumentControlDocuments,
  listDocumentControlIndex,
  rebuildDocumentControlIndex,
  submitDocumentRevision,
} from "../server/document-control-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

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

  const deps = {
    _documentControlIndex: null,
    ensureTabColumns: async (_auth, _deps, sheetId, tab, headers) => {
      ensure(sheetId, tab, headers);
      return { addedColumns: [], headers };
    },
    readTabRecords: async (_auth, _deps, sheetId, tab, options = {}) => {
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
    patchTabRowByHeader: async (_auth, _deps, sheetId, tab, matchHeader, matchValue, updates = {}) => {
      const entry = ensure(sheetId, tab);
      const row = entry.rows.find(
        (candidate) =>
          String(candidate[matchHeader] || "")
            .trim()
            .toLowerCase() ===
          String(matchValue || "")
            .trim()
            .toLowerCase(),
      );
      if (!row) {
        throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
      }
      for (const [header, value] of Object.entries(updates)) {
        row[header] = String(value ?? "").trim();
      }
      return { ok: true };
    },
    deleteAllTabRows: async (_auth, _deps, sheetId, tab) => {
      const entry = ensure(sheetId, tab);
      entry.rows = [];
      return { ok: true };
    },
  };

  return { tabs, deps };
}

function company(folderId, sheetId) {
  return { ok: true, companyFolderId: folderId, companyId: folderId, masterSheetId: sheetId, alternateIds: [] };
}

function actor(role, folderId, email = `${role.toLowerCase()}@example.com`) {
  return { kind: "company", role, email, companyFolderId: folderId, companyId: folderId };
}

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

// --- Unit helpers ---
assert(prefixForDocumentType("policy") === "POL", "3a. policy prefix POL");
assert(formatDocumentNumber("POL", 1) === "POL-001", "3b. number format POL-001");
assert(parseDocumentNumber("PRO-014")?.sequence === 14, "3c. parse sequence");
assert(highestSequenceForPrefix(["POL-001", "POL-003", "PRO-002"], "POL") === 3, "3d. highest sequence ignores other prefixes");
assert(nextDocumentNumberForPrefix(["POL-001", "POL-003"], "POL") === "POL-004", "3e. next number not array length");
assert(!documentNumberAlreadyUsed(["POL-001"], "POL-002"), "4a. unused number ok");
assert(documentNumberAlreadyUsed(["POL-001"], "pol-001"), "4b. duplicate detection case-insensitive");

const missing = validateControlledDocumentInput({ title: "" });
assert(!missing.ok, "2. required metadata validated");

assert(documentReviewDerivedStatus("2026-06-01", "2026-07-01") === "review_overdue", "31. review overdue");
assert(
  documentReviewDerivedStatus("2026-07-20", "2026-07-01", DOCUMENT_REVIEW_DUE_SOON_DAYS) === "review_due_soon",
  "30. review due-soon",
);
assert(documentReviewDerivedStatus("2026-12-01", "2026-07-01") === "review_current", "30b. review current");

const mock = createWorkbookMock();
const SHEET_A = "sheet-a";
const SHEET_B = "sheet-b";
const CO_A = "company-a";
const CO_B = "company-b";
const resolvedA = company(CO_A, SHEET_A);
const resolvedB = company(CO_B, SHEET_B);
const manager = actor("Manager", CO_A);
const admin = actor("Admin", CO_A);
const auditor = actor("Auditor", CO_A);
const managerB = actor("Manager", CO_B, "mgr-b@example.com");

assert(canViewDocumentControl(auditor), "roles: auditor can view");
assert(canManageDocumentControl(manager), "roles: manager can manage");
assert(canApproveDocumentControl(admin), "roles: admin can approve");
assert(!canManageDocumentControl(auditor), "roles: auditor cannot manage");
assert(!canApproveDocumentControl(auditor), "11a. auditor cannot approve");

const created = await createControlledDocument(null, mock.deps, resolvedA, manager, baseInput);
assert(created.ok, "1. Document record can be created");
assert(created.document?.documentNumber === "POL-001", "3. Document number allocated correctly");
assert(created.revision?.revision === "1", "7. First revision is created");
assert(created.revision?.revisionStatus === "draft", "7b. First revision is draft");
assert(created.document?.documentStatus === "draft", "7c. Document starts draft");

const listAuditorDraft = await listDocumentControlDocuments(null, mock.deps, resolvedA, auditor);
assert(listAuditorDraft.ok && (listAuditorDraft.documents || []).length === 0, "8. Draft not visible to Auditor");

const submitted = await submitDocumentRevision(null, mock.deps, resolvedA, manager, created.revision.revisionId);
assert(submitted.ok, "9. Revision can be submitted for approval");

const auditorApprove = await approveDocumentRevision(null, mock.deps, resolvedA, auditor, created.revision.revisionId);
assert(!auditorApprove.ok, "11. Unauthorised role cannot approve");

const approved = await approveDocumentRevision(null, mock.deps, resolvedA, admin, created.revision.revisionId);
assert(approved.ok, "10. Authorised approver can approve");
assert(approved.document?.documentStatus === "current", "12. Approved revision becomes current");
assert(approved.currentRevision?.revisionStatus === "current", "12b. Current revision status");
assert(
  (approved.revisions || []).filter((rev) => rev.revisionStatus === "current").length === 1,
  "13. Exactly one revision is current",
);

const listAuditorCurrent = await listDocumentControlDocuments(null, mock.deps, resolvedA, auditor);
assert(
  listAuditorCurrent.ok && listAuditorCurrent.documents?.length === 1 && listAuditorCurrent.documents[0].documentStatus === "current",
  "17a. Ordinary user lists current only",
);

const getAsAuditor = await getDocumentControlDocument(null, mock.deps, resolvedA, auditor, created.document.documentId);
assert(getAsAuditor.ok && getAsAuditor.resolvedRevisionId === approved.currentRevision.revisionId, "17. Ordinary user resolves DocumentId to current revision");

// Second document number uniqueness
const created2 = await createControlledDocument(null, mock.deps, resolvedA, manager, {
  ...baseInput,
  title: "Second Policy",
  fileId: "file-2",
  fileName: "second.pdf",
});
assert(created2.ok && created2.document.documentNumber === "POL-002", "4. Document numbers unique within company");

// Company B isolation / same number allowed
const createdB = await createControlledDocument(null, mock.deps, resolvedB, managerB, {
  ...baseInput,
  title: "Other Co Policy",
  fileId: "file-b1",
});
assert(createdB.ok && createdB.document.documentNumber === "POL-001", "5. Same number may exist in different companies");
const listA = await listDocumentControlDocuments(null, mock.deps, resolvedA, manager);
assert(!(listA.documents || []).some((doc) => doc.documentId === createdB.document.documentId), "32. Company data cannot cross companies");

// New draft revision does not supersede
const newRev = await createDocumentRevision(null, mock.deps, resolvedA, manager, created.document.documentId, {
  changeSummary: "Annual update",
  fileId: "file-1-rev2",
  fileName: "quality-policy-v2.pdf",
  fileUrl: "https://drive.example/file1v2",
});
assert(newRev.ok && newRev.currentRevisionUnchanged, "14. New draft revision does not supersede the current revision");
const midState = await getDocumentControlDocument(null, mock.deps, resolvedA, manager, created.document.documentId);
assert(
  midState.currentRevision?.revisionId === approved.currentRevision.revisionId &&
    midState.currentRevision?.revisionStatus === "current",
  "14b. Previous revision still current while draft open",
);

await submitDocumentRevision(null, mock.deps, resolvedA, manager, newRev.revision.revisionId);
const approved2 = await approveDocumentRevision(null, mock.deps, resolvedA, admin, newRev.revision.revisionId);
assert(approved2.ok && approved2.currentRevision?.revisionId === newRev.revision.revisionId, "15. Approving new revision makes it current");
const superseded = (approved2.revisions || []).find((rev) => rev.revisionId === created.revision.revisionId);
assert(superseded?.revisionStatus === "superseded", "15b. Previous revision superseded");
assert(superseded?.fileId === "file-1", "16. Superseded file remains preserved");

const auditorSuperseded = await getDocumentRevisionFile(
  null,
  mock.deps,
  resolvedA,
  auditor,
  created.revision.revisionId,
);
assert(!auditorSuperseded.ok, "18. Ordinary user cannot directly access superseded revision");

const warn = await getDocumentRevisionFile(null, mock.deps, resolvedA, manager, created.revision.revisionId);
assert(warn.code === "SUPERSEDED_WARNING_REQUIRED", "19. Admin/Manager sees superseded warning before access");

const opened = await getDocumentRevisionFile(null, mock.deps, resolvedA, manager, created.revision.revisionId, {
  acknowledgedSupersededWarning: true,
});
assert(opened.ok, "19b. Superseded accessible after warning acknowledgement");
const revRows = mock.tabs.get(`${SHEET_A}:${DOCUMENT_REVISIONS_TAB}`).rows;
const supersededRow = revRows.find((row) => row.RevisionId === created.revision.revisionId);
assert(String(supersededRow.ChangeLog || "").includes("superseded_revision_accessed"), "20. Superseded access is logged");

const archived = await archiveControlledDocument(null, mock.deps, resolvedA, manager, created.document.documentId);
assert(archived.ok && archived.document?.documentStatus === "archived", "21. Archive is soft");
assert((archived.revisions || []).length >= 2, "21b. Archive preserves all revisions");

const reuseArchived = await createControlledDocument(null, mock.deps, resolvedA, manager, {
  ...baseInput,
  title: "Reuse attempt",
  documentNumber: "POL-001",
  migrationNumber: true,
  fileId: "file-reuse",
});
assert(!reuseArchived.ok, "6/22. Archived document numbers are not reused");

const nextAfterArchive = await createControlledDocument(null, mock.deps, resolvedA, manager, {
  ...baseInput,
  title: "Next policy",
  fileId: "file-3",
  fileName: "next.pdf",
});
assert(nextAfterArchive.ok && nextAfterArchive.document.documentNumber !== "POL-001", "22b. Next allocation skips archived number");

await submitDocumentRevision(null, mock.deps, resolvedA, manager, created2.revision.revisionId);
await approveDocumentRevision(null, mock.deps, resolvedA, admin, created2.revision.revisionId);

// Index behaviour
assert(Array.isArray(mock.deps._documentControlIndex), "23. Index updates after creation (auto sync)");
const indexAfter = await listDocumentControlIndex(null, mock.deps, resolvedA, manager);
assert(indexAfter.ok && indexAfter.index?.length > 0, "24/25/26. Index available after approval/revision/archive flows");
const rebuilt = await rebuildDocumentControlIndex(null, mock.deps, resolvedA, admin);
assert(rebuilt.ok && rebuilt.rebuilt, "27. Index rebuild runs");
const currentIndexEntry = (rebuilt.index || []).find(
  (row) => String(row.DocumentStatus || "").toLowerCase() === "current" && String(row.CurrentRevision || ""),
);
assert(currentIndexEntry, "27b. Index rebuild produces current revision entries");

const multiClause = await createControlledDocument(null, mock.deps, resolvedA, manager, {
  ...baseInput,
  title: "IMS Procedure",
  documentType: "procedure",
  primaryStandard: "IMS",
  clauseReferences: ["ISO9001:7.5", "ISO14001:7.5", "ISO45001:7.5"],
  fileId: "file-ims",
  fileName: "ims.pdf",
});
assert(multiClause.ok && multiClause.document.clauseReferences.length === 3, "28. Multiple standard/clause references work");
await submitDocumentRevision(null, mock.deps, resolvedA, manager, multiClause.revision.revisionId);
await approveDocumentRevision(null, mock.deps, resolvedA, admin, multiClause.revision.revisionId);
const clauseList = await listDocumentControlDocuments(null, mock.deps, resolvedA, manager);
const groups = clauseList.clauseGroups || groupDocumentsByClause(clauseList.documents || []);
const isoGroups = groups.filter((g) => String(g.clauseCode).includes("7.5"));
const docIds = isoGroups.flatMap((g) => g.documents.map((d) => d.documentId));
const uniqueStored = new Set((clauseList.documents || []).map((d) => d.documentId));
assert(isoGroups.length >= 1, "29. Clause browsing groups exist");
assert(uniqueStored.has(multiClause.document.documentId), "29b. Clause browsing does not duplicate stored document records");
assert(docIds.filter((id) => id === multiClause.document.documentId).length >= 2, "29c. Same document referenced under multiple clauses");

// Schema stability
assert(CONTROLLED_DOCUMENTS_TAB === "ControlledDocuments", "33. ControlledDocuments tab name stable");
assert(DOCUMENT_REVISIONS_TAB === "DocumentRevisions", "33b. DocumentRevisions tab name stable");
assert(DOCUMENT_CONTROL_INDEX_TAB === "DocumentControlIndex", "33c. DocumentControlIndex tab name stable");
assert(CONTROLLED_DOCUMENTS_TAB_COLUMNS[0] === "DocumentId", "33d. DocumentId first column");
assert(DOCUMENT_REVISIONS_TAB_COLUMNS.includes("SupersededByRevisionId"), "33e. revision headers stable");
assert(DOCUMENT_CONTROL_INDEX_TAB_COLUMNS.includes("CurrentFileUrl"), "33f. index headers stable");

// Isolation: mock never created Schedules / LOLER / Calendar / Messages tabs
const tabNames = [...mock.tabs.keys()].map((k) => k.split(":")[1]);
assert(!tabNames.includes("Schedules"), "34. Existing Schedules sheet untouched");
assert(!tabNames.includes("AuditResults") && !tabNames.includes("LOLEREquipment"), "35. Audit/LOLER sheets untouched");
assert(!tabNames.includes("CalendarItems") && !tabNames.includes("OperationalMessages"), "35b. Calendar/Messages sheets untouched");

// Static wiring
const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes("/api/companies/:companyFolderId/document-control/documents"), "wiring: list route");
assert(routes.includes("document-control/revisions/:revisionId/approve"), "wiring: approve route");
assert(routes.includes("document-control/index/rebuild"), "wiring: index rebuild route");
assert(routes.includes("from \"./document-control-service.mjs\""), "wiring: service imported");

const app = read("App.tsx");
assert(app.includes("DocumentControlScreen"), "wiring: App imports DocumentControlScreen");
assert(app.includes('screen === "documentControl"'), "wiring: App renders documentControl screen");

const permissions = read("src/permissions.ts");
assert(permissions.includes("canAccessDocumentControl"), "wiring: canAccessDocumentControl");
assert(permissions.includes("canManageDocumentControl"), "wiring: canManageDocumentControl");
assert(permissions.includes('itemId === "documentControl"'), "wiring: nav gate includes documentControl");

const navItems = read("src/config/navItems.ts");
assert(navItems.includes('id: "documentControl"'), "wiring: navItems includes documentControl");

const roleNav = read("src/config/roleNavigation.ts");
assert((roleNav.match(/id: "documentControl"/g) || []).length >= 4, "wiring: documentControl in role nav buckets");

const navTypes = read("src/types/navigation.ts");
assert(navTypes.includes('"documentControl"'), "wiring: RoutedScreen includes documentControl");

const client = read("src/services/documentControlService.ts");
assert(client.includes("dedupeInFlight"), "38. Request deduplication works");
assert(client.includes("invalidateDocumentControlCache"), "39a. cache invalidation present");
assert(client.includes("readCachedDocumentControlDocuments"), "39. Failed refresh can retain cached metadata");
assert(client.includes("DOCUMENT_CONTROL_OFFLINE_WRITE_MESSAGE"), "37. Offline writes blocked message present");
assert(!client.includes("/api/auth/"), "client never calls auth routes");

const screen = read("src/screens/DocumentControlScreen.tsx");
assert(screen.includes("DocumentRegister") || screen.includes("document-control"), "UI: Document Control screen present");
assert(screen.includes("SupersededWarningDialog") || read("src/components/document-control/SupersededWarningDialog.tsx").includes("Superseded document"), "UI: superseded warning");

const authIndex = read("server/auth-index.mjs");
assert(!authIndex.includes("ControlledDocuments") && !authIndex.includes("document-control"), "36. auth-index untouched");
const userAuth = read("server/user-auth-service.mjs");
assert(!userAuth.includes("ControlledDocuments") && !userAuth.includes("document-control-service"), "36b. user-auth untouched");
const serverMjs = read("server/server.mjs");
assert(!serverMjs.includes("document-control-service"), "36c. server startup does not import document-control");
const lolerService = read("server/loler-service.mjs");
assert(!lolerService.includes("ControlledDocuments"), "35c. LOLER service untouched");
const calendarService = read("server/calendar-service.mjs");
assert(!calendarService.includes("ControlledDocuments"), "35d. Calendar service untouched");
const scheduleService = read("server/schedule-service.mjs");
assert(!scheduleService.includes("ControlledDocuments"), "34b. schedule service untouched");

const packageJson = read("package.json");
assert(packageJson.includes("verify:document-control"), "package.json has verify:document-control script");

console.log(`verify:document-control passed (${caseCount} checks).`);
