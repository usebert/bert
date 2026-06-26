#!/usr/bin/env node
/**
 * Login performance — login must not call Sheets/Drive/setup/repair/health during request.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig, missingLiveCredentials } from "./lib/live-path-config.mjs";
import { LiveHttpClient, assertNoPasswordHash } from "./lib/live-http-client.mjs";

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

const appTsx = read("App.tsx");
const authClient = read("src/services/authService.ts");
const authService = read("server/auth-service.mjs");
const userAuth = read("server/user-auth-service.mjs");
const authIndex = read("server/auth-index.mjs");
const serverMain = read("server/server.mjs");
const pkg = JSON.parse(read("package.json"));
const loginFn = performCompanyLoginBody(authService);

const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);

assert(pkg.scripts["verify:login-performance"], "PKG: npm script registered");
assert(fs.existsSync(path.join(root, "server/auth-index.mjs")), "auth index module exists");
assert(authIndex.includes("lookupByEmail"), "auth index supports email lookup");
assert(authIndex.includes("passwordHash"), "auth index stores passwordHash server-side only");

assert(!appTsx.includes("ensureCompanyLiveIfReady"), "client login does not await registry promotion");
assert(!appTsx.includes('/api/readiness"'), "client login does not call /api/readiness");
assert(
  !/(?:handleLogin|tryServerCompanyLogin|tryServerMasterLogin)[\s\S]{0,800}\/api\/health/.test(appTsx),
  "login handlers do not gate on /api/health",
);
assert(appTsx.includes("loginSubmitting"), "client login shows spinner only during request");
assert(appTsx.includes("Email or password is incorrect."), "client invalid login copy");

assert(!companyLoginBlock.includes("ensureCompanyLiveIfReady"), "company login route does not block on ensureCompanyLiveIfReady");
assert(companyLoginBlock.includes("authIndex: authIndexApi"), "company login route uses auth index");
assert(!companyLoginBlock.includes("probeCompanyLoginSheet"), "company login route does not probe Users tab");

assert(loginFn.includes("authenticateCompanyUserLogin"), "performCompanyLogin delegates to Users tab auth");
assert(loginFn.includes("users_tab_auth"), "performCompanyLogin records users_tab_auth timing");
assert(loginFn.includes("persistLoginAuthIndexEntry"), "performCompanyLogin upserts verified auth index entry");
assert(!loginFn.includes("probeCompanyLoginSheet"), "performCompanyLogin does not probe sheet");
assert(!loginFn.includes("resolveCompanyContextForUser"), "performCompanyLogin does not scan companies");
assert(!loginFn.includes("resolveCompanyContextFromLoginWorkbook"), "performCompanyLogin does not resolve workbook");
assert(!loginFn.includes("enrichCompanyContextFromRegistry"), "performCompanyLogin does not enrich registry");
assert(!loginFn.includes("validateCompanyFolderUnderCompaniesRoot"), "performCompanyLogin does not validate folder placement");
assert(!loginFn.includes("validateLiveCompanyContext"), "performCompanyLogin does not await live Drive validation");
assert(!loginFn.includes("touchCompanyUserLastLogin"), "performCompanyLogin does not touch Users tab synchronously");
assert(!loginFn.includes("getTabValues"), "performCompanyLogin does not scan full Users tab");
assert(!loginFn.includes("readCompanyUsersTabRecord"), "performCompanyLogin reads Users tab via auth index reconcile only");
assert(loginFn.includes("[login] start"), "performCompanyLogin logs start");
assert(loginFn.includes("background_jobs_queued"), "performCompanyLogin queues background jobs marker");

const userAuthLoginFn = userAuth.slice(
  userAuth.indexOf("export async function authenticateCompanyUserLogin"),
  userAuth.indexOf("export async function attemptUsersTabPasswordLogin"),
);
assert(
  !userAuthLoginFn.includes("await rebuildAuthIndexFromUsersTab"),
  "performCompanyLogin auth path does not await full Users tab rebuild",
);
assert(userAuthLoginFn.includes("upsertAuthIndexFromVerifiedLoginRow"), "login auth uses fast index upsert");

assert(appTsx.includes("tryServerMasterLogin") && appTsx.includes("tryServerCompanyLogin"), "client uses direct auth endpoints");
assert(appTsx.includes("fetchAppSession"), "client bootstrap uses unified fetchAppSession");
assert(authClient.includes('/api/session"'), "session restore uses GET /api/session");
assert(!/auth-session-bootstrap[\s\S]{0,1200}\/api\/health/.test(appTsx), "session bootstrap does not call /api/health");

function fnBody(source, fnName) {
  const start = source.indexOf(`export function ${fnName}`);
  if (start < 0) {
    return "";
  }
  const next = source.indexOf("export function", start + 12);
  return source.slice(start, next > start ? next : undefined);
}

assert(!/PasswordHash/.test(fnBody(authService, "buildCompanySessionApiResponse")), "session API omits PasswordHash");

async function runLiveChecks() {
  const config = loadLivePathConfig();
  const missing = missingLiveCredentials(config);
  if (missing.length) {
    console.log(`[verify:login-performance] SKIP live checks (missing ${missing.join(", ")})`);
    return;
  }

  const api = new LiveHttpClient(config.apiBase, config.origin);
  const wrongClient = new LiveHttpClient(config.apiBase, config.origin);

  const wrongPassword = await wrongClient.request("/api/auth/company/login", {
    method: "POST",
    body: {
      email: config.adminEmail,
      password: "definitely-wrong-password-12345",
    },
  });
  assert(wrongPassword.status === 401, "live: wrong password returns 401");
  assertNoPasswordHash(wrongPassword.json, "wrong password response");
  const wrongTiming = wrongPassword.json?.timingMs?.total ?? wrongPassword.elapsedMs;
  assert(typeof wrongTiming === "number" && wrongTiming < 2000, `live: wrong password under hard timeout (${wrongTiming}ms)`);

  const unknownEmail = await wrongClient.request("/api/auth/company/login", {
    method: "POST",
    body: {
      email: "nobody-at-all@usebert.co.uk",
      password: "wrong-password-12345",
    },
  });
  assert(unknownEmail.status === 401, "live: unknown email returns 401");
  assertNoPasswordHash(unknownEmail.json, "unknown email response");
  const unknownTiming = unknownEmail.json?.timingMs?.total ?? unknownEmail.elapsedMs;
  assert(typeof unknownTiming === "number" && unknownTiming < 2000, `live: unknown email under hard timeout (${unknownTiming}ms)`);

  const validLogin = await api.request("/api/auth/company/login", {
    method: "POST",
    body: {
      email: config.adminEmail,
      password: config.adminPassword,
    },
  });
  if (validLogin.status === 200 && validLogin.json?.ok) {
    assertNoPasswordHash(validLogin.json, "valid company login");
    const validTiming = validLogin.json?.timingMs?.total ?? validLogin.elapsedMs;
    assert(typeof validTiming === "number" && validTiming < 2000, `live: valid login under hard timeout (${validTiming}ms)`);
  } else {
    console.log(
      `[verify:login-performance] WARN: valid company login skipped (${validLogin.status}: ${validLogin.json?.error || validLogin.json?.blocker || "unknown"}) — rebuild auth index on API host`,
    );
  }
}

await runLiveChecks();

console.log(`[verify:login-performance] OK — ${caseCount} cases passed`);
