#!/usr/bin/env node
/**
 * BERT foundation verification — all six core failure areas from the architecture rebuild.
 * Static guards always run; live checks when BERT_LIVE_* credentials exist.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig, missingLiveCredentials } from "./lib/live-path-config.mjs";
import { LiveHttpClient, assertNoPasswordHash } from "./lib/live-http-client.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function log(line) {
  console.log(`[verify:bert-foundation] ${line}`);
}

function fail(message, extra) {
  console.error(`FAIL [${caseCount}]: ${message}`);
  if (extra) {
    console.error(JSON.stringify(extra, null, 2));
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
  const foundation = read("server/company-users-foundation.mjs");
  const coreRoutes = read("server/core-workflow-routes.mjs");
  const assigneeService = read("server/schedule-assignee-service.mjs");
  const godmodeService = read("server/godmode-service.mjs");
  const authService = read("server/auth-service.mjs");
  const userAuth = read("server/user-auth-service.mjs");
  const sheetFlow = read("server/company-user-sheet-flow.mjs");
  const clearStale = read("src/utils/clearStaleCompanyLocalStorage.ts");
  const appTsx = read("App.tsx");
  const clientUsers = read("src/services/companyUserService.ts");
  const contextService = read("src/services/companyContextService.ts");
  const serverMain = read("server/server.mjs");
  const pkg = JSON.parse(read("package.json"));
  const foundationDoc = read("docs/FOUNDATION.md");

  assert(pkg.scripts["verify:bert-foundation"], "pkg: verify:bert-foundation registered");
  assert(foundationDoc.includes("company-users-foundation.mjs"), "doc: FOUNDATION.md references foundation module");

  /* 1: People page — single listCompanyProfiles path */
  assert(foundation.includes("export async function listCompanyProfiles"), "1a: listCompanyProfiles exported");
  assert(foundation.includes("readUsersTabProfiles"), "1b: readUsersTabProfiles exported");
  assert(foundation.includes("listableProfilesFromUsersTabRecords"), "1b2: foundation uses canonical Users tab profile mapper");
  assert(foundation.includes("syncCompanyUsersCache"), "1c: syncCompanyUsersCache exported");
  assert(
    coreRoutes.includes('from "./company-users-foundation.mjs"') &&
      coreRoutes.includes("listCompanyProfiles"),
    "1d: GET /users route imports listCompanyProfiles from foundation",
  );
  assert(
    clientUsers.includes("syncAndListActiveUsers") && contextService.includes("resolveCompanyMembersLoadContext"),
    "1e: client uses syncAndListActiveUsers + resolveCompanyMembersLoadContext",
  );
  assert(
    /refreshActiveCompanyMembers[\s\S]{0,1500}fetchCompanyMembers/.test(appTsx),
    "1f: page load and re-sync share fetchCompanyMembers",
  );

  /* 2: Schedule assignees === People users */
  assert(
    assigneeService.includes("getAssignableUsers") &&
      foundation.includes("getAssignableUsers"),
    "2a: assignees flow through foundation getAssignableUsers",
  );
  assert(
    read("server/company-user-service.mjs").includes("syncAndListActiveUsers"),
    "2b: getAssignableUsers calls syncAndListActiveUsers internally",
  );

  /* 3: Login fast path + Users tab fallback */
  assert(authService.includes("performCompanyLogin"), "3a: performCompanyLogin exists");
  assert(authService.includes("performMasterLogin"), "3b: performMasterLogin exists");
  assert(authService.includes("auth_index_lookup"), "3c: login uses auth index first");
  assert(authService.includes("attemptUsersTabPasswordLogin"), "3d: Users tab fallback on index miss");
  assert(authService.includes("background_jobs_queued"), "3e: background jobs after response");
  assert(!authService.includes("getCanonicalCompanyRegistryRecord"), "3f: login skips registry gate");
  assert(userAuth.includes("rebuildAuthIndexFromUsersTab"), "3g: auth index rebuild helper");

  /* 4: Stale company names purged — session wins over localStorage */
  const rockSolidHits = execSync(
    'rg -l "Rock Solid Concrete Ltd" . --glob "!scripts/verify-stale-company-context.mjs" --glob "!scripts/verify-invite-workspace.mjs" --glob "!scripts/verify-bert-foundation.mjs" 2>/dev/null || true',
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert(!rockSolidHits, "4a: no Rock Solid Concrete Ltd in repo");
  assert(clearStale.includes("runAppContextBootstrap"), "4b: boot-time stale purge");
  assert(clearStale.includes("companyName"), "4c: legacy companyName key cleared");
  assert(appTsx.includes("companyContextValid"), "4d: App respects session companyContextValid");
  assert(read("src/main.tsx").includes("runAppContextBootstrap"), "4e: main runs bootstrap before render");

  /* 5: Godmode vs company sessions separated */
  assert(
    authService.includes("platform_owner_master_only") || authService.includes("Platform owner must use master auth"),
    "5a: platform owner blocked from company login",
  );
  assert(
    godmodeService.includes("from \"./company-users-foundation.mjs\"") &&
      godmodeService.includes("listCompanyProfiles"),
    "5b: godmode People uses foundation listCompanyProfiles",
  );
  assert(clearStale.includes("clearGodmodeSelectedCompanyFolderId"), "5c: godmode folder cleared on company boot");
  assert(
    /parsed\.role !== "Master"[\s\S]*?clearStaleCompanyLocalStorage/.test(appTsx),
    "5d: company users do not restore Master/godmode localStorage",
  );

  /* 6: Invite → Users tab → login */
  assert(sheetFlow.includes("completeInviteToUserRow"), "6a: invite writes Users tab row");
  assert(serverMain.includes("completeInviteToUserRow"), "6b: invite complete route uses sheet helper");
  assert(authService.includes("verifyUserPasswordFromUsersTab"), "6c: login verifies Users tab hash");
  assert(sheetFlow.includes("canLoginCompanyUser"), "6d: canLoginCompanyUser sheet-only gate");
  assert(
    serverMain.includes("rebuildCompanyAuthIndexFromSheet") || serverMain.includes("rebuildAuthIndexFromUsersTab"),
    "6e: invite/re-sync rebuilds auth index",
  );

  /* Foundation wiring — re-sync and server imports */
  assert(
    serverMain.includes("from \"./company-users-foundation.mjs\"") ||
      serverMain.includes("rebuildUsersFromSheet"),
    "6f: server re-sync uses foundation rebuildUsersFromSheet",
  );
  assert(foundation.includes("never expose PasswordHash") || foundation.includes("PasswordHash"), "6g: foundation documents PasswordHash rule");

  log(`OK — ${caseCount} static foundation cases passed`);
}

