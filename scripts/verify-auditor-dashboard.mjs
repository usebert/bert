#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canViewFullOperationalDashboard } from "../shared/live-dashboard.mjs";

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

function assertForbidden(source, label, patterns) {
  for (const pattern of patterns) {
    assert(!source.toLowerCase().includes(pattern.toLowerCase()), `${label}: must not include "${pattern}"`);
  }
}

function assertRequired(source, label, patterns) {
  for (const pattern of patterns) {
    assert(source.includes(pattern), `${label}: must include "${pattern}"`);
  }
}

const auditorDashboard = read("src/components/dashboard/AuditorTaskDashboard.tsx");
const unifiedDashboard = read("src/components/dashboard/unified/UnifiedOperationalDashboard.tsx");
const roleConfig = read("src/dashboard/unified/roleConfig.ts");
const performanceKpis = read("src/dashboard/unified/buildPerformanceKpis.ts");
const liveDashboard = read("src/components/dashboard/LiveOperationalDashboard.tsx");
const dashboardScreen = read("src/screens/DashboardScreen.tsx");
const permissions = read("src/permissions.ts");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));

const FORBIDDEN_AUDITOR_UI = [
  "LIVE OPERATIONS",
  "Live operations",
  "Operational compliance score",
  "Hotspots",
  "Highest-risk sites",
  'title="Overdue inspections"',
  "Completed today",
  "Outstanding",
  "Current incidents",
];

const REQUIRED_AUDITOR_UI = [
  "Needs attention",
  "Today's work",
];

const REQUIRED_AUDITOR_METRICS = [
  "Due today",
  "Overdue actions",
  "Open actions",
  "Outstanding briefings",
];

assert(pkg.scripts["verify:auditor-dashboard"], "PKG: npm script registered");

assert(auditorDashboard.includes("RoleUnifiedDashboard"), "AUDITOR_HOME: uses unified operational layout");
assertRequired(unifiedDashboard, "AUDITOR_UNIFIED", REQUIRED_AUDITOR_UI);
assertRequired(performanceKpis, "AUDITOR_METRICS", REQUIRED_AUDITOR_METRICS);
assertForbidden(unifiedDashboard, "AUDITOR_UNIFIED", FORBIDDEN_AUDITOR_UI);
assert(roleConfig.includes('role === "Auditor"') || roleConfig.includes("Auditor:"), "AUDITOR_UNIFIED: auditor role config present");
assert(roleConfig.includes('screen: "briefings"'), "AUDITOR_UNIFIED: briefings shortcut retained");
assert(roleConfig.includes('screen: "sync"') || roleConfig.includes("sync-queued"), "AUDITOR_UNIFIED: sync shortcut retained");

assert(!auditorDashboard.includes("LiveOperationalDashboard"), "AUDITOR_HOME: does not import live ops panel");

assert(dashboardScreen.includes("canCompleteAuditAsAuditor"), "ROUTE: auditor role branch exists");
assert(dashboardScreen.includes("renderAuditorDashboard()"), "ROUTE: auditor render prop used");
assert(
  /if \(canCompleteAuditAsAuditor\(currentUser\.role\)\) \{[\s\S]*return <>\{renderAuditorDashboard\(\)\}<\/>;/.test(
    dashboardScreen,
  ),
  "ROUTE: auditor dashboard is exclusive return path",
);

assert(permissions.includes("shouldRenderLiveOperationalDashboard"), "PERM: live ops render guard exported");
assert(
  permissions.includes('return role === "Admin" || role === "Manager"'),
  "PERM: live ops render guard is admin/manager only",
);

assert(
  liveDashboard.includes("shouldRenderLiveOperationalDashboard"),
  "LIVE_OPS: component imports render guard",
);
assert(
  liveDashboard.includes("if (!shouldRenderLiveOperationalDashboard(role))"),
  "LIVE_OPS: component returns null for non-admin/manager roles",
);

assert(!appTsx.includes("<LiveOperationalDashboard"), "WIRE: App no longer mounts legacy LiveOperationalDashboard blocks");
assert(
  !/\{currentUser\.role === "Auditor"[\s\S]{0,400}<LiveOperationalDashboard/.test(appTsx),
  "WIRE: auditor does not mount live operational dashboard",
);

assert(canViewFullOperationalDashboard({ role: "Admin" }), "ROLE: admin gets full operational dashboard");
assert(canViewFullOperationalDashboard({ role: "Manager" }), "ROLE: manager gets full operational dashboard");
assert(!canViewFullOperationalDashboard({ role: "Auditor" }), "ROLE: auditor does not get full operational dashboard");

assert(liveDashboard.includes("Operational compliance score"), "CONTROL: full dashboard still has compliance score");
assert(liveDashboard.includes("Highest-risk sites"), "CONTROL: full dashboard still has risk heat map");

console.log(`[verify:auditor-dashboard] OK — ${caseCount} cases passed`);
