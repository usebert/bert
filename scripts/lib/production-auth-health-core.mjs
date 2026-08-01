/**
 * Production authentication health checks — shared by live verifier and unit tests.
 */
import { assertNoPasswordHash } from "./live-http-client.mjs";

export const COMPANY_SESSION_COOKIE = "bert_company_session";
export const PROBE_INVALID_PASSWORD = "__bert_smoke_invalid_password__";

export const CHECK_KEYS = [
  "apiHealth",
  "companyRegistry",
  "googleWorkbookAccess",
  "usersTab",
  "usernameResolution",
  "productionLogin",
  "sessionPersistence",
  "invalidPasswordRejected",
  "logout",
  "postLogoutRejection",
];

export const CHECK_LABELS = {
  apiHealth: "API Health",
  companyRegistry: "Company Registry",
  googleWorkbookAccess: "Google Workbook Access",
  usersTab: "Users Tab",
  usernameResolution: "Username Resolution",
  productionLogin: "Production Login",
  sessionPersistence: "Session Persistence",
  invalidPasswordRejected: "Invalid Password Rejected",
  logout: "Logout",
  postLogoutRejection: "Post-Logout Rejection",
};

const DEFAULT_TIMEOUT_MS = 120_000;

function trim(value) {
  return String(value ?? "").trim();
}

