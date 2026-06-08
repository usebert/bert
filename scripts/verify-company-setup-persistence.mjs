#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  COMPANIES_WORKSPACE_COLUMNS,
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
  "Re-check workspace",
  "Repair / complete setup",
  "Unlink reason:",
]);

console.log("verify-company-setup-persistence: OK");
