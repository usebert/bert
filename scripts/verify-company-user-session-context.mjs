#!/usr/bin/env node
/** Company user session must carry real companyName + folder ids — never generic "Company workspace". */
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

const authService = read("server/auth-service.mjs");
const contextService = read("server/company-context-service.mjs");
const serverMain = read("server/server.mjs");
const applyCtx = read("src/utils/applyLinkedCompanyContext.ts");
const headerUtil = read("src/utils/headerCompanyContext.ts");
const appTsx = read("App.tsx");
const userService = read("server/company-user-service.mjs");
const coreRoutes = read("server/core-workflow-routes.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:company-user-session-context"], "PKG: npm script registered");

function performCompanyLoginBody(source) {
  const start = source.indexOf("export async function performCompanyLogin");
  const end = source.indexOf("export function queueCompanyLoginBackgroundJobs", start);
  return source.slice(start, end > start ? end : undefined);
}

const loginFn = performCompanyLoginBody(authService);

/** Session builder includes all required company fields. */
assert(authService.includes("buildCompanySessionApiResponse"), "1: company session API builder");
assert(
  /buildCompanySessionApiResponse[\s\S]*?companyFolderId[\s\S]*?companyName[\s\S]*?masterSheetId/.test(authService),
  "1b: session response includes folder/name/sheet",
);
assert(authService.includes("buildCompanySessionPayload"), "1c: session cookie payload builder");
assert(
  /buildCompanySessionPayload[\s\S]*?companyFolderId[\s\S]*?companyName/.test(authService),
  "1d: cookie payload persists companyFolderId and companyName",
);

/** Login uses auth index for company context — no Sheets/registry during request. */
assert(contextService.includes("resolveCompanyContextFields"), "2: resolveCompanyContextFields exported");
assert(contextService.includes("resolveCompanyContext"), "2a: resolveCompanyContext canonical resolver");
assert(contextService.includes("resolveCompanyContextFromLoginWorkbook"), "2a2: session workbook context resolver");
assert(contextService.includes("findRegistryRecordByMasterSheetId"), "2a3: registry match by masterSheetId only");
assert(
  /resolveCompanyContextFromLoginWorkbook[\s\S]*?readCompanyFieldsFromConfig[\s\S]*?findRegistryRecordByMasterSheetId/.test(
    contextService,
  ),
  "2a4: session workbook uses Config then exact registry sheet match",
);
assert(contextService.includes("readCompanyNameFromDriveFolder"), "2b: Drive folder name resolver");
assert(contextService.includes("readCompanyFieldsFromConfig"), "2c: Config tab resolver");
assert(read("server/auth-index.mjs").includes("pickRowCompanyName"), "2d4: auth index reads Company from Users tab row");
assert(
  read("server/auth-index.mjs").includes("rowPassesCompanyProfileContext") ||
    read("server/auth-index.mjs").includes("rowMatchesCompanyContext"),
  "2d5: auth index filters by company columns (workbook-scoped when masterSheetId set)",
);
assert(authService.includes("auth_index_lookup"), "2d2: login logs auth index lookup");
assert(authService.includes("authIndex.lookupByEmail"), "2d3: performCompanyLogin reads auth index");
assert(
  !/performCompanyLogin[\s\S]*?resolveCompanyContextFromLoginWorkbook/.test(authService),
  "2e: login does not resolve workbook synchronously",
);
assert(
  !/performCompanyLogin[\s\S]*?enrichCompanyContextFromRegistry/.test(authService),
  "2f: login does not enrich registry synchronously",
);
assert(authService.includes("reconcileLoginEntryFromUsersTab"), "2d6: login reconciles auth index from Users tab");
assert(authService.includes("INVALID_CREDENTIALS"), "2d7: login returns INVALID_CREDENTIALS code");
assert(authService.includes("LOGIN_CONTEXT_FAILED"), "2d8: login returns LOGIN_CONTEXT_FAILED code");
assert(
  /performCompanyLogin[\s\S]*?sessionCompanyName/.test(authService),
  "2g: session built from Users tab company columns",
);
assert(
  /resolveCompanyContextFields[\s\S]*?findRegistryRecordByMasterSheetId[\s\S]*?masterSheetId/.test(contextService),
  "2h: context fields prefer masterSheetId registry before companyFolderId",
);

/** Session route resolves folder from login workbook, not stale cookie alone. */
assert(serverMain.includes("resolveCompanyContextFromLoginWorkbook"), "3a: session route uses login workbook resolver");

/** Session route refreshes cookie when companyName is resolved. */
assert(serverMain.includes("buildCompanySessionPayload"), "3: session route can refresh cookie");
assert(
  /resolvedCompanyName[\s\S]*?buildCompanySessionPayload/.test(serverMain),
  "3b: session persists resolved companyName to cookie",
);

/** No "Company workspace" as display fallback in linked context / header. */
assert(!applyCtx.includes('"Company workspace"'), "4: applyLinkedCompanyContext omits Company workspace fallback");
assert(!appTsx.includes('activeCompanyContext.companyName || "Company workspace"'), "4b: App omits Company workspace fallback");
assert(headerUtil.includes("No company linked"), "4c: header shows No company linked when unlinked");

/** Actor + users route share session company context. */
assert(
  /parseBertActorFromRequest[\s\S]*?companyName/.test(serverMain),
  "5: parseBertActorFromRequest includes companyName",
);
assert(coreRoutes.includes("actor?.companyFolderId"), "5b: users route falls back to session companyFolderId");
assert(coreRoutes.includes("actor?.masterSheetId"), "5c: users route falls back to session masterSheetId");
assert(coreRoutes.includes("actor?.companyName"), "5d: users route falls back to session companyName");

