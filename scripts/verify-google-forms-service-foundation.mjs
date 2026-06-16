#!/usr/bin/env node
/**
 * googleFormsService foundation — company-scoped folder resolve, MIME list, GoogleFormTemplates tab I/O.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGoogleFormsFolderQuery,
  COMPANY_GOOGLE_FORMS_SYNC_COLUMNS,
  GOOGLE_FORMS_FOLDER_LOOKUP_FAILED,
  GOOGLE_FORMS_MIME,
  GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS,
  isExactGoogleFormsFolderName,
  listCompanyGoogleFormsFromDrive,
  listGoogleFormsInFolder,
  readGoogleFormTemplatesFromTab,
  resolveCompanyGoogleFormsFolder,
  resolveGoogleFormsFolder,
  syncGoogleFormTemplatesToTab,
} from "../server/google-forms-service.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const googleFormsService = read("server/google-forms-service.mjs");
const companyFormsService = read("server/company-forms-service.mjs");
const workbookService = read("server/workbook-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");

assert(pkg.scripts["verify:google-forms-service-foundation"], "1: npm script registered");
assert(googleFormsService.includes("resolveGoogleFormsFolder"), "2: resolveGoogleFormsFolder exported");
assert(googleFormsService.includes("listCompanyGoogleForms"), "3: listCompanyGoogleForms exported");
assert(googleFormsService.includes("syncGoogleFormTemplatesToTab"), "4: syncGoogleFormTemplatesToTab exported");
assert(googleFormsService.includes("readGoogleFormTemplatesFromTab"), "5: readGoogleFormTemplatesFromTab exported");
assert(googleFormsService.includes("readTabRecords"), "6: sync reads via workbookService readTabRecords");
assert(googleFormsService.includes("writeTabRecords"), "7: sync writes via workbookService writeTabRecords");
assert(googleFormsService.includes("includeItemsFromAllDrives: true"), "8: shared drive list flags");
assert(googleFormsService.includes("supportsAllDrives: true"), "9: supportsAllDrives on Drive calls");
assert(googleFormsService.includes("buildGoogleFormsFolderQuery"), "10: MIME-scoped folder query");
assert(!googleFormsService.includes("q: `name ="), "11: no random Drive name search");
assert(googleFormsService.includes(GOOGLE_FORMS_FOLDER_LOOKUP_FAILED), "12: folder lookup failed code");
assert(companyFormsService.includes('from "./google-forms-service.mjs"'), "13: company-forms-service re-exports googleFormsService");
assert(coreRoutes.includes("/api/companies/:companyId/google-forms"), "14: core route wired");
assert(
  read("server/ensure-required-tabs.mjs").includes("GOOGLE_FORM_TEMPLATES_TAB"),
  "15: GoogleFormTemplates in required tabs",
);
assert(GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS.join(",") === COMPANY_GOOGLE_FORMS_SYNC_COLUMNS.join(","), "16: sync columns match spec");

function createMockDrive(scenario) {
  const folders = new Map(Object.entries(scenario.folders || {}));
  const files = new Map(Object.entries(scenario.files || {}));
  const listCalls = [];

  function childrenOf(parentId) {
    return [...files.values()].filter((file) => (file.parents || []).includes(parentId) && !file.trashed);
  }

  return {
    listCalls,
    files: {
      get: async ({ fileId, supportsAllDrives, includeItemsFromAllDrives }) => {
        assert(supportsAllDrives === true, "Drive get uses supportsAllDrives");
        void includeItemsFromAllDrives;
        const folder = folders.get(fileId);
        if (!folder) {
          const err = new Error("Not Found");
          err.code = 404;
          throw err;
        }
        return { data: folder };
      },
      list: async ({ q, supportsAllDrives, includeItemsFromAllDrives }) => {
        assert(supportsAllDrives === true, "Drive list uses supportsAllDrives");
        assert(includeItemsFromAllDrives === true, "Drive list uses includeItemsFromAllDrives");
        listCalls.push(q);
        const parentMatch = q.match(/'([^']+)' in parents/);
        const parentId = parentMatch?.[1] || "";
        const mimeMatch = q.match(/mimeType = '([^']+)'/);
        const mime = mimeMatch?.[1] || "";
        let items = childrenOf(parentId);
        if (mime) {
          items = items.filter((file) => file.mimeType === mime);
        }
        if (q.includes("trashed = false")) {
          items = items.filter((file) => !file.trashed);
        }
        return { data: { files: items } };
      },
      create: async ({ requestBody, supportsAllDrives }) => {
        assert(supportsAllDrives === true, "Drive create uses supportsAllDrives");
        const id = `created-${folders.size + 1}`;
        const folder = {
          id,
          name: requestBody.name,
          mimeType: "application/vnd.google-apps.folder",
          parents: requestBody.parents,
          createdTime: new Date().toISOString(),
        };
        folders.set(id, folder);
        files.set(id, folder);
        return { data: folder };
      },
    },
  };
}

async function testExactGoogleFormsAtRoot() {
  const companyId = "company-root";
  const formsFolderId = "forms-folder";
  const drive = createMockDrive({
    folders: {
      [companyId]: { id: companyId, name: "Dovecote", mimeType: "application/vnd.google-apps.folder" },
      [formsFolderId]: {
        id: formsFolderId,
        name: "Google Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyId],
      },
    },
    files: {
      [companyId]: { id: companyId, name: "Dovecote", mimeType: "application/vnd.google-apps.folder", parents: [] },
      [formsFolderId]: {
        id: formsFolderId,
        name: "Google Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyId],
      },
      "form-1": {
        id: "form-1",
        name: "Site Audit",
        mimeType: GOOGLE_FORMS_MIME,
        parents: [formsFolderId],
        webViewLink: "https://docs.google.com/forms/d/form-1/edit",
        createdTime: "2026-01-01T00:00:00.000Z",
        modifiedTime: "2026-01-02T00:00:00.000Z",
      },
      "sheet-1": {
        id: "sheet-1",
        name: "Not a form",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [formsFolderId],
      },
    },
  });

  const resolved = await resolveCompanyGoogleFormsFolder(drive, { companyFolderId: companyId });
  assert(resolved.googleFormsFolderId === formsFolderId, "17: exact Google Forms folder resolved inside company");
  assert(resolved.resolvedVia === "exact_google_forms", "18: prefers exact Google Forms name");

  const listed = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyId, companyId });
  assert(listed.ok === true, "19: list ok when folder resolved");
  assert(listed.formsFound === 1, "20: MIME filter returns one form");
  assert(listed.forms[0].driveFileId === "form-1", "21: returns drive file id");
  assert(
    drive.listCalls.some((q) => q.includes(GOOGLE_FORMS_MIME) && q.includes(formsFolderId)),
    "22: lists forms only from resolved folder query",
  );
}

async function testFallbackUnderAudits() {
  const companyId = "company-nested";
  const auditsId = "audits-folder";
  const formsFolderId = "nested-forms";
  const drive = createMockDrive({
    folders: {
      [companyId]: { id: companyId, name: "Nested Co", mimeType: "application/vnd.google-apps.folder" },
      [auditsId]: {
        id: auditsId,
        name: "08 - Audits",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyId],
      },
      [formsFolderId]: {
        id: formsFolderId,
        name: "Google Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [auditsId],
      },
    },
    files: {
      [companyId]: { id: companyId, name: "Nested Co", mimeType: "application/vnd.google-apps.folder", parents: [] },
      [auditsId]: {
        id: auditsId,
        name: "08 - Audits",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyId],
      },
      [formsFolderId]: {
        id: formsFolderId,
        name: "Google Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [auditsId],
      },
      "form-nested": {
        id: "form-nested",
        name: "Nested Audit",
        mimeType: GOOGLE_FORMS_MIME,
        parents: [formsFolderId],
      },
    },
  });

  const resolved = await resolveCompanyGoogleFormsFolder(drive, { companyFolderId: companyId });
  assert(resolved.googleFormsFolderId === formsFolderId, "23: fallback 08 - Audits resolves nested Google Forms");
  const listed = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyId });
  assert(listed.formsFound === 1, "24: nested fallback lists forms");
}

async function testFallbackFormsFolderDirect() {
  const companyId = "company-forms-fallback";
  const formsFolderId = "forms-direct";
  const drive = createMockDrive({
    folders: {
      [companyId]: { id: companyId, name: "Forms Co", mimeType: "application/vnd.google-apps.folder" },
      [formsFolderId]: {
        id: formsFolderId,
        name: "Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyId],
      },
    },
    files: {
      [companyId]: { id: companyId, name: "Forms Co", mimeType: "application/vnd.google-apps.folder", parents: [] },
      [formsFolderId]: {
        id: formsFolderId,
        name: "Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyId],
      },
      "form-direct": {
        id: "form-direct",
        name: "Direct Form",
        mimeType: GOOGLE_FORMS_MIME,
        parents: [formsFolderId],
      },
    },
  });

  const resolved = await resolveCompanyGoogleFormsFolder(drive, { companyFolderId: companyId });
  assert(resolved.googleFormsFolderId === formsFolderId, "25: Forms fallback folder resolved");
  assert(resolved.resolvedVia === "fallback_forms", "26: resolved via Forms fallback");
}

async function testCreateGoogleFormsInsideCompanyFolder() {
  const companyId = "company-create";
  const drive = createMockDrive({
    folders: {
      [companyId]: { id: companyId, name: "Empty Co", mimeType: "application/vnd.google-apps.folder" },
    },
    files: {
      [companyId]: { id: companyId, name: "Empty Co", mimeType: "application/vnd.google-apps.folder", parents: [] },
    },
  });

  const resolved = await resolveCompanyGoogleFormsFolder(drive, {
    companyFolderId: companyId,
    createIfMissing: true,
  });
  assert(resolved.created === true, "27: creates Google Forms when missing");
  assert(resolved.parentFolderId === companyId, "28: created inside company folder");
  assert(resolved.resolvedVia === "created_at_company_root", "29: created at company root");
}

async function testFolderLookupFailureNotEmptyListMessage() {
  const drive = createMockDrive({
    folders: {
      "company-b": { id: "company-b", name: "B", mimeType: "application/vnd.google-apps.folder" },
    },
    files: {
      "company-b": { id: "company-b", name: "B", mimeType: "application/vnd.google-apps.folder", parents: [] },
    },
  });

  const listed = await listCompanyGoogleFormsFromDrive(drive, {
    companyFolderId: "company-b",
    createIfMissing: false,
  });
  assert(listed.ok === false, "30: folder missing is not ok");
  assert(listed.status === "folder_lookup_failed", "31: structured folder lookup failure");
  assert(listed.code === GOOGLE_FORMS_FOLDER_LOOKUP_FAILED, "32: folder lookup failed code");
  assert(listed.formsFound === 0, "33: zero forms on lookup failure");
  assert(!String(listed.error || "").includes("No Google Forms found"), "34: not empty-folder message");
  assert(listed.diagnostics?.folderLookupFailed === true, "35: diagnostics flag folder lookup failure");
}

async function testWrongCompanyExcluded() {
  const companyA = "company-a";
  const companyB = "company-b";
  const formsA = "forms-a";
  const drive = createMockDrive({
    folders: {
      [companyA]: { id: companyA, name: "A", mimeType: "application/vnd.google-apps.folder" },
      [companyB]: { id: companyB, name: "B", mimeType: "application/vnd.google-apps.folder" },
      [formsA]: {
        id: formsA,
        name: "Google Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyA],
      },
    },
    files: {
      [companyA]: { id: companyA, name: "A", mimeType: "application/vnd.google-apps.folder", parents: [] },
      [companyB]: { id: companyB, name: "B", mimeType: "application/vnd.google-apps.folder", parents: [] },
      [formsA]: {
        id: formsA,
        name: "Google Forms",
        mimeType: "application/vnd.google-apps.folder",
        parents: [companyA],
      },
      "form-a": {
        id: "form-a",
        name: "A Form",
        mimeType: GOOGLE_FORMS_MIME,
        parents: [formsA],
      },
    },
  });

  const listedB = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyB, createIfMissing: false });
  assert(listedB.status === "folder_lookup_failed", "36: company B does not inherit company A forms folder");
  const listedA = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyA });
  assert(listedA.formsFound === 1, "37: company A keeps its forms");
}

async function testTabSyncFields() {
  const masterSheetId = "sheet-sync";
  const companyFolderId = "company-sync";
  const tabStore = [];

  const mockDeps = {
    google: { sheets: () => ({}) },
    readTabRecords: async () => ({ ok: true, records: [...tabStore] }),
    writeTabRecords: async (_auth, _deps, _sheetId, _tab, columns, rows) => {
      tabStore.length = 0;
      for (const row of rows) {
        const record = {};
        columns.forEach((header) => {
          record[header] = row[header] ?? "";
        });
        tabStore.push(record);
      }
      return { ok: true, rowCount: rows.length };
    },
    ensureTabColumns: async () => ({ addedColumns: [] }),
  };

  const forms = [
    {
      formId: "form-sync",
      driveFileId: "form-sync",
      name: "Synced Form",
      companyId: companyFolderId,
      companyFolderId,
      googleFormsFolderId: "forms-sync",
      webViewLink: "https://docs.google.com/forms/d/form-sync/edit",
      createdTime: "2026-01-01T00:00:00.000Z",
      modifiedTime: "2026-01-02T00:00:00.000Z",
    },
  ];

  const syncResult = await syncGoogleFormTemplatesToTab({}, mockDeps, { masterSheetId, companyFolderId }, forms);
  assert(syncResult.ok === true, "38: tab sync ok");
  assert(syncResult.synced === 1, "39: one form synced");
  assert(tabStore.length === 1, "40: one tab row written");
  for (const column of COMPANY_GOOGLE_FORMS_SYNC_COLUMNS) {
    assert(Object.prototype.hasOwnProperty.call(tabStore[0], column), `41: column ${column} present`);
  }
  assert(tabStore[0].FormId === "form-sync", "42: FormId synced");
  assert(tabStore[0].CompanyFolderId === companyFolderId, "43: CompanyFolderId synced");

  const readBack = await readGoogleFormTemplatesFromTab({}, mockDeps, masterSheetId, companyFolderId);
  assert(readBack.ok === true, "44: readGoogleFormTemplatesFromTab ok");
  assert(readBack.records.length === 1, "45: read back one company row");
}

assert(GOOGLE_FORMS_MIME === "application/vnd.google-apps.form");
assert(isExactGoogleFormsFolderName("Google Forms"));
assert(buildGoogleFormsFolderQuery("folder-1").includes(GOOGLE_FORMS_MIME));

await testExactGoogleFormsAtRoot();
await testFallbackUnderAudits();
await testFallbackFormsFolderDirect();
await testCreateGoogleFormsInsideCompanyFolder();
await testFolderLookupFailureNotEmptyListMessage();
await testWrongCompanyExcluded();
await testTabSyncFields();

console.log(`[verify:google-forms-service-foundation] ${caseCount} checks passed`);
