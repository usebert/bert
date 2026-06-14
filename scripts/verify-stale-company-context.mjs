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

const rockSolidHits = execSync('rg -l "Rock Solid Concrete Ltd" . --glob "!scripts/verify-stale-company-context.mjs" --glob "!scripts/verify-invite-workspace.mjs" 2>/dev/null || true', {
  cwd: root,
  encoding: "utf8",
}).trim();
assert(!rockSolidHits, "AUDIT: Rock Solid Concrete Ltd not in repo");

assert(contextService.includes("validateLiveCompanyContext"), "1: live company context validator");
assert(contextService.includes("validateCompanyFolderUnderCompaniesRoot"), "1b: validator checks Drive folder, placement, workbook");
assert(
  /folderPlacementOk[\s\S]*?companyContextValid:\s*true/.test(contextService),
  "1b2: invalid folder placement still returns valid workbook context",
);
assert(contextService.includes("COMPANY_CONTEXT_INVALID"), "1c: validator uses COMPANY_CONTEXT_INVALID");

assert(authService.includes("companyContextValid"), "2: session API exposes companyContextValid");
assert(authService.includes("resolveValidatedCompanyLoginContext"), "2b: login context resolver");
assert(authService.includes("validateLiveCompanyContext"), "2c: auth service re-exports live validator");

assert(serverMain.includes("validateLiveCompanyContext"), "3: session route validates live context");
assert(serverMain.includes("COMPANY_CONTEXT_INVALID"), "3b: session returns COMPANY_CONTEXT_INVALID");
assert(serverMain.includes("resolveValidatedCompanyLoginContext"), "3c: session route validates after password");
assert(!serverMain.includes("lookupByEmailValidated(auth, getCompanyContextEnrichmentDeps(), result.email)"), "3d: login route does not block on validated lookup");
assert(serverMain.includes("pruneAuthIndexGhostEntries"), "3e: server startup prunes ghost auth index entries");

assert(authIndex.includes("lookupByEmailValidated"), "4a: auth index validates entries on lookup");
assert(authIndex.includes("validateLiveCompanyContext"), "4b: auth index uses live validator");
assert(authIndex.includes("pruneAuthIndexGhostEntries"), "4f: auth index prunes ghost entries on startup");
assert(
  /rebuildAuthIndex[\s\S]*?validateLiveCompanyContext/.test(authIndex),
  "4g: rebuild only indexes folders under Live Companies",
);
assert(authIndex.includes("rowMatchesCompanyContext"), "4h: auth index filters Users tab by company columns");
assert(authIndex.includes("pickRowCompanyName"), "4i: auth index session company from row Company column");
assert(read("shared/auth-index-trust.mjs").includes("isKnownStaleAuthIndexPairing"), "4e: known stale auth pairings guarded");

assert(clearStale.includes("clearStaleCompanyLocalStorage"), "5: stale storage clearer exists");
assert(clearStale.includes("bert_company_login_hint_v1"), "5b: clears login hint");
assert(clearStale.includes("runAppContextBootstrap"), "5b2: boot-time context bootstrap");
assert(clearStale.includes("bert_app_context_version"), "5b3: version key for one-time wipe");
assert(clearStale.includes("clearStoredFolderLinkCompanyFields"), "5b4: clears folder link company fields");
assert(clearStale.includes("clearGodmodeSelectedCompanyFolderId"), "5c: clears godmode folder id");
assert(clearStale.includes("companyMembersCache"), "5d: clears members cache");
assert(clearStale.includes("companyName"), "5e: clears legacy companyName key");

assert(read("src/main.tsx").includes("runAppContextBootstrap"), "6a: main runs boot bootstrap before render");
const selectedFolderMemoBlock =
  appTsx.match(/const selectedFolder = useMemo[\s\S]*?\),\s*\n\s*\);/)?.[0] ?? "";
assert(selectedFolderMemoBlock.length > 0, "6a2: selectedFolder useMemo present");
assert(!selectedFolderMemoBlock.includes("readCompanyLoginHint"), "6a2b: selectedFolder never reads login hint");
const loadGoogleStatusBlock = appTsx.match(/const loadGoogleStatus = async[\s\S]*?\n  };\n/)?.[0] ?? "";
assert(loadGoogleStatusBlock.length > 0, "6a3: loadGoogleStatus present");
assert(!loadGoogleStatusBlock.includes("readCompanyLoginHint"), "6a3b: google status never selects company from login hint");
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
assert(
  /getRoleBannerCopy\(role,\s*workspaceName\)/.test(read("src/components/RoleContextBanner.tsx")),
  "8c: role banner uses workspaceName prop only",
);
const workspaceNameMemoBlock =
  appTsx.match(/const workspaceName = useMemo[\s\S]*?\),\s*\n\s*\);/)?.[0] ?? "";
assert(workspaceNameMemoBlock.length > 0, "8d: workspaceName useMemo present");
assert(
  !workspaceNameMemoBlock.includes("readCompanyLoginHint"),
  "8d2: workspaceName memo never reads login hint (Rock Solid localStorage cannot reach banners)",
);
assert(authIndex.includes("pruneStaleAuthIndexEntries"), "9: auth index prunes stale entries on rebuild");
assert(authIndex.includes("rebuildAuthIndex"), "9c: auth index has full rebuild with conflict resolution");
assert(authIndex.includes("removeAuthIndexEntriesForCompany"), "9d: auth index clears entries on company reset");
assert(authIndex.includes("invalidateAuthIndexEntry"), "9e: auth index invalidates stale entries");
assert(authIndex.includes("verifyAuthIndexEntryMatchesUsersWorkbook"), "9f: auth index verifies workbook match");
assert(read("shared/auth-index-trust.mjs").includes("isKnownStaleAuthIndexPairing"), "9g: known stale pairing guard");
assert(serverMain.includes("rebuildAuthIndex"), "9b: rebuild-auth-index prunes stale entries");
assert(appTsx.includes("isKnownStaleAuthIndexPairing"), "9c: App rejects known stale auth pairings");
assert(serverMain.includes("rebuildAuthIndex"), "9h: godmode rebuild uses full auth index rebuild");
assert(serverMain.includes("verifyAuthIndexEntryMatchesUsersWorkbook"), "9i: session verifies auth index workbook match");
assert(serverMain.includes("isKnownStaleAuthIndexPairing"), "9j: session rejects known stale pairings");
assert(clearStale.includes("bert_context_schema_version"), "9k: boot uses bert_context_schema_version");
assert(clearStale.includes("BERT_CONTEXT_SCHEMA_VERSION = 5"), "9m: schema version bumped for one-time client wipe");
assert(
  read("src/components/admin/UsersInvitesPilotPanel.tsx").includes("companyContextBlocked"),
  "9n: invite panel blocks when company context invalid",
);

console.log(`[verify:stale-company-context] OK — ${caseCount} cases passed`);
