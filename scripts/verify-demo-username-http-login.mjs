#!/usr/bin/env node
/**
 * Verify demo username/email login via the same HTTP route shape as the browser:
 * POST /api/auth/company/login with { username|email, password, companyFolderId? }.
 *
 * Unlike verify:demo-username-logins (helper path), this spins a local HTTP handler that
 * uses buildCompanyLoginInputFromRequestBody + performCompanyLogin — the same wiring as
 * server/server.mjs — then POSTs browser-shaped JSON bodies.
 *
 * Asserts successful username logins return the real Users tab email, never the username.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   npm run verify:demo-username-http-login
 *
 * Optional live API probe (after deploy):
 *   BERT_VERIFY_API_BASE=https://api.usebert.co.uk npm run verify:demo-username-http-login
 */
import dotenv from "dotenv";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SHARED_PASSWORD,
  DEMO_COMPANY_WORKBOOK_ENV,
  demoEmail,
  demoUsername,
} from "../shared/demo-company-seed.mjs";
import {
  buildCompanyLoginInputFromRequestBody,
  pickLoginIdentityFromBody,
} from "../shared/login-username.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import { getTabValues, ensureTabColumns } from "../server/workbook-service.mjs";
import {
  readCanonicalCompanyWorkspaceRegistryMap,
  getCanonicalCompanyRegistryRecord,
} from "../server/company-workspace-registry.mjs";
import {
  readCompanyUsersTabRecord,
  findCompanyUsersTabRow,
  writeUsersTabRecordByHeaders,
} from "../server/company-users.mjs";
import { performCompanyLogin } from "../server/auth-service.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { resolveCompanyFromFolder } from "../server/company-folder-resolver.mjs";
import { LiveHttpClient } from "./lib/live-http-client.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();
const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const password = String(process.env.DEMO_LOGIN_PASSWORD || DEMO_COMPANY_SHARED_PASSWORD);
const liveApiBase = String(process.env.BERT_VERIFY_API_BASE || "").trim().replace(/\/$/, "");

const CASES = [
  {
    label: "email bert.demo+joe.jones",
    bodyKey: "email",
    identity: demoEmail("joe.jones"),
    expectedEmail: demoEmail("joe.jones"),
    withFolder: true,
    expectOk: true,
  },
  {
    label: "username joe.jones",
    bodyKey: "username",
    identity: demoUsername("joe.jones"),
    expectedEmail: demoEmail("joe.jones"),
    withFolder: true,
    expectOk: true,
  },
  {
    label: "username terry.terinson",
    bodyKey: "username",
    identity: demoUsername("terry.terinson"),
    expectedEmail: demoEmail("terry.terinson"),
    withFolder: true,
    expectOk: true,
  },
  {
    label: "username mr.important",
    bodyKey: "username",
    identity: demoUsername("mr.important"),
    expectedEmail: demoEmail("mr.important"),
    withFolder: true,
    expectOk: true,
  },
  {
    label: "username joe.jones wrong password",
    bodyKey: "username",
    identity: demoUsername("joe.jones"),
    expectedEmail: "",
    withFolder: true,
    expectOk: false,
    passwordOverride: "WrongPassword!!!",
  },
  {
    label: "username joe.jones cold (no folder)",
    bodyKey: "username",
    identity: demoUsername("joe.jones"),
    expectedEmail: demoEmail("joe.jones"),
    withFolder: false,
    expectOk: true,
  },
];

