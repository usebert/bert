#!/usr/bin/env node
/** My Checks page — assigned schedules from GET /api/me/assigned-checks only. */
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
const auditsScreen = read("src/screens/AuditsScreen.tsx");
const checkService = read("src/services/checkService.ts");
const contextService = read("src/services/companyContextService.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
const roleNav = read("src/config/roleNavigation.ts");
const auditAccess = read("src/utils/auditAccess.ts");
const managerDashboard = read("src/components/dashboard/ManagerRoleDashboard.tsx");
const thingsToDoSection = read("src/components/dashboard/DashboardThingsToDoSection.tsx");
const assignedCheckRow = read("src/components/checks/AssignedCheckActionRow.tsx");
const assignedCheckDisplay = read("src/utils/assignedCheckDisplay.ts");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:my-checks-page-wiring"], "PKG: npm script registered");

/** 1: Canonical GET /api/me/assigned-checks only. */
assert(checkService.includes("fetchAssignedChecks"), "1: client fetchAssignedChecks");
assert(checkService.includes("/api/me/assigned-checks"), "1b: assigned-checks API path");
assert(coreRoutes.includes('app.get("/api/me/assigned-checks"'), "1c: server route registered");
assert(appTsx.includes("fetchAssignedChecks"), "1d: App loads assigned checks via fetchAssignedChecks");
assert(
  /useEffect\([\s\S]{0,4500}fetchAssignedChecks/.test(appTsx),
  "1e: page load uses session company context + fetchAssignedChecks",
);
assert(roleNav.includes('id: "audits", label: "Complete Work"'), "1e0: Complete Work nav id is audits");
assert(roleNav.includes("isCompleteWorkListScreen"), "1e0b: Complete Work screen helper exported");
assert(roleNav.includes("shouldLoadAssignedChecksScreen"), "1e0c: assigned-checks screen gate helper exported");
assert(roleNav.includes("COMPLETE_WORK_NAV_SCREEN_ID"), "1e0d: Complete Work nav screen constant exported");
assert(appTsx.includes("shouldLoadAssignedChecksScreen"), "1e1: App gates assigned-checks load via screen helper");
assert(appTsx.includes("isCompleteWorkListScreen"), "1e1b: App renders Complete Work via screen helper");
assert(
  /shouldLoadAssignedChecksScreen\(screen, currentUser\.role\)[\s\S]{0,3200}fetchAssignedChecks/.test(appTsx),
  "1e2: Complete Work screen gate triggers fetchAssignedChecks",
);
assert(
  !/shouldLoadAssignedChecksScreen\(screen, currentUser\.role\)[\s\S]{0,400}Boolean\(companyId\)/.test(appTsx),
  "1e3: assigned-checks load does not require client companyId",
);
assert(
  /screen !== "schedules"[\s\S]{0,2200}listCompanySchedules/.test(appTsx),
  "1e4: company schedules list loads only on Schedules screen",
);
assert(auditAccess.includes("buildCompleteWorkAssignedAudits"), "1e5: assigned checks builder is API-only");
assert(!appTsx.includes("companySchedulesState.loadError") || !/AuditsScreen[\s\S]{0,400}companySchedulesState/.test(appTsx), "1e6: Complete Work does not wire company schedule list errors");
assert(!checkService.includes("isScheduleAssignedToUser"), "1f: client does not filter schedules by email");
assert(!checkService.includes("listCompanySchedules"), "1g: client does not list all schedules for My Checks");
assert(auditsScreen.includes("AssignedCheckActionRow"), "1h: assigned checks list uses shared Start/Continue row");
assert(assignedCheckRow.includes('"Start check"'), "1i: assigned checks list exposes Start check action");
assert(assignedCheckRow.includes('"Continue check"'), "1i2: assigned checks list exposes Continue check action");
assert(roleNav.includes('screen === "dashboard"'), "1e0e: dashboard screen loads assigned checks");
assert(thingsToDoSection.includes("Things to do"), "1e0f: dashboard Things to do section title");
assert(thingsToDoSection.includes("No checks due right now."), "1e0g: dashboard Things to do empty state");
assert(managerDashboard.includes("DashboardThingsToDoSection"), "1e0h: manager dashboard renders Things to do section");
assert(read("src/components/dashboard/CompanyAdminDashboard.tsx").includes("DashboardThingsToDoSection"), "1e0h1: admin dashboard renders Things to do section");
assert(read("src/components/dashboard/AuditorTaskDashboard.tsx").includes("Checks due today"), "1e0h1b: auditor dashboard renders checks priority section");
assert(read("src/components/dashboard/MasterPlatformDashboard.tsx").includes("DashboardThingsToDoSection"), "1e0h1c: master dashboard renders Things to do when company linked");
assert(read("src/components/dashboard/CompanyAdminDashboard.tsx").includes("DashboardThingsToDoSection"), "1e0h1: admin dashboard renders Things to do section");
assert(read("src/components/dashboard/MasterPlatformDashboard.tsx").includes("DashboardThingsToDoSection"), "1e0h1b: master dashboard renders Things to do section");
assert(
  managerDashboard.indexOf("DashboardThingsToDoSection") < managerDashboard.indexOf("Open actions"),
  "1e0h2: Things to do appears before Open actions on manager dashboard",
);
assert(assignedCheckRow.includes('"Start check"'), "1e0i: shared assigned-check row exposes Start check");
assert(assignedCheckRow.includes('"Continue check"'), "1e0j: shared assigned-check row exposes Continue check");
assert(assignedCheckDisplay.includes('"Not due yet"'), "1e0m: dashboard status includes Not due yet");
assert(assignedCheckDisplay.includes('"Overdue"'), "1e0n: dashboard status includes Overdue");
assert(appTsx.includes("buildAssignedCheckScheduleMeta"), "1e0k: App builds schedule meta for dashboard cards");
assert(assignedCheckDisplay.includes("filterAssignedChecksForThingsToDo"), "1e0l1: Things to do due-check filter helper");
assert(assignedCheckDisplay.includes("assignedCheckCardStatus"), "1e0l2: assigned-check card status helper");
assert(
  /renderManagerDashboard[\s\S]{0,1200}assignedCheckScheduleMeta/.test(appTsx),
  "1e0m: manager dashboard receives assigned-check schedule meta",
);
assert(auditsScreen.includes("AssignedCheckActionRow"), "1e0n: Complete Work reuses shared assigned-check row");
assert(
  thingsToDoSection.includes("AssignedCheckActionRow") && thingsToDoSection.includes("onOpenAudit={onOpenAudit}"),
  "1e0o: dashboard Things to do wires Start through shared AssignedCheckActionRow",
);
assert(
  /renderManagerDashboard[\s\S]{0,1600}onOpenAudit=\{startAudit\}/.test(appTsx),
  "1e0p: manager dashboard passes startAudit to Things to do",
);
assert(
  /const activeAudit = useMemo\([\s\S]{0,900}assignedAudits\.find/.test(appTsx),
  "1e0q: activeAudit resolves assigned-check audits for completion wizard",
);

/** 2: Session company context — no localStorage companyName truth. */
assert(contextService.includes("resolveActiveCompanyContext"), "2: unified company context resolver");
assert(appTsx.includes("activeCompanyContext"), "2b: App uses activeCompanyContext");
assert(appTsx.includes("resolveCompanyMembersLoadContext"), "2c: shared load context for assigned-checks API");
assert(!appTsx.includes("localStorage.getItem(storageKeys.companyName)"), "2d: no localStorage companyName read in App");

/** 3: Friendly states + timeouts. */
assert(checkService.includes("ASSIGNED_CHECKS_LOAD_TIMEOUT_MS"), "3: assigned checks load timeout");
assert(auditsScreen.includes("ASSIGNED_CHECKS_LOADING_MESSAGE"), "3b: loading message in My Checks UI");
assert(auditsScreen.includes("ASSIGNED_CHECKS_REFRESHING_MESSAGE"), "3b1: refreshing message shown while cache reloads");
assert(appTsx.includes("readAssignedChecksCache"), "3b2: App warms assigned checks from localStorage cache");
{
  const timeoutMatch = checkService.match(/ASSIGNED_CHECKS_LOAD_TIMEOUT_MS\s*=\s*([\d_]+)/);
  const timeoutMs = Number(String(timeoutMatch?.[1] || "0").replace(/_/g, ""));
  assert(timeoutMs >= 180_000, "3c: assigned checks timeout is production-safe");
}
assert(auditsScreen.includes("assignedChecksLoadError"), "3c: error UI in My Checks screen");
assert(appTsx.includes("assignedChecksState"), "3d: App tracks assigned checks load state");
assert(appTsx.includes("assignedChecksLoading={assignedChecksState.loading}"), "3e: loading wired to AuditsScreen");
assert(appTsx.includes("assignedChecksLoadError={assignedChecksState.loadError}"), "3e1: error wired to AuditsScreen");
assert(appTsx.includes("assignedChecksRequestRef"), "3e2: assigned-check fetch uses request generation guard");
assert(appTsx.includes("hasLoadedOnce"), "3e3: assigned-check state tracks initial load completion");
assert(
  /shouldLoadAssignedChecksScreen\(screen, currentUser\.role\)[\s\S]{0,220}loading:\s*false/.test(appTsx),
  "3e4: leaving assigned-check screens clears loading",
);
assert(
  /!result\.ok[\s\S]{0,320}loading:\s*false/.test(appTsx),
  "3e5: assigned-check fetch failure clears loading",
);
assert(
  /schedules:\s*result\.schedules[\s\S]{0,180}loading:\s*false/.test(appTsx),
  "3e6: assigned-check fetch success clears loading",
);
assert(thingsToDoSection.includes("loadError"), "3e7: dashboard Things to do handles load errors");
assert(auditsScreen.includes("assignedChecksLoadErrorDetail"), "3f: error detail wired in My Checks UI");
assert(appTsx.includes("assignedChecksLoadErrorDetail"), "3g: App passes assigned checks error detail");
assert(appTsx.includes("usesAssignedChecksCompletionFlow(currentUser.role)"), "3h: assigned checks load gated to completable roles");

/** 4: No legacy auditor-only / client email filtering for auditor My Checks. */
assert(
  /usesAssignedChecksCompletionFlow\(currentUser\.role\)[\s\S]{0,1200}assignedChecksState\.schedules/.test(appTsx),
  "4: assigned audits built from API schedules for all completable roles",
);
assert(appTsx.includes("buildCompleteWorkAssignedAudits"), "4d: App builds Complete Work audits from assigned-checks API");
assert(auditsScreen.includes("myAssignedChecks"), "4e: AuditsScreen accepts myAssignedChecks for Admin/Manager");
assert(auditsScreen.includes("My assigned checks"), "4f: Admin/Manager see assigned checks action section");
assert(auditsScreen.includes("audits={myAssignedChecks}"), "4g: Auditor My Checks renders from myAssignedChecks prop");
{
  const fetchAssignedChecksCall =
    appTsx.match(/await fetchAssignedChecks\([\s\S]{0,500}\);/)?.[0] ?? "";
  assert(fetchAssignedChecksCall.length > 0, "4b: fetchAssignedChecks call present");
  assert(!fetchAssignedChecksCall.includes("userEmail"), "4c: App does not pass userEmail to fetchAssignedChecks");
}

/** 4d: Screen fixture — Complete Work nav id must trigger assigned-checks load gate. */
{
  const completeWorkScreenMatch = roleNav.match(
    /export function isCompleteWorkListScreen\(screen: RoutedScreen\)[\s\S]{0,120}?return screen === ([^;]+);/,
  );
  assert(completeWorkScreenMatch, "4d1: isCompleteWorkListScreen helper present");
  assert(completeWorkScreenMatch[1].includes("COMPLETE_WORK_NAV_SCREEN_ID"), "4d2: Complete Work screen uses nav constant");
  assert(roleNav.includes('export const COMPLETE_WORK_NAV_SCREEN_ID = "audits"'), "4d3: Complete Work nav constant is audits");
  assert(roleNav.includes("export function shouldLoadAssignedChecksScreen(screen: RoutedScreen, role?: Role)"), "4d4: shouldLoadAssignedChecksScreen helper present");
  assert(roleNav.includes("isCompleteWorkListScreen(screen)"), "4d5: load gate includes Complete Work screen");
  assert(roleNav.includes('role === "Master" && screen === "godmodeHome"'), "4d5b: load gate includes Master godmode home");
  assert(appTsx.includes("shouldLoadAssignedChecksScreen(screen, currentUser.role)"), "4d6: App calls load gate with current screen and role");
}

/** 5: Backend uses session email + company folder; rejects query email override. */
assert(coreRoutes.includes("signedInEmail"), "5: route resolves signed-in email from session");
assert(coreRoutes.includes("ASSIGNED_CHECKS_IDENTITY_MISMATCH"), "5b: route rejects email query override");
assert(coreRoutes.includes("SESSION_COMPANY_REQUIRED"), "5c: route requires session company folder");
assert(
  !/assigned-checks[\s\S]{0,2200}req\.query\.companyFolderId/.test(coreRoutes),
  "5d: route does not trust companyFolderId query param",
);
assert(
  !checkService.includes('params.set("companyFolderId"') && !checkService.includes('params.set("masterSheetId"'),
  "5e: client does not send authoritative company/sheet query params",
);
assert(!checkService.includes("URLSearchParams"), "5f: client calls assigned-checks without query builder");

console.log(`[verify:my-checks-page-wiring] OK — ${caseCount} cases passed`);