export function maskEmail(email = "") {
  const normalized = trim(email).toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0) {
    return normalized || "(unknown)";
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.length <= 2) {
    return `${local[0] || "*"}*@${domain}`;
  }
  if (local.includes("+")) {
    const [prefix, slug] = local.split("+", 2);
    const maskedSlug = slug.length <= 2 ? `${slug[0] || "*"}*` : `${slug.slice(0, 2)}***`;
    return `${prefix}+${maskedSlug}@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

export function loadSmokeConfig(env = process.env) {
  const username = trim(env.BERT_SMOKE_USERNAME);
  const password = trim(env.BERT_SMOKE_PASSWORD);
  const companyFolderId = trim(env.BERT_SMOKE_COMPANY_FOLDER_ID);
  const masterSheetId = trim(env.BERT_SMOKE_MASTER_SHEET_ID);
  const apiBase = trim(env.BERT_SMOKE_API_ORIGIN) || "https://api.usebert.co.uk";
  const appOrigin = trim(env.BERT_SMOKE_APP_ORIGIN) || "https://app.usebert.co.uk";
  const expectedEmail = trim(env.BERT_SMOKE_EXPECTED_EMAIL).toLowerCase();
  const expectedRole = trim(env.BERT_SMOKE_EXPECTED_ROLE) || "Admin";
  const timeoutMs = Number(env.BERT_SMOKE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const missing = [];
  if (!username) missing.push("BERT_SMOKE_USERNAME");
  if (!password) missing.push("BERT_SMOKE_PASSWORD");
  if (!companyFolderId) missing.push("BERT_SMOKE_COMPANY_FOLDER_ID");
  if (!masterSheetId) missing.push("BERT_SMOKE_MASTER_SHEET_ID");

  return {
    username,
    password,
    companyFolderId,
    masterSheetId,
    apiBase: apiBase.replace(/\/$/, ""),
    appOrigin: appOrigin.replace(/\/$/, ""),
    expectedEmail,
    expectedRole,
    timeoutMs,
    missing,
  };
}

export function buildLoginBody(config, passwordOverride) {
  return {
    username: config.username,
    password: passwordOverride ?? config.password,
    companyFolderId: config.companyFolderId,
    masterSheetId: config.masterSheetId,
  };
}

function hasSessionCookie(cookieJar = {}) {
  const value = cookieJar[COMPANY_SESSION_COOKIE];
  return Boolean(value && String(value).trim());
}

function cookieCleared(cookieJar = {}, previousValue = "") {
  const current = cookieJar[COMPANY_SESSION_COOKIE];
  if (!previousValue) {
    return !current;
  }
  return !current || current !== previousValue;
}

export function classifyProbeLoginFailure(json = {}) {
  const code = trim(json.code);
  const blocker = trim(json.blocker);
  const reasonCode = trim(json.reasonCode || json?.diagnostics?.reasonCode);
  if (code === "USER_NOT_FOUND" || blocker === "user_not_found") {
    return "user_not_found";
  }
  if (
    blocker === "ambiguous_users_tab_rows" ||
    code === "AMBIGUOUS_USERS_TAB_ROWS" ||
    json?.diagnostics?.reason === "username_ambiguous"
  ) {
    return "duplicate_username";
  }
  if (code === "INVALID_CREDENTIALS" || blocker === "invalid_credentials") {
    return "invalid_credentials";
  }
  if (blocker === "inactive" || code === "INACTIVE") {
    return "inactive";
  }
  if (blocker === "company_not_live" || reasonCode === "company_not_live") {
    return "company_not_live";
  }
  if (blocker === "google_not_connected" || reasonCode === "google_oauth_not_connected") {
    return "google_not_connected";
  }
  if (
    blocker === "company_context_invalid" ||
    code === "COMPANY_CONTEXT_INVALID" ||
    json?.companyContextValid === false
  ) {
    return "company_context_invalid";
  }
  if (reasonCode.includes("invalid_grant") || String(json?.diagnostics?.reason || "").includes("invalid_grant")) {
    return "invalid_grant";
  }
  return code || blocker || "unknown";
}

function assertResponseSafe(json, label) {
  assertNoPasswordHash(json, label);
  const raw = JSON.stringify(json || {});
  if (/scrypt\$|argon2\$|bcrypt\$/i.test(raw)) {
    throw new Error(`${label} appears to expose a password hash`);
  }
  if (/bert_company_session=/.test(raw)) {
    throw new Error(`${label} appears to expose a session cookie value`);
  }
}

export function formatReport(result) {
  const lines = [
    "========================================",
    "BERT Production Authentication Health",
    "========================================",
    "",
  ];

  for (const key of CHECK_KEYS) {
    const status = result.checks[key]?.status || "FAIL";
    const label = CHECK_LABELS[key];
    lines.push(`${label.padEnd(27)} ${status}`);
  }

  lines.push("");
  if (result.apiVersion) {
    lines.push(`API Version: ${result.apiVersion}`);
  }
  if (result.apiSha) {
    lines.push(`API SHA: ${result.apiSha}`);
  }
  if (result.accountEmail) {
    lines.push(`Account: ${maskEmail(result.accountEmail)}`);
  }
  if (result.role) {
    lines.push(`Role: ${result.role}`);
  }
  if (result.companyLabel) {
    lines.push(`Company: ${result.companyLabel}`);
  }
  lines.push("");

  if (result.ok) {
    lines.push("RESULT: READY FOR CUSTOMERS");
  } else {
    lines.push("RESULT: FAILED");
    lines.push("");
    lines.push("Failed stage:");
    lines.push(result.failedStage || CHECK_LABELS[result.failedKey] || "Unknown");
    lines.push("");
    lines.push("Reason:");
    lines.push(result.failureReason || "Unknown failure");
    if (result.remediation) {
      lines.push("");
      lines.push("Likely remediation:");
      lines.push(result.remediation);
    }
  }

  return lines.join("\n");
}

/**
 * @param {object} config
 * @param {{ request: Function, getCookies?: Function, clearCookies?: Function }} transport
 */
export async function runProductionAuthHealthChecks(config, transport) {
  const checks = Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }]));
  const result = {
    ok: false,
    checks,
    apiSha: "",
    apiVersion: "",
    shortSha: "",
    accountEmail: "",
    role: "",
    companyLabel: "",
    failedKey: "",
    failedStage: "",
    failureReason: "",
    remediation: "",
  };

  const fail = (key, reason, remediation = "") => {
    checks[key].status = "FAIL";
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    for (const other of CHECK_KEYS) {
      if (other !== key && checks[other].status === "PENDING") {
        checks[other].status = "SKIP";
      }
    }
    return result;
  };

  const pass = (key) => {
    checks[key].status = "PASS";
  };

  const request = transport.request;

  // A. API health
  let health;
  try {
    health = await request("GET", "/api/health");
  } catch (error) {
    return fail(
      "apiHealth",
      `Health endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
      "Confirm the API host is deployed and reachable from this network.",
    );
  }
  if (health.status !== 200 || health.json?.ok !== true) {
    return fail(
      "apiHealth",
      `Expected GET /api/health HTTP 200 with ok:true (got ${health.status}).`,
      "Redeploy the API service and confirm /api/health responds.",
    );
  }
  result.apiSha = trim(health.json?.gitSha);
  result.apiVersion = trim(health.json?.version);
  result.shortSha = trim(health.json?.shortSha) || (result.apiSha ? result.apiSha.slice(0, 7) : "");
  pass("apiHealth");

  // B. Google-backed company resolution
  if (health.json?.googleOAuthConnected !== true) {
    return fail(
      "companyRegistry",
      "API health reports Google OAuth is not connected.",
      "Reconnect Google OAuth on the production API host.",
    );
  }

  let authHealth;
  try {
    authHealth = await request(
      "GET",
      `/api/google/auth-health?spreadsheetId=${encodeURIComponent(config.masterSheetId)}`,
    );
  } catch (error) {
    return fail(
      "googleWorkbookAccess",
      `Google auth-health probe failed: ${error instanceof Error ? error.message : String(error)}`,
      "Reconnect Google OAuth on the production API host and verify workbook access.",
    );
  }

  assertResponseSafe(authHealth.json, "google auth-health");

  const sheetsProbe = authHealth.json?.sheetsProbe || {};
  if (authHealth.status !== 200 || authHealth.json?.ok !== true || sheetsProbe.ok !== true) {
    const reason = trim(sheetsProbe.reason || sheetsProbe.message || authHealth.json?.googleAuth?.reason);
    const remediation =
      reason === "invalid_grant"
        ? "Reconnect Google OAuth on the API host — refresh token is invalid or revoked."
        : "Verify BERT_SMOKE_MASTER_SHEET_ID and API Google credentials can read the company workbook.";
    return fail(
      "googleWorkbookAccess",
      reason === "invalid_grant"
        ? "Google OAuth invalid_grant during workbook probe."
        : `Workbook probe failed (${reason || `HTTP ${authHealth.status}`}).`,
      remediation,
    );
  }
  pass("googleWorkbookAccess");

  // Users tab + username resolution via non-destructive wrong-password probe
  let probe;
  try {
    probe = await request("POST", "/api/auth/company/login", buildLoginBody(config, PROBE_INVALID_PASSWORD));
  } catch (error) {
    return fail(
      "usersTab",
      `Username probe login failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect API logs for Google Sheets or auth-index errors during company login.",
    );
  }
  assertResponseSafe(probe.json, "username probe login");

  const probeOutcome = classifyProbeLoginFailure(probe.json);
  if (probeOutcome === "company_not_live") {
    return fail(
      "companyRegistry",
      "Company registry entry is not LIVE for the supplied CompanyFolderId.",
      "Run npm run register:demo-company (or company onboarding finalize) to mark the registry row LIVE.",
    );
  }
  if (probeOutcome === "company_context_invalid") {
    return fail(
      "companyRegistry",
      "Company folder/workbook context could not be resolved for the supplied CompanyFolderId.",
      "Register the company as LIVE in the platform registry and verify folder/workbook IDs.",
    );
  }
  if (probeOutcome === "google_not_connected") {
    return fail(
      "usersTab",
      "Login probe could not reach Google-backed Users tab (google_not_connected).",
      "Reconnect Google OAuth on the API host.",
    );
  }
  if (probeOutcome === "invalid_grant") {
    return fail(
      "usersTab",
      "Google OAuth invalid_grant while reading the Users tab.",
      "Reconnect Google OAuth on the API host.",
    );
  }
  if (probeOutcome === "user_not_found") {
    pass("companyRegistry");
    pass("usersTab");
    return fail(
      "usernameResolution",
      `Username "${config.username}" did not resolve to an active Users tab account.`,
      "Repair the Users tab Username column and rebuild the auth index for this account.",
    );
  }
  if (probeOutcome === "duplicate_username") {
    pass("companyRegistry");
    pass("usersTab");
    return fail(
      "usernameResolution",
      `Username "${config.username}" is ambiguous across multiple active accounts.`,
      "Remove duplicate Username values on the Users tab and rebuild the auth index.",
    );
  }
  if (probeOutcome === "inactive") {
    pass("companyRegistry");
    pass("usersTab");
    return fail(
      "usernameResolution",
      `Account for username "${config.username}" is not ACTIVE.`,
      "Set Status=ACTIVE on the Users tab row and rebuild the auth index.",
    );
  }
  if (probeOutcome !== "invalid_credentials") {
    pass("companyRegistry");
    return fail(
      "usersTab",
      `Unexpected probe login outcome: ${probeOutcome || probe.status}.`,
      "Inspect API login diagnostics for this username and company folder.",
    );
  }
  pass("companyRegistry");
  pass("usersTab");
  pass("usernameResolution");

  // D. Production login
  if (transport.clearCookies) {
    transport.clearCookies();
  }
  let login;
  try {
    login = await request("POST", "/api/auth/company/login", buildLoginBody(config));
  } catch (error) {
    return fail(
      "productionLogin",
      `Production login request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect API logs for the company login route.",
    );
  }
  assertResponseSafe(login.json, "production login");

  const cookies = transport.getCookies ? transport.getCookies() : {};
  if (login.status !== 200 || login.json?.ok !== true) {
    const outcome = classifyProbeLoginFailure(login.json);
    return fail(
      "productionLogin",
      `Login rejected (HTTP ${login.status}, outcome=${outcome}).`,
      outcome === "invalid_credentials"
        ? "Reset the smoke account password with npm run reset:demo-user-password if needed."
        : "Inspect company registry, Users tab, and API Google connectivity.",
    );
  }

  const sessionEmail = trim(login.json?.user?.email).toLowerCase();
  const sessionRole = trim(login.json?.user?.role);
  const sessionFolderId = trim(
    login.json?.company?.companyFolderId || login.json?.company?.companyId || login.json?.user?.companyFolderId,
  );
  const sessionCompanyName = trim(login.json?.company?.companyName);

  if (config.expectedEmail && sessionEmail !== config.expectedEmail) {
    return fail(
      "productionLogin",
      `Login email mismatch (got ${maskEmail(sessionEmail)}, expected ${maskEmail(config.expectedEmail)}).`,
      "Repair the Users tab Username/Email mapping and rebuild the auth index.",
    );
  }
  if (!sessionEmail.includes("@")) {
    return fail(
      "productionLogin",
      "Login response did not return a canonical email address.",
      "Inspect performCompanyLogin session payload shaping.",
    );
  }
  if (sessionFolderId !== config.companyFolderId) {
    return fail(
      "productionLogin",
      `Login companyFolderId mismatch (got ${sessionFolderId || "(blank)"}).`,
      "Verify BERT_SMOKE_COMPANY_FOLDER_ID matches the Users tab and registry row.",
    );
  }
  if (config.expectedRole && sessionRole !== config.expectedRole) {
    return fail(
      "productionLogin",
      `Login role mismatch (got ${sessionRole || "(blank)"}, expected ${config.expectedRole}).`,
      "Verify the Users tab Role column for the smoke account.",
    );
  }
  if (!hasSessionCookie(cookies)) {
    return fail(
      "productionLogin",
      `Login succeeded but no ${COMPANY_SESSION_COOKIE} cookie was issued.`,
      "Inspect session cookie settings (SESSION_SECRET, secure/sameSite) on the API host.",
    );
  }

  result.accountEmail = sessionEmail;
  result.role = sessionRole;
  result.companyLabel = sessionCompanyName || config.companyFolderId;
  pass("productionLogin");

  // E. Session persistence
  let session;
  try {
    session = await request("GET", "/api/auth/company/session");
  } catch (error) {
    return fail(
      "sessionPersistence",
      `Session endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/auth/company/session on the API host.",
    );
  }
  assertResponseSafe(session.json, "company session");
  if (session.status !== 200 || session.json?.ok !== true) {
    return fail(
      "sessionPersistence",
      `Authenticated session was not accepted (HTTP ${session.status}).`,
      "Inspect signed session cookies and company session validation on the API host.",
    );
  }
  const persistedEmail = trim(session.json?.user?.email).toLowerCase();
  const persistedRole = trim(session.json?.user?.role);
  const persistedFolder = trim(session.json?.company?.companyFolderId || session.json?.company?.companyId);
  if (persistedEmail !== sessionEmail) {
    return fail(
      "sessionPersistence",
      `Session email mismatch (got ${maskEmail(persistedEmail)}).`,
      "Inspect company session payload after login.",
    );
  }
  if (persistedRole !== sessionRole) {
    return fail(
      "sessionPersistence",
      `Session role mismatch (got ${persistedRole || "(blank)"}).`,
      "Inspect company session payload after login.",
    );
  }
  if (persistedFolder !== config.companyFolderId) {
    return fail(
      "sessionPersistence",
      `Session companyFolderId mismatch (got ${persistedFolder || "(blank)"}).`,
      "Inspect company context enrichment during session reads.",
    );
  }
  pass("sessionPersistence");

  // F. Invalid password rejection — isolated client preferred; clear cookies first
  const previousCookie = cookies[COMPANY_SESSION_COOKIE];
  if (transport.clearCookies) {
    transport.clearCookies();
  }
  let badLogin;
  try {
    badLogin = await request("POST", "/api/auth/company/login", buildLoginBody(config, PROBE_INVALID_PASSWORD));
  } catch (error) {
    return fail(
      "invalidPasswordRejected",
      `Invalid-password probe failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect login rejection handling on the API host.",
    );
  }
  assertResponseSafe(badLogin.json, "invalid password login");
  const badCookies = transport.getCookies ? transport.getCookies() : {};
  const badOutcome = classifyProbeLoginFailure(badLogin.json);
  if (badLogin.status < 400 || badLogin.json?.ok === true) {
    return fail(
      "invalidPasswordRejected",
      "Invalid password was not rejected.",
      "Inspect authenticateCompanyUserLogin password comparison.",
    );
  }
  if (badOutcome !== "invalid_credentials") {
    return fail(
      "invalidPasswordRejected",
      `Invalid password probe returned ${badOutcome} instead of invalid_credentials.`,
      "Confirm the smoke account still exists and password verification runs before session issue.",
    );
  }
  if (hasSessionCookie(badCookies)) {
    return fail(
      "invalidPasswordRejected",
      "Invalid password login issued a session cookie.",
      "Ensure failed logins never call res.cookie for company sessions.",
    );
  }
  pass("invalidPasswordRejected");

  // Restore valid session for logout checks
  if (transport.clearCookies) {
    transport.clearCookies();
  }
  let relogin;
  try {
    relogin = await request("POST", "/api/auth/company/login", buildLoginBody(config));
  } catch (error) {
    return fail(
      "logout",
      `Could not re-login before logout check: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect company login route stability.",
    );
  }
  if (relogin.status !== 200 || relogin.json?.ok !== true) {
    return fail("logout", "Re-login before logout check failed.", "Inspect company login route.");
  }
  const reloginCookies = transport.getCookies ? transport.getCookies() : {};
  if (!hasSessionCookie(reloginCookies)) {
    return fail(
      "logout",
      "Re-login before logout did not issue a session cookie.",
      "Inspect session cookie issuance.",
    );
  }

  // G. Logout
  let logout;
  try {
    logout = await request("POST", "/api/auth/company/logout");
  } catch (error) {
    return fail(
      "logout",
      `Logout request failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect POST /api/auth/company/logout on the API host.",
    );
  }
  assertResponseSafe(logout.json, "company logout");
  if (logout.status !== 200 || logout.json?.ok !== true) {
    return fail(
      "logout",
      `Logout did not return ok:true (HTTP ${logout.status}).`,
      "Inspect company logout route.",
    );
  }
  const afterLogoutCookies = transport.getCookies ? transport.getCookies() : {};
  if (!cookieCleared(afterLogoutCookies, reloginCookies[COMPANY_SESSION_COOKIE])) {
    return fail(
      "logout",
      "Logout did not clear or invalidate the company session cookie.",
      "Inspect clearCookie options on POST /api/auth/company/logout.",
    );
  }
  pass("logout");

  // H. Post-logout rejection
  let postLogoutSession;
  try {
    postLogoutSession = await request("GET", "/api/auth/company/session");
  } catch (error) {
    return fail(
      "postLogoutRejection",
      `Post-logout session check failed: ${error instanceof Error ? error.message : String(error)}`,
      "Inspect GET /api/auth/company/session after logout.",
    );
  }
  assertResponseSafe(postLogoutSession.json, "post-logout session");
  if (postLogoutSession.status < 400 || postLogoutSession.json?.ok === true) {
    return fail(
      "postLogoutRejection",
      "Session endpoint still accepts the logged-out cookie.",
      "Ensure logout clears the signed cookie and session validation rejects stale payloads.",
    );
  }
  pass("postLogoutRejection");

  result.ok = true;
  return result;
}

