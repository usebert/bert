#!/usr/bin/env node
/** verify:safety-ui — BERT Safety module Release 6 checks. */
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
const workspace = read("src/safety/SafetyWorkspace.tsx");
const screen = read("src/screens/IncidentReportingScreen.tsx");
const adapter = read("src/safety/adapters/incidentListAdapter.ts");
const app = read("App.tsx");
const incidentsService = read("src/services/incidentsService.ts");

assert(Boolean(pkg.scripts?.["verify:safety-ui"]), "package.json defines verify:safety-ui");
assert(workspace.includes("SafetyWorkspace"), "shared safety workspace exists");
assert(workspace.includes("PageContainer"), "uses PageContainer");
assert(workspace.includes("PageHeader"), "uses PageHeader");
assert(workspace.includes("SafetySummaryCards"), "summary strip wired");
assert(workspace.includes("SafetyFilters"), "filters wired");
assert(workspace.includes("SafetyList"), "reusable safety list wired");
assert(screen.includes("SafetyWorkspace"), "IncidentReportingScreen delegates to workspace");

assert(workspace.includes("incidents"), "Incidents tab");
assert(workspace.includes("near-misses"), "Near Misses tab");
assert(workspace.includes("investigations"), "Investigations tab");
assert(workspace.includes("closed"), "Closed tab");

assert(adapter.includes("sortSafetyItems"), "sorting preserved");
assert(adapter.includes('item.priority === "High"'), "high-risk prioritisation");
assert(workspace.includes("validateForm"), "incident form validation preserved");
assert(workspace.includes('onSubmit={onSubmit}'), "submit form wired");
assert(workspace.includes('role="alert"'), "error alert role preserved");
assert(workspace.includes("IncidentReassignModal"), "reassign modal wired");
assert(workspace.includes("openInvestigationWorkflow"), "investigation workflow wired");
assert(workspace.includes("investigation-workflow-"), "investigation scroll target");
assert(workspace.includes("Assignment history"), "assignment history shown");
assert(workspace.includes("ArchiveRecordButton"), "archive wired");
assert(app.includes("onSubmitIncident={submitIncidentReport}"), "App submit handler preserved");
assert(app.includes("offlineMode={offlineMode}"), "offline state passed to safety workspace");
assert(incidentsService.includes("readFileAsDataUrl"), "evidence read helper unchanged");
assert(workspace.includes("You are offline"), "offline queue message shown");

console.log(`PASS: verify:safety-ui (${caseCount} checks)`);
