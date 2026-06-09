#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMPANY_REGISTRY_STATUS_LIVE,
  isCompanyRegistryLive,
} from "../shared/company-invite-permissions.mjs";
import {
  buildFallbackRegistryDiagnostic,
  FALLBACK_REGISTRY_BASENAME,
  FALLBACK_REGISTRY_WARNING,
  getFallbackRegistryRecord,
  persistFallbackCompanyLive,
  readFallbackRegistryMap,
  resolveCompanyRegistryFallbackPath,
} from "../server/company-registry-fallback.mjs";
import {
  COMPANIES_WORKSPACE_COLUMNS,
  findMissingRegistryColumns,
  findRegistryRowIndex,
  mergeFallbackRegistryIntoMap,
  mergeRegistryRowCells,
  mergeDriveCompanyWithRegistry,
  deriveCompanyWorkspaceStatus,
  diagnoseCompanyWorkspaceUnlink,
  rowObjectFromCompanyWorkspaceRecord,
} from "../server/company-workspace-registry.mjs";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function assertContains(filePath, snippets) {
  const fullPath = path.join(root, filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const snippet of snippets) {
    assert(content.includes(snippet), `Missing "${snippet}" in ${filePath}`);
  }
}

assert(COMPANIES_WORKSPACE_COLUMNS.includes("Company ID"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Master Sheet ID"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Root Folder ID"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Last Setup At"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Setup Completed At"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Unlink Reason"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Health Status"));
assert(COMPANIES_WORKSPACE_COLUMNS.includes("Updated At"));

const missing = findMissingRegistryColumns(["Company ID", "Company Name", "Status"]);
assert(missing.includes("Health Status"), "migration detects missing Health Status column");

const registryRows = [
  ["folder-a", "Acme", "sheet-a"],
  ["folder-b", "Other Co", "sheet-b"],
];
const registryHeaders = ["Company ID", "Company Name", "Master Sheet ID"];
assert(
  findRegistryRowIndex(registryHeaders, registryRows, { masterSheetId: "sheet-b" }) === 1,
  "upsert row match by masterSheetId",
);
assert(
  findRegistryRowIndex(registryHeaders, registryRows, { companyName: "acme" }) === 0,
  "upsert row match by normalized companyName",
);

const headerRow = ["Company ID", "Master Sheet ID", "Company Name"];
const existing = ["co-1", "sheet-old", "Acme"];
const merged = mergeRegistryRowCells(existing, headerRow, {
  "Company ID": "co-1",
  "Master Sheet ID": "",
  "Company Name": "Acme Ltd",
});
assert(merged[1] === "sheet-old", "merge must not erase master sheet id with blank");
assert(merged[2] === "Acme Ltd", "merge must fill updated company name");

const mergedDrive = mergeDriveCompanyWithRegistry(
  { id: "co-1", name: "Acme", responseSheetId: "", setupStatusLabel: "Setup in progress" },
  {
    companyId: "co-1",
    masterSheetId: "sheet-registry",
    status: "Live",
    rootFolderId: "co-1",
    companyName: "Acme",
    workbookFolderId: "",
    companyFoldersMappingStatus: "",
    firstAdminStatus: "",
    lastSetupAt: "",
    lastHealthCheckAt: "",
    setupCompletedAt: "",
    liveAt: "",
    unlinkReason: "",
  },
);
assert(mergedDrive.masterSheetId === "sheet-registry", "registry master sheet should override empty drive scan");
assert(mergedDrive.setupStatusLabel === "Ready", "live registry status maps to Ready label");

assert(
  deriveCompanyWorkspaceStatus({ rootFolderId: "co-1", masterSheetId: "sheet-1" }) === "Live",
  "linked ids should be Live",
);
assert(
  deriveCompanyWorkspaceStatus({ rootFolderId: "co-1", masterSheetId: "sheet-1", status: "Needs attention" }) ===
    "Needs attention",
  "explicit needs attention preserved",
);

assert(
  diagnoseCompanyWorkspaceUnlink({}, { companyFolderId: "" }) === "missing_root_folder_id",
  "diagnose missing root folder",
);
assert(
  diagnoseCompanyWorkspaceUnlink({}, { companyFolderId: "co-1", masterSheetId: "" }) === "missing_master_sheet_id",
  "diagnose missing master sheet",
);

const row = rowObjectFromCompanyWorkspaceRecord({
  companyId: "co-1",
  companyName: "Acme",
  rootFolderId: "co-1",
  masterSheetId: "sheet-1",
  status: "Live",
});
assert(row["Company ID"] === "co-1");
assert(row["Master Sheet ID"] === "sheet-1");

assertContains("server/server.mjs", [
  "installCompanyWorkspaceRegistryRoutes",
  "mergeDriveCompanyWithRegistry",
  "readCompanyWorkspaceRegistryMap",
  "recordCompanyWorkspaceHealthCheck",
  "persistCompanyWorkspaceSetup",
  "persistCompanyLive",
]);

assertContains("server/company-workspace-registry.mjs", [
  "export async function persistAndVerifyCompanyLive",
  "export async function persistCompanyLive",
  "REGISTRY_WRITE_FAILED",
  "REGISTRY_VERIFY_FAILED",
  "Failed health checks must never erase persisted workspace links",
  "wasLive",
]);

assertContains("server/company-onboarding.mjs", [
  "upsertCompanyWorkspaceRegistryRecords",
  "persistCompanyWorkspaceSetup",
]);

assertContains("App.tsx", [
  "companyWorkspaceRegistryService",
  "persistCompanyWorkspaceLinks",
  "applyRegistryMasterSheetToFolder",
]);

