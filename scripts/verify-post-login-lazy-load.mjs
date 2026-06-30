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
const coreRoutes = read("server/core-workflow-routes.mjs");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:post-login-lazy-load"], "PKG: npm script registered");

/** 1: Screen gate helpers exported. */
assert(roleNavigation.includes("shouldLoadScheduleAssigneesScreen"), "1: schedule-assignees screen gate exported");
assert(roleNavigation.includes("shouldLoadCompanyResultsScreen"), "1b: results screen gate exported");
assert(roleNavigation.includes("shouldLoadSchedulesResultsEnrichment"), "1b2: schedules results enrichment gate exported");
assert(roleNavigation.includes("shouldLoadGoogleFormsScreen"), "1c: google-forms screen gate exported");
assert(roleNavigation.includes("shouldLoadCompanyMembersScreen"), "1c2: users screen gate exported");
assert(roleNavigation.includes("shouldLoadDashboardAssignedChecksPreview"), "1d: dashboard assigned-checks preview gate exported");
assert(roleNavigation.includes("shouldLoadFullAssignedChecksScreen"), "1d2: full assigned-checks screen gate exported");

/** 2: Heavy fetches are screen-gated in App.tsx useEffects. */
assert(
  /useEffect\([\s\S]{0,800}shouldLoadScheduleAssigneesScreen\(screen\)[\s\S]{0,8000}fetchScheduleAssignees/.test(appTsx),
  "2a: schedule-assignees fetch only when schedules/actions gate passes",
);
assert(
  /useEffect\([\s\S]{0,800}shouldLoadCompanyMembersScreen\(screen\)[\s\S]{0,8000}fetchCompanyMembers/.test(appTsx),
  "2b: users fetch only when users/invites/admin gate passes",
);
assert(
  /useEffect\([\s\S]{0,1200}shouldLoadCompanyResultsScreen\(screen\)[\s\S]{0,1200}shouldLoadSchedulesResultsEnrichment\(screen\)[\s\S]{0,1200}loadCompanyResults\("initial"\)/.test(
    appTsx,
  ),
  "2c: results fetch only when results/reports/schedules gate passes",
);
assert(
  /useEffect\([\s\S]{0,800}shouldLoadGoogleFormsScreen\(screen\)[\s\S]{0,8000}fetchCompanyGoogleForms/.test(appTsx),
  "2d: google-forms fetch only when Google Forms gate passes",
);
assert(
  /useEffect\([\s\S]{0,1600}shouldLoadDashboardAssignedChecksPreview\(screen, currentUser\.role\)[\s\S]{0,8000}fetchAssignedChecks/.test(
    appTsx,
  ),
  "2e: assigned-checks fetch uses dashboard preview gate",
);
assert(
  /useEffect\([\s\S]{0,2000}shouldLoadFullAssignedChecksScreen\(screen, currentUser\.role\)[\s\S]{0,8000}fetchAssignedChecks/.test(
    appTsx,
  ),
  "2f: assigned-checks fetch uses full Complete Work gate",
);

/** 3: Dashboard boot path must not call heavy endpoints unconditionally. */
assert(
  /useEffect\([\s\S]{0,600}shouldLoadCompanyMembersScreen\(screen\)/.test(appTsx),
  "3a: company members effect is screen-gated",
);
assert(
  !/shouldLoadCompanyMembersScreen[\s\S]{0,120}screen === "dashboard"/.test(roleNavigation),
  "3b: users gate does not include dashboard",
);
assert(
  /useEffect\([\s\S]{0,600}shouldLoadScheduleAssigneesScreen\(screen\)/.test(appTsx),
  "3c: schedule-assignees effect is screen-gated",
);
assert(
  !/shouldLoadScheduleAssigneesScreen[\s\S]{0,120}dashboard/.test(roleNavigation),
  "3d: schedule-assignees gate does not include dashboard",
);
assert(
  /useEffect\([\s\S]{0,800}shouldLoadCompanyResultsScreen\(screen\)[\s\S]{0,800}loadCompanyResults\("initial"\)/.test(
    appTsx,
  ),
  "3e: results initial load effect is screen-gated",
);
assert(
  !/shouldLoadCompanyResultsScreen[\s\S]{0,120}dashboard/.test(roleNavigation),
  "3f: results gate does not include dashboard",
);
assert(
  /useEffect\([\s\S]{0,600}shouldLoadGoogleFormsScreen\(screen\)/.test(appTsx),
  "3g: google-forms effect is screen-gated",
);
assert(!/shouldLoadGoogleFormsScreen[\s\S]{0,80}dashboard/.test(roleNavigation), "3h: google-forms gate does not include dashboard");

/** 4: Page-owned loading — routes still wired when user navigates. */
assert(
  roleNavigation.includes('return screen === "schedules" || screen === "actions"'),
  "4a: schedules route owns schedule-assignees",
);
assert(
  roleNavigation.includes('return screen === "users" || screen === "invites" || screen === "admin"'),
  "4b: users route owns company members",
);
assert(
  roleNavigation.includes('return screen === "results" || screen === "reports"'),
  "4c: results route owns company results",
);
assert(roleNavigation.includes('return screen === "googleForms"'), "4d: google-forms route owns forms list");
assert(schedulesScreen.includes("availableAssignees") || appTsx.includes("availableScheduleAssignees"), "4e: schedules still receives assignees");
assert(
  googleFormsScreen.includes("forms,") || googleFormsScreen.includes("forms:"),
  "4f: Google Forms screen still receives forms prop",
);
assert(resultsScreen.includes("resultsLoading"), "4g: Results screen still receives loading prop");
assert(appTsx.includes('screen === "schedules"'), "4h: schedules route still mounted");
assert(appTsx.includes('screen === "googleForms"'), "4i: googleForms route still mounted");
assert(appTsx.includes('screen === "results"'), "4j: results route still mounted");

/** 5: Dashboard assigned-checks preview is lightweight; Complete Work keeps full fetch. */
assert(checkService.includes("DASHBOARD_ASSIGNED_CHECKS_PREVIEW_LIMIT"), "5a: dashboard preview limit constant exported");
assert(
  appTsx.includes("DASHBOARD_ASSIGNED_CHECKS_PREVIEW_LIMIT") &&
    /fetchAssignedChecks\([\s\S]{0,400}limit:\s*previewLimit/.test(appTsx),
  "5b: dashboard preview passes limit to fetchAssignedChecks",
);
assert(
  /shouldLoadFullAssignedChecksScreen\(screen, currentUser\.role\)[\s\S]{0,4000}previewLimit/.test(appTsx) === false ||
    /previewLimit = isDashboardPreview \? DASHBOARD_ASSIGNED_CHECKS_PREVIEW_LIMIT : undefined/.test(appTsx),
  "5c: preview limit only applies on dashboard",
);
assert(coreRoutes.includes("req.query.limit"), "5d: server assigned-checks accepts limit query param");
assert(
  roleNavigation.includes("isCompleteWorkListScreen(screen)") &&
    roleNavigation.includes("shouldLoadFullAssignedChecksScreen"),
  "5e: full assigned-checks tied to Complete Work screen",
);

/** 6: In-flight dedupe wired for heavy endpoints. */
assert(requestDedupe.includes("dedupeInFlight"), "6: dedupeInFlight utility present");
assert(checkService.includes("dedupeInFlight") && checkService.includes("/api/me/assigned-checks"), "6b: assigned-checks deduped");
assert(
  scheduleService.includes("dedupeInFlight") && scheduleService.includes("schedule-assignees"),
  "6c: schedule-assignees deduped",
);
assert(resultsService.includes("dedupeInFlight") && resultsService.includes("/results"), "6d: results deduped");
assert(
  companyFormsService.includes("dedupeInFlight") && companyFormsService.includes("/google-forms"),
  "6e: google-forms deduped",
);

/** 7: Dashboard shell renders while Things To Do loads. */
assert(dashboardThingsToDo.includes("DashboardThingsToDoSection"), "7: Things To Do section component");
assert(dashboardThingsToDo.includes("animate-pulse"), "7b: skeleton placeholders while assigned-checks load");
assert(appTsx.includes("<CompanyAdminDashboard") || appTsx.includes("<DashboardScreen"), "7c: dashboard shell still rendered from App");
assert(appTsx.includes("assignedChecksLoading={assignedChecksState.loading}"), "7d: loading state passed to dashboard");

console.log(`[verify:post-login-lazy-load] OK — ${caseCount} cases passed`);
