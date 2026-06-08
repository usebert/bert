#!/usr/bin/env node
/**
 * Static checks for Godmode company repair setup (9 explicit steps).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_SETUP_STEPS, GOOGLE_OPERATION_TIMEOUT_MS } from "../server/company-setup-progress.mjs";
import {
  findCompanyWorkspaceRegistryRecordInMap,
  normalizeCompanyRegistryNameKey,
  normalizeCompanyWorkspaceRecord,
} from "../server/company-workspace-registry.mjs";
import {
  SETUP_REQUIRED_TABS,
  buildAddSheetBatchRequests,
  classifyGoogleSheetsAccessError,
  findMissingRequiredTabs,
  withOperationTimeout,
} from "../server/ensure-required-tabs.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const progress = read("server/company-setup-progress.mjs");
const serverMain = read("server/server.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const appTsx = read("App.tsx");
const service = read("src/services/companySetupProgressService.ts");
const registry = read("server/company-workspace-registry.mjs");
const inviteHelpers = read("src/utils/companyWorkspaceInvite.ts");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");

/** 1: Nine explicit setup steps exported */
assert(COMPANY_SETUP_STEPS.length === 9, "1: exactly 9 setup steps");
assert(
  COMPANY_SETUP_STEPS[0].key === "resolve_registry" && COMPANY_SETUP_STEPS[8].key === "mark_live",
  "1b: first and last step keys",
);
assert(COMPANY_SETUP_STEPS[7].key === "verify_workbook_read_write", "1c: step 8 verifies workbook read/write");

/** 2: Progress response shape fields always returned */
assert(progress.includes("companyId"), "2: companyId in progress module");
assert(progress.includes("completedSteps"), "2b: completedSteps in progress module");
assert(progress.includes("failedStep"), "2c: failedStep in progress module");
assert(progress.includes("technicalError"), "2d: technicalError in progress module");
assert(progress.includes("NEEDS_ATTENTION"), "2e: NEEDS_ATTENTION status");

/** 3: Google call timeout protection */
assert(progress.includes("withGoogleTimeout"), "3: withGoogleTimeout helper");
assert(GOOGLE_OPERATION_TIMEOUT_MS >= 30_000, "3b: sensible Google timeout");

/** 4: Canonical repair-setup API + run-setup delegates */
assert(progress.includes("/api/godmode/companies/:companyId/repair-setup"), "4: repair-setup route");
assert(progress.includes("/api/godmode/company-workspace/run-setup"), "4b: run-setup still registered");
assert(progress.includes("handleCompanyRepairSetupRequest"), "4c: shared repair handler");
assert(serverMain.includes("installCompanySetupProgressRoutes"), "4d: server installs setup progress routes");
assert(service.includes("/api/godmode/companies/"), "4e: frontend calls repair-setup");
assert(service.includes("repairSetup"), "4f: frontend repairSetup service");

/** 5: Backend logs companyId + step name */
assert(progress.includes("[company-setup] start step="), "5: step start logging");
assert(progress.includes("[company-setup] complete step="), "5b: step complete logging");
assert(progress.includes("[company-setup] failed step="), "5c: step failed logging");

/** 6: Always return JSON on failure with customer-safe message */
assert(progress.includes("buildFailureResponse"), "6: structured failure response");
assert(progress.includes("CUSTOMER_SETUP_FAILURE_MESSAGE"), "6b: customer-safe failure copy");
assert(progress.includes("catch (error)"), "6c: catch returns JSON");

/** 7: Frontend service + request timeout + finally clears loading */
assert(service.includes("companySetupProgressService"), "7: frontend setup service");
assert(service.includes("AbortController"), "7b: frontend request timeout");
assert(service.includes("COMPANY_SETUP_DID_NOT_FINISH_MESSAGE"), "7c: customer-safe failure copy");
assert(appTsx.includes("setCompanyFolderStructureRepairing(false)"), "7d: finally clears provisioning state");

/** 8: Godmode UI shows current step, error, and technicalError */
assert(panel.includes("companySetupCurrentStep"), "8: panel shows current step prop");
assert(panel.includes("companySetupError"), "8b: panel shows setup error prop");
assert(panel.includes("technicalError"), "8c: panel shows technicalError");
assert(panel.includes("Repair / complete setup"), "8d: repair button label");

