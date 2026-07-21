#!/usr/bin/env node
/** Reports dashboard — aggregation, role visibility, route wiring, empty states. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReportsDashboardFromTabs,
  canViewReportsDashboard,
  REPORTS_EMPTY_NO_DATA,
  REPORTS_EMPTY_SCHEDULES_ONLY,
  shouldScopeReportsToOwnHistory,
} from "../shared/reports-dashboard.mjs";

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

const ownCompany = "folder-testco";
const otherCompany = "folder-other";
const coreRoutes = read("server/core-workflow-routes.mjs");
const reportsService = read("server/reports-dashboard-service.mjs");
const reportsScreen = read("src/screens/ReportsScreen.tsx");
const dashboardPanel = read("src/components/reports/ReportsDashboardPanel.tsx");
const pkg = JSON.parse(read("package.json"));

const sampleTabs = {
  Schedules: [
    {
      "Schedule ID": "sched-1",
      "Company Folder ID": ownCompany,
      "Schedule Name": "Weekly walk",
      "Audit ID": "audit-3",
      "Template Name": "Fire walk",
      Frequency: "Weekly",
      "Assigned User Emails": "auditor@testco.test",
      Status: "ACTIVE",
      "Health State": "Overdue",
    },
  ],
  AuditResults: [
    {
      "Result ID": "res-1",
      "Audit ID": "audit-1",
      "Area ID": "area-1",
      "Company ID": ownCompany,
      Status: "Passed",
      "Completed By": "auditor@testco.test",
      "Completed At": "2026-06-08T10:00:00.000Z",
    },
    {
      "Result ID": "res-2",
      "Audit ID": "audit-2",
      "Area ID": "area-2",
      "Company ID": ownCompany,
      Status: "Failed",
      "Completed By": "manager@testco.test",
      "Completed At": "2026-06-09T11:00:00.000Z",
    },
  ],
  AuditFindings: [
    {
      "Finding ID": "find-1",
      "Audit ID": "audit-2",
      "Question ID": "q-1",
      "Company ID": ownCompany,
      "Risk Level": "High",
      "Created At": "2026-06-09T11:00:00.000Z",
    },
    {
      "Finding ID": "find-2",
      "Audit ID": "audit-2",
      "Question ID": "q-2",
      "Company ID": ownCompany,
      "Risk Level": "Critical",
      "Created At": "2026-06-09T11:05:00.000Z",
    },
  ],
  Actions: [
    {
      "Action ID": "act-1",
      "Company ID": ownCompany,
      Status: "Open",
      "Source Audit ID": "audit-2",
      "Source Question ID": "q-9",
      "Assigned To User ID": "manager@testco.test",
      "Created At": "2026-06-09T12:00:00.000Z",
      "Due Date": "2026-12-31T00:00:00.000Z",
    },
    {
      "Action ID": "act-2",
      "Company ID": ownCompany,
      Status: "Closed",
      "Source Audit ID": "audit-2",
      "Source Question ID": "q-1",
      "Created At": "2026-06-01T12:00:00.000Z",
    },
  ],
  Areas: [
    { "Area ID": "area-1", Name: "Yard" },
    { "Area ID": "area-2", Name: "Plant" },
  ],
  Evidence: [],
  Reports: [],
};

/** 1: summary cards aggregate scheduled, completed, overdue, findings, actions, completion %. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, {
    companyFolderId: ownCompany,
    dateRange: "all",
  });
  assert(built.summary.totalChecksScheduled >= 1, "1: scheduled checks counted");
  assert(built.summary.completedChecks === 2, "1b: completed checks counted");
  assert(built.summary.overdueChecks >= 1, "1c: overdue schedules counted");
  assert(built.summary.openFindings === 1, "1d: open findings exclude closed actions");
  assert(built.summary.openActions === 1, "1e: open actions counted");
  assert(built.summary.completionRatePercent > 0, "1f: completion rate computed");
}

/** 2: checks completed over time line data. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, { companyFolderId: ownCompany, dateRange: "all" });
  assert(built.charts.checksCompletedOverTime.length >= 2, "2: checks completed over time has points");
}

/** 3: completion rate by site/area bar data. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, { companyFolderId: ownCompany, dateRange: "all" });
  assert(
    built.charts.completionRateBySiteArea.some((row) => row.label === "Yard" || row.label === "Plant"),
    "3: completion rate by area",
  );
}

/** 4: open findings by severity buckets. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, { companyFolderId: ownCompany, dateRange: "all" });
  const critical = built.charts.openFindingsBySeverity.find((row) => row.label === "Critical");
  assert(critical?.value === 1, "4: critical open finding counted");
}

/** 5: open actions by status buckets. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, { companyFolderId: ownCompany, dateRange: "all" });
  const open = built.charts.openActionsByStatus.find((row) => row.label === "Open");
  const closed = built.charts.openActionsByStatus.find((row) => row.label === "Closed");
  assert(open?.value === 1 && closed?.value === 1, "5: action status buckets");
}

/** 6: outstanding checks by assignee horizontal bar data. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, { companyFolderId: ownCompany, dateRange: "all" });
  assert(
    built.charts.outstandingChecksByAssignee.some((row) => row.label.includes("auditor@testco.test")),
    "6: outstanding checks by assignee",
  );
}

/** 7: pass/fail trend line data. */
{
  const built = buildReportsDashboardFromTabs(sampleTabs, { companyFolderId: ownCompany, dateRange: "all" });
  assert(built.charts.passFailTrend.some((row) => row.pass > 0 || row.fail > 0), "7: pass/fail trend populated");
}

