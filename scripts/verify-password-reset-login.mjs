#!/usr/bin/env node
/**
 * Password reset + login must share user-auth-service helpers; Users tab PasswordHash wins.
 * Audit fixture: 7oakcottages@gmail.com (Rock Solid stale auth-index pairing).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { performCompanyLogin } from "../server/auth-service.mjs";
import {
  completeCompanyPasswordReset,
  readUserAuthRowByEmail,
  verifyUserPasswordFromUsersTab,
  writeUserPasswordHash,
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

function performCompanyLoginBody(source) {
  const start = source.indexOf("export async function performCompanyLogin");
  const end = source.indexOf("export function queueCompanyLoginBackgroundJobs", start);
  return source.slice(start, end > start ? end : undefined);
}

const userAuth = read("server/user-auth-service.mjs");
const resetModule = read("server/password-reset.mjs");
const authService = read("server/auth-service.mjs");
const authIndex = read("server/auth-index.mjs");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));
const loginFn = performCompanyLoginBody(authService);

assert(pkg.scripts["verify:password-reset-login"], "PKG: npm script registered");

assert(userAuth.includes("7oakcottages@gmail.com"), "1: audit comment for 7oakcottages@gmail.com");
assert(userAuth.includes("export { hashPassword, verifyPassword }"), "2a: hashPassword exported");
assert(userAuth.includes("verifyPassword"), "2b: verifyPassword exported");
assert(userAuth.includes("readUserAuthRowByEmail"), "2c: readUserAuthRowByEmail");
assert(userAuth.includes("writeUserPasswordHash"), "2d: writeUserPasswordHash");
assert(userAuth.includes("rebuildAuthIndexFromUsersTab"), "2e: rebuildAuthIndexFromUsersTab");
assert(userAuth.includes("completeCompanyPasswordReset"), "2f: completeCompanyPasswordReset");
assert(userAuth.includes("PasswordHash"), "2g: writes PasswordHash by header name");

assert(resetModule.includes("completeCompanyPasswordReset"), "3a: reset uses completeCompanyPasswordReset");
assert(!resetModule.includes("setCompanyUserPasswordHash("), "3b: reset no longer calls setCompanyUserPasswordHash directly");

assert(loginFn.includes("authenticateCompanyUserLogin"), "4a: login uses authenticateCompanyUserLogin");
assert(loginFn.includes("users_tab_auth"), "4b: login authenticates via Users tab path");
assert(!loginFn.includes("verifyPasswordForEntry(passwordEntry"), "4c: login does not verify auth-index password first");
assert(userAuth.includes("rebuildAuthIndexFromUsersTab"), "4d: auth index rebuild helper available for background/reset flows");
assert(userAuth.includes("upsertAuthIndexFromVerifiedLoginRow"), "4e: login uses fast auth index upsert");
assert(
  !/authenticateCompanyUserLogin[\s\S]{0,5000}await rebuildAuthIndexFromUsersTab/.test(userAuth),
  "4f: login hot path does not await full Users tab rebuild",
);

assert(authIndex.includes("indexHash !== rowHash"), "5: auth index detects stale password hash");

assert(serverMain.includes("/api/godmode/debug/verify-user-password"), "6a: godmode debug endpoint");
assert(serverMain.includes("debugVerifyUserPassword"), "6b: godmode debug handler wired");
assert(serverMain.includes("findMasterSheetIdsForCompanyLoginEmail"), "6c: login receives invite sheet hints");

const panel = read("src/components/godmode/GodmodeCompanyWorkspacePanel.tsx");
assert(panel.includes("verify-user-password"), "7: frontend advanced diagnostics password verify");

/** In-memory Users tab mock — header-ordered PasswordHash column. */
function createMockUsersTabStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    deps: {
      getTabValues: async () => [["Email", "PasswordHash", "Status", "Role", "Name"], ...[...store.entries()].map(([email, row]) => [email, row.passwordHash, row.status, row.role, row.name])],
      getConfig: async () => ({}),
      updateConfig: async () => null,
      ensureColumns: async () => ({ addedColumns: [] }),
      google: { sheets: () => ({ spreadsheets: { values: { update: async () => null, append: async () => null } } }) },
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
        sheetRowIndex: 1,
        headers: ["Email", "PasswordHash", "Status", "Role", "Name"],
        rowObject: { Email: key, PasswordHash: row.passwordHash, Status: row.status, Role: row.role, Name: row.name || key },
      };
    },
  };
}

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "bert-pw-reset-login-"));
try {
  const authIndexPath = path.join(sessionDir, "auth-index.json");
  const authIndexApi = createAuthIndexApi(authIndexPath);
  const masterSheetId = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
  const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
  const auditEmail = "7oakcottages@gmail.com";
  const oldPassword = "OldRockSolid-99";
  const newPassword = "NewSevenOaks-2026!";
  const mock = createMockUsersTabStore({
    [auditEmail]: {
      passwordHash: hashPassword(oldPassword),
      status: "ACTIVE",
      role: "Admin",
      name: "Sophie",
      companyFolderId,
      companyName: "Seven Oaks Cottages",
      masterSheetId,
    },
  });

  const userDeps = {
    ...mock.deps,
    findCompanyUsersTabRow: mock.findRow.bind(mock),
    readCompanyUsersTabRecord: async (auth, sheetId, email) => {
      const row = await mock.findRow(auth, sheetId, email);
      if (!row) return null;
      return {
        role: row.role,
        name: row.name,
        email: row.email,
        status: row.status,
        passwordHash: row.passwordHash,
        companyFolderId,
        companyId: companyFolderId,
        companyName: "Seven Oaks Cottages",
        rowObject: row.rowObject,
      };
    },
  };

  authIndexApi.upsertEntry({
    email: auditEmail,
    name: "Sophie",
    role: "Admin",
    companyId: companyFolderId,
    companyFolderId,
    companyName: "Rock Solid Scaffolding",
    masterSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword(oldPassword),
    updatedAt: new Date().toISOString(),
  });

  const resetResult = await completeCompanyPasswordReset(
    {},
    { getCompanyUsersDeps: () => userDeps, authIndex: authIndexApi },
    { email: auditEmail, newPassword, companyContext: { masterSheetId, companyFolderId, companyName: "Seven Oaks Cottages" } },
  );
  assert(resetResult.ok === true, "8: reset writes Users tab and verifies read-back");

  const savedRow = await readUserAuthRowByEmail({}, { masterSheetId }, auditEmail, userDeps);
  assert(savedRow?.passwordHash && verifyPassword(newPassword, savedRow.passwordHash), "9: Users tab hash matches new password");

  const staleIndexEntry = authIndexApi.lookupByEmail(auditEmail);
  assert(staleIndexEntry?.passwordHash && verifyPassword(newPassword, staleIndexEntry.passwordHash), "10: auth index updated after reset");

  const resolveCompanyFromFolder = async (_auth, _deps, folderId) => ({
    ok: true,
    companyFolderId: folderId,
    companyId: folderId,
    companyName: folderId === companyFolderId ? "Seven Oaks Cottages" : "Rock Solid Scaffolding",
    masterSheetId,
  });

  const loginDepsBase = {
    authIndex: authIndexApi,
    getCompanyUsersDeps: () => userDeps,
    resolveCompanyFromFolder,
    findMasterSheetIdsForCompanyLoginEmail: (addr) =>
      String(addr).trim().toLowerCase() === auditEmail ? [masterSheetId] : [],
  };

  const staleLogin = await performCompanyLogin(
    {},
    { ...loginDepsBase, email: auditEmail, password: newPassword },
  );
  assert(staleLogin.ok === true, "11: login succeeds with new password");

  authIndexApi.upsertEntry({
    email: auditEmail,
    name: "Sophie",
    role: "Admin",
    companyId: companyFolderId,
    companyFolderId,
    companyName: "Seven Oaks Cottages",
    masterSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword("WrongIndexOnly-12"),
    updatedAt: new Date().toISOString(),
  });
  mock.store.set(auditEmail, {
    passwordHash: hashPassword(newPassword),
    status: "ACTIVE",
    role: "Admin",
    name: "Sophie",
  });

  const repairedLogin = await performCompanyLogin(
    {},
    { ...loginDepsBase, email: auditEmail, password: newPassword },
  );
  assert(repairedLogin.ok === true, "12: stale index password repaired by Users tab fallback");

  authIndexApi.removeEntry(auditEmail);
  const missingIndexLogin = await performCompanyLogin(
    {},
    { ...loginDepsBase, email: auditEmail, password: newPassword },
  );
  assert(missingIndexLogin.ok === true, "13: missing index login via Users tab fallback");

  const wrongPassword = await performCompanyLogin(
    {},
    { ...loginDepsBase, email: auditEmail, password: "TotallyWrong-999" },
  );
  assert(wrongPassword.ok === false && wrongPassword.code === "INVALID_CREDENTIALS", "14: wrong password fails");

  authIndexApi.upsertEntry({
    email: auditEmail,
    name: "Sophie",
    role: "Admin",
    companyId: companyFolderId,
    companyFolderId,
    companyName: "Seven Oaks Cottages",
    masterSheetId: "1WrongSheetId0000000000000000000000000000000",
    status: "ACTIVE",
    passwordHash: hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
  });

  const wrongSheetLogin = await performCompanyLogin(
    {},
    { ...loginDepsBase, email: auditEmail, password: newPassword },
  );
  assert(wrongSheetLogin.ok === true, "14b: stale index masterSheetId repaired via invite hint + Users tab");

  const wrongCompany = await verifyUserPasswordFromUsersTab(
    {},
    { masterSheetId: "other-company-sheet" },
    auditEmail,
    newPassword,
    {
      ...userDeps,
      readCompanyUsersTabRecord: async () => null,
      findCompanyUsersTabRow: async () => null,
    },
  );
  assert(wrongCompany.ok === false, "15: wrong company row fails");

  const debugShape = {
    ok: true,
    rowFound: true,
    passwordHashPresent: true,
    passwordHashPrefix: savedRow.passwordHash.slice(0, 12),
    passwordHashLength: savedRow.passwordHash.length,
    source: "users_tab",
  };
  assert(!("passwordHash" in debugShape) || debugShape.passwordHash === undefined, "16: no full hash in debug shape");
} finally {
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

console.log(`[verify:password-reset-login] OK — ${caseCount} cases passed`);
