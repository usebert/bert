#!/usr/bin/env node
/**
 * P0 foundation hardening — canonical routes, folder-first context, retired sheet-by-id writes, invite gates.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCompanyScheduleContext } from "../server/schedule-service.mjs";

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

const pkg = JSON.parse(read("package.json"));
const googleFormsService = read("server/google-forms-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const scheduleService = read("server/schedule-service.mjs");
const completionService = read("server/completion-service.mjs");
const serverMain = read("server/server.mjs");

assert(pkg.scripts["verify:foundation-p0-hardening"], "1: npm script registered");

assert(coreRoutes.includes("/api/companies/:companyId/google-forms"), "2: canonical GET google-forms route");
assert(coreRoutes.includes("/api/companies/:companyId/google-forms/sync"), "3: canonical POST google-forms sync route");
assert(coreRoutes.includes("handleCompanyGoogleFormsGet"), "4: core routes delegate to shared google-forms handler");
assert(coreRoutes.includes("handleCompanyGoogleFormsSyncPost"), "5: core routes delegate sync to shared handler");
assert(googleFormsService.includes("export async function handleCompanyGoogleFormsGet"), "6: shared GET handler exported");
assert(googleFormsService.includes("export async function handleCompanyGoogleFormsSyncPost"), "7: shared sync handler exported");
assert(
  googleFormsService.includes("return handleCompanyGoogleFormsGet(req, res, deps,"),
  "8: legacy /api/company route delegates to canonical handler",
);
assert(
  !googleFormsService.match(/app\.get\("\/api\/company[\s\S]*listCompanyGoogleForms\(/),
  "9: legacy google-forms route has no separate list logic",
);

assert(scheduleService.includes("resolveCompanyFromFolder"), "10: schedule context imports folder resolver");
assert(
  !scheduleService.includes("if (companyFolderId && masterSheetId)"),
  "11: schedule context does not trust client masterSheetId early-return",
);
assert(
  !scheduleService.includes("input.masterSheetId"),
  "12: schedule context does not read client masterSheetId as truth",
);
assert(completionService.includes("resolveCompanyScheduleContext"), "13: completion uses schedule context resolver");

assert(serverMain.includes("respondLegacySheetByIdWriteRetired"), "14: legacy sheet write helper present");
assert(serverMain.includes('LEGACY_SHEET_WRITE_RETIRED'), "15: legacy sheet write JSON code present");
for (const tab of ["Schedules", "Users", "AuditResults"]) {
  assert(
    serverMain.includes(`respondLegacySheetByIdWriteRetired(res, "${tab}")`),
    `16: sheet-by-id ${tab} write retired with JSON`,
  );
}
assert(
  serverMain.includes('app.post("/api/google-sheet-by-id/:sheetId/schedules"') &&
    serverMain.includes("respondLegacySheetByIdWriteRetired(res, \"Schedules\")"),
  "17: schedules sheet-by-id POST retired via JSON helper",
);

assert(
  !serverMain.match(/async function processCompanyUserInvite[\s\S]*assertCompanyWorkspaceAcceptsUserInvite/),
  "18: invite create does not call registry/live gate",
);
assert(
  !serverMain.match(/async function processCompanyUserInvite[\s\S]*isArchiveOrNonLiveWorkspaceName/),
  "19: invite create does not block on archive/non-live name",
);
assert(serverMain.includes("resolvePreparedCompanyUserInviteContext"), "20: invite create uses folder-first resolve");

const folderResolvedSheet = "resolved-workbook-from-folder";
const clientWrongSheet = "client-wrong-sheet-id";
const folderId = "folder-company-a";

const mockAuth = {
  credentials: { access_token: "verify-token" },
  getAccessToken: async () => ({ token: "verify-token" }),
};

const context = await resolveCompanyScheduleContext(
  mockAuth,
  {
    resolveCompanyFromFolder: async () => ({
      ok: true,
      companyFolderId: folderId,
      companyId: folderId,
      masterSheetId: folderResolvedSheet,
      companyName: "Acme",
    }),
  },
  {
    companyId: folderId,
    companyFolderId: folderId,
    masterSheetId: clientWrongSheet,
  },
);
assert(context.ok === true, "21: schedule context resolves from folder");
assert(context.masterSheetId === folderResolvedSheet, "22: resolved workbook wins over client masterSheetId");
assert(context.masterSheetId !== clientWrongSheet, "23: client masterSheetId is not trusted");

console.log(`[verify:foundation-p0-hardening] ${caseCount} checks passed`);
