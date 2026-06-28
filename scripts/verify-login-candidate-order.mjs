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
  LOGIN_AUTH_TOTAL_CAP_MS,
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
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:login-candidate-order"], "PKG: npm script registered");
assert(userAuth.includes("export const LOGIN_CANDIDATE_TIMEOUT_MS = 5000"), "static: 5s per-candidate timeout");
assert(userAuth.includes("export const LOGIN_AUTH_TOTAL_CAP_MS = 7000"), "static: 7s global login auth cap");
assert(userAuth.includes("createLoginAuthBudget"), "static: login auth budget helper");
assert(userAuth.includes("global_auth_cap"), "static: global_auth_cap skip reason logged");
assert(userAuth.includes("loginAuthTotalCapMs"), "static: loginAuthTotalCapMs logged in timing");
assert(userAuth.includes("candidate_attempt_timeout"), "static: candidate_attempt_timeout timing phase");
assert(userAuth.includes("candidate_attempt_skipped"), "static: candidate_attempt_skipped timing phase");
assert(userAuth.includes("raceLoginCandidateAttempt"), "static: Promise.race candidate wrapper");
assert(userAuth.includes("candidateOrder"), "static: candidate order logged");
assert(userAuth.includes("export function collectLoginResolutionAttempts"), "static: collectLoginResolutionAttempts exported");
assert(userAuth.includes("upsertLoginAuthIndexFromUsersTabRow"), "static: login upserts auth index without full rebuild");
assert(!userAuth.includes("await rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, email)"), "static: login success path skips full auth-index rebuild");

