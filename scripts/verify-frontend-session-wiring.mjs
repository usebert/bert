#!/usr/bin/env node
/** Frontend login/session wiring — backend session wins; no PasswordHash or demo company names in login path. */
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

const appTsx = read("App.tsx");
const authClient = read("src/services/authService.ts");
const serverMain = read("server/server.mjs");
const clearStale = read("src/utils/clearStaleCompanyLocalStorage.ts");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:frontend-session-wiring"], "PKG: npm script registered");

assert(serverMain.includes('app.get("/api/session"'), "1: unified GET /api/session route");
assert(serverMain.includes("respondMasterUserSession"), "1b: master session resolved for /api/session");
assert(serverMain.includes("includeSessionKind: true"), "1c: company session tagged for /api/session");

assert(authClient.includes("fetchAppSession"), "2: client fetchAppSession exported");
assert(authClient.includes('/api/session"'), "2b: fetchAppSession calls GET /api/session");
assert(!/PasswordHash/.test(authClient), "2c: client auth service omits PasswordHash");

assert(appTsx.includes("fetchAppSession"), "3: App bootstrap uses fetchAppSession");
assert(appTsx.includes("authSessionHydrating"), "3b: App waits for session hydrate before login UI");
assert(
  /handleLogin[\s\S]*?clearStaleCompanyLocalStorage/.test(appTsx),
  "3c: login clears stale company context before sign-in",
);
assert(
  /handleLogout[\s\S]*?clearStaleCompanyLocalStorage/.test(appTsx),
  "3d: logout clears stale company context for all roles",
);
assert(
  !/parsed\.role !== "Master"[\s\S]*?removeItem\(userStorageKey\)/.test(appTsx),
  "3e: App does not restore signed-in user from localStorage without backend session",
);
assert(
  /applySignedInUser\([\s\S]*?companyName/.test(appTsx),
  "3f: company login welcome uses backend companyName",
);

assert(clearStale.includes("BERT_CONTEXT_SCHEMA_VERSION = 7"), "4: schema version bumped for session wiring");

const loginBlock = appTsx.match(/const handleLogin = async[\s\S]*?\n  };\n/)?.[0] ?? "";
assert(loginBlock.length > 0, "5: handleLogin block present");
assert(!loginBlock.includes("Rock Solid"), "5b: no demo company names in login path");
assert(!loginBlock.includes("Acme Precast"), "5c: no invented demo company in login path");
assert(!loginBlock.includes("Dovecote"), "5d: no demo company names in login path");

console.log(`[verify:frontend-session-wiring] OK — ${caseCount} cases passed`);
