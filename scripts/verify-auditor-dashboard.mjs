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

const auditorDashboard = read("src/components/dashboard/AuditorTaskDashboard.tsx");
const liveDashboard = read("src/components/dashboard/LiveOperationalDashboard.tsx");
const dashboardScreen = read("src/screens/DashboardScreen.tsx");
const appTsx = read("App.tsx");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:auditor-dashboard"], "PKG: npm script registered");

assert(auditorDashboard.includes("My work today"), "UI: auditor heading");
assert(auditorDashboard.includes("Due today"), "UI: due today KPI");
assert(auditorDashboard.includes("Overdue"), "UI: overdue KPI");
assert(auditorDashboard.includes("Open actions"), "UI: open actions KPI");
assert(auditorDashboard.includes("Briefings"), "UI: briefings KPI");
assert(auditorDashboard.includes("Priority list"), "UI: priority list is main panel");
assert(auditorDashboard.includes("Checks due today"), "UI: checks due today section");
assert(auditorDashboard.includes("Overdue checks"), "UI: overdue checks section");
assert(auditorDashboard.includes("My open actions"), "UI: open actions section");
assert(auditorDashboard.includes("Briefings to read/sign"), "UI: briefings section");
assert(auditorDashboard.includes("Failed / offline sync"), "UI: sync section when needed");
assert(auditorDashboard.includes("Start check"), "UI: start check quick button");
assert(auditorDashboard.includes("View my actions"), "UI: view my actions quick button");
assert(auditorDashboard.includes("View briefings"), "UI: view briefings quick button");
assert(auditorDashboard.includes("Sync Centre"), "UI: sync centre quick button");

assert(!auditorDashboard.includes("Operational compliance score"), "UI: no compliance score on auditor home");
assert(!auditorDashboard.includes("Highest-risk sites"), "UI: no risk heat map on auditor home");
assert(!auditorDashboard.includes("LiveOperationalDashboard"), "UI: auditor dashboard does not embed live ops panel");
assert(!auditorDashboard.includes("compliance score"), "UI: no compliance widgets on auditor home");

assert(dashboardScreen.includes("canCompleteAuditAsAuditor"), "ROUTE: auditor role branch exists");
assert(dashboardScreen.includes("renderAuditorDashboard()"), "ROUTE: auditor render prop used");

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
