#!/usr/bin/env node
/**
 * Login timing diagnostics — helpers stay secret-safe; login response contract unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOGIN_TIMING_PREFIX,
  createLoginTimingTrace,
  logLoginTimingMark,
  logLoginTimingPhase,
  safeLoginTimingMeta,
} from "../server/login-timing.mjs";
import { buildCompanySessionApiResponse } from "../server/auth-service.mjs";

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

const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["verify:login-timing-diagnostics"], "PKG: npm script registered");

const loginTimingModule = read("server/login-timing.mjs");
const authService = read("server/auth-service.mjs");
const userAuth = read("server/user-auth-service.mjs");
const serverMain = read("server/server.mjs");
const appTsx = read("App.tsx");
const clientTiming = read("src/utils/loginTiming.ts");

assert(loginTimingModule.includes("safeLoginTimingMeta"), "static: safeLoginTimingMeta exported");
assert(loginTimingModule.includes(LOGIN_TIMING_PREFIX), "static: login timing prefix constant");
assert(authService.includes("login-timing.mjs"), "static: auth-service uses login-timing module");
assert(userAuth.includes("login-timing.mjs"), "static: user-auth-service uses login-timing module");
assert(serverMain.includes("login-timing.mjs"), "static: server route uses login-timing module");
assert(appTsx.includes("loginTiming"), "static: App.tsx uses client login timing");
assert(clientTiming.includes(LOGIN_TIMING_PREFIX), "static: client timing prefix");

const forbiddenLogPatterns = [
  /logLoginTimingPhase\([^)]*password/i,
  /logClientLoginTiming\([^)]*password/i,
  /console\.log\([^)]*passwordHash/i,
];
for (const pattern of forbiddenLogPatterns) {
  assert(
    !pattern.test(authService) && !pattern.test(userAuth) && !pattern.test(serverMain) && !pattern.test(appTsx),
    `static: no sensitive values in timing log calls (${pattern})`,
  );
}

const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);
const successResponseKeys = ["ok: true", "user:", "company:", "timingMs:"];
for (const key of successResponseKeys) {
  assert(companyLoginBlock.includes(key), `static: company login success response still includes ${key}`);
}

const sessionResponse = buildCompanySessionApiResponse({
  email: "diag@usebert.co.uk",
  companyFolderId: "folder-abc",
  companyId: "folder-abc",
  companyName: "Diag Co",
  masterSheetId: "sheet-abc",
  role: "Admin",
  name: "Diag User",
});
assert(sessionResponse.ok === true, "static: buildCompanySessionApiResponse ok");
assert(!Object.prototype.hasOwnProperty.call(sessionResponse, "PasswordHash"), "static: session API omits PasswordHash");
assert(!JSON.stringify(sessionResponse).match(/passwordhash/i), "static: session API JSON has no passwordhash keys");

const blockedMeta = safeLoginTimingMeta({
  email: "safe@usebert.co.uk",
  password: "secret-plain",
  passwordHash: "secret-hash",
  token: "secret-token",
  cookie: "secret-cookie",
  companyFolderId: "folder-1",
});
assert(blockedMeta.email === "safe@usebert.co.uk", "safe meta keeps email");
assert(blockedMeta.companyFolderId === "folder-1", "safe meta keeps companyFolderId");
assert(!("password" in blockedMeta), "safe meta strips password");
assert(!("passwordHash" in blockedMeta), "safe meta strips passwordHash");
assert(!("token" in blockedMeta), "safe meta strips token");
assert(!("cookie" in blockedMeta), "safe meta strips cookie");

const captured = [];
const originalInfo = console.info;
console.info = (...args) => {
  captured.push(args.map((part) => String(part)).join(" "));
};
try {
  logLoginTimingPhase("password_check", Date.now() - 5, {
    email: "safe@usebert.co.uk",
    password: "must-not-appear",
    passwordHash: "must-not-appear",
  });
  const trace = createLoginTimingTrace({ route: "verify" });
  trace.logPhase("users_tab_read", Date.now() - 5, { token: "hidden", masterSheetId: "sheet-1" });
  logLoginTimingMark("total_login_duration", { durationMs: trace.totalMs(), ok: true });
} finally {
  console.info = originalInfo;
}

for (const line of captured) {
  assert(!/password=|passwordHash=|\"password\":/i.test(line), `runtime: timing log must not leak password values (${line})`);
  assert(!/passwordhash/i.test(line) || /password_check/.test(line), `runtime: timing log must not include passwordHash (${line})`);
  assert(!/\"token\":/i.test(line), `runtime: timing log must not include token (${line})`);
  assert(line.includes(LOGIN_TIMING_PREFIX), `runtime: timing line uses prefix (${line})`);
}
assert(captured.some((line) => line.includes("users_tab_read")), "runtime: users_tab_read logged");
assert(captured.some((line) => line.includes("total_login_duration")), "runtime: total_login_duration logged");

const requiredServerPhases = [
  "route_entered",
  "request_parsed",
  "email_normalised",
  "platform_auth_check",
  "collect_login_candidates",
  "folder_company_resolve",
  "users_tab_auth_start",
  "users_tab_auth_end",
  "users_tab_read",
  "password_check",
  "company_context_load_start",
  "company_context_load_end",
  "session_create_start",
  "session_create_end",
  "background_jobs_queued_start",
  "background_jobs_queued_end",
  "response_sent",
  "total_login_duration",
];
for (const phase of requiredServerPhases) {
  const inServer =
    serverMain.includes(`"${phase}"`) ||
    authService.includes(`"${phase}"`) ||
    userAuth.includes(`"${phase}"`);
  assert(inServer, `static: server logs phase ${phase}`);
}

const requiredClientPhases = [
  "login_button_clicked",
  "login_request_started",
  "login_response_received",
  "app_state_set",
  "dashboard_things_to_do_loading_started",
  "dashboard_things_to_do_loading_finished",
];
for (const phase of requiredClientPhases) {
  assert(
    appTsx.includes(`"${phase}"`) || clientTiming.includes(`"${phase}"`),
    `static: client logs phase ${phase}`,
  );
}

console.log(`[verify:login-timing-diagnostics] OK — ${caseCount} cases passed`);
