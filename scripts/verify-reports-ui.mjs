#!/usr/bin/env node
/** verify:reports-ui — BERT Reports module Release 6 checks. */
import { readFileSync } from "node:fs";
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
  console.log(`ok ${caseCount}: ${message}`);
}
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const workspace = read("src/reports/ReportsWorkspace.tsx");
const screen = read("src/screens/ReportsScreen.tsx");
const dashboard = read("src/components/reports/ReportsDashboardPanel.tsx");
const app = read("App.tsx");

assert(Boolean(pkg.scripts?.["verify:reports-ui"]), "package.json defines verify:reports-ui");
assert(workspace.includes("ReportsWorkspace"), "reports workspace exists");
assert(workspace.includes("PageContainer"), "uses PageContainer");
assert(workspace.includes("overview"), "Overview tab label");
assert(workspace.includes("equipment"), "Equipment tab label");
assert(screen.includes("ReportsWorkspace"), "ReportsScreen delegates to workspace");
assert(screen.includes("ReportsWorkspaceBody"), "reports body preserved");
assert(screen.includes("ReportsDashboardPanel"), "dashboard panel connected");
assert(dashboard.includes("ReportsDashboardPanel"), "dashboard component exists");
assert(app.includes('screen === "reports"'), "reports route preserved");
assert(screen.includes("reportTemplates"), "export templates preserved");

console.log(`PASS: verify-reports-ui (${caseCount} checks)`);
