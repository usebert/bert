#!/usr/bin/env node
/** Login must reconcile auth index with Users tab company columns and return traceable context failures. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const authService = read("server/auth-service.mjs");
const authIndex = read("server/auth-index.mjs");
const serverMain = read("server/server.mjs");
const authClient = read("src/services/authService.ts");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));
const loginFn = performCompanyLoginBody(authService);

const companyLoginBlock = serverMain.slice(
  serverMain.indexOf('app.post("/api/auth/company/login"'),
  serverMain.indexOf('app.post("/api/auth/company/logout"'),
);

assert(pkg.scripts["verify:login-context-trace"], "PKG: npm script registered");

assert(authService.includes("INVALID_CREDENTIALS"), "1: invalid credentials code exported");
assert(authService.includes("LOGIN_CONTEXT_FAILED"), "1b: login context failed code exported");
assert(authService.includes("buildLoginContextFailure"), "1c: structured context failure builder");
assert(
  /buildLoginContextFailure[\s\S]*?failedStep[\s\S]*?diagnostics/.test(authService),
  "1d: diagnostics include failedStep",
);

assert(loginFn.includes("authIndex.lookupByEmail"), "2a: auth index lookup first");
assert(loginFn.includes("reconcileLoginEntryFromUsersTab"), "2b: Users tab reconcile when auth available");
assert(loginFn.includes("verifyPasswordForEntry"), "2c: password verify after reconcile");
assert(loginFn.includes("sessionCompanyName"), "2d: session built from row company columns");
assert(loginFn.includes("validateLiveCompany"), "2e: live validation queued for background");
assert(!loginFn.includes("validateLiveCompanyContext"), "2f: login does not await live Drive validation");
assert(!loginFn.includes("lookupByEmailValidated"), "2g: login does not use validated index lookup");

assert(authIndex.includes("reconcileLoginEntryFromUsersTab"), "3a: auth index exposes login reconcile");
assert(authIndex.includes("isIndexEntryStaleVsUsersTab"), "3b: auth index detects column mismatch");
assert(authIndex.includes("pickRowCompanyName"), "3c: reconcile reads Company column from row");
assert(authIndex.includes("upsertEntry"), "3d: reconcile upserts index when stale");

assert(!companyLoginBlock.includes("lookupByEmailValidated"), "4a: login route does not block on validated lookup");
assert(!companyLoginBlock.includes("resolveValidatedCompanyLoginContext"), "4b: login route does not block on resolver");
assert(companyLoginBlock.includes("clearClientHints"), "4c: success clears stale client hints");
assert(companyLoginBlock.includes("diagnostics"), "4d: failure returns diagnostics payload");
assert(companyLoginBlock.includes("LOGIN_CONTEXT_FAILED"), "4e: catch maps unexpected errors to LOGIN_CONTEXT_FAILED");

assert(authClient.includes("LoginContextDiagnostics"), "5a: client types login diagnostics");
assert(authClient.includes("diagnostics?: LoginContextDiagnostics"), "5b: client handles login context diagnostics");
assert(authClient.includes("clearClientHints"), "5c: client reads clearClientHints");

assert(appTsx.includes("login_context_failed"), "6a: App handles login context failure");
assert(appTsx.includes("diagnostics.failedStep"), "6b: App shows Godmode diagnostics on failure");
assert(appTsx.includes('"invalid_credentials"'), "6c: App handles invalid credentials blocker");

assert(
  read("shared/auth-index-trust.mjs").includes("7oakcottages@gmail.com"),
  "7: known stale Rock Solid pairing includes Sophie login email",
);

console.log(`[verify:login-context-trace] OK — ${caseCount} cases passed`);
