#!/usr/bin/env node
/**
 * Company setup next-action contract — no dead-end "Ready for health check" UX.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPANY_SETUP_DISPLAY_STATUS,
  COMPANY_SETUP_PHASE,
  resolveCompanySetupDisplayStatus,
  resolveCompanySetupPhase,
  resolveCompanySetupPrimaryAction,
  shouldAutoQueueHealthCheck,
} from "../shared/company-setup-state.mjs";

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

const statusTs = read("src/utils/companyWorkspaceStatus.ts");
const setupStateTs = read("src/utils/companySetupState.ts");
const setupStateShared = read("shared/company-setup-state.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const registry = read("server/company-workspace-registry.mjs");
const backgroundJobs = read("server/background-jobs-service.mjs");
const registryService = read("src/services/companyWorkspaceRegistryService.ts");
const pkg = JSON.parse(read("package.json"));

// ─── dead-end copy removed ───────────────────────────────────────────────────

assert(!statusTs.includes("Ready for health check"), "1: no Ready for health check in status module");
assert(!panel.includes("Ready for health check"), "2: godmode panel never shows Ready for health check");
assert(!setupStateTs.includes("health check"), "3: setup state module hides health-check jargon");
assert(!setupStateShared.includes("health check"), "4: shared setup state hides health-check jargon");

// ─── plain display statuses ──────────────────────────────────────────────────

assert(setupStateTs.includes('"Not set up"'), "5: Not set up status");
assert(setupStateTs.includes('"Working in the background"'), "6: Working in the background status");
assert(setupStateTs.includes('"Ready"'), "7: Ready status");
assert(setupStateTs.includes('"Needs attention"'), "8: Needs attention status");
assert(!setupStateTs.includes('"Usable"'), "9: Usable label removed from setup state");

// ─── phase → display mapping ─────────────────────────────────────────────────

assert(
  resolveCompanySetupDisplayStatus(COMPANY_SETUP_PHASE.SETUP_REQUIRED) ===
    COMPANY_SETUP_DISPLAY_STATUS.NOT_SET_UP,
  "10: SETUP_REQUIRED → Not set up",
);
assert(
  resolveCompanySetupDisplayStatus(COMPANY_SETUP_PHASE.SETUP_RUNNING) ===
    COMPANY_SETUP_DISPLAY_STATUS.WORKING_IN_BACKGROUND,
  "11: SETUP_RUNNING → Working in the background",
);
assert(
  resolveCompanySetupDisplayStatus(COMPANY_SETUP_PHASE.LIVE) === COMPANY_SETUP_DISPLAY_STATUS.READY,
  "12: LIVE → Ready",
);
assert(
  resolveCompanySetupDisplayStatus(COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE) ===
    COMPANY_SETUP_DISPLAY_STATUS.NEEDS_ATTENTION,
  "13: HEALTH_CHECK_FAILED_LIVE → Needs attention",
);

// ─── next actions ────────────────────────────────────────────────────────────

assert(
  resolveCompanySetupPrimaryAction(COMPANY_SETUP_PHASE.SETUP_REQUIRED).label === "Make company usable",
  "14: SETUP_REQUIRED primary is Make company usable",
);
assert(
  resolveCompanySetupPrimaryAction(COMPANY_SETUP_PHASE.LIVE).label === "Invite users",
  "15: LIVE primary is Invite users",
);
assert(
  resolveCompanySetupPrimaryAction(COMPANY_SETUP_PHASE.HEALTH_CHECK_READY).action === "none",
  "16: HEALTH_CHECK_READY has no blocking primary action",
);
assert(
  resolveCompanySetupPrimaryAction(COMPANY_SETUP_PHASE.SETUP_FAILED).label === "Could not finish setup",
  "17: SETUP_FAILED shows could not finish setup",
);

// ─── HEALTH_CHECK_READY auto-queue ───────────────────────────────────────────

assert(shouldAutoQueueHealthCheck(COMPANY_SETUP_PHASE.HEALTH_CHECK_READY), "18: HEALTH_CHECK_READY auto-queues");
assert(!shouldAutoQueueHealthCheck(COMPANY_SETUP_PHASE.LIVE), "19: LIVE does not auto-queue health check");

const healthReadyPhase = resolveCompanySetupPhase({
  hasCompanyFolder: true,
  masterSheetId: "sheet-1",
  syncState: "Synced",
  healthCheckRun: false,
  companyLive: false,
});
assert(healthReadyPhase === COMPANY_SETUP_PHASE.HEALTH_CHECK_READY, "20: synced without health check → HEALTH_CHECK_READY");

assert(backgroundJobs.includes("queueCompanyHealthCheckIfReady"), "21: background jobs expose health auto-queue");
assert(registry.includes("maybeQueueBackgroundHealthCheck"), "22: registry routes auto-queue on load");
assert(registry.includes("/api/godmode/companies/:companyId/ensure-background-health"), "23: ensure-background-health route");
assert(registryService.includes("ensureBackgroundHealth"), "24: frontend can request background health queue");

// ─── godmode card wiring ─────────────────────────────────────────────────────

assert(panel.includes("resolveCompanySetupPrimaryAction"), "25: panel uses primary action resolver");
assert(panel.includes("resolveCompanySetupDisplayStatus"), "26: panel uses display status resolver");
assert(panel.includes("ensureBackgroundHealth"), "27: panel auto-queues HEALTH_CHECK_READY");
assert(panel.includes("Advanced diagnostics"), "28: secondary action is Advanced diagnostics");
assert(panel.includes("Invite users"), "29: Invite users primary when ready");
assert(panel.includes("godmode-user-management"), "30: invite users scroll target");

assert(pkg.scripts["verify:setup-next-actions"], "31: npm script registered");

console.log(`[verify:setup-next-actions] OK — ${caseCount} cases passed`);
