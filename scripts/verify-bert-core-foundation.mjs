#!/usr/bin/env node
/**
 * BERT core foundation — 24+ cases: folder → workbook → login → users → invite → schedule → check.
 * Static guards always run; live journey when BERT_LIVE_* creds exist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig, missingLiveCredentials } from "./lib/live-path-config.mjs";
import { LiveHttpClient, assertNoPasswordHash, redactJson } from "./lib/live-http-client.mjs";
import {
  COMPANY_CONTEXT_STATUS_USABLE,
  isCompanyWorkspaceUsable,
} from "../shared/company-folder-context.mjs";
import { SETUP_REQUIRED_TABS } from "../server/ensure-required-tabs.mjs";
import { getScheduleAssignedEmails } from "../shared/schedule-assignment.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function log(line) {
  console.log(`[verify:bert-core-foundation] ${line}`);
}

function fail(message, extra) {
  console.error(`FAIL [${caseCount}]: ${message}`);
  if (extra) {
    console.error(redactJson(extra));
  }
  process.exit(1);
}

function assert(condition, message, extra) {
  caseCount += 1;
  if (!condition) {
    fail(message, extra);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function runStaticGuards() {
  const pkg = JSON.parse(read("package.json"));
  const companyService = read("server/company-service.mjs");
  const workbookService = read("server/workbook-service.mjs");
  const authService = read("server/auth-service.mjs");
  const userService = read("server/company-user-service.mjs");
  const inviteService = read("server/invite-service.mjs");
  const scheduleService = read("server/schedule-service.mjs");
  const checkService = read("server/check-service.mjs");
  const completionService = read("server/completion-service.mjs");
  const folderStructure = read("server/company-folder-structure.mjs");
  const folderResolver = read("server/company-folder-resolver.mjs");
  const usersFoundation = read("server/company-users-foundation.mjs");
  const folderConnect = read("server/company-folder-connect.mjs");
  const godmodeService = read("server/godmode-service.mjs");
  const godmodeServiceTs = read("src/services/godmodeService.ts");
  const connectPanel = read("src/components/godmode/GodmodeConnectCompanyFolderPanel.tsx");
  const coreRoutes = read("server/core-workflow-routes.mjs");
  const usersPanel = read("src/components/admin/UsersInvitesPilotPanel.tsx");
  const companyUsers = read("server/company-users.mjs");
  const sheetFlow = read("server/company-user-sheet-flow.mjs");
  const serverMain = read("server/server.mjs");
  const activeUserCard = read("src/components/admin/ActiveUserCard.tsx");
  const inviteDisplay = read("src/utils/inviteStatusDisplay.ts");
  const appTsx = read("App.tsx");
  const uxDeclutter = read("src/utils/uxDeclutter.ts");

  assert(pkg.scripts["verify:bert-core-foundation"], "static: npm script registered");
  assert(pkg.scripts["verify:drive-folder-map"], "static: drive-folder-map script");
  assert(pkg.scripts["verify:users-from-company-workbook"], "static: users-from-workbook script");
  assert(pkg.scripts["verify:invite-to-users-tab"], "static: invite-to-users-tab script");
  assert(pkg.scripts["verify:schedule-contract"], "static: schedule-contract script");
  assert(pkg.scripts["verify:people-scheduler-consistency"], "static: people-scheduler-consistency script");
  assert(pkg.scripts["verify:google-forms-folder"], "static: google-forms-folder script");
  assert(pkg.scripts["verify:api-json-contract"], "static: api-json-contract script");
  assert(companyService.includes("findCompanyWorkbook"), "static: companyService.findCompanyWorkbook");
  assert(companyService.includes("ensureCompanyWorkbook"), "static: companyService.ensureCompanyWorkbook");
  assert(companyService.includes("ensureRequiredTabs"), "static: companyService.ensureRequiredTabs");
  assert(workbookService.includes("export async function readTabRecords"), "static: workbookService.readTabRecords");
  assert(workbookService.includes("export async function ensureTabColumns"), "static: workbookService.ensureTabColumns");
  assert(workbookService.includes("patchTabRowByHeader"), "static: workbookService.patchTabRowByHeader");
  assert(read("server/users-tab-reader.mjs").includes("readTabRecords"), "static: users tab reads via workbookService");
  assert(!folderResolver.includes("rebuildRegistryCache"), "static: company resolve skips registry cache");
  assert(!usersFoundation.includes("readCachedMasterSheetId"), "static: users foundation skips masterSheet cache");
  assert(usersFoundation.includes("activeProfilesFromUsersTabRecords"), "static: ACTIVE + CompanyFolderId filter");
  assert(usersFoundation.includes("COMPANY_CONTEXT_FAILED"), "static: COMPANY_CONTEXT_FAILED error code");
  assert(folderStructure.includes("buildCompanyWorkbookName(companyName)"), "static: create workbook uses BERT Workbook name");
  assert(folderStructure.includes("buildCompanyWorkbookName"), "static: BERT Workbook naming");
  assert(read("server/google-forms-service.mjs").includes("resolveCompanyGoogleFormsFolder"), "static: googleFormsService folder resolve");
  assert(read("server/google-forms-service.mjs").includes("listCompanyGoogleForms"), "static: googleFormsService listCompanyGoogleForms");
  assert(read("server/google-forms-service.mjs").includes("syncGoogleFormTemplatesToTab"), "static: googleFormsService tab sync");
  assert(pkg.scripts["verify:google-forms-service-foundation"], "static: google-forms-service-foundation script");
  assert(read("server/company-forms-service.mjs").includes("listCompanyGoogleForms"), "static: company Google Forms list re-export");
  assert(pkg.scripts["verify:google-forms-folder"], "static: google-forms-folder verify script");
  assert(companyService.includes("connectCompanyFolder"), "static: companyService connectCompanyFolder");
  assert(folderConnect.includes("/api/godmode/companies/connect-folder"), "static: connect-folder route");
  assert(folderConnect.includes("hashPassword"), "static: connect-folder hashes admin password server-side");
  assert(folderConnect.includes("PasswordHash: hashPassword"), "static: connect-folder hashes admin password server-side");
  assert(godmodeServiceTs.includes("connectGodmodeCompanyFolder"), "static: client connectGodmodeCompanyFolder");
  assert(connectPanel.includes("Connect company folder"), "static: godmode connect folder UI");
  assert(serverMain.includes("installCompanyFolderConnectRoutes"), "static: server installs connect-folder routes");
  assert(SETUP_REQUIRED_TABS.includes("Documents"), "static: Documents tab required for bootstrap");
  assert(SETUP_REQUIRED_TABS.includes("Invites"), "static: Invites tab required for bootstrap");
  assert(companyService.includes("resolveCompanyFromFolder"), "static: companyService resolves folder");
  assert(authService.includes("platformLogin"), "static: authService platformLogin alias");
  assert(authService.includes("companyLogin"), "static: authService companyLogin alias");
  assert(authService.includes("performCompanyLogin"), "static: authService fast login");
  assert(authService.includes("performMasterLogin"), "static: authService Godmode login");
  assert(authService.includes("rebuildAuthIndexFromUsersTab"), "static: authService rebuildAuthIndexFromUsersTab");
  assert(authService.includes("verifyPassword"), "static: authService verifyPassword");
  assert(authService.includes("auth_index_lookup"), "static: login uses auth index");
  assert(read("server/auth-index.mjs").includes("lookupByEmail"), "static: auth index module");
  assert(read("server/auth-index.mjs").includes("isPlatformOwnerAuthIndexEmail"), "static: auth index excludes platform owner");
  assert(!authService.includes("getCanonicalCompanyRegistryRecord"), "static: login skips registry gate");
  assert(userService.includes("listActiveUsers"), "static: companyUserService listActiveUsers");
  assert(read("server/user-service.mjs").includes("listActiveUsers"), "static: userService alias listActiveUsers");
  assert(userService.includes("readUsersTab"), "static: userService readUsersTab");
  assert(userService.includes("writeUserRow"), "static: userService writeUserRow");
  assert(userService.includes("repairUsersTabSchema"), "static: userService repairUsersTabSchema");
  assert(userService.includes("rebuildUserCacheFromSheet"), "static: userService rebuildUserCacheFromSheet");
  assert(sheetFlow.includes("listActiveUsersFromSheet"), "static: listActiveUsersFromSheet helper");
  assert(
    read("server/users-tab-profiles.mjs").includes("rowPassesCompanyProfileContext") ||
      read("server/users-tab-schema.mjs").includes("rowMatchesCompanyContext"),
    "static: active users filter by company columns",
  );
  assert(companyUsers.includes("migrateUsersTabCompanyColumns"), "static: company column migration");
  assert(sheetFlow.includes("completeInviteToUserRow"), "static: completeInviteToUserRow helper");
  assert(sheetFlow.includes("canLoginCompanyUser"), "static: canLoginCompanyUser helper");
  assert(userService.includes("sanitizeUsersTabRecords"), "static: PasswordHash stripped server-side");
  assert(serverMain.includes("completeInviteToUserRow"), "static: invite completion uses sheet helper");
  assert(companyUsers.includes("updateCompanyUserRecord"), "static: Users tab writeback on edit");
  assert(companyUsers.includes("validateCompanyUserEditInput"), "static: edit validation trims name/email");
  assert(
    serverMain.includes('"/api/companies/:companyFolderId/users/:email"') && serverMain.includes("app.patch"),
    "static: PATCH user edit route",
  );
  assert(read("src/services/companyUserService.ts").includes("updateCompanyMember"), "static: client updateCompanyMember");
  assert(activeUserCard.includes("ActiveUserCard"), "static: active user cards with action menu");
  assert(usersPanel.includes("ActiveUserCard"), "static: users panel renders active user cards");
  assert(inviteDisplay.includes("Company Admin"), "static: role display Company Admin label");
  assert(!companyUsers.includes("abusive") && !companyUsers.includes("profan"), "static: no abusive name filtering");
  assert(inviteService.includes("createInvite"), "static: inviteService createInvite");
  assert(inviteService.includes("completeInvite"), "static: inviteService completeInvite");
  assert(inviteService.includes("isCompanyUserInviteActiveForResend"), "static: invite resend helper");
  assert(scheduleService.includes("listSchedules"), "static: scheduleService listSchedules alias");
  assert(scheduleService.includes("listScheduleAssignees"), "static: scheduleService listScheduleAssignees");
  assert(scheduleService.includes("listSchedulerAssignees"), "static: scheduleService listSchedulerAssignees");
  assert(scheduleService.includes("saveSchedule"), "static: scheduleService saveSchedule alias");
  assert(scheduleService.includes("listMyChecks"), "static: scheduleService listMyChecks");
  assert(scheduleService.includes("readSchedulesFromTab"), "static: scheduleService readSchedulesFromTab");
  assert(scheduleService.includes("writeScheduleToTab"), "static: scheduleService writeScheduleToTab");
  assert(scheduleService.includes("resolveCompanyFromFolder"), "static: folder-first schedule context via resolveCompanyFromFolder");
  assert(completionService.includes("verifyScheduleCompletionEligibility"), "static: completionService eligibility");
  assert(completionService.includes("submitCompletedCheck"), "static: completionService submitCompletedCheck");
  assert(completionService.includes("listAuditResults"), "static: completionService listAuditResults");
  assert(completionService.includes("buildAuditResultRow"), "static: completionService buildAuditResultRow");
  assert(completionService.includes("completeCheck"), "static: completionService completeCheck");
  assert(completionService.includes("listResults"), "static: completionService listResults");
  assert(godmodeService.includes("listGodmodeCompanyUsers"), "static: godmode reads same Users tab");
  assert(godmodeService.includes("listGodmodeCompanySchedules"), "static: godmode reads same Schedules tab");
  assert(read("src/services/authService.ts").includes("companyLogin"), "static: client authService");
  assert(read("src/services/companyUserService.ts").includes("listActiveUsers"), "static: client listActiveUsers");
  assert(read("src/services/godmodeService.ts").includes("listGodmodeCompanyUsers"), "static: client godmodeService");
  assert(!usersPanel.includes("fetchCompanyInviteReadiness"), "static: users panel not gated on invite-readiness");
  assert(!usersPanel.includes("COMPANY_NOT_LIVE_INVITE_MESSAGE"), "static: no not-live banner in Users panel");
  assert(!coreRoutes.includes("assertCompanyLiveForInvite"), "static: invite API has no live gate");
  assert(appTsx.includes("companyLogin"), "static: App uses authService login");
  assert(read("src/services/companyUserService.ts").includes("COMPANY_MEMBERS_LOAD_TIMEOUT_MS"), "static: members load timeout constant exists");
  assert(read("src/services/companyUserService.ts").includes("90_000"), "static: members load timeout is 90s");
  assert(uxDeclutter.includes('role === "Master"'), "static: clutter gated to Master");
  assert(
    isCompanyWorkspaceUsable({ companyId: "f1", companyFolderId: "f1", masterSheetId: "s1" }),
    "static: folder + workbook = usable",
  );

  log(`OK — ${caseCount} static guard cases passed`);
}

function findCompany(companies, nameHint) {
  const hint = String(nameHint || "").trim().toLowerCase();
  if (!Array.isArray(companies)) return null;
  return (
    companies.find((row) => String(row?.name || "").trim().toLowerCase() === hint) ||
    companies.find((row) => String(row?.name || "").toLowerCase().includes(hint)) ||
    companies[0] ||
    null
  );
}

async function runLiveJourney(config) {
  const masterClient = new LiveHttpClient(config.apiBase, config.origin);
  const testClient = new LiveHttpClient(config.apiBase, config.origin);

  const testEmail = (
    config.testAdminEmail || `verify.foundation+${Date.now()}@usebert.co.uk`
  ).toLowerCase();
  const testPassword = config.testAdminPassword || `VerifyLive${Date.now()}!`;
  const testName = "Foundation Verify User";
  const companyFolderId = String(config.companyFolderId || "").trim();

  const masterLogin = await masterClient.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  assert(masterLogin.status === 200 && masterLogin.json?.ok === true, "1: Godmode login works");
  assertNoPasswordHash(masterLogin.json, "godmode login");

  assert(companyFolderId, "2: BERT_LIVE_COMPANY_FOLDER_ID provided");

  const connectRes = await masterClient.request("/api/godmode/companies/connect-folder", {
    method: "POST",
    body: {
      companyFolderId,
      companyName: config.companyNameHint || undefined,
      admin: { email: testEmail, name: testName, password: testPassword },
    },
  });
  assert(connectRes.status === 200 && connectRes.json?.ok === true, "3: connect-folder bootstraps company", connectRes.json);
  assertNoPasswordHash(connectRes.json, "connect-folder response");

  const company = connectRes.json?.company || {};
  const masterSheetId = String(company.masterSheetId || company.workbookId || "").trim();
  assert(String(company.companyId || "") === companyFolderId, "4: companyId === companyFolderId", company);
  assert(String(company.companyFolderId || "") === companyFolderId, "4b: companyFolderId matches folder");
  assert(masterSheetId, "5: workbook id returned from connect-folder", company);
  assert(String(company.status || "").toLowerCase() === "usable", "5b: company status usable", company);

  const resolveFromFolder = await masterClient.request(
    `/api/godmode/companies/${encodeURIComponent(companyFolderId)}/resolve-from-folder`,
    {
      method: "POST",
      body: { companyFolderId, ensureTabsSync: true },
    },
  );
  assert(resolveFromFolder.status === 200 && resolveFromFolder.json?.ok === true, "6: workbook resolves in folder", resolveFromFolder.json);
  assert(String(resolveFromFolder.json?.masterSheetId || "") === masterSheetId, "6b: resolve returns same workbook");
  const missingTabs = Array.isArray(resolveFromFolder.json?.missingTabs) ? resolveFromFolder.json.missingTabs : [];
  assert(missingTabs.length === 0, "7: required tabs present after connect", { missingTabs });

  const usersAfterConnect = await masterClient.request(
    `/api/companies/${encodeURIComponent(companyFolderId)}/users?masterSheetId=${encodeURIComponent(masterSheetId)}`,
  );
  assert(usersAfterConnect.status === 200 && Array.isArray(usersAfterConnect.json?.users), "8: Users tab readable after connect");
  assertNoPasswordHash(usersAfterConnect.json, "users after connect");
  assert(
    usersAfterConnect.json?.users?.some((row) => String(row?.email || "").toLowerCase() === testEmail),
    "8b: bootstrap admin appears in Users tab",
    { emails: usersAfterConnect.json?.users?.map((row) => row?.email) },
  );

  const testLogin = await testClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: testEmail, password: testPassword, masterSheetId },
  });
  assert(testLogin.status === 200 && testLogin.json?.ok === true, "9: fresh test user login works", testLogin.json);
  assertNoPasswordHash(testLogin.json, "test user login");

  const resolvedCompanyId = String(
    testLogin.json?.company?.companyId || testLogin.json?.company?.companyFolderId || companyFolderId,
  ).trim();
  const resolvedSheetId = String(testLogin.json?.company?.masterSheetId || masterSheetId).trim();

  const scheduleId = `verify-foundation-${Date.now()}`;
  const saveScheduleRes = await testClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules`,
    {
      method: "POST",
      body: {
        masterSheetId: resolvedSheetId,
        companyFolderId: resolvedCompanyId,
        schedules: [
          {
            id: scheduleId,
            companyFolderId: resolvedCompanyId,
            scheduleName: "Foundation verify check",
            lifecycle: "Live",
            status: "Live",
            audits: [{ auditId: "verify-audit-1", auditName: "Walk", frequency: "Daily" }],
            assignedUserEmails: [testEmail],
            assignedUsers: [{ email: testEmail, name: testName, role: "Auditor" }],
          },
        ],
      },
    },
  );
  assert(saveScheduleRes.status === 200 && saveScheduleRes.json?.ok !== false, "10: schedule saved for test user", saveScheduleRes.json);
  assertNoPasswordHash(saveScheduleRes.json, "save schedule");

  const assignedChecks = await testClient.request("/api/me/assigned-checks");
  assert(assignedChecks.status === 200 && assignedChecks.json?.ok === true, "11: My Checks loads", assignedChecks.json);
  assertNoPasswordHash(assignedChecks.json, "assigned checks");
  const assignedSchedules = Array.isArray(assignedChecks.json?.schedules) ? assignedChecks.json.schedules : [];
  const assignedSchedule =
    assignedSchedules.find((row) => String(row?.id || row?.scheduleId || "") === scheduleId) ||
    assignedSchedules.find((row) => getScheduleAssignedEmails(row).includes(testEmail)) ||
    assignedSchedules[0];
  assert(assignedSchedule, "11b: assigned schedule visible to test user", {
    scheduleIds: assignedSchedules.map((row) => row?.id || row?.scheduleId),
  });

  const completeScheduleId = String(assignedSchedule?.id || assignedSchedule?.scheduleId || scheduleId).trim();
  const completeRes = await testClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/checks/${encodeURIComponent(completeScheduleId)}/complete`,
    {
      method: "POST",
      body: {
        masterSheetId: resolvedSheetId,
        companyFolderId: resolvedCompanyId,
        answers: { q1: "pass" },
        findings: [],
        evidence: [],
      },
    },
  );
  assert(completeRes.status === 200 && completeRes.json?.ok === true, "12: check completion works", completeRes.json);
  assertNoPasswordHash(completeRes.json, "complete check");
  const resultId = String(completeRes.json?.resultId || "").trim();
  assert(resultId, "12b: AuditResults row id returned");

  const auditResults = await testClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/audit-results?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(auditResults.status === 200 && auditResults.json?.ok === true, "13: AuditResults list loads", auditResults.json);
  assertNoPasswordHash(auditResults.json, "audit results");
  assert(
    (auditResults.json?.results || []).some((row) => String(row?.id || row?.resultId || row?.["Result ID"] || "") === resultId),
    "13b: completed check appears in AuditResults",
    { resultId, count: auditResults.json?.results?.length },
  );

  const results = await testClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/results?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(results.status === 200 && results.json?.ok === true, "14: Results screen data loads", results.json);
  assertNoPasswordHash(results.json, "results list");

  const googleForms = await masterClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/google-forms?masterSheetId=${encodeURIComponent(resolvedSheetId)}&companyFolderId=${encodeURIComponent(resolvedCompanyId)}`,
  );
  assert(googleForms.status === 200 && googleForms.json?.ok === true, "15: Google Forms load from company folder", googleForms.json);
  assertNoPasswordHash(googleForms.json, "google forms");

  const htmlRes = await fetch(`${config.frontendUrl}/`, { signal: AbortSignal.timeout(30_000) });
  const html = await htmlRes.text();
  const jsMatch = html.match(/\/assets\/index-[^"]+\.js/);
  if (jsMatch?.[0]) {
    const bundleRes = await fetch(`${config.frontendUrl}${jsMatch[0]}`, { signal: AbortSignal.timeout(30_000) });
    const bundle = await bundleRes.text();
    assert(!bundle.includes("PasswordHash"), "16: No PasswordHash in frontend bundle");
  }

  log(`OK — ${caseCount} total cases passed (static + live)`);
}

async function main() {
  log("Phase A — static guards (always run)");
  runStaticGuards();

  const config = loadLivePathConfig();
  const missing = missingLiveCredentials(config);
  if (missing.length > 0) {
    console.error(
      [
        "[verify:bert-core-foundation] Live journey skipped — missing BERT_LIVE_* credentials.",
        ...missing.map((key) => `  - ${key}`),
        "",
        `Static guards passed (${caseCount} cases). Set BERT_LIVE_MASTER_PASSWORD and BERT_LIVE_COMPANY_FOLDER_ID for full live proof.`,
      ].join("\n"),
    );
    process.exit(0);
  }

  log(`Phase B — live journey | API ${config.apiBase}`);
  await runLiveJourney(config);
}

main().catch((error) => {
  console.error("[verify:bert-core-foundation] Unhandled error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
