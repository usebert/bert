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
  "Completed today",
  "Outstanding",
  "Current incidents",
  "Overdue inspections",
];

const REQUIRED_AUDITOR_UI = [
  "My work today",
  "Due today",
  "Overdue",
  "Open actions",
  "Briefings",
  "Sync Centre",
];

assert(pkg.scripts["verify:auditor-dashboard"], "PKG: npm script registered");

assertRequired(auditorDashboard, "AUDITOR_HOME", REQUIRED_AUDITOR_UI);
assertForbidden(auditorDashboard, "AUDITOR_HOME", FORBIDDEN_AUDITOR_UI);

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

const liveOpsMounts = [...appTsx.matchAll(/<LiveOperationalDashboard/g)];
assert(liveOpsMounts.length === 2, "WIRE: LiveOperationalDashboard mounted exactly twice in App");

for (const match of liveOpsMounts) {
  const start = Math.max(0, match.index - 600);
  const prefix = appTsx.slice(start, match.index);
  assert(prefix.includes("shouldRenderLiveOperationalDashboard"), "WIRE: each live ops mount uses render guard");
  assert(prefix.includes("!canCompleteAuditAsAuditor"), "WIRE: each live ops mount excludes auditor path");
  assert(!prefix.includes('currentUser.role === "Auditor"'), "WIRE: live ops mount is not auditor-gated on");
}

assert(
  appTsx.includes('currentUser.role === "Admin"') && appTsx.includes("<LiveOperationalDashboard"),
  "WIRE: admin still mounts live operational dashboard",
);
assert(
  appTsx.includes('currentUser.role === "Manager"') && appTsx.includes("<LiveOperationalDashboard"),
  "WIRE: manager still mounts live operational dashboard",
);
assert(
  !/\{currentUser\.role === "Auditor"[\s\S]{0,400}<LiveOperationalDashboard/.test(appTsx),
  "WIRE: auditor does not mount live operational dashboard",
);
assert(
  !/\{currentUser\.role !== "Master" &&\s+currentUser\.role !== "Manager"[\s\S]{0,400}<LiveOperationalDashboard/.test(appTsx),
  "WIRE: pre-dashboard live panel is not shown to all non-manager roles",
);

assert(canViewFullOperationalDashboard({ role: "Admin" }), "ROLE: admin gets full operational dashboard");
assert(canViewFullOperationalDashboard({ role: "Manager" }), "ROLE: manager gets full operational dashboard");
assert(!canViewFullOperationalDashboard({ role: "Auditor" }), "ROLE: auditor does not get full operational dashboard");

assert(liveDashboard.includes("Operational compliance score"), "CONTROL: full dashboard still has compliance score");
assert(liveDashboard.includes("Highest-risk sites"), "CONTROL: full dashboard still has risk heat map");

console.log(`[verify:auditor-dashboard] OK — ${caseCount} cases passed`);