assertContains("src/utils/companyWorkspaceStatus.ts", ['"Needs attention"']);

assertContains("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx", [
  "Make company usable",
  "Technical diagnostics",
  "Unlink reason:",
  "Registry spreadsheet:",
  "Lookup keys",
  "Missing columns:",
  "Verify readback:",
]);
assertContains("server/godmode-registry-actions.mjs", [
  "makeCompanyUsable",
  "/api/godmode/companies/:workspaceId/make-usable",
  "persistAndVerifyCompanyLive",
]);

assertContains("server/company-setup-progress.mjs", [
  "persistAndVerifyCompanyLive",
  "REGISTRY_WRITE_FAILED",
  "REGISTRY_VERIFY_FAILED",
]);

const registryContent = fs.readFileSync(path.join(root, "server/company-workspace-registry.mjs"), "utf8");
assert(registryContent.includes("ensureCompanyRegistryRecordForWorkspace(auth, deps"), "persist verify ensures registry row");
assert(registryContent.includes("getCompanyWorkspaceRegistryRecord(auth, deps, registryCompanyId)"), "persist verify re-reads registry row");
assert(
  registryContent.includes("throw createRegistryPersistError") && registryContent.includes("REGISTRY_VERIFY_FAILED"),
  "persist verify throws on not LIVE",
);
assert(
  registryContent.includes("throw createRegistryPersistError") && registryContent.includes("REGISTRY_WRITE_FAILED"),
  "persist verify throws on write failure",
);
assert(registryContent.includes("status: COMPANY_REGISTRY_STATUS_LIVE"), "persist verify writes LIVE status");
assert(registryContent.includes("liveAt: now"), "persist verify writes liveAt");
assert(registryContent.includes("lastSetupAt: now"), "persist verify writes updatedAt");
assert(registryContent.includes("Persist company Live in registry"), "failed step label for registry persist");
assert(registryContent.includes("findRegistryRowIndex"), "multi-key registry row index");
assert(registryContent.includes("registryLocation"), "registry write returns registryLocation");
assert(registryContent.includes("missingColumns"), "registry write returns missingColumns");
assert(registryContent.includes("lookupKeys"), "registry write returns lookupKeys");
assert(registryContent.includes("sheets_write_failed"), "sheets API errors surfaced");

assertContains("server/company-registry-fallback.mjs", [
  "company-registry-fallback.json",
  "persistFallbackCompanyLive",
  "FALLBACK_REGISTRY_WARNING",
  "Using fallback registry because main Companies registry write failed",
]);

assertContains("server/company-workspace-registry.mjs", [
  "export async function getCanonicalCompanyRegistryRecord",
  "mergeFallbackRegistryIntoMap",
  "readCanonicalCompanyWorkspaceRegistryMap",
]);

assertContains("server/godmode-registry-actions.mjs", [
  "persistFallbackCompanyLive",
  "getCanonicalCompanyRegistryRecord",
  "FALLBACK_REGISTRY_WARNING",
  "buildFallbackRegistryDiagnostic",
]);

assertContains("server/server.mjs", [
  "readCanonicalCompanyWorkspaceRegistryMap",
  "getCanonicalCompanyRegistryRecord",
  "sessionDir",
]);

const fallbackTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bert-fallback-registry-"));
const fallbackWrite = persistFallbackCompanyLive(fallbackTempDir, {
  companyId: "co-fallback-1",
  companyFolderId: "folder-fallback-1",
  masterSheetId: "sheet-fallback-1",
  companyName: "Fallback Co",
});
assert(fallbackWrite.synced, "fallback persist writes LIVE record");
assert(
  resolveCompanyRegistryFallbackPath(fallbackTempDir).endsWith(FALLBACK_REGISTRY_BASENAME),
  "fallback file uses canonical basename under session dir",
);
const fallbackRecord = getFallbackRegistryRecord(fallbackTempDir, "co-fallback-1");
assert(fallbackRecord?.companyId === "co-fallback-1", "fallback read by companyId");
assert(fallbackRecord?.masterSheetId === "sheet-fallback-1", "fallback stores masterSheetId");
assert(isCompanyRegistryLive(fallbackRecord), "fallback record is LIVE for invites");
assert(
  buildFallbackRegistryDiagnostic("sheets_write_failed").includes("sheets_write_failed"),
  "fallback diagnostic includes original error",
);
assert(FALLBACK_REGISTRY_WARNING.includes("fallback registry"), "fallback warning message");

const mergedMap = mergeFallbackRegistryIntoMap(new Map(), fallbackTempDir);
assert(mergedMap.get("co-fallback-1")?.registrySource === "fallback", "merged map includes fallback LIVE");
assert(readFallbackRegistryMap(fallbackTempDir).size === 1, "fallback map has one company");

const mainLiveMap = new Map([
  [
    "co-main-1",
    {
      companyId: "co-main-1",
      status: COMPANY_REGISTRY_STATUS_LIVE,
      rootFolderId: "co-main-1",
      masterSheetId: "sheet-main-1",
      companyName: "Main Co",
    },
  ],
]);
const mergedWithMain = mergeFallbackRegistryIntoMap(mainLiveMap, fallbackTempDir);
assert(mergedWithMain.size === 2, "merge keeps main and fallback companies");
assert(mergedWithMain.get("co-main-1")?.registrySource === "main", "main LIVE record keeps main source");

try {
  fs.rmSync(fallbackTempDir, { recursive: true, force: true });
} catch {
  /* best-effort cleanup */
}

console.log("verify-company-setup-persistence: OK");