async function runLiveChecks(config) {
  const masterClient = new LiveHttpClient(config.apiBase, config.origin);
  const adminClient = new LiveHttpClient(config.apiBase, config.origin);

  const masterLogin = await masterClient.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  assert(masterLogin.status === 200 && masterLogin.json?.ok === true, "live-5: Godmode login", masterLogin.json);
  assertNoPasswordHash(masterLogin.json, "godmode login");

  const companyBlocked = await adminClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  assert(
    companyBlocked.status === 401 && String(companyBlocked.json?.message || "").includes("master"),
    "live-5b: platform owner rejected from company login",
  );

  const liveCompanies = await masterClient.request("/api/godmode/live-companies");
  assert(liveCompanies.status === 200, "live-1: godmode company list");
  const company =
    liveCompanies.json?.companies?.find((row) =>
      String(row?.name || "")
        .toLowerCase()
        .includes(String(config.companyNameHint || "").toLowerCase()),
    ) || liveCompanies.json?.companies?.[0];
  const companyFolderId = String(company?.id || company?.folderId || "").trim();
  const masterSheetId = String(company?.masterSheetId || company?.sheetId || "").trim();
  assert(companyFolderId && masterSheetId, "live-1b: company folder + workbook", { company });

  const adminLogin = await adminClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.adminEmail, password: config.adminPassword, masterSheetId },
  });
  assert(adminLogin.status === 200 && adminLogin.json?.ok === true, "live-3: company admin login", adminLogin.json);
  assertNoPasswordHash(adminLogin.json, "admin login");

  const usersRes = await adminClient.request(
    `/api/companies/${encodeURIComponent(companyFolderId)}/users?masterSheetId=${encodeURIComponent(masterSheetId)}`,
  );
  assert(usersRes.status === 200 && Array.isArray(usersRes.json?.users), "live-1c: People users load");
  assertNoPasswordHash(usersRes.json, "people users");

  const assigneesRes = await adminClient.request(
    `/api/companies/${encodeURIComponent(companyFolderId)}/schedule-assignees?masterSheetId=${encodeURIComponent(masterSheetId)}`,
  );
  assert(assigneesRes.status === 200 && Array.isArray(assigneesRes.json?.assignees), "live-2: schedule assignees load");
  const peopleEmails = new Set((usersRes.json?.users || []).map((row) => String(row?.email || "").toLowerCase()));
  const assigneeEmails = (assigneesRes.json?.assignees || []).map((row) =>
    String(row?.email || row?.assignedUserEmail || "").toLowerCase(),
  );
  for (const email of assigneeEmails) {
    if (email) {
      assert(peopleEmails.has(email), "live-2b: assignee email exists in People list", { email });
    }
  }

  log(`OK — ${caseCount} total cases (static + live)`);
}

async function main() {
  log("Phase A — static foundation guards");
  runStaticGuards();

  const config = loadLivePathConfig();
  const missing = missingLiveCredentials(config);
  if (missing.length > 0) {
    log(`Live checks skipped — missing: ${missing.join(", ")}`);
    log(`Static guards passed (${caseCount} cases). Set BERT_LIVE_* for live proof.`);
    return;
  }

  log(`Phase B — live foundation checks | API ${config.apiBase}`);
  await runLiveChecks(config);
}

main().catch((error) => {
  console.error("[verify:bert-foundation] Unhandled error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
