#!/usr/bin/env node
/** Company members diagnostics — structured reasonCode + session fallback contract. */
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
const coreRoutes = read("server/core-workflow-routes.mjs");
const companyUserServiceTs = read("src/services/companyUserService.ts");
const panel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
const diagnosticsPanel = read("src/components/CompanyMembersDiagnosticsPanel.tsx");
const pkg = JSON.parse(read("package.json"));

const REASON_CODES = [
  "MISSING_COMPANY_CONTEXT",
  "MISSING_COMPANY_FOLDER_ID",
  "MISSING_MASTER_SHEET_ID",
  "WORKBOOK_NOT_FOUND",
  "USERS_TAB_MISSING",
  "USERS_TAB_READ_FAILED",
  "GOOGLE_AUTH_FAILED",
  "GOOGLE_PERMISSION_DENIED",
  "INVALID_COMPANY_ID",
];

/** 1: API failure envelope uses COMPANY_USERS_LOAD_FAILED + reasonCode. */
{
  assert(coreRoutes.includes('code: "COMPANY_USERS_LOAD_FAILED"'), "1: route returns COMPANY_USERS_LOAD_FAILED");
  assert(coreRoutes.includes("reasonCode: result.reasonCode"), "1b: route forwards reasonCode");
  assert(coreRoutes.includes("diagnostics: result.diagnostics"), "1c: route forwards diagnostics");
  assert(coreRoutes.includes("Could not load company users."), "1d: route user-facing message");
  assert(userService.includes('code: COMPANY_USERS_LOAD_FAILED'), "1e: service uses COMPANY_USERS_LOAD_FAILED");
  assert(userService.includes("reasonCode"), "1f: service sets reasonCode");
}

/** 2: All reason codes are implemented in the service. */
for (const code of REASON_CODES) {
  assert(userService.includes(`"${code}"`), `2: reasonCode ${code} implemented`);
}

/** 3: Diagnostics fields are built for failures and successes. */
{
  const fields = [
    "companyId",
    "companyFolderId",
    "companyName",
    "masterSheetId",
    "signedInEmail",
    "signedInRole",
    "dataSource",
    "failedStep",
    "durationMs",
    "upstreamStatus",
    "upstreamMessage",
  ];
  for (const field of fields) {
    assert(userService.includes(field), `3: diagnostics field ${field}`);
  }
}

/** 4: masterSheetId resolved from company folder when missing (registry is cache). */
{
  assert(userService.includes("resolveCompanyFromFolder"), "4: folder resolver used");
  assert(userService.includes("resolveMasterSheetFromFolder"), "4b: folder master sheet resolver");
  assert(userService.includes("companyId: companyFolderId"), "4c: companyId equals companyFolderId");
}

/** 5: No session fallback in active users list; cache reconciliation diagnostics instead. */
{
  assert(!userService.includes("buildSessionFallbackSuccess"), "5: session fallback removed from active list");
  assert(!userService.includes('dataSource: "session-fallback"'), "5b: no session-fallback dataSource");
  assert(userService.includes("cacheOnlyUsersRemoved"), "5c: cache reconciliation diagnostics");
  assert(userService.includes("totalSheetRows"), "5d: totalSheetRows diagnostics");
}

/** 6: Frontend surfaces friendly message for normal users; diagnostics for godmode/dev. */
{
  assert(companyUserServiceTs.includes("reasonCode"), "6: client parses reasonCode");
  assert(companyUserServiceTs.includes("buildLoadErrorDetail"), "6b: client builds technical detail");
  assert(companyUserServiceTs.includes("failedStep"), "6c: client detail includes failedStep");
  assert(panel.includes("activeMembersLoadErrorDetail"), "6d: panel receives error detail");
  assert(panel.includes("activeMembersLoadDiagnostics"), "6e: panel receives structured diagnostics");
  assert(panel.includes("CompanyMembersDiagnosticsPanel"), "6f: collapsible diagnostics panel");
  assert(diagnosticsPanel.includes("useState(false)"), "6g: diagnostics collapsed by default");
  assert(panel.includes("isDebugUiAllowed"), "6h: dev diagnostics gate");
  assert(panel.includes("COMPANY_MEMBERS_USER_MESSAGE"), "6i: normal user message constant");
  assert(panel.includes("canShowTechnicalUi(currentUser.role)"), "6j: godmode gates diagnostics");
}

/** 7: npm script registered. */
assert(pkg.scripts["verify:company-members-diagnostics"], "7: verify npm script registered");

console.log("[verify:company-members-diagnostics] OK: all diagnostics contract checks passed");