/**
 * Authenticate the smoke account only (login + session validation).
 * Reused by production audit workflow and other post-deploy verifiers.
 */
export async function performProductionSmokeLogin(config, transport) {
  if (transport.clearCookies) {
    transport.clearCookies();
  }

  let login;
  try {
    login = await transport.request("POST", "/api/auth/company/login", buildLoginBody(config));
  } catch (error) {
    return {
      ok: false,
      failureReason: `Production login request failed: ${error instanceof Error ? error.message : String(error)}`,
      remediation: "Inspect API logs for the company login route.",
      httpStatus: 0,
      responseBody: "",
    };
  }

  assertResponseSafe(login.json, "production login");
  const cookies = transport.getCookies ? transport.getCookies() : {};

  if (login.status !== 200 || login.json?.ok !== true) {
    const outcome = classifyProbeLoginFailure(login.json);
    return {
      ok: false,
      failureReason: `Login rejected (HTTP ${login.status}, outcome=${outcome}).`,
      remediation:
        outcome === "invalid_credentials"
          ? "Reset the smoke account password with npm run reset:demo-user-password if needed."
          : "Inspect company registry, Users tab, and API Google connectivity.",
      httpStatus: login.status,
      responseBody: login.json,
    };
  }

  const sessionEmail = trim(login.json?.user?.email).toLowerCase();
  const sessionRole = trim(login.json?.user?.role);
  const sessionFolderId = trim(
    login.json?.company?.companyFolderId || login.json?.company?.companyId || login.json?.user?.companyFolderId,
  );
  const sessionCompanyName = trim(login.json?.company?.companyName);
  const masterSheetId = trim(login.json?.masterSheetId || config.masterSheetId);

  if (config.expectedEmail && sessionEmail !== config.expectedEmail) {
    return {
      ok: false,
      failureReason: `Login email mismatch (got ${maskEmail(sessionEmail)}, expected ${maskEmail(config.expectedEmail)}).`,
      remediation: "Repair the Users tab Username/Email mapping and rebuild the auth index.",
      httpStatus: login.status,
      responseBody: login.json,
    };
  }
  if (!sessionEmail.includes("@")) {
    return {
      ok: false,
      failureReason: "Login response did not return a canonical email address.",
      remediation: "Inspect performCompanyLogin session payload shaping.",
      httpStatus: login.status,
      responseBody: login.json,
    };
  }
  if (sessionFolderId !== config.companyFolderId) {
    return {
      ok: false,
      failureReason: `Login companyFolderId mismatch (got ${sessionFolderId || "(blank)"}).`,
      remediation: "Verify BERT_SMOKE_COMPANY_FOLDER_ID matches the Users tab and registry row.",
      httpStatus: login.status,
      responseBody: login.json,
    };
  }
  if (config.expectedRole && sessionRole !== config.expectedRole) {
    return {
      ok: false,
      failureReason: `Login role mismatch (got ${sessionRole || "(blank)"}, expected ${config.expectedRole}).`,
      remediation: "Verify the Users tab Role column for the smoke account.",
      httpStatus: login.status,
      responseBody: login.json,
    };
  }
  if (!hasSessionCookie(cookies)) {
    return {
      ok: false,
      failureReason: `Login succeeded but no ${COMPANY_SESSION_COOKIE} cookie was issued.`,
      remediation: "Inspect session cookie settings (SESSION_SECRET, secure/sameSite) on the API host.",
      httpStatus: login.status,
      responseBody: login.json,
    };
  }

  let session;
  try {
    session = await transport.request("GET", "/api/auth/company/session");
  } catch (error) {
    return {
      ok: false,
      failureReason: `Session endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
      remediation: "Inspect GET /api/auth/company/session on the API host.",
      httpStatus: 0,
      responseBody: "",
    };
  }
  assertResponseSafe(session.json, "company session");
  if (session.status !== 200 || session.json?.ok !== true) {
    return {
      ok: false,
      failureReason: `Authenticated session was not accepted (HTTP ${session.status}).`,
      remediation: "Inspect signed session cookies and company session validation on the API host.",
      httpStatus: session.status,
      responseBody: session.json,
    };
  }

  return {
    ok: true,
    accountEmail: sessionEmail,
    role: sessionRole,
    companyLabel: sessionCompanyName || config.companyFolderId,
    companyFolderId: sessionFolderId,
    masterSheetId,
    user: login.json?.user || {},
    company: login.json?.company || {},
  };
}

export function createFetchTransport(apiBase, appOrigin, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const cookies = new Map();

  function absorbSetCookies(response) {
    const raw =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const part = String(line || "").split(";")[0];
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name) continue;
      if (!value) {
        cookies.delete(name);
      } else {
        cookies.set(name, value);
      }
    }
  }

  async function request(method, path, body, requestOptions = {}) {
    const url = path.startsWith("http") ? path : `${apiBase.replace(/\/$/, "")}${path}`;
    const controller = new AbortController();
    const effectiveTimeoutMs = Number(requestOptions.timeoutMs) || timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Origin: appOrigin,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookies.size ? { Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
      absorbSetCookies(response);
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, ok: response.ok, json, text, elapsedMs: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
  };
}
