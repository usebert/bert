#!/usr/bin/env node
/**
 * Company auth foundation — Users tab PasswordHash + folder-first company resolve.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import {
  buildCompanySessionApiResponse,
  performCompanyLogin,
} from "../server/auth-service.mjs";
import {
  authenticateCompanyUserLogin,
  completeCompanyPasswordReset,
  readUserAuthRowByEmail,
  verifyUserPasswordFromUsersTab,
} from "../server/user-auth-service.mjs";

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

const userAuth = read("server/user-auth-service.mjs");
const authService = read("server/auth-service.mjs");
const resetModule = read("server/password-reset.mjs");
const sheetFlow = read("server/company-user-sheet-flow.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:company-auth-foundation"], "PKG: npm script registered");
assert(userAuth.includes("export async function authenticateCompanyUserLogin"), "static: authenticateCompanyUserLogin");
assert(userAuth.includes("reason: \"wrong_company\""), "static: wrong_company guard on Users tab");
assert(authService.includes("authenticateCompanyUserLogin"), "static: performCompanyLogin uses authenticateCompanyUserLogin");
assert(!authService.includes("verifyPasswordForEntry(passwordEntry"), "static: login no auth-index password verify");
assert(resetModule.includes("readUserAuthRowByEmail"), "static: reset reads Users tab");
assert(resetModule.includes("resolveCompanyFromFolder"), "static: reset folder-first resolve");
assert(sheetFlow.includes('reason: "cache_only"'), "static: cache-only login denied");
assert(userAuth.includes("buildCompanyContextFromHintedSheet"), "static: hinted sheet fallback builder");
assert(userAuth.includes("pushFolder(indexFolderId, indexSheetId)"), "static: auth-index pairs folder with sheet");
assert(userAuth.includes("buildLoginAuthFailure"), "static: login auth failure builder");
assert(userAuth.includes("no_workbook_candidates"), "static: no_workbook_candidates diagnostic");
assert(userAuth.includes("password_hash_missing"), "static: password_hash_missing diagnostic");
assert(userAuth.includes("password_compare_failed"), "static: password_compare_failed diagnostic");
assert(userAuth.includes("isKnownStaleAuthIndexPairing"), "static: stale auth index pairings skipped for login");
assert(userAuth.includes("resolveCompanyContextForUser"), "static: registry Users tab fallback on login");
assert(userAuth.includes("pickLoginMasterSheetId"), "static: paired sheet hint preferred over folder discovery");
assert(userAuth.includes("collectUsersTabLoginDiagnostics"), "static: users tab login diagnostics");
const appTsx = read("App.tsx");
assert(appTsx.includes("persistedCompanyLoginHints"), "static: App persists login hints before stale clear");
assert(
  /readCompanyLoginHint\(\)[\s\S]*?clearStaleCompanyLocalStorage/.test(appTsx),
  "static: login hint captured before clearStaleCompanyLocalStorage",
);

function createMockUsersTabStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    deps: {
      getTabValues: async () => [
        ["Email", "PasswordHash", "Status", "Role", "Name", "CompanyFolderId", "CompanyName"],
        ...[...store.entries()].map(([email, row]) => [
          email,
          row.passwordHash,
          row.status,
          row.role,
          row.name,
          row.companyFolderId,
          row.companyName,
        ]),
      ],
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
      writeUsersTabRecordByHeaders: async (_auth, _sheetId, record) => {
        const email = String(record.Email || "").trim().toLowerCase();
        if (!email) return { ok: false, reason: "invalid_email" };
        const existing = store.get(email) || { status: "ACTIVE", role: "Admin", name: email };
        store.set(email, {
          ...existing,
          passwordHash: String(record.PasswordHash || existing.passwordHash || "").trim(),
          status: String(record.Status || existing.status || "ACTIVE"),
        });
        return { ok: true, email };
      },
    },
    async findRow(_auth, sheetId, email) {
      const key = String(email || "").trim().toLowerCase();
      const row = store.get(key);
      if (!row) return null;
      if (row.masterSheetId && sheetId && row.masterSheetId !== sheetId) {
        return null;
      }
      return {
        email: key,
        roleRaw: row.role,
        role: row.role,
        name: row.name || key,
        status: row.status || "ACTIVE",
        passwordHash: row.passwordHash,
        companyFolderId: row.companyFolderId,
        companyId: row.companyFolderId,
        companyName: row.companyName,
        sheetRowIndex: 1,
        headers: ["Email", "PasswordHash", "Status", "Role", "Name", "CompanyFolderId", "CompanyName"],
        rowObject: {
          Email: key,
          PasswordHash: row.passwordHash,
          Status: row.status,
          Role: row.role,
          Name: row.name || key,
          CompanyFolderId: row.companyFolderId,
          CompanyName: row.companyName,
        },
      };
    },
  };
}

function buildUserDeps(mock, companyFolderId, companyName) {
  return {
    ...mock.deps,
    findCompanyUsersTabRow: mock.findRow.bind(mock),
    readCompanyUsersTabRecord: async (_auth, _sheetId, email) => {
      const row = await mock.findRow(_auth, _sheetId, email);
      if (!row) return null;
      return {
        role: row.role,
        name: row.name,
        email: row.email,
        status: row.status,
        passwordHash: row.passwordHash,
        companyFolderId,
        companyId: companyFolderId,
        companyName,
        rowObject: row.rowObject,
      };
    },
  };
}

function mockResolver(folderToSheet, folderToName) {
  return async (_auth, _deps, companyFolderId) => ({
    ok: true,
    companyFolderId,
    companyId: companyFolderId,
    companyName: folderToName[companyFolderId] || "Company",
    masterSheetId: folderToSheet[companyFolderId] || "",
  });
}

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "bert-company-auth-"));
try {
  const authIndexPath = path.join(sessionDir, "auth-index.json");
  const authIndexApi = createAuthIndexApi(authIndexPath);
  const masterSheetId = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
  const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
  const wrongFolderId = "1WrongFolder000000000000000000000000";
  const wrongSheetId = "1WrongSheetId0000000000000000000000000000000";
  const email = "active.user@example.com";
  const password = "ActiveUser-2026!";
  const newPassword = "ResetUser-2026!";

  const mock = createMockUsersTabStore({
    [email]: {
      passwordHash: hashPassword(password),
      status: "ACTIVE",
      role: "Admin",
      name: "Active User",
      companyFolderId,
      companyName: "Seven Oaks Cottages",
      masterSheetId,
    },
  });
  const userDeps = buildUserDeps(mock, companyFolderId, "Seven Oaks Cottages");
  const resolveCompanyFromFolder = mockResolver(
    { [companyFolderId]: masterSheetId, [wrongFolderId]: wrongSheetId },
    { [companyFolderId]: "Seven Oaks Cottages", [wrongFolderId]: "Rock Solid" },
  );

  const loginDeps = {
    authIndex: authIndexApi,
    getCompanyUsersDeps: () => userDeps,
    resolveCompanyFromFolder,
    findMasterSheetIdsForCompanyLoginEmail: (addr) =>
      String(addr).trim().toLowerCase() === email ? [masterSheetId] : [],
  };

  const activeLogin = await performCompanyLogin(
    {},
    { ...loginDeps, email, password },
  );
  assert(activeLogin.ok === true, "runtime: active Users tab user can log in");
  assert(!("passwordHash" in (activeLogin.user || {})), "runtime: login user payload has no PasswordHash");

  mock.store.set(email, {
    ...mock.store.get(email),
    status: "INACTIVE",
  });
  const inactiveLogin = await authenticateCompanyUserLogin(
    {},
    loginDeps,
    { email, password, masterSheetId },
  );
  assert(inactiveLogin.ok === false && inactiveLogin.blocker === "inactive", "runtime: inactive user cannot log in");

  mock.store.set(email, {
    ...mock.store.get(email),
    status: "ACTIVE",
  });
  authIndexApi.upsertEntry({
    email,
    name: "Active User",
    role: "Admin",
    companyId: wrongFolderId,
    companyFolderId: wrongFolderId,
    companyName: "Rock Solid",
    masterSheetId: wrongSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString(),
  });

  const wrongCompanyLogin = await authenticateCompanyUserLogin(
    {},
    {
      ...loginDeps,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password },
  );
  assert(wrongCompanyLogin.ok === false, "runtime: wrong-company auth index cannot log in without sheet hints");

  authIndexApi.upsertEntry({
    email,
    name: "Active User",
    role: "Admin",
    companyId: wrongFolderId,
    companyFolderId: wrongFolderId,
    companyName: "Rock Solid",
    masterSheetId: wrongSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword("StaleIndexOnly-99"),
    updatedAt: new Date().toISOString(),
  });

  const staleIndexLogin = await performCompanyLogin(
    {},
    { ...loginDeps, email, password },
  );
  assert(staleIndexLogin.ok === true, "runtime: stale auth index does not block login when Users tab is correct");

  const resetResult = await completeCompanyPasswordReset(
    {},
    { getCompanyUsersDeps: () => userDeps, authIndex: authIndexApi },
    {
      email,
      newPassword,
      companyContext: { masterSheetId, companyFolderId, companyName: "Seven Oaks Cottages" },
    },
  );
  assert(resetResult.ok === true, "runtime: password reset updates Users tab PasswordHash");

  const savedRow = await readUserAuthRowByEmail({}, { masterSheetId }, email, userDeps);
  assert(
    savedRow?.passwordHash && verifyPassword(newPassword, savedRow.passwordHash),
    "runtime: password reset read-back verifies saved hash",
  );

  const postResetLogin = await performCompanyLogin(
    {},
    { ...loginDeps, email, password: newPassword },
  );
  assert(postResetLogin.ok === true, "runtime: login works with new password");

  const apiShape = buildCompanySessionApiResponse({
    email,
    name: "Active User",
    role: "Admin",
    companyFolderId,
    companyName: "Seven Oaks Cottages",
    masterSheetId,
  });
  const serialized = JSON.stringify(apiShape);
  assert(!serialized.includes("passwordHash") && !serialized.includes("PasswordHash"), "runtime: PasswordHash never in API payload");

  const wrongFolderVerify = await verifyUserPasswordFromUsersTab(
    {},
    { masterSheetId, companyFolderId: wrongFolderId },
    email,
    newPassword,
    userDeps,
  );
  assert(wrongFolderVerify.reason === "wrong_company", "runtime: verifyUserPasswordFromUsersTab enforces CompanyFolderId");

  const failingResolver = async () => ({ ok: false, masterSheetId: "" });

  const hintOnlyLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: failingResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password: newPassword, masterSheetId },
  );
  assert(
    hintOnlyLogin.ok === true,
    "runtime: login succeeds when folder resolve fails but masterSheetId hint + Users row exist",
  );

  const legacyMasterSheetLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => {
        const legacyDeps = buildUserDeps(mock, companyFolderId, "Seven Oaks Cottages");
        const legacyFindRow = async (_auth, sheetId, addr) => {
          const key = String(addr || "").trim().toLowerCase();
          if (key !== email) return null;
          return {
            email: key,
            roleRaw: "Admin",
            role: "Admin",
            name: "Active User",
            status: "ACTIVE",
            passwordHash: hashPassword(newPassword),
            companyFolderId: masterSheetId,
            companyId: masterSheetId,
            companyName: "Seven Oaks Cottages",
            sheetRowIndex: 1,
            headers: ["Email", "PasswordHash", "Status", "Role", "Name", "CompanyId", "CompanyName"],
            rowObject: {
              Email: key,
              PasswordHash: hashPassword(newPassword),
              Status: "ACTIVE",
              Role: "Admin",
              Name: "Active User",
              CompanyId: masterSheetId,
              CompanyName: "Seven Oaks Cottages",
            },
          };
        };
        return {
          ...legacyDeps,
          findCompanyUsersTabRow: legacyFindRow,
          readCompanyUsersTabRecord: async (_auth, _sheetId, addr) => {
            const row = await legacyFindRow(_auth, _sheetId, addr);
            if (!row) return null;
            return {
              role: row.role,
              name: row.name,
              email: row.email,
              status: row.status,
              passwordHash: row.passwordHash,
              companyFolderId: row.companyFolderId,
              companyId: row.companyId,
              companyName: row.companyName,
              rowObject: row.rowObject,
            };
          },
        };
      },
      resolveCompanyFromFolder: mockResolver(
        { [companyFolderId]: masterSheetId },
        { [companyFolderId]: "Seven Oaks Cottages" },
      ),
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password: newPassword, masterSheetId },
  );
  assert(
    legacyMasterSheetLogin.ok === true,
    "runtime: legacy Users tab CompanyId=masterSheetId still logs in after folder resolve",
  );

  const noHintsLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: { lookupByEmail: () => null },
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: failingResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password: newPassword },
  );
  assert(
    noHintsLogin.ok === false && noHintsLogin.blocker === "invalid_credentials",
    "runtime: missing hints still blocks login",
  );
  assert(
    noHintsLogin.diagnostics?.reasonCode === "no_workbook_candidates",
    "runtime: missing hints return no_workbook_candidates diagnostic",
  );

  const pairedIndexPath = path.join(sessionDir, "auth-index-paired.json");
  const pairedIndexApi = createAuthIndexApi(pairedIndexPath);
  pairedIndexApi.upsertEntry({
    email,
    name: "Active User",
    role: "Admin",
    companyId: companyFolderId,
    companyFolderId,
    companyName: "Seven Oaks Cottages",
    masterSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
  });

  const indexPairedLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: pairedIndexApi,
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: failingResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password: newPassword },
  );
  assert(
    indexPairedLogin.ok === true,
    "runtime: auth-index folder+sheet login via sheet hint when folder resolve fails",
  );

  const legacyUsernameEmail = "legacy.username.user@example.com";
  const legacyPassword = "LegacyUser-2026!";
  const legacyMock = createMockUsersTabStore({});
  const legacyUserDeps = {
    ...legacyMock.deps,
    getTabValues: async () => [
      ["Username", "Name", "Role", "PasswordHash", "Status", "CompanyFolderId", "CompanyName"],
      [
        legacyUsernameEmail,
        "Legacy Username User",
        "Manager",
        hashPassword(legacyPassword),
        "ACTIVE",
        companyFolderId,
        "Seven Oaks Cottages",
      ],
    ],
    findCompanyUsersTabRow: async (_auth, sheetId, addr) => {
      const { findCompanyUsersTabRow } = await import("../server/company-users.mjs");
      return findCompanyUsersTabRow(_auth, sheetId, addr, legacyUserDeps);
    },
    readCompanyUsersTabRecord: async (_auth, sheetId, addr) => {
      const { readCompanyUsersTabRecord } = await import("../server/company-users.mjs");
      return readCompanyUsersTabRecord(_auth, sheetId, addr, legacyUserDeps);
    },
  };

  const legacyUsernameLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => legacyUserDeps,
      resolveCompanyFromFolder: mockResolver(
        { [companyFolderId]: masterSheetId },
        { [companyFolderId]: "Seven Oaks Cottages" },
      ),
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email: legacyUsernameEmail, password: legacyPassword, masterSheetId },
  );
  assert(legacyUsernameLogin.ok === true, "runtime: legacy Username-column Users row can log in");

  const {
    DOVECOTE_USERS_TAB_HEADERS,
    DOVECOTE_USERS_TAB_ROWS,
    DOVECOTE_FOLDER_ID,
    DOVECOTE_MASTER_SHEET_ID,
    DOVECOTE_COMPANY_NAME,
  } = await import("./fixtures/dovecote-users-tab.fixture.mjs");
  const sophieEmail = "7oakcottages@gmail.com";
  const sophiePassword = "Sophie-Dovecote-2026!";
  const sophieHash = hashPassword(sophiePassword);
  const doveMockRows = DOVECOTE_USERS_TAB_ROWS.map((row) =>
    row[0] === sophieEmail ? [row[0], row[1], row[2], row[3], row[4], row[5], sophieHash, ...row.slice(7)] : row,
  );
  const doveMock = {
    deps: {
      getTabValues: async () => [DOVECOTE_USERS_TAB_HEADERS, ...doveMockRows],
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
    },
  };
  const doveUserDeps = {
    ...doveMock.deps,
    findCompanyUsersTabRow: async (auth, sheetId, addr) => {
      const { findCompanyUsersTabRow } = await import("../server/company-users.mjs");
      return findCompanyUsersTabRow(auth, sheetId, addr, doveUserDeps);
    },
    readCompanyUsersTabRecord: async (auth, sheetId, addr) => {
      const { readCompanyUsersTabRecord } = await import("../server/company-users.mjs");
      return readCompanyUsersTabRecord(auth, sheetId, addr, doveUserDeps);
    },
  };
  const wrongRockSheetId = "1RockSolidWrongSheet000000000000000000000";
  const wrongRockFolderId = "1RockSolidWrongFolder00000000000000000";
  const staleRockIndexPath = path.join(sessionDir, "auth-index-rock-solid.json");
  const staleRockIndexApi = createAuthIndexApi(staleRockIndexPath);
  staleRockIndexApi.upsertEntry({
    email: sophieEmail,
    name: "sophie Graney",
    role: "Manager",
    companyId: wrongRockFolderId,
    companyFolderId: wrongRockFolderId,
    companyName: "Rock Solid",
    masterSheetId: wrongRockSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword("StaleRockSolid-99"),
    updatedAt: new Date().toISOString(),
  });

  const registryMap = new Map([
    [
      DOVECOTE_FOLDER_ID,
      {
        companyId: DOVECOTE_FOLDER_ID,
        companyFolderId: DOVECOTE_FOLDER_ID,
        companyName: DOVECOTE_COMPANY_NAME,
        masterSheetId: DOVECOTE_MASTER_SHEET_ID,
        status: "LIVE",
      },
    ],
  ]);

  const sophieRegistryLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: staleRockIndexApi,
      getCompanyUsersDeps: () => doveUserDeps,
      resolveCompanyFromFolder: async (_auth, _deps, folderId) => ({
        ok: folderId === DOVECOTE_FOLDER_ID,
        companyFolderId: DOVECOTE_FOLDER_ID,
        companyId: DOVECOTE_FOLDER_ID,
        companyName: DOVECOTE_COMPANY_NAME,
        masterSheetId: DOVECOTE_MASTER_SHEET_ID,
      }),
      findMasterSheetIdsForCompanyLoginEmail: () => [],
      readCanonicalCompanyWorkspaceRegistryMap: async () => ({ map: registryMap }),
      isCompanyRegistryLive: (record) => String(record?.status || "").toUpperCase() === "LIVE",
    },
    { email: sophieEmail, password: sophiePassword },
  );
  assert(
    sophieRegistryLogin.ok === true,
    "runtime: stale Rock Solid auth index skipped; registry Dovecote Users tab login succeeds",
  );
} finally {
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

console.log(`[verify:company-auth-foundation] OK — ${caseCount} cases passed`);