/** 9: Setup aligns with repair (ISO folders + tab repair before health check) */
assert(progress.includes("ensureIsoReadinessFolders"), "9: setup ensures ISO readiness folders");
assert(progress.includes("mergeWorkspaceFolderConfig"), "9b: setup merges ISO + structure folder config");
assert(progress.includes("verify_workbook_read_write_repair_tabs"), "9c: setup repairs tabs before final validation");

/** 10: LIVE promotion + shared drive does not block readiness */
assert(progress.includes("ensureCompanyLiveIfReady"), "10: mark_live calls ensureCompanyLiveIfReady");
assert(progress.includes("shared drive warning"), "10b: shared drive logged as warning only");
const readinessBlock = registry.slice(
  registry.indexOf("export function evaluateCompanyWorkspaceReadiness"),
  registry.indexOf("export async function ensureCompanyLiveIfReady"),
);
assert(!readinessBlock.includes("sharedDrive"), "10c: shared drive verification does not block LIVE");
assert(readinessBlock.includes("explicitChecksPass"), "10d: stale Needs attention cleared when checks pass");
assert(registry.includes("findCompanyWorkspaceRegistryRecord"), "10e: registry lookup by folder id");
assert(registry.includes("clearUnlinkReason"), "10f: Live promotion clears unlink reason");
assert(progress.includes("allRequiredSetupChecksPass"), "10g: force LIVE persist when checks pass");
assert(progress.includes("mark_live_force_persist"), "10h: mark_live force persist fallback");
assert(inviteHelpers.includes("isCompanyUsersTabWritable"), "10i: Godmode Users tab invite gate");
assert(usersPanel.includes("isCompanyUsersTabWritable"), "10j: invite panel uses Users tab gate for Master");

assert(appTsx.includes("companySetupProgressService"), "App uses setup progress service");

/** 11–17: Registry backfill lookup (7 cases) */
function sampleRegistryMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    const record = normalizeCompanyWorkspaceRecord(entry);
    map.set(record.companyId, record);
  }
  return map;
}

const registryLookupMap = sampleRegistryMap([
  {
    "Company ID": "folder-a",
    "Root Folder ID": "folder-a",
    "Master Sheet ID": "sheet-a",
    "Company Name": "Acme Precast",
    Status: "Setup in progress",
  },
  {
    "Company ID": "legacy-id",
    "Root Folder ID": "folder-b",
    "Master Sheet ID": "sheet-b",
    "Company Name": "TESTCO",
    Status: "Live",
  },
]);

assert(
  findCompanyWorkspaceRegistryRecordInMap(registryLookupMap, { companyId: "folder-a" })?.matchedBy === "companyId",
  "11: registry lookup by companyId",
);
assert(
  findCompanyWorkspaceRegistryRecordInMap(registryLookupMap, { companyId: "folder-b" })?.matchedBy === "companyId",
  "12: registry lookup by root folder id when company id differs",
);
assert(
  findCompanyWorkspaceRegistryRecordInMap(registryLookupMap, { masterSheetId: "sheet-b" })?.matchedBy ===
    "masterSheetId",
  "13: registry lookup by masterSheetId",
);
assert(
  findCompanyWorkspaceRegistryRecordInMap(registryLookupMap, { companyName: "acme  precast" })?.matchedBy ===
    "companyName",
  "14: registry lookup by normalized companyName",
);
assert(
  !findCompanyWorkspaceRegistryRecordInMap(registryLookupMap, {
    companyName: "BLANK COMPANY - BERT Folder Structure",
    companyId: "blank-1",
  }),
  "15: system template company skipped from name lookup",
);
assert(
  normalizeCompanyRegistryNameKey("  Acme—Precast!! ") === "acme precast",
  "16: normalized company name key",
);
assert(registry.includes("ensureCompanyRegistryRecordForWorkspace"), "17a: ensure registry helper exported");
assert(progress.includes("ensureCompanyRegistryRecordForWorkspace"), "17b: repair-setup resolves registry first");
assert(registry.includes("ensureCompanyRegistryRecordForWorkspace(auth, deps, {"), "17c: mark live ensures registry");
assert(panel.includes("Company registry link missing"), "17d: godmode panel registry link missing copy");
assert(panel.includes("onOneClickGoogleOnboarding"), "17e: registry relink uses repair-setup handler");
assert(!panel.includes("Mark company LIVE if ready"), "17f: godmode panel avoids separate mark-live button");
assert(!panel.includes("markLiveIfReady"), "17g: godmode panel avoids mark-live-if-ready endpoint");
assert(!panel.includes("Not In Registry"), "17h: godmode panel avoids dead-end Not In Registry copy");
assert(registry.includes('normalized === "not_in_registry"'), "17f: not_in_registry humanized for API");

