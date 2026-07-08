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

import {
  DOVECOTE_USERS_TAB_HEADERS,
  DOVECOTE_USERS_TAB_ROWS,
  DOVECOTE_MASTER_SHEET_ID,
} from "./fixtures/dovecote-users-tab.fixture.mjs";

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
assert(userAuth.includes("pickLoginMasterSheetId"), "static: folder workbook picker for login");
assert(userAuth.includes("targetEmailInEmailLikeColumns"), "static: email-like column diagnostics");
assert(userAuth.includes("candidateMasterSheetIds"), "static: candidate workbook diagnostics");
assert(userAuth.includes("registryLookupDeps"), "static: registry lookup deps for login fallback");
assert(userAuth.includes("if (resolvedId)"), "static: folder discovery workbook wins over paired hint");
assert(userAuth.includes("!trustedFolderIds.length"), "static: auth-index skipped when trusted company folder selected");
assert(read("server/server.mjs").includes("...getCompanyContextResolutionDeps()"), "static: login route receives registry resolution deps");
assert(userAuth.includes("summarizeUsersTabEmailScanForLoginLog"), "static: USER_NOT_FOUND login logs include live email scan");
assert(!read("server/server.mjs").includes("/api/diagnostics/dovecote-users-tab"), "static: temporary Users-tab diagnostic route removed");
assert(!read("server/server.mjs").includes("dovecote-users-tab-diagnostics"), "static: diagnostic module not imported by server");
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
  assert(Boolean(DOVECOTE_FOLDER_ID), "runtime: Dovecote folder fixture present for duplicate-row cases");
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

  const sophieResolverRegistryLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: staleRockIndexApi,
      getCompanyUsersDeps: () => doveUserDeps,
      getCompanyResolverDeps: () => ({
        google: doveMock.deps.google,
        readCanonicalCompanyWorkspaceRegistryMap: async () => ({ map: registryMap }),
        isCompanyRegistryLive: (record) => String(record?.status || "").toUpperCase() === "LIVE",
      }),
      resolveCompanyFromFolder: failingResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email: sophieEmail, password: sophiePassword },
  );
  assert(
    sophieResolverRegistryLogin.ok === true,
    "runtime: registry fallback resolves via getCompanyResolverDeps registry helpers",
  );

  const sophieHintedFolderLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: staleRockIndexApi,
      getCompanyUsersDeps: () => doveUserDeps,
      getCompanyResolverDeps: () => ({ google: doveMock.deps.google }),
      resolveCompanyFromFolder: async (_auth, _deps, folderId) => ({
        ok: folderId === DOVECOTE_FOLDER_ID,
        companyFolderId: DOVECOTE_FOLDER_ID,
        companyId: DOVECOTE_FOLDER_ID,
        companyName: DOVECOTE_COMPANY_NAME,
        masterSheetId: DOVECOTE_MASTER_SHEET_ID,
      }),
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    {
      email: sophieEmail,
      password: sophiePassword,
      masterSheetId: wrongRockSheetId,
      companyFolderId: DOVECOTE_FOLDER_ID,
    },
  );
  assert(
    sophieHintedFolderLogin.ok === true,
    "runtime: folder workbook wins over stale cached masterSheetId when company folder selected",
  );
  assert(
    sophieHintedFolderLogin.companyContext?.masterSheetId === DOVECOTE_MASTER_SHEET_ID,
    "runtime: login session uses folder-discovered workbook not stale hint",
  );

  const loginColumnEmail = "login.column.user@example.com";
  const loginColumnPassword = "LoginColumn-2026!";
  const loginColumnDeps = {
    ...legacyMock.deps,
    getTabValues: async () => [
      ["Login", "Name", "Role", "PasswordHash", "Status", "CompanyFolderId", "CompanyName"],
      [
        loginColumnEmail,
        "Login Column User",
        "User",
        hashPassword(loginColumnPassword),
        "ACTIVE",
        companyFolderId,
        "Seven Oaks Cottages",
      ],
    ],
    findCompanyUsersTabRow: async (_auth, sheetId, addr) => {
      const { findCompanyUsersTabRow } = await import("../server/company-users.mjs");
      return findCompanyUsersTabRow(_auth, sheetId, addr, loginColumnDeps);
    },
    readCompanyUsersTabRecord: async (_auth, sheetId, addr) => {
      const { readCompanyUsersTabRecord } = await import("../server/company-users.mjs");
      return readCompanyUsersTabRecord(_auth, sheetId, addr, loginColumnDeps);
    },
  };
  const loginColumnResult = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => loginColumnDeps,
      resolveCompanyFromFolder: mockResolver(
        { [companyFolderId]: masterSheetId },
        { [companyFolderId]: "Seven Oaks Cottages" },
      ),
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email: loginColumnEmail, password: loginColumnPassword, masterSheetId },
  );
  assert(loginColumnResult.ok === true, "runtime: Login-column Users row can log in");

  const missingUserLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: failingResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email: "nobody@example.com", password: "nope-2026", masterSheetId },
  );
  assert(
    missingUserLogin.diagnostics?.candidateMasterSheetIds?.includes(masterSheetId),
    "runtime: user_not_found diagnostics include candidate workbook ids",
  );
  assert(
    Array.isArray(missingUserLogin.diagnostics?.usersTabLookups?.[0]?.detectedHeaders),
    "runtime: user_not_found diagnostics include Users tab headers",
  );
  const serializedDiagnostics = JSON.stringify(missingUserLogin.diagnostics || {});
  assert(
    !/"passwordHash"\s*:\s*"[^"]+"/i.test(serializedDiagnostics) &&
      !serializedDiagnostics.includes("scrypt$"),
    "runtime: login diagnostics never include password hash values",
  );

  const { summarizeUsersTabEmailScanForLoginLog } = await import("../server/users-tab-schema.mjs");
  const loginEmailScan = summarizeUsersTabEmailScanForLoginLog(
    [DOVECOTE_USERS_TAB_HEADERS, ...DOVECOTE_USERS_TAB_ROWS],
    "7oakcottages@gmail.com",
  );
  assert(loginEmailScan.rowCount === 3, "runtime: fixture Users tab has three data rows");
  assert(loginEmailScan.targetEmailScan.found === true, "runtime: login email scan finds fixture user");
  assert(!JSON.stringify(loginEmailScan).includes("scrypt$"), "runtime: login email scan never includes hash values");

  const { findCompanyUsersTabRow, selectBestUsersTabLoginRow, scoreUsersTabLoginRowCandidate } =
    await import("../server/company-users.mjs");
  const duplicateInactiveFirstHash = hashPassword("ActiveWins-2026!");
  const duplicateHeaders = ["Email", "Name", "Role", "Status", "PasswordHash", "CompanyFolderId"];
  const duplicateRows = [
    duplicateHeaders,
    ["7oakcottages@gmail.com", "Sophie Inactive", "Manager", "INACTIVE", hashPassword("StaleInactive-99"), DOVECOTE_FOLDER_ID],
    ["7oakcottages@gmail.com", "Sophie Active", "Manager", "ACTIVE", duplicateInactiveFirstHash, DOVECOTE_FOLDER_ID],
    ["eddie thomas", "dovecotestudio@icloud.com", "Admin", "BERT Admin", "", "1OtherFolderWrong"],
  ];
  const duplicateDeps = {
    getTabValues: async () => duplicateRows,
    resolveUsersTab: async () => ({ tabTitle: "Users" }),
    preferredCompanyFolderId: DOVECOTE_FOLDER_ID,
  };
  const activePreferred = await findCompanyUsersTabRow({}, DOVECOTE_MASTER_SHEET_ID, "7oakcottages@gmail.com", duplicateDeps);
  assert(activePreferred?.status === "ACTIVE", "runtime: ACTIVE duplicate Users row preferred over earlier INACTIVE");
  assert(
    activePreferred?.passwordHash === duplicateInactiveFirstHash,
    "runtime: preferred ACTIVE duplicate preserves PasswordHash",
  );
  assert(
    !(await findCompanyUsersTabRow({}, DOVECOTE_MASTER_SHEET_ID, "dovecotestudio@icloud.com", duplicateDeps)),
    "runtime: Name-column email on polluted workbook does not match login email",
  );
  const scored = selectBestUsersTabLoginRow(
    [
      {
        sheetRowIndex: 1,
        email: "7oakcottages@gmail.com",
        status: "INACTIVE",
        passwordHash: hashPassword("x"),
        companyFolderId: DOVECOTE_FOLDER_ID,
        emailColumnMatch: true,
      },
      {
        sheetRowIndex: 2,
        email: "7oakcottages@gmail.com",
        status: "ACTIVE",
        passwordHash: duplicateInactiveFirstHash,
        companyFolderId: DOVECOTE_FOLDER_ID,
        emailColumnMatch: true,
      },
    ],
    "7oakcottages@gmail.com",
    DOVECOTE_FOLDER_ID,
  );
  assert(scored?.sheetRowIndex === 2, "runtime: score helper picks ACTIVE duplicate");
  assert(
    scoreUsersTabLoginRowCandidate(scored, "7oakcottages@gmail.com", DOVECOTE_FOLDER_ID) >
      scoreUsersTabLoginRowCandidate(
        { sheetRowIndex: 1, email: "7oakcottages@gmail.com", status: "INACTIVE", passwordHash: "scrypt$x", emailColumnMatch: true },
        "7oakcottages@gmail.com",
        DOVECOTE_FOLDER_ID,
      ),
    "runtime: ACTIVE+hash scores above inactive duplicate",
  );

  const { isAmbiguousUsersTabLoginDuplicateSet } = await import("../server/company-users.mjs");
  assert(
    isAmbiguousUsersTabLoginDuplicateSet(
      [
        {
          emailColumnMatch: true,
          status: "ACTIVE",
          passwordHash: hashPassword("One-2026!"),
          companyFolderId: DOVECOTE_FOLDER_ID,
        },
        {
          emailColumnMatch: true,
          status: "ACTIVE",
          passwordHash: hashPassword("Two-2026!"),
          companyFolderId: DOVECOTE_FOLDER_ID,
        },
      ],
      DOVECOTE_FOLDER_ID,
    ) === true,
    "runtime: divergent ACTIVE+hash duplicates are ambiguous",
  );
  let ambiguousThrown = false;
  try {
    selectBestUsersTabLoginRow(
      [
        {
          sheetRowIndex: 1,
          email: "7oakcottages@gmail.com",
          status: "ACTIVE",
          passwordHash: hashPassword("One-2026!"),
          companyFolderId: DOVECOTE_FOLDER_ID,
          emailColumnMatch: true,
        },
        {
          sheetRowIndex: 2,
          email: "7oakcottages@gmail.com",
          status: "ACTIVE",
          passwordHash: hashPassword("Two-2026!"),
          companyFolderId: DOVECOTE_FOLDER_ID,
          emailColumnMatch: true,
        },
      ],
      "7oakcottages@gmail.com",
      DOVECOTE_FOLDER_ID,
    );
  } catch (error) {
    ambiguousThrown = error?.reasonCode === "ambiguous_users_tab_rows";
  }
  assert(ambiguousThrown, "runtime: selector throws safe ambiguous diagnostic for divergent ACTIVE duplicates");

  const inactiveThenActiveLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => duplicateDeps,
      resolveCompanyFromFolder: async (_auth, _deps, folderId) => ({
        ok: folderId === DOVECOTE_FOLDER_ID,
        companyFolderId: DOVECOTE_FOLDER_ID,
        companyId: DOVECOTE_FOLDER_ID,
        companyName: "Dovecote Studio",
        masterSheetId: DOVECOTE_MASTER_SHEET_ID,
      }),
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    {
      email: "7oakcottages@gmail.com",
      password: "ActiveWins-2026!",
      companyFolderId: DOVECOTE_FOLDER_ID,
    },
  );
  assert(
    inactiveThenActiveLogin.ok === true,
    "runtime: inactive duplicate before ACTIVE still logs in with ACTIVE row",
  );

  const staleTestcoSheetId = "15fEwp5M_WPaf0_GFHcNoZmget-_HW20xrAAVW_ehrps";
  const doveUserDepsForStale = {
    getTabValues: async (_auth, sheetId) => {
      if (sheetId === staleTestcoSheetId) {
        return [
          ["Email", "Name", "Role", "Status", "PasswordHash", "CompanyFolderId"],
          ["eddie thomas", "dovecotestudio@icloud.com", "Admin", "BERT Admin", "", "1OVn1p0t_ZrsfVy3GINMGV6zM0sH_UUPD"],
        ];
      }
      return [
        DOVECOTE_USERS_TAB_HEADERS,
        ...DOVECOTE_USERS_TAB_ROWS.map((row) =>
          row[0] === "dovecotestudio@icloud.com"
            ? [row[0], row[1], row[2], row[3], row[4], row[5], hashPassword("Edward-Dovecote-2026!"), ...row.slice(7)]
            : row,
        ),
      ];
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
  doveUserDepsForStale.findCompanyUsersTabRow = async (auth, sheetId, addr) => {
    const { findCompanyUsersTabRow: findRow } = await import("../server/company-users.mjs");
    return findRow(auth, sheetId, addr, doveUserDepsForStale);
  };
  doveUserDepsForStale.readCompanyUsersTabRecord = async (auth, sheetId, addr) => {
    const { readCompanyUsersTabRecord: readRow } = await import("../server/company-users.mjs");
    return readRow(auth, sheetId, addr, doveUserDepsForStale);
  };
  const staleSheetInactiveSkipped = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => doveUserDepsForStale,
      resolveCompanyFromFolder: async (_auth, _deps, folderId) => ({
        ok: folderId === DOVECOTE_FOLDER_ID,
        companyFolderId: DOVECOTE_FOLDER_ID,
        companyId: DOVECOTE_FOLDER_ID,
        companyName: "Dovecote Studio",
        masterSheetId: DOVECOTE_MASTER_SHEET_ID,
      }),
      findMasterSheetIdsForCompanyLoginEmail: () => [staleTestcoSheetId],
    },
    {
      email: "dovecotestudio@icloud.com",
      password: "Edward-Dovecote-2026!",
      companyFolderId: DOVECOTE_FOLDER_ID,
    },
  );
  assert(
    staleSheetInactiveSkipped.ok === true,
    "runtime: trusted Dovecote folder login wins over stale polluted invite sheet inactive match",
  );
} finally {
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

console.log(`[verify:company-auth-foundation] OK — ${caseCount} cases passed`);