function fail(message) {
  console.error(`[verify:demo-username-http-login] FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function loadGoogleAuth() {
  const sessionCandidates = [
    path.join(sessionsRoot, "google-oauth-token.json"),
    path.join(sessionsRoot, "google-session.json"),
    path.join(root, ".sessions", "google-session.json"),
    path.join(root, ".data", "google-oauth.json"),
  ];
  const sessionPath = sessionCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sessionPath) {
    throw new Error("Missing Google OAuth token — connect Google first (npm run google:connect).");
  }
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(session.tokens || session);
  return auth;
}

function buildDeps(authIndex) {
  const deps = {
    google,
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID || "",
    platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
    sessionDir: sessionsRoot,
    getCanonicalCompanyRegistryRecord,
    readCanonicalCompanyWorkspaceRegistryMap,
    isCompanyRegistryLive,
  };

  deps.getTabValues = (auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab) => {
    if (maybeDepsOrSheetId && typeof maybeDepsOrSheetId === "object" && maybeDepsOrSheetId.google) {
      return getTabValues(auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab);
    }
    return getTabValues(auth, deps, maybeDepsOrSheetId, maybeSheetIdOrTab);
  };
  deps.ensureColumns = (auth, spreadsheetId, tab, columns) =>
    ensureTabColumns(auth, deps, spreadsheetId, tab, columns);

  const noopMigrate = async () => ({ ok: true, addedColumns: [], backfilled: 0 });
  const userDeps = {
    ...deps,
    getConfig: async () => ({}),
    updateConfig: async () => ({}),
    readCompanyUsersTabRecord,
    findCompanyUsersTabRow,
    migrateUsersTabColumns: noopMigrate,
    writeUsersTabRecordByHeaders,
  };

  return {
    ...deps,
    authIndex,
    getCompanyUsersDeps: () => userDeps,
    findMasterSheetIdsForCompanyLoginEmail: () => [],
    migrateUsersTabColumns: noopMigrate,
    readCompanyUsersTabRecord,
    resolveCompanyFromFolder,
    getCompanyResolverDeps: () => deps,
  };
}

function assertRouteContract() {
  const serverMain = fs.readFileSync(path.join(root, "server/server.mjs"), "utf8");
  const authService = fs.readFileSync(path.join(root, "server/auth-service.mjs"), "utf8");
  const userAuth = fs.readFileSync(path.join(root, "server/user-auth-service.mjs"), "utf8");
  const appTsx = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
  const loginRouteStart = serverMain.indexOf('app.post("/api/auth/company/login"');
  assert(loginRouteStart >= 0, "company login route missing");
  const loginRoute = serverMain.slice(loginRouteStart, loginRouteStart + 3500);
  assert(loginRoute.includes("buildCompanyLoginInputFromRequestBody"), "route must use buildCompanyLoginInputFromRequestBody");
  assert(loginRoute.includes("loginInput"), "route must pass loginInput to performCompanyLogin");
  assert(authService.includes("authResult.email"), "performCompanyLogin must use resolved authResult.email");
  assert(authService.includes('email.includes("@")'), "session must reject non-email identities");
  assert(userAuth.includes("users_tab_username") || userAuth.includes("companyScopedMatchCount"), "Users tab username resolve required");
  assert(appTsx.includes('get("companyFolderId")'), "App must read URL companyFolderId for login");
  assert(
    pickLoginIdentityFromBody({ email: "joe.jones", username: "joe.jones" }) === "joe.jones",
    "pickLoginIdentityFromBody treats non-email email field as username",
  );
  assert(
    buildCompanyLoginInputFromRequestBody({ username: "joe.jones", email: "joe.jones", password: "x" }).username ===
      "joe.jones",
    "route input sets username for non-email identity",
  );
  assert(
    buildCompanyLoginInputFromRequestBody({ username: "joe.jones", email: "joe.jones", password: "x" }).email === "",
    "route input must not keep username in email field",
  );
  console.log("[verify:demo-username-http-login] OK: route/client contract");
}

function startLocalLoginHttp(auth, loginDeps) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/auth/company/login") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      body = {};
    }
    const loginInput = buildCompanyLoginInputFromRequestBody(body, "");
    try {
      const result = await performCompanyLogin(auth, loginDeps, loginInput);
      const status = result.ok ? 200 : result.httpStatus || 401;
      res.writeHead(status, { "Content-Type": "application/json" });
      if (result.ok) {
        res.end(
          JSON.stringify({
            ok: true,
            user: result.user,
            company: result.company,
            email: result.email,
            masterSheetId: result.masterSheetId,
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          ok: false,
          code: result.code,
          blocker: result.blocker,
          error: result.error || result.message,
          message: result.message || result.error,
        }),
      );
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

function evaluateCase(testCase, response) {
  const sessionEmail = String(response.json?.user?.email || response.json?.email || "")
    .trim()
    .toLowerCase();
  if (!testCase.expectOk) {
    const failed = response.status >= 400 || response.json?.ok === false;
    const usernameLeaked = sessionEmail === String(testCase.identity || "").toLowerCase();
    return {
      ok: failed && !usernameLeaked,
      email: sessionEmail,
      error: failed ? "" : "expected failure but login succeeded",
    };
  }
  const ok =
    response.status === 200 &&
    response.json?.ok === true &&
    sessionEmail === String(testCase.expectedEmail || "").toLowerCase() &&
    sessionEmail.includes("@");
  return {
    ok,
    email: sessionEmail,
    error: ok
      ? ""
      : response.json?.error ||
        response.json?.message ||
        (sessionEmail && sessionEmail !== testCase.expectedEmail
          ? `session email=${sessionEmail} expected=${testCase.expectedEmail}`
          : response.text?.slice(0, 120) || "login failed"),
  };
}

async function runCasesAgainstBase(baseUrl, origin) {
  const rows = [];
  for (const testCase of CASES) {
    const client = new LiveHttpClient(baseUrl, origin || baseUrl);
    const body = {
      [testCase.bodyKey]: testCase.identity,
      password: testCase.passwordOverride || password,
      ...(testCase.withFolder ? { companyFolderId, masterSheetId } : {}),
    };
    const response = await client.request("/api/auth/company/login", { method: "POST", body });
    const result = evaluateCase(testCase, response);
    rows.push({
      label: testCase.label,
      status: response.status,
      ok: result.ok ? "PASS" : "FAIL",
      email: result.email || "",
      error: result.error,
    });
    if (!result.ok) {
      console.error(`[verify:demo-username-http-login] case failed: ${testCase.label}`, {
        status: response.status,
        json: response.json,
        expectedEmail: testCase.expectedEmail,
      });
    }
  }
  return rows;
}

async function main() {
  assertRouteContract();

  if (confirm !== "yes") {
    fail(`Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run live Google login checks.`);
  }
  if (!companyFolderId || !masterSheetId) {
    fail(`Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV}.`);
  }

  const auth = loadGoogleAuth();
  const authIndexPath = path.join(sessionsRoot, "auth-index-demo-username-http-login.json");
  if (fs.existsSync(authIndexPath)) {
    fs.unlinkSync(authIndexPath);
  }
  // Seed a poisoned username alias (email = username). Company-scoped resolve must ignore it
  // and still return the real Users tab email.
  fs.writeFileSync(
    authIndexPath,
    JSON.stringify(
      {
        version: 1,
        byEmail: {},
        byUsername: {
          "joe.jones": { email: "joe.jones", companyFolderId },
        },
        rebuiltAt: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  const authIndex = createAuthIndexApi(authIndexPath);
  const loginDeps = buildDeps(authIndex);
  const { server, baseUrl } = await startLocalLoginHttp(auth, loginDeps);

  try {
    console.log(`[verify:demo-username-http-login] local HTTP ${baseUrl}/api/auth/company/login`);
    const localRows = await runCasesAgainstBase(baseUrl, baseUrl);
    for (const row of localRows) {
      console.log(`  ${row.ok}  ${row.label}  status=${row.status}  email=${row.email || "-"} ${row.error ? `err=${row.error}` : ""}`);
    }
    const localFailed = localRows.filter((row) => row.ok !== "PASS");
    assert(localFailed.length === 0, `${localFailed.length} local HTTP login case(s) failed`);
    console.log("[verify:demo-username-http-login] OK: local HTTP login cases");

    if (liveApiBase) {
      console.log(`[verify:demo-username-http-login] probing live API ${liveApiBase}`);
      const liveRows = await runCasesAgainstBase(liveApiBase, "https://app.usebert.co.uk");
      for (const row of liveRows) {
        console.log(
          `  ${row.ok}  ${row.label}  status=${row.status}  email=${row.email || "-"} ${row.error ? `err=${row.error}` : ""}`,
        );
      }
      const liveFailed = liveRows.filter((row) => row.ok !== "PASS");
      if (liveFailed.length) {
        console.warn(
          `[verify:demo-username-http-login] WARN: ${liveFailed.length} live API case(s) failed (deploy may be behind local fix)`,
        );
      } else {
        console.log("[verify:demo-username-http-login] OK: live API login cases");
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("[verify:demo-username-http-login] Verdict: ALL HTTP USERNAME LOGINS PASS");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
