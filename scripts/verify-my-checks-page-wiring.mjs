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
assert(!checkService.includes("isScheduleAssignedToUser"), "1f: client does not filter schedules by email");
assert(!checkService.includes("listCompanySchedules"), "1g: client does not list all schedules for My Checks");

/** 2: Session company context — no localStorage companyName truth. */
assert(contextService.includes("resolveActiveCompanyContext"), "2: unified company context resolver");
assert(appTsx.includes("activeCompanyContext"), "2b: App uses activeCompanyContext");
assert(appTsx.includes("resolveCompanyMembersLoadContext"), "2c: shared load context for assigned-checks API");
assert(!appTsx.includes("localStorage.getItem(storageKeys.companyName)"), "2d: no localStorage companyName read in App");

/** 3: Friendly states + timeouts. */
assert(checkService.includes("ASSIGNED_CHECKS_LOAD_TIMEOUT_MS"), "3: assigned checks load timeout");
assert(auditsScreen.includes("ASSIGNED_CHECKS_LOADING_MESSAGE"), "3b: loading message in My Checks UI");
assert(auditsScreen.includes("assignedChecksLoadError"), "3c: error UI in My Checks screen");
assert(appTsx.includes("assignedChecksState"), "3d: App tracks assigned checks load state");
assert(appTsx.includes("assignedChecksLoading={assignedChecksState.loading}"), "3e: loading wired to AuditsScreen");

/** 4: Assigned audits built from API schedules for all assignable completion roles. */
assert(
  /canCompleteAssignedCheck\(currentUser\.role\)[\s\S]{0,1200}assignedChecksState\.schedules/.test(appTsx),
  "4: assigned audits built from API schedules",
);
assert(appTsx.includes("buildAuditsFromAssignedSchedules"), "4a: schedules mapped to actionable audit cards");
assert(read("src/utils/assignedScheduleChecks.ts").includes("buildPlaceholderAuditFromScheduleAudit"), "4b: placeholder audits for missing templates");
assert(read("src/screens/AuditsScreen.tsx").includes("canCompleteAssignedCheck"), "4c: My Checks UI uses assigned-check completion permission");
assert(auditsScreen.includes("Start"), "4d: My Checks shows start action");
assert(auditsScreen.includes("Continue"), "4e: My Checks shows continue action");
{
  const fetchAssignedChecksCall =
    appTsx.match(/await fetchAssignedChecks\([\s\S]{0,500}\);/)?.[0] ?? "";
  assert(fetchAssignedChecksCall.length > 0, "4f: fetchAssignedChecks call present");
  assert(!fetchAssignedChecksCall.includes("userEmail"), "4g: App does not pass userEmail to fetchAssignedChecks");
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
