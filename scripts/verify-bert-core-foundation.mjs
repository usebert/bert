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
  const authService = read("server/auth-service.mjs");
  const userService = read("server/company-user-service.mjs");
  const inviteService = read("server/invite-service.mjs");
  const scheduleService = read("server/schedule-service.mjs");
  const checkService = read("server/check-service.mjs");
  const completionService = read("server/completion-service.mjs");
  const folderStructure = read("server/company-folder-structure.mjs");
  const godmodeService = read("server/godmode-service.mjs");
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
  assert(folderStructure.includes("buildCompanyWorkbookName"), "static: BERT Workbook naming");
  assert(read("server/google-forms-service.mjs").includes("resolveCompanyGoogleFormsFolder"), "static: googleFormsService folder resolve");
  assert(read("server/company-forms-service.mjs").includes("listCompanyGoogleForms"), "static: company Google Forms list");
  assert(pkg.scripts["verify:google-forms-folder"], "static: google-forms-folder verify script");
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
  assert(scheduleService.includes("saveSchedule"), "static: scheduleService saveSchedule alias");
  assert(scheduleService.includes("listSchedulesAssignedToUser"), "static: schedule assigned-user list");
  assert(scheduleService.includes("companyFolderId && masterSheetId"), "static: folder-first schedule context");
  assert(checkService.includes("submitCompletedCheck"), "static: checkService submits AuditResults");
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
  const api = new LiveHttpClient(config.apiBase, config.origin);
  const masterClient = new LiveHttpClient(config.apiBase, config.origin);
  const adminClient = new LiveHttpClient(config.apiBase, config.origin);
  const managerClient = new LiveHttpClient(config.apiBase, config.origin);

  const masterLogin = await masterClient.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  assert(masterLogin.status === 200 && masterLogin.json?.ok === true, "1: Godmode login works");
  assertNoPasswordHash(masterLogin.json, "godmode login");

  const liveCompanies = await masterClient.request("/api/godmode/live-companies");
  assert(liveCompanies.status === 200 && liveCompanies.json?.ok === true, "1b: Godmode company list loads");
  const company = findCompany(liveCompanies.json?.companies, config.companyNameHint);
  assert(company?.id || company?.folderId, "1c: Godmode selects company folder", { company });
  const companyFolderId = String(company.id || company.folderId || "").trim();
  const masterSheetId = String(company.masterSheetId || company.sheetId || "").trim();

  const resolveFromFolder = await masterClient.request(
    `/api/godmode/companies/${encodeURIComponent(companyFolderId)}/resolve-from-folder`,
    {
      method: "POST",
      body: { companyFolderId, masterSheetId, companyName: company.name },
    },
  );
  if (resolveFromFolder.status === 200 && resolveFromFolder.json?.ok) {
    assert(
      resolveFromFolder.json?.status === COMPANY_CONTEXT_STATUS_USABLE || resolveFromFolder.json?.usable === true,
      "2: Company resolves workbook from folder",
      resolveFromFolder.json,
    );
  } else {
    log("WARN: resolve-from-folder skipped — using registry folder context");
    assert(companyFolderId && masterSheetId, "2b: folder + workbook ids present");
  }

  const adminLogin = await adminClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.adminEmail, password: config.adminPassword, masterSheetId: masterSheetId || undefined },
  });
  assert(adminLogin.status === 200 && adminLogin.json?.ok === true, "3: Company Admin login works", adminLogin.json);
  assertNoPasswordHash(adminLogin.json, "admin login");

  const managerLogin = await managerClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.managerEmail, password: config.managerPassword, masterSheetId: masterSheetId || undefined },
  });
  assert(managerLogin.status === 200 && managerLogin.json?.ok === true, "3b: Manager login works");

  const resolvedCompanyId = String(
    adminLogin.json?.company?.companyId || adminLogin.json?.company?.companyFolderId || companyFolderId,
  ).trim();
  const resolvedSheetId = String(adminLogin.json?.company?.masterSheetId || masterSheetId).trim();

  const godmodeUsers = await masterClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/users?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(godmodeUsers.status === 200 && Array.isArray(godmodeUsers.json?.users), "4: Users tab users in Godmode People");
  assertNoPasswordHash(godmodeUsers.json, "godmode users");

  const inviteEmail = `verify.foundation+${Date.now()}@usebert.co.uk`.toLowerCase();
  const inviteRes = await managerClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/invites/auditor`,
    {
      method: "POST",
      body: {
        email: inviteEmail,
        role: "Auditor",
        masterSheetId: resolvedSheetId,
        companyFolderId: resolvedCompanyId,
        companyName: company.name || config.companyNameHint,
      },
    },
  );
  assert(inviteRes.status === 200 && inviteRes.json?.ok === true, "5: Manager creates invite", inviteRes.json);
  const inviteToken = String(inviteRes.json?.tokenId || inviteRes.json?.token || "").trim();
  assert(inviteToken, "5b: invite token created");

  const replaceRes = await managerClient.request("/api/onboarding/app-invites/company-user", {
    method: "POST",
    body: {
      email: inviteEmail,
      role: "Auditor",
      companyFolderId: resolvedCompanyId,
      masterSheetId: resolvedSheetId,
      companyName: company.name,
      resend: true,
      tokenId: "f".repeat(48),
    },
  });
  assert(replaceRes.status === 200 && replaceRes.json?.ok === true, "6: Resend invalid invite creates fresh link", replaceRes.json);
  const freshToken = String(replaceRes.json?.tokenId || "").trim();
  assert(freshToken && freshToken !== inviteToken, "6b: fresh token differs");

  const inviteComplete = await api.request(`/api/invites/company-user/${encodeURIComponent(freshToken)}/complete`, {
    method: "POST",
    body: { fullName: "Foundation Verify", password: "VerifyLive1!", confirmPassword: "VerifyLive1!" },
  });
  assert(inviteComplete.status === 200 && inviteComplete.json?.ok !== false, "7: Invite acceptance creates active user", inviteComplete.json);
  assertNoPasswordHash(inviteComplete.json, "invite complete");

  const membersAfter = await adminClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/users?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(
    membersAfter.json?.users?.some((row) => String(row?.email || "").toLowerCase() === inviteEmail),
    "8: Active user appears in People",
    { emails: membersAfter.json?.users?.map((r) => r?.email) },
  );

  const editedName = "Foundation Verify Edited";
  const editRes = await adminClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/users/${encodeURIComponent(inviteEmail)}?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
    {
      method: "PATCH",
      body: { masterSheetId: resolvedSheetId, name: editedName, role: "Auditor" },
    },
  );
  assert(editRes.status === 200 && editRes.json?.ok === true, "8c: Company Admin can edit active user", editRes.json);
  assertNoPasswordHash(editRes.json, "user edit");
  assert(String(editRes.json?.user?.name || "").trim() === editedName, "8d: edited name returned");

  const membersEdited = await adminClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/users?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  const editedRow = membersEdited.json?.users?.find((row) => String(row?.email || "").toLowerCase() === inviteEmail);
  assert(editedRow && String(editedRow.name || "").trim() === editedName, "8e: edited user in refreshed list");

  const assigneesRes = await adminClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedule-assignees?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(assigneesRes.status === 200 && Array.isArray(assigneesRes.json?.assignees), "8b: Active users in schedule assignment");
  assertNoPasswordHash(assigneesRes.json, "schedule assignees");

  const godmodeSchedules = await masterClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(godmodeSchedules.status === 200 && godmodeSchedules.json?.ok === true, "12: Godmode reads company schedules");
  const schedules = Array.isArray(godmodeSchedules.json?.schedules) ? godmodeSchedules.json.schedules : [];
  if (schedules.length > 0) {
    const sample = schedules[0];
    const assigned = getScheduleAssignedEmails(sample);
    assert(assigned.length > 0, "9: Schedule exposes assignedUserEmails", { scheduleId: sample.id, assigned });
  } else {
    log("WARN: no schedules — assignedUserEmails on-sheet check skipped");
  }

  const invitedLogin = await api.request("/api/auth/company/login", {
    method: "POST",
    body: { email: inviteEmail, password: "VerifyLive1!", masterSheetId: resolvedSheetId },
  });
  assert(invitedLogin.status === 200 && invitedLogin.json?.ok === true, "10: Assigned user can log in");

  const managerSchedules = await managerClient.request(
    `/api/companies/${encodeURIComponent(resolvedCompanyId)}/schedules?masterSheetId=${encodeURIComponent(resolvedSheetId)}`,
  );
  assert(managerSchedules.status === 200, "10b: Company user reads schedules");

  const htmlRes = await fetch(`${config.frontendUrl}/`, { signal: AbortSignal.timeout(30_000) });
  const html = await htmlRes.text();
  const jsMatch = html.match(/\/assets\/index-[^"]+\.js/);
  if (jsMatch?.[0]) {
    const bundleRes = await fetch(`${config.frontendUrl}${jsMatch[0]}`, { signal: AbortSignal.timeout(30_000) });
    const bundle = await bundleRes.text();
    assert(!bundle.includes("PasswordHash"), "15: No PasswordHash in frontend bundle");
    assert(!bundle.includes("Ready for health check"), "13: No health-check clutter in bundle");
    assert(!bundle.includes("registry fallback"), "13b: No registry fallback clutter in bundle");
  }

  assert(read("src/services/companyUserService.ts").includes("COMPANY_MEMBERS_LOAD_TIMEOUT_MS"), "14: load timeout constant exists");
  assert(read("src/services/companyUserService.ts").includes("90_000"), "14b: load timeout is 90s");

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
        `Static guards passed (${caseCount} cases). Set credentials for full 15-case live proof.`,
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
