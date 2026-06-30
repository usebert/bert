#!/usr/bin/env node
/** Post-login boot must not eagerly load heavy company APIs; page-open hooks + in-flight dedupe. */
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
const roleNavigation = read("src/config/roleNavigation.ts");
const requestDedupe = read("src/utils/requestDedupe.ts");
const checkService = read("src/services/checkService.ts");
const scheduleService = read("src/services/scheduleService.ts");
const resultsService = read("src/services/resultsService.ts");
const companyFormsService = read("src/services/companyFormsService.ts");
const dashboardThingsToDo = read("src/components/dashboard/DashboardThingsToDoSection.tsx");
const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
const googleFormsScreen = read("src/screens/GoogleFormsScreen.tsx");
const resultsScreen = read("src/screens/ResultsScreen.tsx");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:post-login-lazy-load"], "PKG: npm script registered");

/** 1: Boot gates — heavy endpoints gated by routed screen helpers. */
assert(roleNavigation.includes("shouldLoadScheduleAssigneesScreen"), "1: schedule-assignees screen gate exported");
assert(roleNavigation.includes("shouldLoadCompanyResultsScreen"), "1b: results screen gate exported");
assert(roleNavigation.includes("shouldLoadGoogleFormsScreen"), "1c: google-forms screen gate exported");
assert(roleNavigation.includes("shouldLoadAssignedChecksScreen"), "1d: assigned-checks screen gate exported");

assert(
  /useEffect\([\s\S]{0,800}shouldLoadScheduleAssigneesScreen\(screen\)[\s\S]{0,8000}fetchScheduleAssignees/.test(appTsx),
  "1e: schedule-assignees fetch only when schedules UI gate passes",
);
assert(
  /useEffect\([\s\S]{0,500}shouldLoadCompanyResultsScreen\(screen\)[\s\S]{0,1200}loadCompanyResults\("initial"\)/.test(
    appTsx,
  ),
  "1f: results fetch only when results/reports/schedules gate passes",
);
assert(
  /useEffect\([\s\S]{0,500}shouldLoadGoogleFormsScreen\(screen\)[\s\S]{0,8000}fetchCompanyGoogleForms/.test(appTsx),
  "1g: google-forms fetch only when Google Forms gate passes",
);
assert(
  /useEffect\([\s\S]{0,1200}shouldLoadAssignedChecksScreen\(screen[\s\S]{0,8000}fetchAssignedChecks/.test(appTsx),
  "1h: assigned-checks fetch gated by dashboard/complete-work screens",
);

/** 2: Post-login dashboard boot must not call heavy endpoints unconditionally. */
assert(
  /useEffect\([\s\S]{0,500}shouldLoadCompanyResultsScreen\(screen\)[\s\S]{0,400}loadCompanyResults\("initial"\)/.test(
    appTsx,
  ),
  "2: results initial load is screen-gated",
);
assert(
  /useEffect\([\s\S]{0,500}shouldLoadGoogleFormsScreen\(screen\)[\s\S]{0,8000}fetchCompanyGoogleForms/.test(appTsx),
  "2b: google-forms load is screen-gated",
);
assert(
  /useEffect\([\s\S]{0,500}shouldLoadScheduleAssigneesScreen\(screen\)[\s\S]{0,8000}fetchScheduleAssignees/.test(appTsx),
  "2c: schedule-assignees load is screen-gated",
);

/** 3: In-flight dedupe wired for the four heavy endpoints. */
assert(requestDedupe.includes("dedupeInFlight"), "3: dedupeInFlight utility present");
assert(checkService.includes("dedupeInFlight") && checkService.includes("/api/me/assigned-checks"), "3b: assigned-checks deduped");
assert(
  scheduleService.includes("dedupeInFlight") && scheduleService.includes("schedule-assignees"),
  "3c: schedule-assignees deduped",
);
assert(resultsService.includes("dedupeInFlight") && resultsService.includes("/results"), "3d: results deduped");
assert(
  companyFormsService.includes("dedupeInFlight") && companyFormsService.includes("/google-forms"),
  "3e: google-forms deduped",
);

/** 4: Dashboard shell renders while Things To Do loads. */
assert(dashboardThingsToDo.includes("DashboardThingsToDoSection"), "4: Things To Do section component");
assert(dashboardThingsToDo.includes("animate-pulse"), "4b: skeleton placeholders while assigned-checks load");
assert(appTsx.includes("<CompanyAdminDashboard"), "4c: dashboard shell still rendered from App");
assert(appTsx.includes("assignedChecksLoading={assignedChecksState.loading}"), "4d: loading state passed to dashboard");

/** 5: Page-open loaders still wired when user navigates. */
assert(schedulesScreen.includes("availableAssignees") || appTsx.includes("availableScheduleAssignees"), "5: schedules still receives assignees");
assert(
  googleFormsScreen.includes("forms,") || googleFormsScreen.includes("forms:"),
  "5b: Google Forms screen still receives forms prop",
);
assert(resultsScreen.includes("resultsLoading"), "5c: Results screen still receives loading prop");
assert(appTsx.includes('screen === "schedules"'), "5d: schedules route still mounted");
assert(appTsx.includes('screen === "googleForms"'), "5e: googleForms route still mounted");
assert(appTsx.includes('screen === "results"'), "5f: results route still mounted");

console.log(`[verify:post-login-lazy-load] OK — ${caseCount} cases passed`);
