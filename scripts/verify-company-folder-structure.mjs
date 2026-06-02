#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  COMPANY_FOLDER_TREE,
  COMPANY_FOLDERS_COLUMNS,
  COMPANY_FOLDERS_TAB,
  buildLegacyFolderConfigFromStructure,
  resolveEvidenceUploadFolderId,
} from "../server/company-folder-structure.mjs";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertContains(filePath, snippets) {
  const fullPath = path.join(root, filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`Missing "${snippet}" in ${filePath}`);
    }
  }
}

function countNodes(nodes) {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children || []), 0);
}

const nodeCount = countNodes(COMPANY_FOLDER_TREE);
assert(nodeCount >= 60, `Expected at least 60 folder nodes, got ${nodeCount}`);
assert(COMPANY_FOLDERS_TAB === "CompanyFolders");
assert(COMPANY_FOLDERS_COLUMNS.includes("Folder Key"));

const sampleIds = {
  ADMIN_COMPANY_SETUP: "setup-1",
  FORMS_LIVE: "forms-1",
  EVIDENCE_PHOTOS: "photos-1",
  EVIDENCE_OFFLINE_UPLOADS: "offline-1",
  BERT_COMPANY_WORKBOOK: "wb-1",
};
const legacy = buildLegacyFolderConfigFromStructure(sampleIds);
assert(legacy.setupFolderId === "setup-1");
assert(legacy.evidenceFolderId === "photos-1");
assert(legacy.auditFormsFolderId === "forms-1");

assert(resolveEvidenceUploadFolderId(sampleIds, "", { kind: "offline" }) === "offline-1");
assert(resolveEvidenceUploadFolderId(sampleIds, "legacy", { kind: "photo" }) === "photos-1");
assert(resolveEvidenceUploadFolderId({}, "legacy-only", { kind: "photo" }) === "legacy-only");

assertContains("server/server.mjs", [
  "ensureCompanyFolderStructure",
  "installCompanyFolderStructureRoutes",
  "COMPANY_FOLDERS_TAB",
  "resolveCompanyEvidenceFolderIdForUpload",
]);

assertContains("server/company-folder-structure.mjs", [
  "00 - Admin",
  "01 - BERT System Files",
  "03 - Evidence",
  "FORMS_GOOGLE_COPIES",
  "AUDITS_GOOGLE_FORMS",
  "COMPANY_GOOGLE_FORM_STORAGE_PATH",
  "auditsGoogleFormsFolderId",
  "ensureCompanyFolderStructure",
  "ensureCompanyMasterSheet",
  "buildCompanyMasterSheetName",
  "masterSheetStatus",
  "/api/company-folder/",
]);

assertContains("src/services/companyFolderStructureService.ts", [
  "repairCompanyFolderStructure",
  "ensure-structure",
  "masterSheetLink",
  "ensureMasterSheet",
]);

assertContains("src/screens/AdminScreen.tsx", [
  "Repair company folder structure",
  "Create company master sheet",
  "Company master sheet created:",
]);

assertContains("package.json", ["verify:company-folder-structure"]);

console.log(`[verify:company-folder-structure] ${nodeCount} folder nodes and wiring OK`);
