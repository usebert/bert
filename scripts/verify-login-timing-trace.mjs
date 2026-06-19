#!/usr/bin/env node
/**
 * Login timing trace — prints server-reported timing breakdown for login scenarios.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig, missingLiveCredentials } from "./lib/live-path-config.mjs";
import { LiveHttpClient } from "./lib/live-http-client.mjs";
import { hashPassword, upsertMasterOperator, findOperatorByIdentity, verifyPassword } from "../server/master-auth.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { performCompanyLogin } from "../server/auth-service.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
if (!pkg.scripts["verify:login-timing-trace"]) {
  console.error("FAIL: npm script verify:login-timing-trace missing");
  process.exit(1);
}

function printTiming(label, payload, elapsedMs) {
  const timing = payload?.timingMs;
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${payload?._status ?? "?"} elapsedMs=${elapsedMs}`);
  if (timing && typeof timing === "object") {
    for (const key of [
      "normalise_email",
      "platform_auth_check",
      "auth_index_lookup",
      "password_verify",
      "company_context_load",
      "session_create",
      "background_jobs_queued",
      "response_sent",
      "total",
    ]) {
      if (typeof timing[key] === "number") {
        console.log(`[login] ${key} durationMs=${timing[key]}`);
      }
    }
  } else {
    console.log("(no timingMs in response)");
  }
  if (payload?.error) {
    console.log(`error: ${payload.error}`);
  }
  if (payload?.blocker) {
    console.log(`blocker: ${payload.blocker}`);
  }
}

async function runDirectTimingTrace() {
  const sessionDir = fs.mkdtempSync(path.join(root, ".tmp-login-timing-"));
  const authIndexPath = path.join(sessionDir, "auth-index.json");
  const authIndex = createAuthIndexApi(authIndexPath);
  const testPassword = "trace-test-password-12";
  const testEmail = "trace-admin@usebert.co.uk";
  const masterEmail = "trace-master@usebert.co.uk";
  const masterPassword = "trace-master-password-12";

  upsertMasterOperator({ sessionDir, email: masterEmail, name: "Trace Master", password: masterPassword });
  authIndex.upsertEntry({
    email: testEmail,
    name: "Trace Admin",
    role: "Admin",
    accessLevel: "Company Admin",
    companyId: "trace-company-folder",
    companyFolderId: "trace-company-folder",
    companyName: "Trace Co",
    masterSheetId: "trace-master-sheet",
    status: "ACTIVE",
    passwordHash: hashPassword(testPassword),
    updatedAt: new Date().toISOString(),
    companyAreas: [],
  });

  try {
    const godmodeStarted = Date.now();
    const loginStarted = Date.now();
    const timing = {};
    console.log("[login] start");
    const tNormalize = Date.now();
    const identity = masterEmail;
    timing.normalise_email = Date.now() - tNormalize;
    console.log(`[login] normalise_email durationMs=${timing.normalise_email}`);
    const tLookup = Date.now();
    const found = findOperatorByIdentity(sessionDir, identity);
    const op = found?.operator;
    timing.auth_index_lookup = Date.now() - tLookup;
    console.log(`[login] auth_index_lookup durationMs=${timing.auth_index_lookup}`);
    console.log("[login] platform_auth_check durationMs=0");
    const tPassword = Date.now();
    const passwordOk = Boolean(op && verifyPassword(masterPassword, op.passwordHash));
    timing.password_verify = Date.now() - tPassword;
    console.log(`[login] password_verify durationMs=${timing.password_verify}`);
    console.log("[login] company_context_load durationMs=0");
    const tSession = Date.now();
    timing.session_create = passwordOk ? Date.now() - tSession : 0;
    if (passwordOk) {
      console.log(`[login] session_create durationMs=${timing.session_create}`);
    }
    console.log("[login] background_jobs_queued durationMs=0");
    timing.total = Date.now() - loginStarted;
    console.log(`[login] total durationMs=${timing.total}`);
    printTiming("Godmode login (direct)", { ok: passwordOk, timingMs: timing, _status: passwordOk ? 200 : 401 }, Date.now() - godmodeStarted);

    const companyDeps = { authIndex };
    const validStarted = Date.now();
    const valid = await performCompanyLogin(null, {
      ...companyDeps,
      email: testEmail,
      password: testPassword,
    });
    printTiming("Company login (direct)", { ...valid, _status: valid.ok ? 200 : 401, timingMs: valid.timing }, Date.now() - validStarted);

    const wrongStarted = Date.now();
    const wrong = await performCompanyLogin(null, {
      ...companyDeps,
      email: testEmail,
      password: "wrong-password-trace-test",
    });
    printTiming("Wrong password (direct)", { ...wrong, _status: 401, timingMs: wrong.timing }, Date.now() - wrongStarted);

    const unknownStarted = Date.now();
    const unknown = await performCompanyLogin(null, {
      ...companyDeps,
      email: "unknown-user-trace@usebert.co.uk",
      password: "wrong-password-trace-test",
    });
    printTiming("Unknown email (direct)", { ...unknown, _status: 401, timingMs: unknown.timing }, Date.now() - unknownStarted);

    if (!valid.timing || !wrong.timing || !unknown.timing) {
      throw new Error("Direct company login missing timing");
    }
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}

async function runLiveTimingTrace() {
  const config = loadLivePathConfig();
  const api = new LiveHttpClient(config.apiBase, config.origin);

  const godmode = await api.request("/api/auth/master/login", {
    method: "POST",
    body: { email: config.masterEmail, password: config.masterPassword },
  });
  printTiming("Godmode login", { ...godmode.json, _status: godmode.status }, godmode.elapsedMs);

  const company = await api.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.adminEmail, password: config.adminPassword },
  });
  printTiming("Company login", { ...company.json, _status: company.status }, company.elapsedMs);

  const wrongPasswordClient = new LiveHttpClient(config.apiBase, config.origin);
  const wrongPassword = await wrongPasswordClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: config.adminEmail, password: "wrong-password-trace-test" },
  });
  printTiming("Wrong password", { ...wrongPassword.json, _status: wrongPassword.status }, wrongPassword.elapsedMs);

  const unknownEmailClient = new LiveHttpClient(config.apiBase, config.origin);
  const unknownEmail = await unknownEmailClient.request("/api/auth/company/login", {
    method: "POST",
    body: { email: "unknown-user-trace@usebert.co.uk", password: "wrong-password-trace-test" },
  });
  printTiming("Unknown email", { ...unknownEmail.json, _status: unknownEmail.status }, unknownEmail.elapsedMs);
}

const config = loadLivePathConfig();
const missing = missingLiveCredentials(config);
if (missing.length) {
  console.log(`[verify:login-timing-trace] live creds missing (${missing.join(", ")}); using direct auth index trace`);
  await runDirectTimingTrace();
} else {
  await runLiveTimingTrace();
}

console.log("\n[verify:login-timing-trace] OK — timing breakdown printed");
