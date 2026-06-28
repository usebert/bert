#!/usr/bin/env node
/**
 * Login candidate ordering + per-candidate timeout — folder-first before stale session sheets.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import {
  authenticateCompanyUserLogin,
  collectLoginResolutionAttempts,
  LOGIN_CANDIDATE_TIMEOUT_MS,
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
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:login-candidate-order"], "PKG: npm script registered");
assert(userAuth.includes("export const LOGIN_CANDIDATE_TIMEOUT_MS = 8000"), "static: 8s per-candidate timeout");
assert(userAuth.includes("candidate_timeout"), "static: candidate_timeout timing phase");
assert(userAuth.includes("candidateOrder"), "static: candidate order logged");
assert(userAuth.includes("export function collectLoginResolutionAttempts"), "static: collectLoginResolutionAttempts exported");
assert(userAuth.includes("upsertLoginAuthIndexFromUsersTabRow"), "static: login upserts auth index without full rebuild");
assert(!userAuth.includes("await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, email)"), "static: login success path skips full auth-index rebuild");

const staleSheetAfterIndexBlock = userAuth.slice(
  userAuth.indexOf("Folder-first auth-index hint before stale session"),
  userAuth.indexOf("if (typeof deps.findMasterSheetIdsForCompanyLoginEmail"),
);
assert(staleSheetAfterIndexBlock.includes("pushSheet(hintedSheetId)"), "static: session masterSheetId tried after auth-index folder");
assert(!staleSheetAfterIndexBlock.includes("else if (hintedSheetId)"), "static: session sheet no longer tried before auth-index");

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
    },
    async findRow(_auth, sheetId, email) {
      const key = String(email || "").trim().toLowerCase();
      const row = store.get(key);
      if (!row) return null;
      if (row.blockSheets?.includes(sheetId)) {
        await new Promise((resolve) => setTimeout(resolve, LOGIN_CANDIDATE_TIMEOUT_MS + 500));
        return null;
      }
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

const email = "candidate.order@example.com";
const password = "CandidateOrder-2026!";
const masterSheetId = "1PlwknNgtt-4j08matn1w4358YTe5SXFs5Hh0zA_m3So";
const staleSheetId = "1WrongSheetId0000000000000000000000000000000";
const companyFolderId = "1TVQ-gbpxoOzE6PCkHX581eTDgtMC11lc";
const wrongFolderId = "1WrongFolder000000000000000000000000000";

const mock = createMockUsersTabStore({
  [email]: {
    passwordHash: hashPassword(password),
    status: "ACTIVE",
    role: "Admin",
    name: "Candidate Order",
    companyFolderId,
    companyName: "Candidate Co",
    masterSheetId,
    blockSheets: [staleSheetId],
  },
});
const userDeps = buildUserDeps(mock, companyFolderId, "Candidate Co");

const attempts = collectLoginResolutionAttempts(
  { email, masterSheetId: staleSheetId, companyFolderId },
  { findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId] },
);
assert(attempts[0]?.type === "folder" && attempts[0]?.companyFolderId === companyFolderId, "runtime: explicit folder candidate is first");
assert(
  attempts[0]?.masterSheetId === staleSheetId,
  "runtime: stale session sheet kept as paired fallback on folder candidate only",
);
assert(attempts.length === 1, "runtime: explicit folder absorbs stale session sheet instead of separate sheet candidate");

const sessionOnlyAttempts = collectLoginResolutionAttempts(
  { email, masterSheetId: staleSheetId },
  { findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId] },
);
assert(
  sessionOnlyAttempts.some((attempt) => attempt.type === "sheet_hint" && attempt.masterSheetId === staleSheetId),
  "runtime: stale session sheet collected when no folder selected",
);

const timingLines = [];
const originalInfo = console.info;
console.info = (...args) => {
  timingLines.push(args.map((part) => String(part)).join(" "));
};
try {
  const resolveCompanyFromFolder = async (_auth, _deps, folderId) => ({
    ok: folderId === companyFolderId,
    companyFolderId,
    companyId: companyFolderId,
    companyName: "Candidate Co",
    masterSheetId,
  });

  const hintedFolderLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder,
      findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          timingLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email, password, companyFolderId, masterSheetId: staleSheetId },
  );
  assert(hintedFolderLogin.ok === true, "runtime: folder-first candidate succeeds before stale session sheet");
  assert(
    !timingLines.some((line) => line.includes("candidate_timeout") && line.includes(staleSheetId)),
    "runtime: stale session sheet not waited on when folder-first succeeds",
  );

  const authIndexPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bert-login-candidate-")), "auth-index.json");
  const authIndexApi = createAuthIndexApi(authIndexPath);
  authIndexApi.upsertEntry({
    email,
    name: "Candidate Order",
    role: "Admin",
    companyId: companyFolderId,
    companyFolderId,
    companyName: "Candidate Co",
    masterSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString(),
  });

  const orderedAttempts = collectLoginResolutionAttempts(
    { email, masterSheetId: staleSheetId },
    { authIndex: authIndexApi, findMasterSheetIdsForCompanyLoginEmail: () => [] },
  );
  assert(
    orderedAttempts[0]?.type === "folder" && orderedAttempts[0]?.companyFolderId === companyFolderId,
    "runtime: auth-index folder tried before stale session masterSheetId",
  );
  assert(
    orderedAttempts[1]?.type === "sheet_hint" && orderedAttempts[1]?.masterSheetId === staleSheetId,
    "runtime: stale session masterSheetId follows folder candidate",
  );

  const slowResolveCalls = [];
  const slowWrongFolderResolver = async (_auth, _deps, folderId) => {
    slowResolveCalls.push(folderId);
    if (folderId === wrongFolderId) {
      await new Promise((resolve) => setTimeout(resolve, LOGIN_CANDIDATE_TIMEOUT_MS + 500));
      return { ok: false, masterSheetId: "" };
    }
    return {
      ok: folderId === companyFolderId,
      companyFolderId,
      companyId: companyFolderId,
      companyName: "Candidate Co",
      masterSheetId,
    };
  };

  const wrongIndexApi = createAuthIndexApi(path.join(path.dirname(authIndexPath), "wrong-index.json"));
  wrongIndexApi.upsertEntry({
    email,
    name: "Candidate Order",
    role: "Admin",
    companyId: wrongFolderId,
    companyFolderId: wrongFolderId,
    companyName: "Wrong Co",
    masterSheetId: staleSheetId,
    status: "ACTIVE",
    passwordHash: hashPassword("WrongCo-2026!"),
    updatedAt: new Date().toISOString(),
  });

  const timeoutStarted = Date.now();
  const timeoutLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: wrongIndexApi,
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: slowWrongFolderResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [masterSheetId],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          timingLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email, password, masterSheetId: staleSheetId },
  );
  const timeoutElapsed = Date.now() - timeoutStarted;
  assert(timeoutLogin.ok === true, "runtime: login succeeds after timed-out wrong candidates");
  assert(timeoutElapsed < LOGIN_CANDIDATE_TIMEOUT_MS * 3, "runtime: timed-out candidates do not block login for 50s");
  assert(
    timingLines.some((line) => line.includes("candidate_timeout")),
    "runtime: candidate_timeout logged for slow candidate",
  );

  mock.store.set(email, { ...mock.store.get(email), status: "INACTIVE" });
  const inactiveLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password, companyFolderId },
  );
  assert(inactiveLogin.ok === false && inactiveLogin.blocker === "inactive", "runtime: inactive users still cannot log in");

  mock.store.set(email, { ...mock.store.get(email), status: "ACTIVE" });
  const wrongPasswordLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password: "WrongPassword-2026!", companyFolderId },
  );
  assert(wrongPasswordLogin.ok === false, "runtime: wrong password still fails");
  assert(wrongPasswordLogin.entry === undefined, "runtime: failed login does not return entry payload");
} finally {
  console.info = originalInfo;
}

for (const line of timingLines) {
  assert(!/passwordhash|\"password\"|token|secret|cookie/i.test(line), `runtime: timing logs stay secret-safe (${line})`);
}

console.log(`[verify:login-candidate-order] OK — ${caseCount} cases passed`);
