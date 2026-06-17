#!/usr/bin/env node
/** Company Google Forms folder — Drive resolve/list + Phase 8 canonical /api/companies routes. */
import fs from "node:fs";
import path from "node:path";
import {
  buildGoogleFormsFolderQuery,
  COMPANY_GOOGLE_FORMS_SYNC_COLUMNS,
  GOOGLE_FORMS_MIME,
  installCompanyFormsRoutes,
  isCompanyFormsPermissionError,
  isExactGoogleFormsFolderName,
  listCompanyGoogleForms,
  listCompanyGoogleFormsFromDrive,
  listGoogleFormsInFolderTree,
  resolveCompanyGoogleFormsFolder,
} from "../server/company-forms-service.mjs";

const root = process.cwd();
const DOVECOTE_COMPANY_FOLDER_ID = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
const DOVECOTE_MASTER_SHEET_ID = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function readFile(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function assertContains(filePath, snippets) {
  const content = readFile(filePath);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`Missing "${snippet}" in ${filePath}`);
    }
  }
}

function assertNotContains(filePath, snippets) {
  const content = readFile(filePath);
  for (const snippet of snippets) {
    if (content.includes(snippet)) {
      throw new Error(`Unexpected "${snippet}" in ${filePath}`);
    }
  }
}

assert(GOOGLE_FORMS_MIME === "application/vnd.google-apps.form");
assert(isExactGoogleFormsFolderName("Google Forms"));
assert(!isExactGoogleFormsFolderName("08 - Audits"));
assert(buildGoogleFormsFolderQuery("abc123").includes("abc123"));
assert(buildGoogleFormsFolderQuery("abc123").includes(GOOGLE_FORMS_MIME));
assert(COMPANY_GOOGLE_FORMS_SYNC_COLUMNS.includes("FormId"));
assert(COMPANY_GOOGLE_FORMS_SYNC_COLUMNS.includes("GoogleFormsFolderId"));
assert(COMPANY_GOOGLE_FORMS_SYNC_COLUMNS.includes("LastSyncedAt"));
assert(typeof resolveCompanyGoogleFormsFolder === "function");
assert(typeof listCompanyGoogleFormsFromDrive === "function");
assert(typeof listCompanyGoogleForms === "function");
assert(typeof listGoogleFormsInFolderTree === "function");
assert(typeof installCompanyFormsRoutes === "function");

assert(isCompanyFormsPermissionError({ code: 403 }));
assert(isCompanyFormsPermissionError({ response: { status: 403 } }));
assert(!isCompanyFormsPermissionError({ code: 500, message: "timeout" }));

/** Mock Drive — exact Google Forms at company root */
function createMockDrive(scenario) {
  const folders = new Map(Object.entries(scenario.folders || {}));
  const files = new Map(Object.entries(scenario.files || {}));

  function childrenOf(parentId) {
    return [...files.values()].filter((file) => (file.parents || []).includes(parentId) && !file.trashed);
  }

  return {
    files: {
      get: async ({ fileId }) => {
        const folder = folders.get(fileId);
        if (!folder) {
          const err = new Error("Not Found");
          err.code = 404;
          throw err;
        }
        return { data: folder };
      },
      list: async ({ q }) => {
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
      create: async ({ requestBody }) => {
        const id = `created-${Object.keys(Object.fromEntries(folders)).length + 1}`;
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
        owners: [{ emailAddress: "admin@example.com" }],
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
  assert(resolved.googleFormsFolderId === formsFolderId, "exact Google Forms folder resolved");
  assert(resolved.resolvedVia === "exact_google_forms", "prefers exact Google Forms");

  const listed = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyId, companyId });
  assert(listed.ok === true, "listCompanyGoogleForms ok");
  assert(listed.formsFound === 1, "lists one form");
  assert(listed.forms[0].driveFileId === "form-1", "returns drive file id");
  assert(listed.forms.every((form) => form.driveFileId && form.name), "returns form metadata only");
}

async function testNestedUnderAudits() {
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
        webViewLink: "https://docs.google.com/forms/d/form-nested/edit",
      },
    },
  });

  const resolved = await resolveCompanyGoogleFormsFolder(drive, { companyFolderId: companyId });
  assert(resolved.googleFormsFolderId === formsFolderId, "nested Google Forms folder resolved");
  const listed = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyId });
  assert(listed.formsFound === 1, "nested folder lists forms");
}

