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
const registryService = read("src/services/companyWorkspaceRegistryService.ts");
const registry = read("server/company-workspace-registry.mjs");
const registryActions = read("server/godmode-registry-actions.mjs");
const inviteHelpers = read("src/utils/companyWorkspaceInvite.ts");
const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");

/** 1: Nine explicit setup steps exported */
assert(COMPANY_SETUP_STEPS.length === 9, "1: exactly 9 setup steps");
assert(
  COMPANY_SETUP_STEPS[0].key === "resolve_registry" && COMPANY_SETUP_STEPS[8].key === "verify_workbook_read_write",
  "1b: first and last step keys",
);
assert(COMPANY_SETUP_STEPS[7].key === "mark_live", "1c: step 8 marks LIVE before verify");
assert(COMPANY_SETUP_STEPS[8].key === "verify_workbook_read_write", "1d: step 9 verifies workbook read/write (warning-only)");

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
assert(progress.includes("verifyWorkbookReadWrite"), "9c: setup uses lightweight workbook verify");

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
assert(panel.includes("relinkRegistry"), "17e: godmode panel calls relink-registry service");
assert(panel.includes("forceLiveIfReady"), "17f: godmode panel calls force-live-if-ready service");
assert(panel.includes("Create / relink company registry record"), "17g: godmode panel relink button");
assert(panel.includes("Force mark LIVE from ready checks"), "17h: godmode panel force live button");
assert(registryActions.includes("/api/godmode/companies/:workspaceId/relink-registry"), "17i: relink-registry route");
assert(registryActions.includes("/api/godmode/companies/:companyId/force-live-if-ready"), "17j: force-live route");
assert(!registryActions.includes("getDriveFile"), "17k: relink no Drive folder calls");
assert(!registryActions.includes("ensureCompanyFolderStructure"), "17l: relink no folder structure calls");
assert(!registryActions.includes("verifyWorkbookReadWrite"), "17m: force live no workbook verify");
assert(registryActions.includes("ensureCompanyRegistryRecordForWorkspace"), "17n: relink uses ensure registry helper");
assert(registryActions.includes("persistCompanyWorkspaceSetup"), "17o: force live persists registry only");
assert(registryActions.includes("findCompanyWorkspaceRegistryRecordInMap"), "17p: relink finds existing row before create");
assert(serverMain.includes("installGodmodeRegistryActionRoutes"), "17q: server installs godmode registry actions");
assert(registryService.includes("relinkRegistry"), "17r: frontend relinkRegistry service");
assert(registryService.includes("forceLiveIfReady"), "17s: frontend forceLiveIfReady service");
assert(registryService.includes("REGISTRY_ACTION_TIMEOUT_MS = 30_000"), "17t: registry action 30s timeout");
assert(!panel.includes("Not In Registry"), "17u: godmode panel avoids dead-end Not In Registry copy");
assert(registry.includes('normalized === "not_in_registry"'), "17v: not_in_registry humanized for API");

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

/** 27–33: Lightweight verify_workbook_read_write + canonical LIVE UI (7 cases) */
const verifyWorkbookModule = read("server/verify-workbook-read-write.mjs");
assert(verifyWorkbookModule.includes("export async function verifyWorkbookReadWrite"), "27: verifyWorkbookReadWrite exported");
assert(progress.includes('from "./verify-workbook-read-write.mjs"'), "28: setup progress imports verify workbook module");
assert(verifyWorkbookModule.includes("includeGridData: false"), "29: verify uses metadata-only spreadsheets.get");
assert(verifyWorkbookModule.includes("write_sync_log_ping"), "30: verify names SyncLog ping write operation");
assert(progress.includes("setupWritesSucceeded"), "31: repair tracks setupWritesSucceeded flag");
assert(progress.includes("Workbook read/write verification timed out after setup writes succeeded"), "32: non-blocking verify timeout warning");
const statusModule = read("src/utils/companyWorkspaceStatus.ts");
assert(statusModule.includes("registryStatus"), "33: workspace status resolves from registryStatus");
assert(panel.includes("companyRegistryStatus"), "33b: godmode panel receives canonical registry status");
assert(panel.includes("visibleSetupError"), "33c: godmode panel hides stale errors when Live");

/** 34–38: Early LIVE promotion before slow Google verify (5 cases) */
assert(progress.includes("buildSetupChecksFromCompletedSteps"), "34: builds checks from completed fast steps");
assert(progress.includes("isPersistedHealthReady"), "35: reads persisted health readiness from registry");
assert(progress.includes("executeMarkLiveStep"), "36: mark_live runs before verify");
assert(progress.includes("runVerifyWorkbookWarningOnly"), "37: verify runs warning-only after mark_live");
const markLiveRunIndex = progress.indexOf('stepFailure = await runStep("mark_live"');
const verifyRunIndex = progress.indexOf("await runVerifyWorkbookWarningOnly");
assert(
  markLiveRunIndex > 0 && verifyRunIndex > markLiveRunIndex,
  "38: mark_live precedes warning-only verify in flow",
);
assert(progress.includes("reload_registry_after_writes"), "38b: reloads registry before early LIVE evaluation");
assert(panel.includes("Google verification is slow"), "38c: panel shows slow-verify warning when Live");

/** 39–43: LIVE clears stale Godmode setup running state */
assert(appTsx.includes("clearCompanySetupRunningState"), "39: App clears setup running state helper");
assert(
  appTsx.includes("isCompanyRegistryLive({ status: canonicalStatus, registryStatus: canonicalStatus })"),
  "39b: App clears running state when registry is LIVE",
);
assert(panel.includes("setupRunning && !companyLive"), "40: panel derives provisioning from setupRunning && !companyLive");
assert(
  statusModule.indexOf("isCompanyRegistryLive") < statusModule.indexOf("input.isProvisioning"),
  "41: workspace status resolves LIVE before provisioning flag",
);
assert(panel.includes("finally"), "42: godmode panel registry actions use finally");
assert(appTsx.includes("onClearSetupError={clearCompanySetupRunningState}"), "43: clear setup error clears running state");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-setup-progress"], "npm script registered");

console.log("OK: verify-company-setup-progress (57 cases)");
