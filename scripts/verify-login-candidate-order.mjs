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
assert(userAuth.includes("export const LOGIN_CANDIDATE_TIMEOUT_MS = 5000"), "static: 5s per-candidate timeout");
assert(userAuth.includes("candidate_attempt_timeout"), "static: candidate_attempt_timeout timing phase");
assert(userAuth.includes("candidate_attempt_skipped"), "static: candidate_attempt_skipped timing phase");
assert(userAuth.includes("raceLoginCandidateAttempt"), "static: Promise.race candidate wrapper");
assert(userAuth.includes("isTrustedFolderCandidate"), "static: trusted folder candidates fully awaited");
assert(userAuth.includes("isSheetHintCandidate"), "static: sheet_hint candidates skip race timeout");
assert(userAuth.includes("sheet_hint_background"), "static: sheet_hint folder resolve is background only");
assert(userAuth.includes("scheduleSheetHintFolderResolveRefresh"), "static: sheet_hint folder resolve scheduled async");
assert(userAuth.includes("resolveFolderLoginContext"), "static: folder resolve split from Users tab verify");
assert(userAuth.includes("tryUsersTabSheetHintLogin"), "static: sheet_hint login uses same-request row for password_check");
assert(userAuth.includes("verifyUsersTabLoginAttempt"), "static: Users tab verify reuses existingRow from cache miss");
assert(userAuth.includes("folderResolveOnlyTimeout"), "static: only folder_company_resolve is race-timed for folder candidates");
assert(userAuth.includes("sessionCompanyFolderId"), "static: session company folder collected as candidate");
assert(userAuth.includes("candidate_attempt_await"), "static: trusted folder await phase logged");
assert(userAuth.includes("candidateOrder"), "static: candidate order logged");
assert(userAuth.includes("export function collectLoginResolutionAttempts"), "static: collectLoginResolutionAttempts exported");
assert(userAuth.includes("upsertLoginAuthIndexFromUsersTabRow"), "static: login upserts auth index without full rebuild");
assert(!userAuth.includes("await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, email)"), "static: login success path skips full auth-index rebuild");

