#!/usr/bin/env node
/** Stale localStorage/session must never open a company workspace without live backend validation. */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
const authService = read("server/auth-service.mjs");
const authIndex = read("server/auth-index.mjs");
const contextService = read("server/company-context-service.mjs");
const serverMain = read("server/server.mjs");
const clearStale = read("src/utils/clearStaleCompanyLocalStorage.ts");
const authClient = read("src/services/authService.ts");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:stale-company-context"], "PKG: npm script registered");

const rockSolidHits = execSync('rg -l "Rock Solid Concrete Ltd" . --glob "!scripts/verify-stale-company-context.mjs" 2>/dev/null || true', {
  cwd: root,
  encoding: "utf8",
}).trim();
assert(!rockSolidHits, "AUDIT: Rock Solid Concrete Ltd not in repo");

assert(contextService.includes("validateLiveCompanyContext"), "1: live company context validator");
assert(
  /validateLiveCompanyContext[\s\S]*?readCompanyNameFromDriveFolder[\s\S]*?validateCompanyFolderUnderCompaniesRoot/.test(
    contextService,
  ),
  "1b: validator checks Drive folder, placement, workbook",
);
assert(contextService.includes("COMPANY_CONTEXT_INVALID"), "1c: validator uses COMPANY_CONTEXT_INVALID");

assert(authService.includes("companyContextValid"), "2: session API exposes companyContextValid");
assert(authService.includes("resolveValidatedCompanyLoginContext"), "2b: login context resolver");
assert(authService.includes("validateLiveCompanyContext"), "2c: auth service re-exports live validator");

assert(serverMain.includes("validateLiveCompanyContext"), "3: session route validates live context");
assert(serverMain.includes("COMPANY_CONTEXT_INVALID"), "3b: session returns COMPANY_CONTEXT_INVALID");
assert(serverMain.includes("resolveValidatedCompanyLoginContext"), "3c: login route validates after password");
assert(serverMain.includes("invalidateAuthIndexEntryIfCompanyMissing"), "3d: login prunes stale auth index rows");

assert(authIndex.includes("invalidateAuthIndexEntryIfCompanyMissing"), "4: auth index invalidates missing companies");
assert(authIndex.includes("validateLiveCompanyContext"), "4b: auth index uses live validator");

assert(clearStale.includes("clearStaleCompanyLocalStorage"), "5: stale storage clearer exists");
assert(clearStale.includes("bert_company_login_hint_v1"), "5b: clears login hint");
assert(clearStale.includes("clearGodmodeSelectedCompanyFolderId"), "5c: clears godmode folder id");
assert(clearStale.includes("companyMembersCache"), "5d: clears members cache");
assert(clearStale.includes("companyName"), "5e: clears legacy companyName key");

assert(appTsx.includes("clearStaleCompanyLocalStorage"), "6: App clears stale storage");
assert(appTsx.includes("COMPANY_NO_LONGER_AVAILABLE_MESSAGE"), "6b: App shows company unavailable copy");
assert(!appTsx.includes("setLinkedCompanyContext({\n        companyId: hint.companyFolderId"), "6c: App does not trust login hint for linked context");
assert(
  /parsed\.role !== "Master"[\s\S]*?clearStaleCompanyLocalStorage[\s\S]*?removeItem\(userStorageKey\)/.test(appTsx),
  "6d: company users never restore from localStorage without session",
);
assert(appTsx.includes("companyContextValid"), "6e: App checks companyContextValid from session");
assert(appTsx.includes("companyLinkBlockedMessage"), "6f: App blocks dashboard when company invalid");
assert(
  /handleLogout[\s\S]*?clearStaleCompanyLocalStorage/.test(appTsx),
  "6g: logout clears stale company storage",
);

assert(authClient.includes("companyContextValid"), "7: client auth service types companyContextValid");

assert(
  !read("src/utils/workspaceDisplay.ts").includes("readCompanyLoginHint"),
  "8: workspace display never reads login hint",
);
assert(
  /resolveDocumentTitle\([\s\S]*?activeCompanyContext\.companyName/.test(appTsx),
  "8b: document.title uses validated activeCompanyContext only",
);

console.log(`[verify:stale-company-context] OK — ${caseCount} cases passed`);