assert(panel.includes("registryLinkMissing"), "17i: godmode panel uses registryLinkMissing flag");
assert(serverMain.includes("registryLinkMissing: !registryRecord"), "17j: live companies expose registryLinkMissing");

/** 18–23: ensure_required_tabs optimization (6 cases) */
assert(progress.includes('from "./ensure-required-tabs.mjs"'), "18b: ensure-required-tabs module imported");
const ensureTabsStepBlock = progress.slice(
  progress.indexOf('runStep("ensure_required_tabs"'),
  progress.indexOf('runStep("ensure_companyfolders_mapping"'),
);
assert(ensureTabsStepBlock.includes("ensureRequiredTabs"), "18: setup step uses ensureRequiredTabs");
assert(!ensureTabsStepBlock.includes("ensureTabsAndColumns"), "18c: ensure_required_tabs avoids heavy ensureTabsAndColumns");
assert(progress.includes("get_spreadsheet_metadata") || read("server/ensure-required-tabs.mjs").includes("get_spreadsheet_metadata"), "18d: metadata operation name");

const ensureTabsModule = read("server/ensure-required-tabs.mjs");
assert(ensureTabsModule.includes("includeGridData: false"), "19: spreadsheets.get uses includeGridData false");
assert(ensureTabsModule.includes("batch_create_missing_tabs"), "19b: batch create operation name");
assert(ensureTabsModule.includes("MASTER_SHEET_ID_INVALID"), "19c: invalid id error code");
assert(ensureTabsModule.includes("GOOGLE_PERMISSION_DENIED"), "19d: permission denied error code");
assert(ensureTabsModule.includes("MASTER_SHEET_UNAVAILABLE"), "19e: unavailable error code");
assert(SETUP_REQUIRED_TABS.length === 16, "19f: sixteen setup required tabs");
assert(SETUP_REQUIRED_TABS.includes("GoogleFormTemplates"), "19g: GoogleFormTemplates in required tabs");

const allPresent = SETUP_REQUIRED_TABS;
const noMissing = findMissingRequiredTabs(allPresent);
assert(noMissing.length === 0, "20: existing required tabs -> no batchUpdate");

const missingMany = findMissingRequiredTabs(["Config"]);
assert(missingMany.length === SETUP_REQUIRED_TABS.length - 1, "21: missing tabs detected");
const batchRequests = buildAddSheetBatchRequests(missingMany);
assert(batchRequests.length === missingMany.length, "21b: one addSheet request per missing tab");
assert(batchRequests.every((req) => req.addSheet?.properties?.title), "21c: batchUpdate addSheet shape");

const rerunMissing = findMissingRequiredTabs([...SETUP_REQUIRED_TABS, "Extra"]);
assert(rerunMissing.length === 0, "22: duplicate rerun -> no duplicate tabs");

let timeoutMetaError = null;
try {
  await withOperationTimeout(new Promise(() => {}), "get_spreadsheet_metadata", 15);
} catch (error) {
  timeoutMetaError = error;
}
assert(timeoutMetaError?.code === "GOOGLE_TIMEOUT", "23: timeout on metadata get -> GOOGLE_TIMEOUT");
assert(String(timeoutMetaError?.message || "").includes("get_spreadsheet_metadata"), "23b: metadata timeout names operation");

let timeoutBatchError = null;
try {
  await withOperationTimeout(new Promise(() => {}), "batch_create_missing_tabs", 15);
} catch (error) {
  timeoutBatchError = error;
}
assert(timeoutBatchError?.code === "GOOGLE_TIMEOUT", "24: timeout on batchUpdate -> GOOGLE_TIMEOUT");
assert(String(timeoutBatchError?.message || "").includes("batch_create_missing_tabs"), "24b: batch timeout names operation");

const folderInvalid = classifyGoogleSheetsAccessError(null, "application/vnd.google-apps.folder");
assert(folderInvalid?.code === "MASTER_SHEET_ID_INVALID", "25: folder id -> MASTER_SHEET_ID_INVALID");

const unavailable = classifyGoogleSheetsAccessError({ code: 404, message: "Not Found" });
assert(unavailable?.code === "MASTER_SHEET_UNAVAILABLE", "26: invalid masterSheetId -> MASTER_SHEET_UNAVAILABLE");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-setup-progress"], "npm script registered");

console.log("OK: verify-company-setup-progress (27 cases)");
