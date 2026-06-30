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
  safeLoginRequestHintMeta,
  safeLoginTimingMeta,
} from "../server/login-timing.mjs";
import {
  API_TIMING_PREFIX,
  attachApiRouteTimingFinish,
  createApiTimingTrace,
} from "../server/api-timing.mjs";
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
const apiTimingModule = read("server/api-timing.mjs");
const coreWorkflowRoutes = read("server/core-workflow-routes.mjs");
const authService = read("server/auth-service.mjs");
const userAuth = read("server/user-auth-service.mjs");
const serverMain = read("server/server.mjs");
const appTsx = read("App.tsx");
const clientTiming = read("src/utils/loginTiming.ts");

assert(loginTimingModule.includes("safeLoginTimingMeta"), "static: safeLoginTimingMeta exported");
assert(apiTimingModule.includes("safeLoginTimingMeta"), "static: api-timing reuses safeLoginTimingMeta");
assert(apiTimingModule.includes(API_TIMING_PREFIX), "static: api timing prefix constant");
assert(coreWorkflowRoutes.includes("api-timing.mjs"), "static: core-workflow-routes uses api-timing module");
assert(coreWorkflowRoutes.includes('beginTrackedApiRoute(req, res, "users")'), "static: users route has api timing");
assert(coreWorkflowRoutes.includes('beginTrackedApiRoute(req, res, "schedule-assignees")'), "static: schedule-assignees route has api timing");
assert(coreWorkflowRoutes.includes('beginTrackedApiRoute(req, res, "assigned-checks")'), "static: assigned-checks route has api timing");
assert(coreWorkflowRoutes.includes('beginTrackedApiRoute(req, res, "results")'), "static: results route has api timing");
assert(coreWorkflowRoutes.includes('beginTrackedApiRoute(req, res, "google-forms")'), "static: google-forms route has api timing");
assert(serverMain.includes('createApiTimingTrace({ route: "app-invites" })'), "static: app-invites route has api timing");
assert(loginTimingModule.includes("safeLoginRequestHintMeta"), "static: safeLoginRequestHintMeta exported");
assert(loginTimingModule.includes(LOGIN_TIMING_PREFIX), "static: login timing prefix constant");
assert(authService.includes("login-timing.mjs"), "static: auth-service uses login-timing module");
assert(userAuth.includes("login-timing.mjs"), "static: user-auth-service uses login-timing module");
assert(serverMain.includes("login-timing.mjs"), "static: server route uses login-timing module");
assert(appTsx.includes("loginTiming"), "static: App.tsx uses client login timing");
assert(clientTiming.includes(LOGIN_TIMING_PREFIX), "static: client timing prefix");

const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);

const forbiddenLogPatterns = [
  /logLoginTimingPhase\([^)]*password/i,
  /logClientLoginTiming\([^)]*password/i,
  /console\.log\([^)]*passwordHash/i,
  /login_request_hints[^)]*req\.body\?\.password/i,
  /safeLoginRequestHintMeta\([^)]*password/i,
];
for (const pattern of forbiddenLogPatterns) {
  assert(
    !pattern.test(authService) && !pattern.test(userAuth) && !pattern.test(serverMain) && !pattern.test(appTsx),
    `static: no sensitive values in timing log calls (${pattern})`,
  );
}

assert(companyLoginBlock.includes("login_request_hints"), "static: route logs login_request_hints phase");
assert(companyLoginBlock.includes("safeLoginRequestHintMeta"), "static: route uses safeLoginRequestHintMeta");
assert(authService.includes("company_login_input_hints"), "static: auth-service logs company_login_input_hints");
assert(authService.includes("explicitFolderFirst"), "static: auth-service logs explicitFolderFirst");
assert(authService.includes("companyFolderIdSource"), "static: auth-service logs companyFolderIdSource");
assert(userAuth.includes("login_resolution_diagnostics"), "static: user-auth logs login_resolution_diagnostics");
assert(userAuth.includes("resolveLoginCompanyFolderIdSource"), "static: user-auth resolves companyFolderIdSource");
assert(userAuth.includes("attemptCount"), "static: user-auth logs attemptCount");
assert(userAuth.includes("candidateOrder"), "static: user-auth logs candidateOrder");

const hintMeta = safeLoginRequestHintMeta({
  email: "hint@usebert.co.uk",
  password: "must-not-appear",
  passwordHash: "must-not-appear",
  companyFolderId: "folder-1",
  companyId: "folder-1",
  masterSheetId: "sheet-1",
  token: "secret-token",
  cookie: "secret-cookie",
});
assert(hintMeta.hasCompanyFolderId === true, "hint meta: hasCompanyFolderId");
assert(hintMeta.hasCompanyId === true, "hint meta: hasCompanyId");
assert(hintMeta.hasMasterSheetId === true, "hint meta: hasMasterSheetId");
assert(hintMeta.requestHintKeys.includes("email"), "hint meta: requestHintKeys includes email");
assert(hintMeta.requestHintKeys.includes("companyFolderId"), "hint meta: requestHintKeys includes companyFolderId");
assert(!hintMeta.requestHintKeys.includes("password"), "hint meta: requestHintKeys omits password");
assert(!("password" in hintMeta), "hint meta: omits password value");
assert(!("passwordHash" in hintMeta), "hint meta: omits passwordHash value");
assert(!("token" in hintMeta), "hint meta: omits token value");
assert(!("cookie" in hintMeta), "hint meta: omits cookie value");
assert(
  !JSON.stringify(hintMeta).match(/must-not-appear|secret-token|secret-cookie/i),
  "hint meta: JSON has no secret values",
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
  "login_request_hints",
  "request_parsed",
  "email_normalised",
  "platform_auth_check",
  "collect_login_candidates",
  "login_resolution_diagnostics",
  "company_login_input_hints",
  "candidate_attempt_start",
  "candidate_attempt_timeout",
  "candidate_attempt_skipped",
  "candidate_attempt_success",
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
  "login_response_ready",
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

const requiredApiPhases = ["route_entered", "response_sent", "total_duration"];
for (const phase of requiredApiPhases) {
  assert(
    apiTimingModule.includes(`"${phase}"`) ||
      coreWorkflowRoutes.includes(`"${phase}"`) ||
      serverMain.includes(`"${phase}"`),
    `static: api timing logs phase ${phase}`,
  );
}

const apiCaptured = [];
console.info = (...args) => {
  apiCaptured.push(args.map((part) => String(part)).join(" "));
};
try {
  const finishHandlers = [];
  const mockRes = {
    headersSent: false,
    writableEnded: false,
    on(event, handler) {
      if (event === "finish") {
        finishHandlers.push(handler);
      }
    },
  };
  const apiTrace = createApiTimingTrace({ route: "verify-api" });
  apiTrace.mark("route_entered");
  attachApiRouteTimingFinish(mockRes, apiTrace, { ok: true });
  for (const handler of finishHandlers) {
    handler();
  }
} finally {
  console.info = originalInfo;
}

for (const line of apiCaptured) {
  assert(line.includes(API_TIMING_PREFIX), `runtime: api timing line uses prefix (${line})`);
  assert(!/password=|passwordHash=|\"password\":/i.test(line), `runtime: api timing must not leak password (${line})`);
  assert(!/\"token\":/i.test(line), `runtime: api timing must not include token (${line})`);
}
assert(apiCaptured.some((line) => line.includes("route_entered")), "runtime: api route_entered logged");
assert(apiCaptured.some((line) => line.includes("response_sent")), "runtime: api response_sent logged");
assert(apiCaptured.some((line) => line.includes("total_duration")), "runtime: api total_duration logged");

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
