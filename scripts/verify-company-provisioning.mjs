#!/usr/bin/env node
/**
 * verify:company-provisioning — Automated Create company workflow.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SETUP_REQUIRED_TABS } from "../server/ensure-required-tabs.mjs";
import {
  DOCUMENT_MODULE_REQUIRED_TABS,
  buildIso9001FolderTemplate,
  countTemplateFolders,
} from "../shared/document-schema.mjs";
import { deriveUsernameFromEmail } from "../shared/login-username.mjs";
import {
  COMPANY_PROVISION_STAGES,
  COMPANY_TYPES,
  STANDARD_BERT_OPERATIONAL_FOLDERS,
  assertProvisionTabsCoverRequirements,
  getCompanyProvisionOperation,
  provisionCompanyWorkspace,
  validateCompanyProvisionInput,
} from "../server/company-provisioning-service.mjs";
import { buildCompanyWorkbookName } from "../server/company-folder-structure.mjs";
import { hashPassword } from "../server/user-auth-service.mjs";

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

function createMockHarness() {
  const foldersByParent = new Map();
  const workbookTabs = new Map();
  let folderSeq = 1;
  let sheetSeq = 1;

  const key = (sheetId, tab) => `${sheetId}:${tab}`;
  const ensureTab = (sheetId, tab, headers = []) => {
    const k = key(sheetId, tab);
    if (!workbookTabs.has(k)) {
      workbookTabs.set(k, { headers: [...headers], rows: [] });
    }
    const entry = workbookTabs.get(k);
    for (const header of headers) {
      if (!entry.headers.includes(header)) {
        entry.headers.push(header);
      }
    }
    return entry;
  };

  const listChildren = (parentId) => foldersByParent.get(parentId) || [];
  foldersByParent.set("live-companies", []);

  const driveApi = {
    files: {
      list: async ({ q }) => {
        const parentMatch = String(q || "").match(/'([^']+)' in parents/);
        const nameMatch = String(q || "").match(/name = '([^']+)'/);
        const parentId = parentMatch?.[1];
        const name = nameMatch?.[1]?.replace(/\\'/g, "'");
        const children = listChildren(parentId).filter((entry) => !name || entry.name === name);
        return { data: { files: children.map(({ id, name: n }) => ({ id, name: n })) } };
      },
      create: async ({ requestBody }) => {
        const id =
          requestBody.mimeType === "application/vnd.google-apps.spreadsheet"
            ? `sheet-${sheetSeq++}`
            : `folder-${folderSeq++}`;
        const parentId = requestBody.parents?.[0] || "root";
        const entry = { id, name: requestBody.name, mimeType: requestBody.mimeType, parents: [parentId] };
        if (requestBody.mimeType === "application/vnd.google-apps.folder") {
          const list = foldersByParent.get(parentId) || [];
          list.push(entry);
          foldersByParent.set(parentId, list);
          foldersByParent.set(id, foldersByParent.get(id) || []);
        }
        return { data: { id, name: requestBody.name } };
      },
    },
  };

  const google = {
    drive: () => driveApi,
    sheets: () => ({
      spreadsheets: {
        get: async ({ spreadsheetId }) => {
          const titles = [...workbookTabs.keys()]
            .filter((k) => k.startsWith(`${spreadsheetId}:`))
            .map((k) => k.slice(spreadsheetId.length + 1));
          const unique = titles.length ? titles : ["Sheet1"];
          return {
            data: {
              sheets: unique.map((title, index) => ({
                properties: { sheetId: index + 1, title },
              })),
            },
          };
        },
        batchUpdate: async ({ spreadsheetId, requestBody }) => {
          for (const request of requestBody.requests || []) {
            const title = request.addSheet?.properties?.title;
            if (title) {
              ensureTab(spreadsheetId, title, []);
            }
          }
          return { data: {} };
        },
      },
    }),
  };

  const deps = {
    google,
    resolveLiveCompaniesFolder: async () => ({
      liveCompaniesFolder: { id: "live-companies", name: "Live Companies" },
    }),
    getCompanyUsersDeps: () => ({
      google,
      withSheetsQuotaRetry: async (fn) => fn(),
      safeLower: (v) => String(v || "").toLowerCase(),
    }),
    getCompanyWorkspaceRegistryDeps: () => ({}),
    authIndex: { upsert: async () => ({ ok: true }) },
    ensureTabExists: async () => ({ ok: true }),
    ensureColumns: async () => ({ ok: true }),
    getWorkbook: async (_auth, spreadsheetId) => google.sheets().spreadsheets.get({ spreadsheetId }),
    getTabValues: async () => [],
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (v) => String(v || "").toLowerCase(),
    getConfig: async () => ({}),
    updateConfig: async () => ({ ok: true }),
    ensureTabsAndColumns: async () => ({ ok: true }),
    currentSchemaVersion: "3.0.0",
    ensureTabColumns: async (_auth, _deps, sheetId, tab, headers) => {
      ensureTab(sheetId, tab, headers);
      return { addedColumns: [], headers };
    },
    readTabRecords: async (_auth, _deps, sheetId, tab, options = {}) => {
      const entry = ensureTab(sheetId, tab, options.expectedHeaders || []);
      return {
        records: entry.rows.map((row) => {
          const record = {};
          entry.headers.forEach((header, index) => {
            record[header] = row[index] ?? "";
          });
          return record;
        }),
      };
    },
    appendTabRows: async (_auth, _deps, sheetId, tab, headers, rowObjects = []) => {
      const entry = ensureTab(sheetId, tab, headers);
      for (const rowObject of rowObjects) {
        entry.rows.push(headers.map((header) => String(rowObject[header] ?? "")));
      }
      return { ok: true, written: rowObjects.length };
    },
    writeTabRecords: async (_auth, _deps, sheetId, tab, headers, rowObjects = []) => {
      const entry = ensureTab(sheetId, tab, headers);
      entry.rows = rowObjects.map((rowObject) => headers.map((header) => String(rowObject[header] ?? "")));
      return { ok: true };
    },
  };

  return { auth: {}, deps, foldersByParent, driveApi };
}

async function main() {
  const serviceSrc = read("server/company-provisioning-service.mjs");
  const routesSrc = read("server/company-provisioning-routes.mjs");
  const serverSrc = read("server/server.mjs");
  const panelSrc = read("src/components/godmode/GodmodeCreateCompanyPanel.tsx");
  const adminSrc = read("src/screens/AdminScreen.tsx");
  const connectSrc = read("src/components/godmode/GodmodeConnectCompanyFolderPanel.tsx");
  const godmodeServiceSrc = read("src/services/godmodeService.ts");
  const pkg = JSON.parse(read("package.json"));

  assert(Boolean(pkg.scripts?.["verify:company-provisioning"]), "package.json has verify:company-provisioning");
  assert(serverSrc.includes("installCompanyProvisioningRoutes"), "server installs company provisioning routes");
  assert(routesSrc.includes("/api/godmode/companies/create"), "create company route exists");
  assert(routesSrc.includes("requireMasterOnlyActor"), "create company is Master-only");
  assert(serverSrc.includes("installCompanyFolderConnectRoutes"), "connect-folder recovery route still installed");
  assert(adminSrc.includes("GodmodeCreateCompanyPanel"), "AdminScreen uses Create company panel");
  assert(!adminSrc.includes("GodmodeConnectCompanyFolderPanel"), "AdminScreen primary path no longer uses connect panel");
  assert(panelSrc.includes("Create a complete BERT company workspace"), "Create company intro present");
  assert(panelSrc.includes("Show connect company folder (recovery)"), "connect-folder recovery remains hidden in UI");
  assert(panelSrc.includes("Confirm password"), "confirm password field present");
  assert(panelSrc.includes("showPassword"), "show/hide password control present");
  assert(panelSrc.includes("COMPANY_PROVISION_STAGES"), "progress stages used in UI");
  assert(panelSrc.includes('t("godmode.openCompany")'), "Open company success action present");
  assert(connectSrc.includes("companyFolderLink") || connectSrc.includes("Company folder"), "recovery connect panel still available");
  assert(!/console\.(info|log|warn|error)\([^)]*password/i.test(serviceSrc), "password is not logged in service");
  assert(serviceSrc.includes("hashPassword"), "password hashed with existing mechanism");
  assert(serviceSrc.includes("provisionDocumentFolders"), "ISO folders reuse Documents provisioning");
  assert(serviceSrc.includes("operationId"), "provisioning uses operationId");
  assert(serviceSrc.includes("adminSeeded"), "admin seed guarded against duplicates");
  assert(godmodeServiceSrc.includes("/api/godmode/companies/create"), "frontend createCompany client wired");
  assert(godmodeServiceSrc.includes("application/x-ndjson"), "frontend parses NDJSON progress stream");

  assert(COMPANY_PROVISION_STAGES.length === 8, "eight provisioning stages defined");
  assert(
    COMPANY_PROVISION_STAGES.map((s) => s.label).join("|") ===
      [
        "Creating company folder",
        "Creating workbook",
        "Preparing workbook tabs",
        "Creating first administrator",
        "Creating BERT folders",
        "Creating ISO 9001 document structure",
        "Registering company",
        "Finishing setup",
      ].join("|"),
    "stage labels match product copy",
  );
  assert(COMPANY_TYPES.includes("Construction") && COMPANY_TYPES.includes("Other"), "company types include required options");
  assert(STANDARD_BERT_OPERATIONAL_FOLDERS.includes("Audits"), "standard BERT folders include Audits");
  assert(
    STANDARD_BERT_OPERATIONAL_FOLDERS.includes("Controlled Documents") === false,
    "Controlled Documents comes from Documents module provisioner",
  );

  const missingTabs = assertProvisionTabsCoverRequirements();
  assert(missingTabs.includes("People"), "required tab set includes People when checking empty workbook");
  assert(SETUP_REQUIRED_TABS.includes("Users"), "Users tab is required");
  assert(DOCUMENT_MODULE_REQUIRED_TABS.includes("DocumentFolders"), "DocumentFolders tab required");
  assert(buildCompanyWorkbookName("Acme Ltd") === "Acme Ltd - BERT Workbook", "workbook naming convention");

  const iso = buildIso9001FolderTemplate();
  assert(iso.name === "Controlled Documents", "ISO root is Controlled Documents");
  const isoNames = [];
  const walk = (node) => {
    isoNames.push(node.name);
    for (const child of node.children || []) walk(child);
  };
  walk(iso);
  assert(isoNames.some((n) => n.includes("00 QMS Manual")), "ISO includes 00 QMS Manual folder");
  assert(isoNames.some((n) => n.includes("Clause 4")), "ISO includes Clause 4 folder");
  assert(isoNames.some((n) => n.includes("Clause 10") || n.includes("Improvement")), "ISO includes Improvement / Clause 10");
  assert(isoNames.some((n) => /Blank Forms/i.test(n)), "ISO includes Blank Forms and Templates");
  assert(isoNames.some((n) => /Completed Records/i.test(n)), "ISO includes Completed Records");
  assert(isoNames.some((n) => /External Documents/i.test(n)), "ISO includes External Documents");
  assert(isoNames.some((n) => /Archive/i.test(n)), "ISO includes Archive");
  assert(countTemplateFolders(iso) > 10, "ISO template has substantial folder count");

  const bad = validateCompanyProvisionInput({});
  assert(!bad.ok && bad.errors.length >= 4, "validation rejects empty input");
  const mismatch = validateCompanyProvisionInput({
    companyName: "Acme",
    firstAdminName: "Ada",
    firstAdminEmail: "ada@acme.test",
    firstAdminUsername: "ada",
    adminPassword: "password123",
    confirmPassword: "different",
  });
  assert(!mismatch.ok && mismatch.errors.some((e) => /match/i.test(e)), "password confirm must match");
  assert(deriveUsernameFromEmail("bert.demo+joe.jones@usebert.co.uk") === "joe.jones", "username defaults from email prefix");
  const okInput = validateCompanyProvisionInput({
    companyName: "Acme Test Co",
    companyType: "Manufacturing",
    firstAdminName: "Ada Admin",
    firstAdminEmail: "ada@acme.test",
    firstAdminUsername: "ada.admin",
    adminPassword: "password123",
    confirmPassword: "password123",
  });
  assert(okInput.ok, "valid create-company input accepted");
  assert(Boolean(okInput.value.password), "validated value keeps password server-side only");
  const hashed = hashPassword("password123");
  assert(hashed && hashed !== "password123", "password hashing produces non-plaintext");

  const harness = createMockHarness();
  const flakyDeps = {
    ...harness.deps,
    _sheetOk: false,
    google: {
      drive: () => ({
        files: {
          list: harness.driveApi.files.list,
          create: async (args) => {
            if (args.requestBody?.mimeType === "application/vnd.google-apps.spreadsheet" && !flakyDeps._sheetOk) {
              const err = new Error("Forced workbook failure");
              err.stage = "creating_workbook";
              throw err;
            }
            return harness.driveApi.files.create(args);
          },
        },
      }),
      sheets: harness.deps.google.sheets,
    },
  };

  const stagesSeen = [];
  const input = {
    companyName: "Verify Co",
    firstAdminName: "Vera Admin",
    firstAdminEmail: "vera@verify.test",
    firstAdminUsername: "vera",
    adminPassword: "password123",
    confirmPassword: "password123",
  };

  const first = await provisionCompanyWorkspace(harness.auth, flakyDeps, input, async (event) => {
    if (event.type === "stage") {
      stagesSeen.push(`${event.stage}:${event.status}`);
    }
  });
  assert(!first.ok, "first provision fails at workbook stage when Drive sheet create fails");
  assert(first.failedStage === "creating_workbook" || /workbook/i.test(first.error || ""), "failed stage reported");
  assert(Boolean(first.operationId), "operationId returned on failure");
  assert(Boolean(first.companyFolderId), "company folder id retained after partial failure");
  assert((first.completedStages || []).includes("creating_company_folder"), "folder stage completed before failure");
  assert(stagesSeen.some((entry) => entry.startsWith("creating_company_folder:")), "progress emits company folder stage");

  const op = getCompanyProvisionOperation(first.operationId);
  assert(op?.companyFolderId === first.companyFolderId, "operation state stores company folder id");
  assert(
    (harness.foldersByParent.get("live-companies") || []).some((f) => f.name === "Verify Co"),
    "company folder created under Live Companies",
  );

  flakyDeps._sheetOk = true;
  const beforeFolderCount = (harness.foldersByParent.get("live-companies") || []).length;
  const second = await provisionCompanyWorkspace(
    harness.auth,
    flakyDeps,
    { ...input, operationId: first.operationId },
    async () => {},
  );
  const afterFolderCount = (harness.foldersByParent.get("live-companies") || []).length;
  assert(afterFolderCount === beforeFolderCount, "retry does not create duplicate company folders");
  assert(second.operationId === first.operationId, "retry reuses same operationId");
  assert(
    (getCompanyProvisionOperation(first.operationId)?.completedStages || []).includes("creating_company_folder"),
    "completed stages preserved on retry",
  );

  assert(panelSrc.includes("Retry from last successful stage"), "retry CTA present on failure UI");
  assert(panelSrc.includes("operationId"), "frontend sends/resumes operationId");
  assert(routesSrc.includes("only non-secret"), "password logging avoided in routes");
  assert(routesSrc.includes("requireGoogleWorkspaceSession"), "Google workspace session required");
  assert(serviceSrc.includes("rebuildAuthIndexFromUsersTab"), "auth index rebuilt for admin login");
  assert(serviceSrc.includes('Status: "ACTIVE"'), "admin seeded as ACTIVE");
  assert(serviceSrc.includes('Role: "Admin"'), "admin seeded as Admin");
  assert(adminSrc.includes("onBackToCompanies"), "back to companies wired");
  assert(adminSrc.includes("onCompanyFolderConnected"), "success opens company via callback");

  console.log(`\nverify:company-provisioning passed (${caseCount} checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
