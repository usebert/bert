#!/usr/bin/env node
/** verify:riddor — RIDDOR workspace, incident integration, and decision workflow. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateRiddorDecision, RIDDOR_DISCLAIMER } from "../shared/health-safety.mjs";

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

const notReportable = evaluateRiddorDecision({ furtherInformationRequired: false });
assert(notReportable.likelyReportable === false, "evaluation: no triggers yields not likely reportable");

const infoRequired = evaluateRiddorDecision({ furtherInformationRequired: true });
assert(infoRequired.decisionStatus === "information_required", "evaluation: information required status");

const workspace = read("src/health-safety/RiddorWorkspace.tsx");
assert(workspace.includes("decision_required"), "workspace: decision required tab");
assert(workspace.includes("submissionReference"), "workspace: submission reference field");
assert(workspace.includes("updateRiddorRecord"), "workspace: patch RIDDOR record wired");

const panel = read("src/health-safety/components/RiddorAssessmentPanel.tsx");
assert(panel.includes("fatality"), "incident panel: fatality question");
assert(panel.includes("assessIncidentRiddor"), "incident panel: calls assessment API");
assert(panel.includes("may be reportable under RIDDOR"), "incident panel: non-legal-determination wording");

const service = read("server/health-safety-service.mjs");
assert(service.includes("assessIncidentRiddor"), "service: incident assessment handler");
assert(service.includes("buildHealthSafetyOverview"), "service: overview aggregates RIDDOR counts");

const notifications = read("src/services/notificationAdapters/notificationAdapters.ts");
assert(notifications.includes("riddor-decision:"), "notifications: RIDDOR decision required");
assert(notifications.includes("riddor-followup:"), "notifications: RIDDOR follow-up due");

const search = read("src/services/searchAdapters/globalSearchAdapters.ts");
assert(search.includes('kind: "riddor"'), "search: RIDDOR records indexed");

assert(RIDDOR_DISCLAIMER.length > 20, "shared: RIDDOR disclaimer exported");

const pkg = JSON.parse(read("package.json"));
assert(Boolean(pkg.scripts?.["verify:riddor"]), "package.json defines verify:riddor");

console.log(`verify:riddor passed (${caseCount} checks).`);
