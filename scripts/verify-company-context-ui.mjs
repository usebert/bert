#!/usr/bin/env node
/** Company context visible in header/account for all signed-in roles. */
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
const headerUtil = read("src/utils/headerCompanyContext.ts");
const accountSummary = read("src/components/AccountIdentitySummary.tsx");
const authService = read("server/auth-service.mjs");
const masterAuth = read("server/master-auth.mjs");
const serverMain = read("server/server.mjs");
const godmodeCtx = read("src/utils/godmodeCompanyContext.ts");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:company-context-ui"], "PKG: npm script registered");

/** Header shows Working on for company users and Godmode. */
assert(headerUtil.includes("resolveHeaderWorkingOn"), "1: header working-on resolver");
assert(headerUtil.includes("Working on:"), "1b: working-on copy");
assert(headerUtil.includes("No company selected"), "1c: godmode empty copy");
assert(headerUtil.includes("No company linked"), "1d: company user unlinked copy");
assert(!read("src/utils/applyLinkedCompanyContext.ts").includes('"Company workspace"'), "1h: no Company workspace fallback");
assert(read("server/company-context-service.mjs").includes("resolveCompanyContextFields"), "1i: server resolves company context fields");
assert(appTsx.includes("resolveHeaderWorkingOn"), "1e: App uses header resolver");
assert(appTsx.includes("headerWorkingOn"), "1f: App renders header working-on state");
assert(appTsx.includes("resolveHeaderRoleLabel"), "1g: App shows Godmode role label");

/** Account area shows email + company. */
assert(accountSummary.includes("resolveUserEmail"), "2: account email resolver");
assert(accountSummary.includes("companyName"), "2b: account company name");
assert(appTsx.includes("activeCompanyContext.companyName"), "2c: account uses active company context");

/** Session endpoints return company fields (never PasswordHash). */
assert(authService.includes("buildCompanySessionApiResponse"), "3: company session API builder");
assert(authService.includes("buildMasterSessionApiResponse"), "3b: master session API builder");
assert(
  /buildCompanySessionApiResponse[\s\S]*?companyFolderId[\s\S]*?companyName[\s\S]*?masterSheetId/.test(authService),
  "3c: company session includes folder/name/sheet",
);
assert(
  /buildMasterSessionApiResponse[\s\S]*?selectedCompanyName[\s\S]*?accessLevel[\s\S]*?Godmode/.test(authService),
  "3d: master session includes Godmode selected company fields",
);
assert(serverMain.includes("buildCompanySessionApiResponse"), "3e: company session route uses builder");
assert(masterAuth.includes("buildMasterSessionApiResponse"), "3f: master session route uses builder");
assert(masterAuth.includes("/api/auth/master/company-context"), "3g: master company-context sync route");
assert(godmodeCtx.includes("syncMasterCompanyContextToSession"), "3h: client syncs godmode company to session");
function fnBody(source, fnName) {
  const start = source.indexOf(`export function ${fnName}`);
  if (start < 0) {
    return "";
  }
  const next = source.indexOf("export function", start + 12);
  return source.slice(start, next > start ? next : undefined);
}

assert(!/PasswordHash/.test(fnBody(authService, "buildCompanySessionApiResponse")), "3i: company session builder omits PasswordHash");
assert(!/PasswordHash/.test(fnBody(authService, "buildMasterSessionApiResponse")), "3j: master session builder omits PasswordHash");

/** Header identity visible (not dropdown-only). */
assert(appTsx.includes("resolveUserEmail(currentUser)"), "4: header shows email");
assert(!appTsx.includes("hidden min-w-0 text-right sm:block"), "4b: account strip not sm-only hidden");

/** document.title and workspace labels use active company context — not stale localStorage. */
assert(headerUtil.includes("resolveDocumentTitle"), "5: document title resolver");
assert(headerUtil.includes("normalizeAppBrandForTitle"), "5b: app brand normalizer for title");
assert(appTsx.includes("resolveDocumentTitle"), "5c: App sets title via resolver");
assert(
  /document\.title\s*=\s*resolveDocumentTitle/.test(appTsx),
  "5d: document.title assigned from resolver",
);
assert(
  /resolveDocumentTitle\([\s\S]*?activeCompanyContext\.companyName/.test(appTsx),
  "5e: title uses activeCompanyContext.companyName",
);
assert(
  /resolveDocumentTitle\([\s\S]*?activeCompanyContext\.companyFolderId/.test(appTsx),
  "5f: title uses activeCompanyContext.companyFolderId",
);
assert(!appTsx.includes("document.title = workspaceName"), "5g: title does not use workspaceName");
const workspaceDisplayUtil = read("src/utils/workspaceDisplay.ts");
assert(
  !workspaceDisplayUtil.includes("readCompanyLoginHint"),
  "5h: workspace display resolver does not use login hint localStorage",
);
const workspaceNameMemoBlock =
  appTsx.match(/const workspaceName = useMemo[\s\S]*?\),\s*\n\s*\);/)?.[0] ?? "";
assert(workspaceNameMemoBlock.length > 0, "5h2: workspaceName useMemo present");
assert(
  !workspaceNameMemoBlock.includes("readCompanyLoginHint"),
  "5h3: workspaceName memo does not read login hint localStorage",
);
assert(
  /handleLogout[\s\S]*resolveDocumentTitle[\s\S]*signedIn:\s*false/.test(appTsx),
  "5i: logout clears document title",
);
assert(
  /resolveDocumentTitle[\s\S]*resolveHeaderWorkingOn/.test(headerUtil),
  "5j: title reuses header working-on resolver",
);
assert(appTsx.includes("companyContextValid"), "5l: App gates on companyContextValid");
assert(appTsx.includes("clearStaleCompanyLocalStorage"), "5m: App clears stale company storage");
assert(read("src/utils/clearStaleCompanyLocalStorage.ts").includes("bert_company_login_hint_v1"), "5n: stale clearer wipes login hint");
assert(
  headerUtil.includes("No company selected") && headerUtil.includes("No company linked"),
  "5k: title empty-state copy matches header",
);

console.log(`[verify:company-context-ui] OK — ${caseCount} cases passed`);
