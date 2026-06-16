#!/usr/bin/env node
/**
 * Company folder = source of truth — resolver, context, invite readiness, Godmode UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isFolderUnderLiveCompanies,
  isLiveCompaniesFolderName,
} from "../shared/company-folder-placement.mjs";
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
const workbookService = read("server/workbook-service.mjs");
const companyService = read("server/company-service.mjs");
const placement = read("server/company-folder-placement.mjs");
const placementShared = read("shared/company-folder-placement.mjs");
const contextShared = read("shared/company-folder-context.mjs");
const contextService = read("server/company-context-service.mjs");
const inviteReadiness = read("shared/company-invite-readiness.mjs");
const inviteReadinessServer = read("server/company-invite-readiness.mjs");
const makeUsable = read("server/godmode-registry-actions.mjs");
const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
const setupState = read("src/utils/companySetupState.ts");
const serverMain = read("server/server.mjs");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));

// ─── CompanyFolderResolver ───────────────────────────────────────────────────

assert(resolver.includes("export async function resolveCompanyFromFolder"), "1: resolveCompanyFromFolder exported");
assert(resolver.includes("ensureCompanyMasterSheet"), "2: resolver finds/creates workbook");
assert(resolver.includes("ensureCompanyFolderStructure"), "3: resolver ensures folder structure");
assert(resolver.includes("COMPANY_CONTEXT_STATUS_USABLE"), "4: resolver returns USABLE status when folder placement ok");
assert(resolver.includes("installCompanyFolderResolverRoutes"), "5: resolver routes installer");
assert(resolver.includes("/api/godmode/companies/:companyFolderId/resolve-from-folder"), "6: resolve-from-folder route");
assert(!resolver.includes("rebuildRegistryCache"), "7: resolver does not rebuild registry cache");
assert(!resolver.includes("queueCompanyHealthCheckIfReady"), "7b: resolver does not queue health checks");
assert(resolver.includes("ensureRequiredTabs"), "7c: resolver ensures required tabs via workbookService");
assert(workbookService.includes("readTabRecords"), "7d: workbookService canonical tab reads");
assert(companyService.includes("workbook-service.mjs"), "7e: companyService re-exports workbookService tabs");
assert(resolver.includes("cleanCompanyNameFromFolder(trim(folderMeta.name))"), "7f: companyName from Drive folder only");
assert(resolver.includes("validateCompanyFolderUnderCompaniesRoot"), "8b: resolver validates Live Companies placement");
assert(resolver.includes("folderPlacementOk"), "8b2: resolver surfaces folder placement without blocking workbook resolve");
assert(
  /folderPlacementOk[\s\S]*?ok:\s*true/.test(resolver),
  "8b3: resolver returns ok when workbook found even if placement fails",
);
assert(
  placement.includes("export async function validateCompanyFolderUnderCompaniesRoot"),
  "8c: placement validator exported",
);
assert(placement.includes("FOLDER_NOT_IN_COMPANIES_ROOT"), "8d: placement reason code present");
assert(placement.includes("/api/godmode/companies/:companyFolderId/folder-placement"), "8e: godmode placement diagnostic route");
assert(placementShared.includes("isLiveCompaniesFolderName"), "8f: shared Live Companies name matcher");

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
assert(contextService.includes("validateCompanyFolderUnderCompaniesRoot"), "13b: context service validates folder placement");
assert(contextShared.includes("folderPlacementOk"), "13c: usable context requires folder placement");
assert(
  !isCompanyWorkspaceUsable({ companyId: "f1", companyFolderId: "f1", masterSheetId: "s1", folderPlacementOk: false }),
  "13d: invalid folder placement blocks usable",
);

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
assert(
  panel.includes(COMPANY_READY_INVITE_MESSAGE) || panel.includes("COMPANY_READY_INVITE_MESSAGE"),
  "21: ready message in godmode panel",
);
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
assert(
  makeUsable.includes(COMPANY_READY_INVITE_MESSAGE) || makeUsable.includes("COMPANY_READY_INVITE_MESSAGE"),
  "27: make-usable returns ready invite message",
);
assert(makeUsable.includes("registry persist failed (non-blocking)"), "28: registry failure does not block usable");

// ─── Server wiring + npm script ──────────────────────────────────────────────

assert(serverMain.includes("installCompanyFolderResolverRoutes"), "29: server installs folder resolver routes");
assert(serverMain.includes("installCompanyFolderPlacementRoutes"), "29b: server installs folder placement routes");
assert(
  read("server/auth-service.mjs").includes("validateLiveCompanyContext"),
  "29c: login validates company via live resolver",
);
assert(read("server/auth-service.mjs").includes("FOLDER_NOT_IN_COMPANIES_ROOT"), "29d: login denies with reason code");
assert(
  placementShared.includes("This company is not set up in BERT. Contact your administrator."),
  "29e: canonical deny message",
);
assert(read("server/master-auth.mjs").includes("rejectInvalidCompanyFolder"), "29f: godmode select rejects invalid folders");
assert(
  read("server/company-workspace-registry.mjs").includes("invalidateRegistryRecordOutsideCompaniesRoot"),
  "29g: registry invalidates rows outside Companies root",
);
assert(read("server/core-workflow-routes.mjs").includes("rejectCompanyApiIfFolderInvalid"), "29h: company APIs reject invalid folder");
assert(read("src/utils/companyFolderContext.ts").includes("folderPlacementOk"), "29h2: frontend blocks usable when folder placement invalid");
assert(appTsx.includes("companyLinkBlockedMessage"), "29h3: App blocks orphan company dashboard");
assert(panel.includes("Under Live Companies"), "29i: godmode diagnostics show folder placement");
assert(pkg.scripts["verify:company-folder-source-of-truth"], "30: npm script registered");

assert(isLiveCompaniesFolderName("01 Live Companies"), "31: matches numbered Live Companies folder");
assert(isLiveCompaniesFolderName("Companies"), "32: matches Companies alias");
assert(
  isFolderUnderLiveCompanies("company-a", "live-root", ["live-root", "shared-root"]),
  "33: detects folder under Live Companies",
);
assert(
  !isFolderUnderLiveCompanies("company-a", "live-root", ["shared-root"]),
  "34: rejects folder outside Live Companies",
);

console.log(`OK: verify-company-folder-source-of-truth (${caseCount} cases)`);