const staleSheetAfterIndexBlock = userAuth.slice(
  userAuth.indexOf("Users-first: body/session masterSheetId before slow auth-index"),
  userAuth.indexOf("if (typeof deps.findMasterSheetIdsForCompanyLoginEmail"),
);
assert(staleSheetAfterIndexBlock.includes("pushSheet(hintedSheetId)"), "static: session masterSheetId tried before auth-index folder");
assert(staleSheetAfterIndexBlock.includes("pushFolder(indexFolderId"), "static: auth-index folder follows body sheet hint");

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
    orderedAttempts[0]?.type === "sheet_hint" && orderedAttempts[0]?.masterSheetId === staleSheetId,
    "runtime: body masterSheetId sheet_hint tried before auth-index folder",
  );
  assert(
    orderedAttempts[1]?.type === "folder" && orderedAttempts[1]?.companyFolderId === companyFolderId,
    "runtime: auth-index folder follows body sheet hint",
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

  function createWrongIndexApi() {
    const api = createAuthIndexApi(path.join(path.dirname(authIndexPath), `wrong-index-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`));
    api.upsertEntry({
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
    return api;
  }

  const wrongIndexApi = createWrongIndexApi();

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
    timingLines.some((line) => line.includes("candidate_attempt_timeout")),
    "runtime: candidate_attempt_timeout logged for slow candidate",
  );
  assert(
    timingLines.some((line) => line.includes("candidate_attempt_skipped")),
    "runtime: candidate_attempt_skipped logged after timeout",
  );

  const hangingFolderLines = [];
  const hangingFolderResolver = async (_auth, _deps, folderId) => {
    if (folderId === wrongFolderId) {
      await new Promise((resolve) => setTimeout(resolve, LOGIN_CANDIDATE_TIMEOUT_MS + 2000));
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
  const hangingFolderStarted = Date.now();
  const hangingFolderLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: createWrongIndexApi(),
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: hangingFolderResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [masterSheetId],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          hangingFolderLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email, password, masterSheetId: staleSheetId },
  );
  const hangingFolderElapsed = Date.now() - hangingFolderStarted;
  assert(hangingFolderLogin.ok === true, "runtime: login succeeds after hanging folder_company_resolve on first candidate");
  assert(
    hangingFolderElapsed < LOGIN_CANDIDATE_TIMEOUT_MS * 3,
    "runtime: hanging folder_company_resolve times out within budget",
  );

  const usersFirstLines = [];
  let passwordCheckAt = 0;
  let folderResolveFinishedAt = 0;
  const slowSheetHintResolver = async (_auth, _deps, folderId) => {
    await new Promise((resolve) => {
      setTimeout(() => {
        folderResolveFinishedAt = Date.now();
        resolve(undefined);
      }, LOGIN_CANDIDATE_TIMEOUT_MS + 2000);
    });
    return {
      ok: folderId === companyFolderId,
      companyFolderId,
      companyId: companyFolderId,
      companyName: "Candidate Co",
      masterSheetId,
    };
  };
  const usersFirstStarted = Date.now();
  const usersFirstLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: createWrongIndexApi(),
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: slowSheetHintResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
      loginTiming: {
        logPhase(phase, startMs, meta = {}) {
          usersFirstLines.push(`${phase} ${JSON.stringify(meta)}`);
          if (phase === "password_check") {
            passwordCheckAt = Date.now();
          }
        },
      },
    },
    { email, password, masterSheetId },
  );
  const usersFirstElapsed = Date.now() - usersFirstStarted;
  assert(usersFirstLogin.ok === true, "runtime: sheet_hint login returns 200 with slow folder resolve");
  assert(usersFirstElapsed < LOGIN_CANDIDATE_TIMEOUT_MS, "runtime: sheet_hint login completes before folder resolve");
  assert(passwordCheckAt > 0, "runtime: password_check phase logged for sheet_hint");
  assert(
    folderResolveFinishedAt === 0 || passwordCheckAt < folderResolveFinishedAt,
    "runtime: password_check precedes background folder_company_resolve completion",
  );
  assert(
    usersFirstLines.some((line) => line.includes("users_tab_read") && line.includes('"rowFound":true')),
    "runtime: sheet_hint finds user row quickly",
  );
  assert(
    !usersFirstLogin.entry?.passwordHash,
    "runtime: successful login entry does not leak PasswordHash",
  );

  const duplicateIndexLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: createWrongIndexApi(),
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: slowWrongFolderResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [],
    },
    { email, password, masterSheetId },
  );
  assert(duplicateIndexLogin.ok === true, "runtime: duplicate auth-index cannot override valid Users tab row");
  assert(
    duplicateIndexLogin.companyContext?.masterSheetId === masterSheetId,
    "runtime: login uses Dovecote workbook from Users tab not stale auth-index",
  );
  assert(
    duplicateIndexLogin.companyContext?.companyFolderId === companyFolderId,
    "runtime: login uses CompanyFolderId from Users tab row",
  );

  let responseSentAt = 0;
  let slowResolveFinishedAt = 0;
  const blockTestResolver = async (_auth, _deps, folderId) => {
    if (folderId === wrongFolderId) {
      await new Promise((resolve) => {
        setTimeout(() => {
          slowResolveFinishedAt = Date.now();
          resolve(undefined);
        }, LOGIN_CANDIDATE_TIMEOUT_MS + 3000);
      });
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
  const blockTestStarted = Date.now();
  const blockTestLogin = await authenticateCompanyUserLogin(
    {},
    {
      authIndex: createWrongIndexApi(),
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: blockTestResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [masterSheetId],
    },
    { email, password, masterSheetId: staleSheetId },
  );
  responseSentAt = Date.now();
  const blockTestElapsed = responseSentAt - blockTestStarted;
  assert(blockTestLogin.ok === true, "runtime: login returns before timed-out candidate finishes");
  assert(blockTestElapsed < LOGIN_CANDIDATE_TIMEOUT_MS * 3, "runtime: response not blocked by timed-out candidate");
  await new Promise((resolve) => setTimeout(resolve, LOGIN_CANDIDATE_TIMEOUT_MS + 3500));
  assert(slowResolveFinishedAt > 0, "runtime: timed-out resolver eventually completed in background");
  assert(
    responseSentAt < slowResolveFinishedAt,
    "runtime: response_sent precedes timed-out candidate completion",
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

  const slowTrustedLines = [];
  const slowTrustedDelayMs = LOGIN_CANDIDATE_TIMEOUT_MS + 2500;
  const slowTrustedResolver = async (_auth, _deps, folderId) => {
    if (folderId !== companyFolderId) {
      return { ok: false, masterSheetId: "" };
    }
    await new Promise((resolve) => setTimeout(resolve, slowTrustedDelayMs));
    return {
      ok: true,
      companyFolderId,
      companyId: companyFolderId,
      companyName: "Candidate Co",
      masterSheetId,
    };
  };
  const slowTrustedStarted = Date.now();
  const slowTrustedLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: slowTrustedResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          slowTrustedLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email, password, companyFolderId, masterSheetId: staleSheetId },
  );
  const slowTrustedElapsed = Date.now() - slowTrustedStarted;
  assert(slowTrustedLogin.ok === true, "runtime: trusted body folder awaits slow resolve and returns 200");
  assert(
    slowTrustedElapsed >= slowTrustedDelayMs,
    "runtime: trusted body folder not abandoned before folder resolve completes",
  );
  assert(
    !slowTrustedLines.some((line) => line.includes("candidate_attempt_timeout")),
    "runtime: trusted body folder does not log candidate timeout",
  );
  assert(
    !slowTrustedLines.some((line) => line.includes("registry_fallback")),
    "runtime: trusted body folder skips registry fallback",
  );

  const sessionFolderLines = [];
  const sessionFolderStarted = Date.now();
  const sessionFolderLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: slowTrustedResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          sessionFolderLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email, password, sessionCompanyFolderId: companyFolderId, masterSheetId: staleSheetId },
  );
  const sessionFolderElapsed = Date.now() - sessionFolderStarted;
  assert(sessionFolderLogin.ok === true, "runtime: trusted session folder awaits slow resolve and returns 200");
  assert(
    sessionFolderElapsed >= slowTrustedDelayMs,
    "runtime: trusted session folder not abandoned before folder resolve completes",
  );
  assert(
    !sessionFolderLines.some((line) => line.includes("candidate_attempt_timeout")),
    "runtime: trusted session folder does not log candidate timeout",
  );

  const sessionOnlyAttempts = collectLoginResolutionAttempts(
    { email, sessionCompanyFolderId: companyFolderId, masterSheetId: staleSheetId },
    { findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId] },
  );
  assert(
    sessionOnlyAttempts[0]?.type === "folder" && sessionOnlyAttempts[0]?.companyFolderId === companyFolderId,
    "runtime: session company folder collected before stale sheet hints",
  );
  assert(sessionOnlyAttempts.length === 1, "runtime: session folder absorbs stale session sheet candidate");
} finally {
  console.info = originalInfo;
}

for (const line of timingLines) {
  assert(!/passwordhash|\"password\"|token|secret|cookie/i.test(line), `runtime: timing logs stay secret-safe (${line})`);
}

console.log(`[verify:login-candidate-order] OK — ${caseCount} cases passed`);
