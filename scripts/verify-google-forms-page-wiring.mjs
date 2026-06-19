#!/usr/bin/env node
/** Google Forms page — list from GET /api/companies/:companyId/google-forms; sync via POST …/sync. */
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
const googleFormsScreen = read("src/screens/GoogleFormsScreen.tsx");
const companyFormsService = read("src/services/companyFormsService.ts");
const contextService = read("src/services/companyContextService.ts");
const permissions = read("src/permissions.ts");
const navigation = read("src/types/navigation.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:google-forms-page-wiring"], "PKG: npm script registered");

/** 1: Canonical list + sync APIs only. */
assert(companyFormsService.includes("fetchCompanyGoogleForms"), "1: client fetchCompanyGoogleForms");
assert(companyFormsService.includes("syncCompanyGoogleForms"), "1b: client syncCompanyGoogleForms");
assert(
  companyFormsService.includes("/api/companies/") && companyFormsService.includes("/google-forms"),
  "1c: canonical google-forms API path",
);
assert(
  companyFormsService.includes("/google-forms/sync") && companyFormsService.includes('method: "POST"'),
  "1d: sync uses POST /google-forms/sync",
);
assert(coreRoutes.includes('app.get("/api/companies/:companyId/google-forms"'), "1e: server list route registered");
assert(
  coreRoutes.includes('app.post("/api/companies/:companyId/google-forms/sync"'),
  "1f: server sync route registered",
);
assert(appTsx.includes("fetchCompanyGoogleForms"), "1g: App loads forms via fetchCompanyGoogleForms");
assert(
  /useEffect\([\s\S]{0,5000}resolveCompanyMembersLoadContext[\s\S]{0,5000}fetchCompanyGoogleForms/.test(appTsx),
  "1h: page load uses session company context + fetchCompanyGoogleForms",
);
assert(appTsx.includes("syncCompanyGoogleForms"), "1i: App sync handler uses syncCompanyGoogleForms");
assert(!companyFormsService.includes('params.set("masterSheetId"'), "1j: client does not send masterSheetId query");
assert(!companyFormsService.includes("/api/company/"), "1k: client does not use legacy /api/company path");
assert(!companyFormsService.includes("/api/google-forms-folder/"), "1l: client does not use folder-id probe path");

/** 2: Session company context — no localStorage company truth. */
assert(contextService.includes("resolveActiveCompanyContext"), "2: unified company context resolver");
assert(appTsx.includes("activeCompanyContext"), "2b: App uses activeCompanyContext");
assert(appTsx.includes("resolveCompanyMembersLoadContext"), "2c: shared load context for google-forms API");
assert(!appTsx.includes("localStorage.getItem(storageKeys.companyName)"), "2d: no localStorage companyName read in App");

/** 3: Empty vs folder lookup failure. */
assert(companyFormsService.includes("folder_lookup_failed"), "3: maps folder_lookup_failed from API");
assert(companyFormsService.includes("COMPANY_GOOGLE_FORMS_FOLDER_NOT_FOUND_MESSAGE"), "3b: friendly folder-not-found copy");
assert(googleFormsScreen.includes('title="No Google Forms found"'), "3c: empty title only in screen");
assert(googleFormsScreen.includes("loadError"), "3d: error UI separate from empty state");
assert(companyFormsService.includes('payload.googleFormsFolder?.id'), "3e: empty only when folder resolved");

/** 4: Friendly states + timeouts. */
assert(companyFormsService.includes("COMPANY_GOOGLE_FORMS_LOAD_TIMEOUT_MS"), "4: forms load timeout");
assert(googleFormsScreen.includes("COMPANY_GOOGLE_FORMS_LOADING_MESSAGE"), "4b: loading message in UI");
assert(appTsx.includes("companyGoogleFormsState"), "4c: App tracks google forms load state");
assert(appTsx.includes("COMPANY_GOOGLE_FORMS_LOAD_TIMEOUT_MS"), "4d: timeout wired in App");
assert(
  /!masterCompanyWorkspaceDataMatchesSelection[\s\S]{0,400}companyGoogleFormsState/.test(appTsx) ||
    /setCompanyGoogleFormsState\(\{ forms: \[\], loading: false, status: "idle"/.test(appTsx),
  "4e: stale godmode selection does not spin forever",
);

/** 5: Nav + permissions. */
assert(navigation.includes('"googleForms"'), "5: googleForms routed screen type");
assert(permissions.includes("canAccessGoogleForms"), "5b: canAccessGoogleForms permission");
assert(appTsx.includes('<GoogleFormsScreen'), "5c: App renders GoogleFormsScreen");
assert(appTsx.includes('screen === "googleForms"'), "5d: App routes googleForms screen");

/** 6: Sync button wired. */
assert(googleFormsScreen.includes("onSync"), "6: screen accepts onSync");
assert(googleFormsScreen.includes("Sync to workbook"), "6b: sync button label");
assert(appTsx.includes("handleSyncCompanyGoogleForms"), "6c: App defines sync handler");

/** 7: No technical diagnostics in normal UI. */
assert(!googleFormsScreen.includes("driveQuery"), "7: screen omits drive diagnostics");
assert(!googleFormsScreen.includes("masterSheetId"), "7b: screen omits masterSheetId");
assert(!googleFormsScreen.includes("registry"), "7c: screen omits registry wording");

console.log(`[verify:google-forms-page-wiring] OK — ${caseCount} cases passed`);