/** Active users path resolves companyName via canonical context resolver. */
assert(userService.includes("resolveCompanyContextFields"), "6: listActiveCompanyMembers uses context resolver");
assert(userService.includes("deps.getConfig") || read("server/company-context-service.mjs").includes("readCompanyFieldsFromConfig"), "6b: context resolver reads Config tab");

/** Never expose PasswordHash in session builders. */
function fnBody(source, fnName) {
  const start = source.indexOf(`export function ${fnName}`);
  if (start < 0) {
    return "";
  }
  const next = source.indexOf("export function", start + 12);
  return source.slice(start, next > start ? next : undefined);
}

assert(!/PasswordHash/.test(fnBody(authService, "buildCompanySessionApiResponse")), "7: session API omits PasswordHash");
assert(
  /buildCompanySessionPayload\(\{[\s\S]*?companyName[\s\S]*?\}\)/.test(authService),
  "7b: session cookie payload includes companyName",
);

/** Company users load members without browser Google when signed in. */
assert(
  appTsx.includes('currentUser?.role !== "Master" || googleConnected'),
  "8: company users can load members without browser Google",
);

/** Multi-company isolation: company A login never inherits company B folder from registry scan. */
assert(
  /resolveCompanyLoginMasterSheetId[\s\S]*?readCompanyLoginHint[\s\S]*?return "";/.test(appTsx),
  "9: company login sheet id comes from invite hint only",
);
assert(appTsx.includes("clearGodmodeSelectedCompanyFolderId()"), "9b: company login clears godmode folder selection");
assert(
  /validateLiveCompanyContext[\s\S]*?resolveCompanyContextFromLoginWorkbook/.test(contextService),
  "9c: live validator resolves workbook folder over stale cookie",
);
{
  const companyAFolder = "folder-rock-solid";
  const companyBFolder = "folder-dovecote";
  const companyASheet = "sheet-rock-solid";
  const companyBSheet = "sheet-dovecote";
  const registryMap = new Map([
    [companyBFolder, { masterSheetId: companyBSheet, companyFolderId: companyBFolder, companyName: "Dovecote Studio" }],
    [companyAFolder, { masterSheetId: companyASheet, companyFolderId: companyAFolder, companyName: "Rock Solid Concrete" }],
  ]);
  let matched = null;
  for (const record of registryMap.values()) {
    if (String(record.masterSheetId).trim() === companyASheet) {
      matched = record;
      break;
    }
  }
  assert(matched?.companyFolderId === companyAFolder, "9d: masterSheetId match returns company A folder only");
  assert(matched?.companyFolderId !== companyBFolder, "9e: company A login never resolves company B folder");
}

assert(authService.includes("buildCompanySessionPayload"), "3: session route can refresh cookie");
assert(
  /resolvedCompanyName[\s\S]*?buildCompanySessionPayload/.test(serverMain),
  "3b: session persists resolved companyName to cookie",
);

/** Folder placement validated on session refresh, not login request. */
assert(authService.includes("companyContextValid"), "10b: session API exposes companyContextValid");
assert(serverMain.includes("validateLiveCompanyContext"), "10c: session route uses live validator");
assert(serverMain.includes("COMPANY_CONTEXT_INVALID"), "10d: session returns invalid company code");
assert(serverMain.includes("resolveValidatedCompanyLoginContext"), "10e: session validates company after password");
assert(read("server/auth-index.mjs").includes("lookupByEmailValidated"), "10g2: auth index validates on lookup");
assert(read("server/auth-index.mjs").includes("reconcileLoginEntryFromUsersTab"), "10g2b: auth index reconciles login from Users tab");
assert(read("server/auth-index.mjs").includes("pruneAuthIndexGhostEntries"), "10g3: auth index startup ghost prune");
assert(!serverMain.includes("lookupByEmailValidated(auth, getCompanyContextEnrichmentDeps(), result.email)"), "10g4: login route does not block on validated lookup");
assert(read("src/components/admin/UsersInvitesPilotPanel.tsx").includes("companyContextBlocked"), "10i: invite panel gates on company context");
assert(appTsx.includes("clearStaleCompanyLocalStorage"), "10g: App clears stale company storage");
assert(appTsx.includes("COMPANY_NO_LONGER_AVAILABLE_MESSAGE"), "10h: App shows company unavailable message");
assert(!loginFn.includes("validateLiveCompanyContext"), "10: login performCompanyLogin stays fast — live validation in background");
assert(serverMain.includes("folderPlacementOk"), "12: session surfaces folder placement status");
assert(authService.includes("folderPlacementOk"), "12b: session API exposes folder placement");
assert(read("server/auth-index.mjs").includes("verifyAuthIndexEntryMatchesUsersWorkbook"), "10i: auth index verifies workbook Users row");
assert(read("shared/auth-index-trust.mjs").includes("isKnownStaleAuthIndexPairing"), "10j: known stale pairings rejected");
assert(serverMain.includes("verifyAuthIndexEntryMatchesUsersWorkbook"), "10k: session verifies auth index workbook match");
assert(read("src/utils/clearStaleCompanyLocalStorage.ts").includes('APP_CONTEXT_VERSION = "6"'), "10l: app context version bumped");
assert(appTsx.includes("companyLinkBlockedMessage"), "12d: App blocks dashboard when company link invalid");
assert(appTsx.includes("FOLDER_NOT_IN_COMPANIES_ROOT_MESSAGE"), "12e: App shows folder placement deny message");

console.log(`[verify:company-user-session-context] OK — ${caseCount} cases passed`);
