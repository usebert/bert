#!/usr/bin/env node
/**
 * Folder-first company login — trusted folder workbook only; stale sheets cannot interfere.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/master-auth.mjs";
import {
  authenticateCompanyUserLogin,
  collectIgnoredStaleLoginCandidates,
  collectLoginResolutionAttempts,
} from "../server/user-auth-service.mjs";
import {
  DOVECOTE_FOLDER_ID,
  DOVECOTE_MASTER_SHEET_ID,
  DOVECOTE_USERS_TAB_HEADERS,
  DOVECOTE_USERS_TAB_ROWS,
} from "./fixtures/dovecote-users-tab.fixture.mjs";
import { loadLivePathConfig } from "./lib/live-path-config.mjs";
import { LiveHttpClient, assertNoPasswordHash } from "./lib/live-http-client.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;
const companyReports = [];

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

const userAuth = read("server/user-auth-service.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:folder-first-company-logins"], "PKG: npm script registered");
assert(userAuth.includes("export function collectIgnoredStaleLoginCandidates"), "static: collectIgnoredStaleLoginCandidates exported");
assert(userAuth.includes("folderFirstStrict"), "static: folder-first strict login path");
assert(userAuth.includes("effectiveAttempts"), "static: trusted-folder-only candidate loop");
assert(userAuth.includes("staleCandidatesIgnored"), "static: stale candidate diagnostics");
assert(userAuth.includes("companyFolderIdUsed"), "static: companyFolderIdUsed in diagnostics");
assert(userAuth.includes("trustedMasterSheetId"), "static: trustedMasterSheetId in diagnostics");
assert(userAuth.includes("skipSheetHint"), "static: folder resolve can skip sheet hint");
assert(userAuth.includes("pushFolder(hintedFolderId, trustedFolderIds.length ? \"\" : hintedSheetId)"), "static: no paired sheet when folder known");

const staleTestcoSheetId = "15fEwp5M_WPaf0_GFHcNoZmget-_HW20xrAAVW_ehrps";
const testcoFolderId = "1OVn1p0t_ZrsfVy3GINMGV6zM0sH_UUPD";

function buildDovecoteUsersTab(passwordForEdward = "Edward-Dovecote-2026!") {
  return [
    DOVECOTE_USERS_TAB_HEADERS,
    ...DOVECOTE_USERS_TAB_ROWS.map((row) =>
      row[0] === "dovecotestudio@icloud.com"
        ? [row[0], row[1], row[2], row[3], row[4], row[5], hashPassword(passwordForEdward), ...row.slice(7)]
        : row,
    ),
  ];
}

function createStaleAwareDeps() {
  const deps = {
    getTabValues: async (_auth, sheetId) => {
      if (sheetId === staleTestcoSheetId) {
        return [
          ["Email", "Name", "Role", "Status", "PasswordHash", "CompanyFolderId"],
          [
            "eddie thomas",
            "dovecotestudio@icloud.com",
            "Admin",
            "BERT Admin",
            "",
            testcoFolderId,
          ],
        ];
      }
      if (sheetId === DOVECOTE_MASTER_SHEET_ID) {
        return buildDovecoteUsersTab();
      }
      return [["Email", "Name", "Status", "PasswordHash"], []];
    },
    getConfig: async () => ({}),
    updateConfig: async () => null,
    ensureColumns: async () => ({ addedColumns: [] }),
    google: {
      sheets: () => ({
        spreadsheets: { values: { update: async () => null, append: async () => null } },
      }),
    },
    withSheetsQuotaRetry: (fn) => fn(),
    resolveUsersTab: async () => ({ tabTitle: "Users" }),
  };
  return deps;
}

async function wireUsersTabHelpers(deps) {
  const { findCompanyUsersTabRow, readCompanyUsersTabRecord } = await import("../server/company-users.mjs");
  deps.findCompanyUsersTabRow = (auth, sheetId, addr) =>
    findCompanyUsersTabRow(auth, sheetId, addr, deps);
  deps.readCompanyUsersTabRecord = (auth, sheetId, addr) =>
    readCompanyUsersTabRecord(auth, sheetId, addr, deps);
  return deps;
}

const doveUserDeps = await wireUsersTabHelpers(createStaleAwareDeps());

const resolveDovecoteFolder = async (_auth, _deps, folderId) => ({
  ok: folderId === DOVECOTE_FOLDER_ID,
  companyFolderId: DOVECOTE_FOLDER_ID,
  companyId: DOVECOTE_FOLDER_ID,
  companyName: "Dovecote Studio",
  masterSheetId: DOVECOTE_MASTER_SHEET_ID,
});

const loginDeps = {
  getCompanyUsersDeps: () => doveUserDeps,
  resolveCompanyFromFolder: resolveDovecoteFolder,
  findMasterSheetIdsForCompanyLoginEmail: () => [staleTestcoSheetId],
};

const ignored = collectIgnoredStaleLoginCandidates(
  {
    email: "dovecotestudio@icloud.com",
    companyFolderId: DOVECOTE_FOLDER_ID,
    masterSheetId: staleTestcoSheetId,
  },
  loginDeps,
  [DOVECOTE_FOLDER_ID],
);
assert(ignored.some((entry) => entry.includes(staleTestcoSheetId)), "runtime: stale TESTCO invite hint ignored when Dovecote folder known");
assert(
  ignored.some((entry) => entry.includes("session_or_body_masterSheetId")),
  "runtime: stale session masterSheetId ignored when folder known",
);

const attempts = collectLoginResolutionAttempts(
  {
    email: "dovecotestudio@icloud.com",
    companyFolderId: DOVECOTE_FOLDER_ID,
    masterSheetId: staleTestcoSheetId,
  },
  loginDeps,
);
assert(attempts.length === 1 && attempts[0]?.type === "folder", "runtime: only trusted folder candidate collected");
assert(!attempts[0]?.masterSheetId, "runtime: folder candidate has no paired stale sheet id");

const doveLogin = await authenticateCompanyUserLogin(
  {},
  loginDeps,
  {
    email: "dovecotestudio@icloud.com",
    password: "Edward-Dovecote-2026!",
    companyFolderId: DOVECOTE_FOLDER_ID,
    masterSheetId: staleTestcoSheetId,
  },
);
assert(doveLogin.ok === true, "runtime: Dovecote login uses folder workbook only");
assert(
  doveLogin.companyContext?.masterSheetId === DOVECOTE_MASTER_SHEET_ID,
  "runtime: Dovecote trusted workbook id from folder resolve",
);

const missingUserLogin = await authenticateCompanyUserLogin(
  {},
  loginDeps,
  {
    email: "nobody@example.com",
    password: "Wrong-Password-2026!",
    companyFolderId: DOVECOTE_FOLDER_ID,
    masterSheetId: staleTestcoSheetId,
  },
);
assert(missingUserLogin.ok === false, "runtime: missing user in trusted folder fails login");
assert(
  missingUserLogin.reasonCode === "user_not_found",
  "runtime: missing user in trusted folder returns user_not_found not stale inactive",
);
assert(
  missingUserLogin.diagnostics?.companyFolderIdUsed === DOVECOTE_FOLDER_ID,
  "runtime: failure diagnostics include companyFolderIdUsed",
);
assert(
  Array.isArray(missingUserLogin.diagnostics?.staleCandidatesIgnored) &&
    missingUserLogin.diagnostics.staleCandidatesIgnored.length > 0,
  "runtime: failure diagnostics list staleCandidatesIgnored",
);

const inactiveOnlyStaleDeps = await wireUsersTabHelpers({
  ...createStaleAwareDeps(),
  getTabValues: async (_auth, sheetId) => {
    if (sheetId === DOVECOTE_MASTER_SHEET_ID) {
      return [["Email", "Name", "Status", "PasswordHash"], []];
    }
    if (sheetId === staleTestcoSheetId) {
      return [
        ["Email", "Name", "Status", "PasswordHash"],
        ["dovecotestudio@icloud.com", "Edward Thomas", "INACTIVE", hashPassword("x")],
      ];
    }
    return [["Email"], []];
  },
});

const inactiveStaleOnly = await authenticateCompanyUserLogin(
  {},
  {
    getCompanyUsersDeps: () => inactiveOnlyStaleDeps,
    resolveCompanyFromFolder: resolveDovecoteFolder,
    findMasterSheetIdsForCompanyLoginEmail: () => [staleTestcoSheetId],
  },
  {
    email: "dovecotestudio@icloud.com",
    password: "Edward-Dovecote-2026!",
    companyFolderId: DOVECOTE_FOLDER_ID,
  },
);
assert(inactiveStaleOnly.ok === false, "runtime: empty trusted folder Users tab does not fall through to stale inactive");
assert(
  inactiveStaleOnly.reasonCode === "user_not_found",
  "runtime: stale inactive outside folder does not block trusted folder user_not_found",
);

async function verifyRegistryCompanyLive(masterClient, company) {
  const folderId = String(company.id || company.folderId || company.companyFolderId || "").trim();
  const name = String(company.name || company.companyName || "").trim();
  if (!folderId) {
    companyReports.push({ name: name || "(unknown)", status: "skipped", reason: "missing_folder_id" });
    return;
  }
  const resolveRes = await masterClient.request(
    `/api/godmode/companies/${encodeURIComponent(folderId)}/resolve-from-folder`,
    { method: "POST", body: {} },
  );
  const masterSheetId = String(resolveRes.json?.masterSheetId || "").trim();
  const ok = resolveRes.status === 200 && resolveRes.json?.ok === true && Boolean(masterSheetId);
  if (!ok) {
    companyReports.push({
      name,
      companyFolderId: folderId,
      status: "broken",
      reason: resolveRes.json?.reasonCode || resolveRes.json?.userMessage || `http_${resolveRes.status}`,
    });
    return;
  }
  const inviteReadiness = await masterClient.request(
    `/api/companies/${encodeURIComponent(folderId)}/invite-readiness?masterSheetId=${encodeURIComponent(masterSheetId)}&companyFolderId=${encodeURIComponent(folderId)}`,
  );
  const usersTabOk =
    inviteReadiness.status === 200 &&
    inviteReadiness.json?.ok === true &&
    (inviteReadiness.json?.canInvite === true || inviteReadiness.json?.companyStatus === "USABLE");
  companyReports.push({
    name,
    companyFolderId: folderId,
    masterSheetId,
    status: usersTabOk ? "ok" : "broken_users_tab",
    reason: usersTabOk ? undefined : inviteReadiness.json?.reasonCode || inviteReadiness.json?.message || "users_tab_unreadable",
  });
  assertNoPasswordHash(resolveRes.json, `resolve-from-folder:${name}`);
  assertNoPasswordHash(inviteReadiness.json, `invite-readiness:${name}`);
}

const config = loadLivePathConfig();
if (config.masterPassword) {
  try {
    const masterClient = new LiveHttpClient(config.apiBase, config.origin);
    const masterLogin = await masterClient.request("/api/auth/master/login", {
      method: "POST",
      body: { email: config.masterEmail, password: config.masterPassword },
    });
    if (masterLogin.status === 200 && masterLogin.json?.ok === true) {
      const liveCompanies = await masterClient.request("/api/godmode/live-companies");
      assert(liveCompanies.status === 200 && liveCompanies.json?.ok === true, "live: godmode company list loads");
      const companies = Array.isArray(liveCompanies.json?.companies) ? liveCompanies.json.companies : [];
      assert(companies.length > 0, "live: at least one registry company returned");
      for (const company of companies) {
        const companyName = String(company.name || "").toLowerCase();
        if (companyName.includes("testco")) {
          companyReports.push({
            name: company.name,
            companyFolderId: company.id || company.folderId,
            status: "skipped_testco",
          });
          continue;
        }
        await verifyRegistryCompanyLive(masterClient, company);
      }
      const dove = companyReports.find((row) => row.companyFolderId === DOVECOTE_FOLDER_ID);
      if (dove) {
        assert(dove.status === "ok", `live: Dovecote folder resolves with readable Users tab (${dove.reason || dove.status})`);
      }
    }
  } catch (error) {
    console.warn(
      `[verify:folder-first-company-logins] live registry checks skipped: ${error instanceof Error ? error.message : error}`,
    );
  }
}

const broken = companyReports.filter((row) => row.status === "broken" || row.status === "broken_users_tab");
if (broken.length) {
  console.warn("[verify:folder-first-company-logins] companies with missing/broken Users tab:");
  for (const row of broken) {
    console.warn(`  - ${row.name} (${row.companyFolderId}): ${row.reason || row.status}`);
  }
}

console.log("[verify:folder-first-company-logins] company folders checked:");
for (const row of companyReports) {
  console.log(
    `  - ${row.name || "(unknown)"}: ${row.status}${row.masterSheetId ? ` workbook=${row.masterSheetId}` : ""}`,
  );
}

console.log(`[verify:folder-first-company-logins] OK — ${caseCount} cases passed`);
