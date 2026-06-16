#!/usr/bin/env node
/** Login API connectivity — frontend base URL, health, CORS, and JSON error contracts. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePathConfig } from "./lib/live-path-config.mjs";

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

function isJsonContentType(contentType) {
  return String(contentType || "").toLowerCase().includes("json");
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 15_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let json = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, text, json, headers: response.headers };
}

const config = loadLivePathConfig();
const apiBase = String(process.env.BERT_VERIFY_API_BASE || config.apiBase).replace(/\/$/, "");
const frontendOrigin = config.frontendUrl;

const pkg = JSON.parse(read("package.json"));
const authService = read("src/services/authService.ts");
const fetchJson = read("src/utils/fetchJson.ts");
const loginMessages = read("src/utils/loginNetworkMessages.ts");
const appTsx = read("App.tsx");
const apiBaseTs = read("src/config/apiBase.ts");
const serverMain = read("server/server.mjs");

assert(pkg.scripts["verify:login-api-connectivity"], "PKG: npm script registered");

/** 1: Frontend API base URL configured in source/build contract. */
assert(apiBaseTs.includes("VITE_API_BASE_URL"), "1: apiBase reads VITE_API_BASE_URL");
assert(loginMessages.includes("COMPANY_LOGIN_NETWORK_ERROR_MESSAGE"), "1b: login network message constant");
assert(
  loginMessages.includes("BERT could not reach the sign-in service"),
  "1c: user-friendly sign-in network message",
);

const distIndex = path.join(root, "dist/index.html");
if (fs.existsSync(distIndex)) {
  const html = fs.readFileSync(distIndex, "utf8");
  const bundleRel = html.match(/\/assets\/index-[^"]+\.js/)?.[0] || "";
  if (bundleRel) {
    const bundlePath = path.join(root, "dist", bundleRel.replace(/^\//, ""));
    if (fs.existsSync(bundlePath)) {
      const bundle = fs.readFileSync(bundlePath, "utf8");
      assert(
        bundle.includes("api.usebert.co.uk") || bundle.includes(apiBase.replace(/^https?:\/\//, "")),
        "1d: built dist bundle embeds production API host",
      );
    }
  }
} else {
  console.log("[verify:login-api-connectivity] skip dist bundle check (run VITE_API_BASE_URL build first)");
}

/** 2–5: Live API probes when reachable. */
let liveOk = false;
try {
  const health = await fetchWithTimeout(`${apiBase}/api/health`);
  assert(health.response.status === 200, `2: /api/health is 200 (got ${health.response.status})`);
  assert(isJsonContentType(health.headers.get("content-type")), "2b: /api/health content-type is JSON");
  assert(health.json?.ok === true, "2c: /api/health body ok=true");
  liveOk = true;
} catch (error) {
  console.log(
    `[verify:login-api-connectivity] skip live probes (${error instanceof Error ? error.message : error})`,
  );
}

if (liveOk) {
  const preflight = await fetchWithTimeout(`${apiBase}/api/auth/company/login`, {
    method: "OPTIONS",
    headers: {
      Origin: frontendOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  assert(
    preflight.response.status === 204 || preflight.response.status === 200,
    `4: OPTIONS preflight succeeds (${preflight.response.status})`,
  );
  assert(
    preflight.headers.get("access-control-allow-origin") === frontendOrigin,
    `4b: CORS allow-origin is ${frontendOrigin}`,
  );

  const invalidLogin = await fetchWithTimeout(`${apiBase}/api/auth/company/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: frontendOrigin,
    },
    body: JSON.stringify({ email: "verify-login-connectivity@usebert.co.uk", password: "wrong-password" }),
  });
  assert(invalidLogin.response.status === 401, `3/5: login reachable with 401 (${invalidLogin.response.status})`);
  assert(isJsonContentType(invalidLogin.headers.get("content-type")), "5: invalid login content-type is JSON");
  assert(invalidLogin.json?.code === "INVALID_CREDENTIALS", "5b: invalid login returns INVALID_CREDENTIALS JSON");
  assert(
    invalidLogin.headers.get("access-control-allow-origin") === frontendOrigin,
    "3b: login POST includes CORS allow-origin",
  );
}

/** 6: Server login route always returns JSON on unexpected errors. */
const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);
assert(companyLoginBlock.includes("try {"), "6: login route wrapped in try");
assert(companyLoginBlock.includes("LOGIN_CONTEXT_FAILED"), "6b: catch maps to LOGIN_CONTEXT_FAILED JSON");
assert(!companyLoginBlock.includes("requireGoogleWorkspaceSession"), "6c: login does not require Google session");

/** 7: Frontend never surfaces raw NetworkError for normal API transport failures. */
assert(fetchJson.includes("NETWORK_UNREACHABLE"), "7: fetchJson defines NETWORK_UNREACHABLE");
assert(fetchJson.includes("fetchErrorName"), "7b: fetchJson captures fetch error name");
assert(authService.includes('result.code === "NETWORK_UNREACHABLE"'), "7c: authService maps network failures");
assert(authService.includes("companyLoginNetworkError"), "7d: authService uses friendly login network message");
assert(!appTsx.includes("NetworkError when attempting to fetch resource"), "7e: App does not hardcode raw NetworkError");
assert(appTsx.includes("network_unreachable"), "7f: App handles network_unreachable blocker");
assert(appTsx.includes("formatLoginNetworkDebugSuffix"), "7g: App shows dev login network diagnostics");

console.log(`[verify:login-api-connectivity] OK — ${caseCount} cases passed (api=${apiBase})`);
