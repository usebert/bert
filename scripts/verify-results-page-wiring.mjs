#!/usr/bin/env node
/** Results page — completed checks from GET /api/companies/:companyId/results only. */
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
const resultsScreen = read("src/screens/ResultsScreen.tsx");
const resultsService = read("src/services/resultsService.ts");
const contextService = read("src/services/companyContextService.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
const completionService = read("server/completion-service.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:results-page-wiring"], "PKG: npm script registered");

/** 1: Canonical results list + detail APIs only. */
assert(resultsService.includes("fetchCompanyResults"), "1: client fetchCompanyResults");
assert(resultsService.includes("fetchCompanyResultDetail"), "1b: client fetchCompanyResultDetail");
assert(resultsService.includes("/api/companies/") && resultsService.includes("/results"), "1c: results API path");
assert(coreRoutes.includes('app.get("/api/companies/:companyId/results"'), "1d: server list route registered");
assert(coreRoutes.includes('app.get("/api/companies/:companyId/results/:resultId"'), "1e: server detail route registered");
assert(completionService.includes("getAuditResult"), "1f: server getAuditResult exported");
assert(appTsx.includes("fetchCompanyResults"), "1g: App loads results via fetchCompanyResults");
assert(
  /shouldLoadCompanyResultsScreen\(screen\)[\s\S]{0,4000}loadCompanyResults/.test(appTsx),
  "1h: results/reports/schedules screen gate before loadCompanyResults",
);
assert(!resultsService.includes("/api/google-sheet-by-id/"), "1i: client does not use legacy sheet sync for results");
assert(!resultsService.includes("appendAuditResults"), "1j: client does not append results via legacy path");

/** 2: Session company context — no localStorage companyName truth. */
assert(contextService.includes("resolveActiveCompanyContext"), "2: unified company context resolver");
assert(appTsx.includes("activeCompanyContext"), "2b: App uses activeCompanyContext");
assert(appTsx.includes("resolveCompanyMembersLoadContext"), "2c: shared load context for results API");
assert(!appTsx.includes("localStorage.getItem(storageKeys.companyName)"), "2d: no localStorage companyName read in App");

/** 3: Friendly states + timeouts. */
assert(resultsService.includes("COMPANY_RESULTS_LOAD_TIMEOUT_MS"), "3: results list load timeout");
assert(resultsService.includes("COMPANY_RESULT_DETAIL_LOAD_TIMEOUT_MS"), "3b: result detail load timeout");
assert(resultsScreen.includes("COMPANY_RESULTS_LOADING_MESSAGE"), "3c: loading message in Results UI");
assert(resultsScreen.includes("resultsLoadError"), "3d: list error UI in Results screen");
assert(resultsScreen.includes("selectedResultLoadError"), "3e: detail error UI in Results screen");
assert(appTsx.includes("companyResultsState"), "3f: App tracks results load state");
assert(appTsx.includes("resultsLoading={companyResultsState.loading}"), "3g: loading wired to ResultsScreen");

/** 4: No PasswordHash in client results path. */
assert(resultsService.includes("PASSWORD_HASH_FIELD_NAMES"), "4: client strips PasswordHash fields");
assert(!resultsService.includes("PasswordHash") || resultsService.includes('["PasswordHash", "passwordHash"]'), "4b: hash only referenced for stripping");
assert(!resultsScreen.includes("PasswordHash"), "4c: Results UI omits PasswordHash");

/** 5: Session-scoped company folder on URL path only. */
assert(!resultsService.includes("URLSearchParams"), "5: client does not build authoritative query params");
assert(!resultsService.includes('params.set("companyFolderId"'), "5b: client does not send companyFolderId query");
assert(!resultsService.includes('params.set("masterSheetId"'), "5c: client does not send masterSheetId query");
assert(coreRoutes.includes("SESSION_COMPANY_MISMATCH"), "5d: server rejects session/URL company mismatch");
assert(
  /respondWithCompanyAuditResults[\s\S]{0,2200}trustClientSheetHints/.test(coreRoutes),
  "5e: canonical /results route does not trust client sheet hints",
);

/** 6: Safe JSON display helpers. */
assert(resultsService.includes("parseJsonField"), "6: answers/findings/evidence parsed safely");
assert(resultsService.includes("answersDisplay"), "6b: friendly JSON display fields mapped");
assert(resultsScreen.includes("answersDisplay"), "6c: Results UI renders safe JSON display");

/** 7: Screen wiring. */
assert(appTsx.includes('<ResultsScreen'), "7: App renders ResultsScreen");
assert(resultsScreen.includes("Results"), "7b: Results screen present");

/** 8: Results filters + scheduled-check polish. */
const resultsView = read("src/utils/resultsView.ts");
assert(resultsView.includes("filterEnrichedResults"), "8: results filter helper");
assert(resultsView.includes("enrichAuditResults"), "8b: schedule enrichment helper");
assert(appTsx.includes("schedules={managedSchedules}"), "8c: App passes schedules to ResultsScreen");
assert(resultsScreen.includes("Filter results"), "8d: filter panel in Results UI");
assert(resultsScreen.includes("No results match these filters."), "8e: filtered empty state");
assert(resultsScreen.includes("Scheduled check"), "8f: scheduled check label");
assert(
  resultsView.includes("Once per period") || resultsView.includes("Repeatable"),
  "8g: completion mode label",
);
assert(resultsScreen.includes("nameQuery"), "8h: check/schedule name filter");
assert(resultsScreen.includes("completedBy"), "8i: completed-by filter");
assert(resultsScreen.includes("fromDate"), "8j: date range filter");
assert(resultsScreen.includes("status"), "8k: status filter");
assert(resultsService.includes("frequency"), "8l: frequency mapped from AuditResults");

/** 9: Fast default list window + progressive loading. */
assert(resultsService.includes("DEFAULT_COMPANY_RESULTS_LIMIT"), "9: default results list limit");
assert(resultsService.includes("DEFAULT_COMPANY_RESULTS_SINCE_DAYS"), "9b: default results since-days");
assert(resultsService.includes("hasMore"), "9c: client handles hasMore pagination");
assert(resultsService.includes("offset="), "9d: client can request result offsets");
assert(resultsView.includes("createInitialResultsFilters"), "9e: default results date filter");
assert(resultsView.includes("enrichAuditResultBasic"), "9f: basic row enrichment without schedules");
assert(resultsScreen.includes("Load more"), "9g: load more control in Results UI");
assert(resultsScreen.includes("Refresh"), "9h: refresh control in Results UI");
assert(resultsScreen.includes("resultsLoadWarning"), "9i: non-blocking results warning");
assert(resultsScreen.includes("basicResults"), "9j: basic results render before schedule enrichment");
assert(coreRoutes.includes("applyListDefaults"), "9k: canonical results route applies list defaults");
assert(completionService.includes("AUDIT_RESULTS_SUMMARY_READ_RANGES"), "9l: summary-only AuditResults read");

console.log(`[verify:results-page-wiring] OK — ${caseCount} cases passed`);
