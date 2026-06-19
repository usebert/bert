#!/usr/bin/env node
/** Godmode company selector + dashboard header — backend session is source of truth. */
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
const godmodeCtx = read("src/utils/godmodeCompanyContext.ts");
const godmodeService = read("src/services/godmodeService.ts");
const companyService = read("src/services/companyService.ts");
const applyLinked = read("src/utils/applyLinkedCompanyContext.ts");
const authClient = read("src/services/authService.ts");
const masterAuth = read("server/master-auth.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:godmode-company-wiring"], "PKG: npm script registered");

assert(godmodeService.includes("listGodmodeLiveCompanies"), "1: godmode service lists live companies");
assert(godmodeService.includes("resolveGodmodeCompanyFromFolder"), "1b: godmode service resolves from folder");
assert(companyService.includes("/resolve-from-folder"), "1c: company service calls resolve-from-folder API");
assert(godmodeCtx.includes("resolveAndSyncMasterCompanySelection"), "1d: resolve + session sync helper");
assert(godmodeCtx.includes("/api/auth/master/company-context"), "1e: session sync posts master company-context");

assert(appTsx.includes("listGodmodeLiveCompanies"), "2: App loads companies via godmode service");
assert(appTsx.includes("resolveAndSyncMasterCompanySelection"), "2b: App selects company via backend resolve");
assert(!appTsx.includes("readGodmodeSelectedCompanyFolderId"), "2c: App does not restore godmode folder from localStorage");
assert(!appTsx.includes("writeGodmodeSelectedCompanyFolderId"), "2d: App does not persist godmode folder to localStorage");
assert(
  /handleSelectFolder[\s\S]*?clearCompanyWorkspaceLocalStateForGodmodeSwitch/.test(appTsx),
  "2e: company switch clears previous godmode workspace state",
);
assert(
  /handleSelectFolder[\s\S]*?setLinkedCompanyContext\(null\)/.test(appTsx),
  "2f: company switch clears linked context before new selection",
);
assert(
  /handleSelectFolder[\s\S]*?skipLoginHint:\s*true/.test(appTsx),
  "2g: godmode selection skips company login hint localStorage",
);

assert(authClient.includes("normalizeMasterSessionCompany"), "3: session client restores master company");
assert(authClient.includes("fetchAppSession"), "3b: bootstrap uses GET /api/session");
assert(masterAuth.includes("/api/auth/master/company-context"), "3c: backend persists master selected company");

assert(applyLinked.includes("skipLoginHint"), "4: linked context supports skipLoginHint for Godmode");
assert(appTsx.includes("activeCompanyContext.companyName"), "4b: header/account use activeCompanyContext");
assert(appTsx.includes("resolveHeaderWorkingOn"), "4c: header working-on resolver wired");
assert(appTsx.includes("setHydratedCompanyFolderId"), "4d: refresh tracks hydrated company folder id");

assert(!/PasswordHash/.test(authClient), "5: client auth service omits PasswordHash");
assert(!/PasswordHash/.test(companyService), "5b: company service omits PasswordHash");

console.log(`[verify:godmode-company-wiring] OK — ${caseCount} cases passed`);
