#!/usr/bin/env node
/** Company members diagnostics — structured reasonCode + fail-closed workbook contract. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const userService = read("server/company-user-service.mjs");
const foundation = read("server/company-users-foundation.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const companyUserServiceTs = read("src/services/companyUserService.ts");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const diagnosticsPanel = read("src/components/CompanyMembersDiagnosticsPanel.tsx");
const pkg = JSON.parse(read("package.json"));

const REASON_CODES = [
  "COMPANY_CONTEXT_FAILED",
  "USERS_TAB_READ_FAILED",
  "USERS_TAB_SCHEMA_FAILED",
  "GOOGLE_AUTH_FAILED",
  "GOOGLE_PERMISSION_DENIED",
  "GOOGLE_SHEET_ACCESS_DENIED",
];

/** 1: API failure envelope uses COMPANY_USERS_LOAD_FAILED + reasonCode + failedStep. */
{
  assert(coreRoutes.includes('code: "COMPANY_USERS_LOAD_FAILED"'), "1: route returns COMPANY_USERS_LOAD_FAILED");
  assert(coreRoutes.includes("reasonCode: result.reasonCode"), "1b: route forwards reasonCode");
  assert(coreRoutes.includes("failedStep: result.failedStep"), "1b2: route forwards top-level failedStep");
  assert(coreRoutes.includes("diagnostics: result.diagnostics"), "1c: route forwards diagnostics");
  assert(coreRoutes.includes("Could not load company users."), "1d: route user-facing message");
  assert(read("server/company-users-foundation.mjs").includes('code: COMPANY_USERS_LOAD_FAILED'), "1e: foundation uses COMPANY_USERS_LOAD_FAILED");
  assert(foundation.includes("reasonCode"), "1f: foundation sets reasonCode");
  assert(foundation.includes("failedStep"), "1g: foundation sets failedStep");
}

/** 2: All reason codes are implemented in the service. */
for (const code of REASON_CODES) {
  assert(
    foundation.includes(`"${code}"`),
    `2: reasonCode ${code} implemented in foundation`,
  );
}

/** 3: Diagnostics fields are built for failures and successes. */
{
  const fields = [
    "companyId",
    "companyFolderId",
    "companyFolderUrl",
    "companyName",
    "masterSheetId",
    "signedInEmail",
    "signedInRole",
    "dataSource",
    "failedStep",
    "durationMs",
    "upstreamStatus",
    "upstreamMessage",
    "totalRowsRead",
    "profilesReturned",
    "activeOnlyCount",
    "activeRowsFound",
  ];
  for (const field of fields) {
    assert(userService.includes(field), `3: diagnostics field ${field}`);
  }
}

/** 4: masterSheetId resolved from company folder when missing (registry is cache). */
{
  assert(userService.includes("resolveCompanyFromFolder"), "4: folder resolver used");
  assert(userService.includes("resolveMasterSheetFromFolder"), "4b: folder master sheet resolver");
  assert(
    read("server/company-users-foundation.mjs").includes("collectMasterSheetCandidatesRecursive") ||
      read("server/company-folder-structure.mjs").includes("collectMasterSheetCandidatesRecursive"),
    "4b2a: folder discovery walks nested company folders",
  );
  assert(
    !read("server/company-users-foundation.mjs").includes("validateMasterSheetHint") &&
      !read("server/company-users-foundation.mjs").includes("readCachedMasterSheetId"),
    "4b2b: stale session/cache masterSheetId hints are not used",
  );
  assert(
    read("server/company-users-foundation.mjs").includes("buildShareCompanyFolderHint") ||
      read("shared/company-folder-links.mjs").includes("buildShareCompanyFolderHint"),
    "4b5: WORKBOOK_NOT_FOUND includes share-folder operator hint",
  );
  assert(
    read("server/company-folder-resolver.mjs").includes("/api/godmode/companies/:companyFolderId/master-sheet-discovery"),
    "4b6: godmode master-sheet-discovery diagnostic route",
  );
  assert(
    read("server/company-users-foundation.mjs").includes("preferFolderResolution"),
    "4b3: read path prefers folder-resolved masterSheetId",
  );
  assert(userService.includes("companyId: companyFolderId"), "4c: companyId equals companyFolderId");
  assert(foundation.includes("readCompanyNameFromDriveFolder"), "4d: companyName from Drive folder metadata");
  assert(coreRoutes.includes("actor?.companyFolderId"), "4e: users route uses session companyFolderId");
  assert(coreRoutes.includes("actor?.masterSheetId"), "4f: users route uses session masterSheetId");
}

/** 5: No session/cache fallback — fail closed from workbook only. */
{
  assert(!userService.includes("buildSessionFallbackSuccess"), "5: session fallback helper removed");
  assert(!userService.includes('dataSource: "session-fallback"'), "5b: no session-fallback dataSource");
  assert(foundation.includes("activeProfilesFromUsersTabRecords"), "5c: ACTIVE users filtered in foundation");
  assert(foundation.includes("COMPANY_CONTEXT_FAILED"), "5d: structured context failure codes");
  assert(foundation.includes("totalRowsRead"), "5e: totalRowsRead diagnostics");
}

/** 6: Frontend surfaces friendly message for normal users; diagnostics for godmode/dev. */
{
  assert(companyUserServiceTs.includes("reasonCode"), "6: client parses reasonCode");
  assert(companyUserServiceTs.includes("buildLoadErrorDetail"), "6b: client builds technical detail");
  assert(companyUserServiceTs.includes("failedStep: \"client_fetch\""), "6c3: client transport failures include failedStep");
  assert(companyUserServiceTs.includes("CLIENT_LOAD_TIMEOUT"), "6c4: client timeout reasonCode handled");
  assert(companyUserServiceTs.includes("COMPANY_MEMBERS_LOAD_TIMEOUT_MESSAGE"), "6c4b: timeout user message");
  assert(companyUserServiceTs.includes("totalRowsRead"), "6c2: client detail includes totalRowsRead");
  assert(panel.includes("activeMembersLoadErrorDetail"), "6d: panel receives error detail");
  assert(panel.includes("activeMembersLoadDiagnostics"), "6e: panel receives structured diagnostics");
  assert(panel.includes("activeMembersLoadFailedStep"), "6e2: panel receives failedStep");
  assert(panel.includes("CompanyMembersDiagnosticsPanel"), "6f: collapsible diagnostics panel");
  assert(diagnosticsPanel.includes("defaultOpen"), "6g2: diagnostics can open by default on error");
  assert(panel.includes("canShowCompanyMembersDiagnostics"), "6h: godmode diagnostics gate");
  assert(companyUserServiceTs.includes("COMPANY_MEMBERS_WORKBOOK_NOT_FOUND_MESSAGE"), "6i2: workbook-not-found user message");
  assert(panel.includes("activeMembersLoadError || COMPANY_MEMBERS_USER_MESSAGE"), "6i3: panel shows actionable load error to admins");
  assert(panel.includes("defaultOpen={Boolean(activeMembersLoadReasonCode"), "6j: diagnostics open when reason present");
}

/** 7: npm script registered. */
assert(pkg.scripts["verify:company-members-diagnostics"], "7: verify npm script registered");

console.log("[verify:company-members-diagnostics] OK: all diagnostics contract checks passed");