async function testCreateIfMissing() {
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
  assert(resolved.created === true, "creates Google Forms folder when missing");
  assert(resolved.googleFormsFolderId.startsWith("created-"), "returns created folder id");
}

async function testPermissionError() {
  const drive = {
    files: {
      get: async () => {
        const err = new Error("Insufficient permissions");
        err.code = 403;
        throw err;
      },
    },
  };
  const listed = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: "denied" });
  assert(listed.ok === false, "permission failure is not ok");
  assert(listed.status === "permission_denied", "structured permission error");
  assert(listed.formsFound === 0, "no false empty list on permission failure");
}

async function testOtherCompanyIsolation() {
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
  assert(listedB.status === "folder_lookup_failed", "other company folder does not see A forms");
  const listedA = await listCompanyGoogleFormsFromDrive(drive, { companyFolderId: companyA });
  assert(listedA.formsFound === 1, "company A sees its own forms");
}

assertContains("server/server.mjs", [
  "installCompanyFormsRoutes",
  "listCompanyGoogleForms",
  "company-forms-service.mjs",
  "googleFormsDiagnostics",
  "supportsAllDrives: true",
]);

assertContains("server/google-forms-service.mjs", [
  "includeItemsFromAllDrives: true",
  "supportsAllDrives: true",
  "resolveCompanyGoogleFormsFolder",
  "listCompanyGoogleForms",
  "syncGoogleFormTemplatesToTab",
  "GOOGLE_FORM_TEMPLATES_TAB",
  "readTabRecords",
  "writeTabRecords",
  "handleCompanyGoogleFormsGet",
  "handleCompanyGoogleFormsSyncPost",
]);

assertContains("server/core-workflow-routes.mjs", [
  'app.get("/api/companies/:companyId/google-forms"',
  'app.post("/api/companies/:companyId/google-forms/sync"',
  "handleCompanyGoogleFormsGet",
  "handleCompanyGoogleFormsSyncPost",
]);

assertContains("server/company-forms-service.mjs", [
  "resolveCompanyGoogleFormsFolder",
  "listCompanyGoogleForms",
  "COMPANY_GOOGLE_FORMS_SYNC_COLUMNS",
]);

/** Phase 8 client — canonical list/sync APIs, session company id on path only. */
assertContains("src/services/companyFormsService.ts", [
  "fetchCompanyGoogleForms",
  "syncCompanyGoogleForms",
  "/api/companies/",
  "/google-forms/sync",
  'method: "POST"',
  "folder_lookup_failed",
  "payload.googleFormsFolder?.id",
  "COMPANY_GOOGLE_FORMS_PERMISSION_MESSAGE",
  "COMPANY_GOOGLE_FORMS_FOLDER_NOT_FOUND_MESSAGE",
]);
assertNotContains("src/services/companyFormsService.ts", [
  'params.set("masterSheetId"',
  "/api/company/",
]);

assertContains("src/components/forms/FormsChecksTemplatesPanel.tsx", [
  "No Google Forms found in this company folder.",
  "Google Forms folder could not be found.",
  "BERT cannot access the Google Forms folder.",
  "companyFolderId:",
  "googleFormsFolderId:",
  "driveQuery:",
  "formsFound:",
]);

assertContains("App.tsx", [
  "fetchCompanyGoogleForms",
  "syncCompanyGoogleForms",
  "displayCompanyGoogleForms",
  "resolveCompanyMembersLoadContext",
  "activeCompanyContext",
  "companyGoogleFormsState",
]);
assert(
  /useEffect\([\s\S]{0,8000}resolveCompanyMembersLoadContext[\s\S]{0,8000}fetchCompanyGoogleForms/.test(
    readFile("App.tsx"),
  ),
  "App loads Google Forms via session company context + fetchCompanyGoogleForms",
);
assertNotContains("App.tsx", ['localStorage.getItem(storageKeys.companyName)']);
assertContains("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx", ["Google Forms diagnostics"]);
assertContains("package.json", ["verify:company-google-forms-folder", "verify:foundation-p0-hardening"]);

assert(DOVECOTE_COMPANY_FOLDER_ID.length > 10, "Dovecote companyFolderId fixture present");
assert(DOVECOTE_MASTER_SHEET_ID.length > 10, "Dovecote masterSheetId fixture present");

await testExactGoogleFormsAtRoot();
await testNestedUnderAudits();
await testCreateIfMissing();
await testPermissionError();
await testOtherCompanyIsolation();

console.log("[verify:company-google-forms-folder] folder resolve, MIME filter, sync wiring OK");
