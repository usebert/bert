#!/usr/bin/env node
/**
 * Company folder = source of truth — resolver, context, invite readiness, Godmode UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanCompanyNameFromFolder,
  COMPANY_CONTEXT_STATUS_USABLE,
  COMPANY_READY_INVITE_MESSAGE,
  isCompanyWorkspaceUsable,
} from "../shared/company-folder-context.mjs";
import {
  canInviteUsersForCompanyFromData,
  INVITE_READINESS_SOURCE,
} from "../shared/company-invite-readiness.mjs";
import { resolveCompanySetupPhase, COMPANY_SETUP_PHASE } from "../shared/company-setup-state.mjs";

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

const resolver = read("server/company-folder-resolver.mjs");
const contextShared = read("shared/company-folder-context.mjs");
const contextService = read("server/company-context-service.mjs");
const inviteReadiness = read("shared/company-invite-readiness.mjs");
const inviteReadinessServer = read("server/company-invite-readiness.mjs");
const makeUsable = read("server/godmode-registry-actions.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const setupState = read("src/utils/companySetupState.ts");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));

// ─── CompanyFolderResolver ───────────────────────────────────────────────────

assert(resolver.includes("export async function resolveCompanyFromFolder"), "1: resolveCompanyFromFolder exported");
assert(resolver.includes("ensureCompanyMasterSheet"), "2: resolver finds/creates workbook");
assert(resolver.includes("ensureCompanyFolderStructure"), "3: resolver ensures folder structure");
assert(resolver.includes('status: COMPANY_CONTEXT_STATUS_USABLE'), "4: resolver returns USABLE status");
assert(resolver.includes("installCompanyFolderResolverRoutes"), "5: resolver routes installer");
assert(resolver.includes("/api/godmode/companies/:companyFolderId/resolve-from-folder"), "6: resolve-from-folder route");
assert(resolver.includes("queuePostResolveBackgroundJobs"), "7: post-resolve background jobs queued");
assert(resolver.includes("rebuildRegistryCache"), "8: registry cache rebuild is non-blocking");

// ─── Company context ─────────────────────────────────────────────────────────

assert(
  cleanCompanyNameFromFolder("Acme Precast - BERT Folder Structure") === "Acme Precast",
  "9: strips BERT Folder Structure suffix",
);
assert(
  isCompanyWorkspaceUsable({ companyId: "f1", companyFolderId: "f1", masterSheetId: "s1" }),
  "10: folder + workbook = usable",
);
assert(
  !isCompanyWorkspaceUsable({ companyId: "f1", masterSheetId: "" }),
  "11: missing workbook not usable",
);
assert(contextService.includes("resolveCompanyContextFromFolder"), "12: context service exposes folder resolver");
assert(contextService.includes("COMPANY_CONTEXT_STATUS_USABLE"), "13: context service sets USABLE status");

// ─── Invite readiness (no registry Live block) ─────────────────────────────

assert(
  canInviteUsersForCompanyFromData({
    context: { companyId: "f1", companyFolderId: "f1", masterSheetId: "s1", status: "USABLE" },
  }),
  "14: USABLE context allows invites without registry Live",
);
assert(
  canInviteUsersForCompanyFromData({
    context: { companyId: "f1", companyFolderId: "f1", masterSheetId: "s1", registryStatus: "Setup in progress" },
  }),
  "15: linked workspace allows invites when registry not Live",
);
assert(inviteReadiness.includes("INVITE_READINESS_SOURCE.COMPANY_FOLDER"), "16: folder source in invite readiness");
assert(inviteReadinessServer.includes("export async function canInviteUsersForCompany"), "17: server canInviteUsersForCompany");
assert(!inviteReadiness.includes("Finish company onboarding"), "18: no Finish company onboarding gate message");

// ─── Setup UI uses folder/workbook, not registry Live ────────────────────────

assert(panel.includes("companyUsable"), "19: godmode panel uses companyUsable");
assert(panel.includes("setupRunning && !companyUsable"), "20: provisioning derived from companyUsable");
assert(panel.includes(COMPANY_READY_INVITE_MESSAGE), "21: ready message in godmode panel");
assert(!panel.includes("Ready for health check"), "22: no Ready for health check in normal UI");
assert(!panel.includes("Registry link missing") || panel.includes("Advanced diagnostics"), "23: registry copy in diagnostics only");
assert(setupState.includes("companyUsable"), "24: setup state supports companyUsable");
assert(
  resolveCompanySetupPhase({ companyUsable: true, hasCompanyFolder: true, masterSheetId: "s1" }) ===
    COMPANY_SETUP_PHASE.LIVE,
  "25: companyUsable maps to LIVE phase",
);

// ─── make-usable delegates to folder resolver ────────────────────────────────

assert(makeUsable.includes("resolveCompanyFromFolder"), "26: makeCompanyUsable calls folder resolver");
assert(makeUsable.includes(COMPANY_READY_INVITE_MESSAGE), "27: make-usable returns ready invite message");
assert(makeUsable.includes("registry persist failed (non-blocking)"), "28: registry failure does not block usable");

// ─── Server wiring + npm script ──────────────────────────────────────────────

assert(serverMain.includes("installCompanyFolderResolverRoutes"), "29: server installs folder resolver routes");
assert(pkg.scripts["verify:company-folder-source-of-truth"], "30: npm script registered");

console.log(`OK: verify-company-folder-source-of-truth (${caseCount} cases)`);