assert(userAuth.indexOf("pushFolder(indexFolderId") < userAuth.indexOf("pushSheet(hintedSheetId)"), "static: auth-index folder collected before session masterSheetId");
assert(userAuth.includes("!hasFolderCandidate && hintedSheetId"), "static: stale session sheet only when no folder candidate");
assert(userAuth.includes("partitionLoginAttempts"), "static: folder/sheet phases partitioned for registry between them");
assert(userAuth.includes("sessionCompanyFolderId"), "static: session company folder hint supported");
assert(userAuth.includes("return dedupeLoginAttempts(attempts);"), "static: explicit folder short-circuits candidate collection");
assert(serverMain.includes("sessionCompanyFolderId"), "static: login route wires sessionCompanyFolderId");
assert(
  /performCompanyLogin\([\s\S]*?sessionCompanyFolderId:\s*loginSessionCompanyFolderId/.test(serverMain),
  "static: login route passes sessionCompanyFolderId to performCompanyLogin input",
);
assert(
  /performCompanyLogin\([\s\S]*?companyFolderId:\s*loginCompanyFolderId/.test(serverMain),
  "static: login route passes companyFolderId to performCompanyLogin input",
);
assert(
  serverMain.includes("req.body?.companyId") && serverMain.includes("req.body?.companyFolderId"),
  "static: login route accepts companyFolderId and companyId aliases",
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
    !orderedAttempts.some((attempt) => attempt.type === "sheet_hint"),
    "runtime: stale session sheet omitted when auth-index folder exists",
  );

  const authIndexWithFolderAttempts = collectLoginResolutionAttempts(
    { email, masterSheetId: staleSheetId },
    { authIndex: authIndexApi, findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId] },
  );
  assert(
    authIndexWithFolderAttempts[0]?.type === "folder" && authIndexWithFolderAttempts[0]?.companyFolderId === companyFolderId,
    "runtime: Dovecote-style folder-first candidate index 0 before stale session masterSheetId",
  );
  assert(
    authIndexWithFolderAttempts.every((attempt) => attempt.type !== "sheet_hint"),
    "runtime: invite/session sheet hints skipped when auth-index folder exists",
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
  assert(timeoutElapsed < LOGIN_AUTH_TOTAL_CAP_MS + 1500, "runtime: timed-out candidates respect global auth cap");
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
    hangingFolderElapsed < LOGIN_AUTH_TOTAL_CAP_MS + 1500,
    "runtime: hanging folder_company_resolve respects global auth cap",
  );
  assert(
    hangingFolderLines.some((line) => line.includes("candidate_attempt_timeout")),
    "runtime: hanging folder resolve logs candidate_attempt_timeout",
  );
  assert(
    hangingFolderLines.some(
      (line) => line.includes("folder_company_resolve") || line.includes("candidate_attempt_timeout"),
    ),
    "runtime: hanging folder resolve times out or completes within budget",
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
  assert(blockTestElapsed < LOGIN_AUTH_TOTAL_CAP_MS + 1500, "runtime: response respects global auth cap");
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

  const sessionFolderAttempts = collectLoginResolutionAttempts(
    { email, masterSheetId: staleSheetId, sessionCompanyFolderId: companyFolderId },
    { findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId] },
  );
  assert(
    sessionFolderAttempts[0]?.type === "folder" && sessionFolderAttempts[0]?.companyFolderId === companyFolderId,
    "runtime: session company folder tried before stale session masterSheetId",
  );
  assert(
    !sessionFolderAttempts.some((attempt) => attempt.type === "sheet_hint"),
    "runtime: session folder absorbs stale sheet hints",
  );

  const threeStalePlusFolderLines = [];
  const threeStaleResolver = async (_auth, _deps, folderId) => {
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
  const threeStaleStarted = Date.now();
  const threeStaleLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => userDeps,
      resolveCompanyFromFolder: threeStaleResolver,
      findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId, masterSheetId],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          threeStalePlusFolderLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email, password, companyFolderId, masterSheetId: staleSheetId },
  );
  const threeStaleElapsed = Date.now() - threeStaleStarted;
  assert(threeStaleLogin.ok === true, "runtime: explicit folder-first succeeds with stale hints present");
  assert(
    threeStaleElapsed < LOGIN_AUTH_TOTAL_CAP_MS + 500,
    `runtime: 3 stale + folder-first login under global cap (${threeStaleElapsed}ms)`,
  );
  assert(
    !threeStalePlusFolderLines.some((line) => line.includes("candidate_attempt_timeout")),
    "runtime: explicit folder-first skips stale candidate timeouts",
  );
  const successIdx = threeStalePlusFolderLines.findIndex((line) => line.includes("candidate_attempt_success"));
  const responseReadyIdx = threeStalePlusFolderLines.findIndex((line) => line.includes("login_response_ready"));
  assert(successIdx >= 0, "runtime: candidate_attempt_success logged on folder-first path");
  assert(
    responseReadyIdx < 0 || successIdx < responseReadyIdx || responseReadyIdx < 0,
    "runtime: success path has no diagnostic await before login_response_ready",
  );
  assert(
    !threeStalePlusFolderLines.some((line) => line.includes("users tab login diagnostics")),
    "runtime: success path skips failure diagnostics",
  );

  const capProbeLines = [];
  const capProbeEmail = "cap.probe@example.com";
  const staleSheetB = "1StaleSheetB000000000000000000000000000000";
  const capProbeMock = createMockUsersTabStore({
    [capProbeEmail]: {
      passwordHash: hashPassword(password),
      status: "ACTIVE",
      role: "Admin",
      name: "Cap Probe",
      companyFolderId,
      companyName: "Candidate Co",
      masterSheetId,
      blockSheets: [staleSheetId, masterSheetId, staleSheetB],
    },
  });
  const capProbeUserDeps = buildUserDeps(capProbeMock, companyFolderId, "Candidate Co");
  const capProbeStarted = Date.now();
  const capProbeLogin = await authenticateCompanyUserLogin(
    {},
    {
      getCompanyUsersDeps: () => capProbeUserDeps,
      findMasterSheetIdsForCompanyLoginEmail: () => [staleSheetId, masterSheetId, staleSheetB],
      loginTiming: {
        logPhase(phase, _startMs, meta = {}) {
          capProbeLines.push(`${phase} ${JSON.stringify(meta)}`);
        },
      },
    },
    { email: capProbeEmail, password: "WrongPassword-2026!", masterSheetId: staleSheetId },
  );
  const capProbeElapsed = Date.now() - capProbeStarted;
  assert(capProbeLogin.ok === false, "runtime: global cap probe login fails as expected");
  assert(
    capProbeElapsed < LOGIN_AUTH_TOTAL_CAP_MS + 1500,
    `runtime: global cap stops candidate loop (${capProbeElapsed}ms)`,
  );
  assert(
    capProbeLines.some((line) => line.includes("global_auth_cap")),
    "runtime: global_auth_cap logged when deadline reached",
  );
} finally {
  console.info = originalInfo;
}

for (const line of timingLines) {
  assert(!/passwordhash|\"password\"|token|secret|cookie/i.test(line), `runtime: timing logs stay secret-safe (${line})`);
}

console.log(`[verify:login-candidate-order] OK — ${caseCount} cases passed`);
