#!/usr/bin/env node
/**
 * Static checks for Godmode company setup progress (9 explicit steps).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_SETUP_STEPS, GOOGLE_OPERATION_TIMEOUT_MS } from "../server/company-setup-progress.mjs";

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

/** 1: Nine explicit setup steps exported */
assert(COMPANY_SETUP_STEPS.length === 9, "1: exactly 9 setup steps");
assert(
  COMPANY_SETUP_STEPS[0].key === "resolve_registry" && COMPANY_SETUP_STEPS[8].key === "mark_live",
  "1b: first and last step keys",
);

/** 2: Progress response shape fields always returned */
assert(progress.includes("completedSteps"), "2: completedSteps in progress module");
assert(progress.includes("failedStep"), "2b: failedStep in progress module");
assert(progress.includes('errorCode'), "2c: errorCode in progress module");
assert(progress.includes("NEEDS_ATTENTION"), "2d: NEEDS_ATTENTION status");

/** 3: Google call timeout protection */
assert(progress.includes("withGoogleTimeout"), "3: withGoogleTimeout helper");
assert(GOOGLE_OPERATION_TIMEOUT_MS >= 30_000, "3b: sensible Google timeout");

/** 4: Run-setup API endpoint wired */
assert(progress.includes("/api/godmode/company-workspace/run-setup"), "4: run-setup route");
assert(serverMain.includes("installCompanySetupProgressRoutes"), "4b: server installs setup progress routes");

/** 5: Backend logs companyId + step name */
assert(progress.includes("[company-setup] step start"), "5: step start logging");
assert(progress.includes("companyId"), "5b: companyId in logs");

/** 6: Always return JSON on failure */
assert(progress.includes("buildFailureResponse"), "6: structured failure response");
assert(progress.includes("catch (error)"), "6b: catch returns JSON");

/** 7: Frontend service + request timeout */
assert(service.includes("companySetupProgressService"), "7: frontend setup service");
assert(service.includes("AbortController"), "7b: frontend request timeout");
assert(service.includes("COMPANY_SETUP_DID_NOT_FINISH_MESSAGE"), "7c: customer-safe failure copy");

/** 8: Godmode UI shows current step and error code */
assert(panel.includes("companySetupCurrentStep"), "8: panel shows current step prop");
assert(panel.includes("companySetupError"), "8b: panel shows setup error prop");
assert(panel.includes("errorCode"), "8c: panel shows error code");

/** 9: Setup aligns with repair (ISO folders + tab repair before health check) */
assert(progress.includes("ensureIsoReadinessFolders"), "9: setup ensures ISO readiness folders");
assert(progress.includes("mergeWorkspaceFolderConfig"), "9b: setup merges ISO + structure folder config");
assert(progress.includes("workspace_health_check_repair_tabs"), "9c: setup repairs tabs before final health check");

/** 10: LIVE promotion + shared drive does not block readiness */
assert(progress.includes("ensureCompanyLiveIfReady"), "10: mark_live calls ensureCompanyLiveIfReady");
const readinessBlock = registry.slice(
  registry.indexOf("export function evaluateCompanyWorkspaceReadiness"),
  registry.indexOf("export async function ensureCompanyLiveIfReady"),
);
assert(!readinessBlock.includes("sharedDrive"), "10b: shared drive verification does not block LIVE");
assert(readinessBlock.includes("explicitChecksPass"), "10c: stale Needs attention cleared when checks pass");

/** Frontend finally clears loading */
assert(appTsx.includes("setCompanyFolderStructureRepairing(false)"), "finally clears provisioning state");
assert(appTsx.includes("companySetupProgressService"), "App uses setup progress service");

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:company-setup-progress"], "npm script registered");

console.log("OK: verify-company-setup-progress (10 cases)");