/** 8: Godmode can view selected company; company admin own company only. */
{
  assert(
    canViewReportsDashboard({ kind: "master", role: "Master" }, ownCompany),
    "8: Godmode can view company reports",
  );
  assert(
    canViewReportsDashboard({ role: "Admin", companyId: ownCompany }, ownCompany),
    "8b: company admin can view own company",
  );
  assert(
    !canViewReportsDashboard({ role: "Admin", companyId: ownCompany }, otherCompany),
    "8c: company admin cannot view other company",
  );
}

/** 9: Manager area scope + Auditor own history only. */
{
  assert(shouldScopeReportsToOwnHistory({ role: "Auditor" }), "9: auditor scoped to own history");
  assert(!shouldScopeReportsToOwnHistory({ role: "Manager" }), "9b: manager not limited to own history");
  const scoped = buildReportsDashboardFromTabs(sampleTabs, {
    companyFolderId: ownCompany,
    dateRange: "all",
    actor: { role: "Auditor", email: "auditor@testco.test" },
  });
  assert(scoped.summary.completedChecks === 1, "9c: auditor sees only own completed checks");
}

/** 10: missing tab → empty arrays, no throw. */
{
  const partial = { Schedules: sampleTabs.Schedules };
  const built = buildReportsDashboardFromTabs(partial, { companyFolderId: ownCompany, dateRange: "all" });
  assert(Array.isArray(built.charts.passFailTrend), "10: missing tabs return empty chart arrays");
  assert(built.emptyState === "schedules-only", "10b: schedules-only empty state");
}

/** 11: schedules-only vs no-data empty messages exported. */
{
  assert(REPORTS_EMPTY_NO_DATA.includes("Complete a check"), "11: no-data empty message");
  assert(REPORTS_EMPTY_SCHEDULES_ONLY.includes("Schedules are set up"), "11b: schedules-only empty message");
}

/** 12: API route + frontend components + package script wired. */
{
  assert(coreRoutes.includes("/api/companies/:companyId/reports/dashboard"), "12: dashboard API route");
  assert(reportsService.includes("getReportsDashboard"), "12b: dashboard service");
  assert(reportsScreen.includes("ReportsDashboardPanel"), "12c: Reports screen integration");
  assert(dashboardPanel.includes("Updating report data"), "12d: quiet refresh banner");
  assert(pkg.dependencies.recharts, "12e: recharts dependency");
  assert(pkg.scripts["verify:reports-dashboard"], "12f: verify script registered");
}

console.log(`[verify:reports-dashboard] OK — ${caseCount} cases passed`);
