#!/usr/bin/env node
/**
 * verify:health-safety — Health & Safety Phase 1 wiring, schema, and shared helpers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COSHH_REGISTER_TAB,
  COSHH_REGISTER_TAB_COLUMNS,
  COSHH_ASSESSMENTS_TAB,
  COSHH_ASSESSMENTS_TAB_COLUMNS,
  RIDDOR_REPORTS_TAB,
  RIDDOR_REPORTS_TAB_COLUMNS,
  HEALTH_SAFETY_REQUIRED_TABS,
  calculateRiskScore,
  evaluateRiddorDecision,
  mapCoshhRegisterRecord,
  mapRiddorReportRecord,
  RIDDOR_DISCLAIMER,
} from "../shared/health-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

assert(HEALTH_SAFETY_REQUIRED_TABS.length === 3, "schema: three required workbook tabs");
assert(COSHH_REGISTER_TAB_COLUMNS.includes("CoshhId"), "schema: COSHH register columns include CoshhId");
assert(COSHH_ASSESSMENTS_TAB_COLUMNS.includes("AssessmentId"), "schema: COSHH assessments columns include AssessmentId");
assert(RIDDOR_REPORTS_TAB_COLUMNS.includes("RiddorId"), "schema: RIDDOR reports columns include RiddorId");

const mapped = mapCoshhRegisterRecord({
  CoshhId: "coshh-1",
  ProductName: "Acetone",
  ReviewDate: "2026-01-01",
});
assert(mapped.id === "coshh-1" && mapped.productName === "Acetone", "mapper: COSHH register record maps core fields");

const riddor = mapRiddorReportRecord({ RiddorId: "rid-1", IncidentId: "inc-1", DecisionStatus: "decision_required" });
assert(riddor.id === "rid-1" && riddor.decisionStatus === "decision_required", "mapper: RIDDOR record maps decision status");

assert(calculateRiskScore(3, 4) === 12, "risk: likelihood × severity score");
const evaluation = evaluateRiddorDecision({ fatality: true });
assert(evaluation.likelyReportable === true, "riddor: fatality triggers likely reportable");

const provisioning = read("server/company-provisioning-service.mjs");
assert(provisioning.includes("HEALTH_SAFETY_REQUIRED_TABS"), "provisioning: health safety tabs imported");
assert(
  provisioning.includes("HEALTH_SAFETY_REQUIRED_TABS") && provisioning.includes('"Incidents"'),
  "provisioning: new companies receive H&S tabs",
);

const routes = read("server/health-safety-routes.mjs");
assert(routes.includes("/health-safety/overview"), "routes: overview endpoint registered");
assert(routes.includes("/coshh"), "routes: COSHH endpoints registered");
assert(routes.includes("/riddor"), "routes: RIDDOR endpoints registered");
assert(routes.includes("riddor-assessment"), "routes: incident RIDDOR assessment endpoint registered");

const coreRoutes = read("server/core-workflow-routes.mjs");
assert(coreRoutes.includes("installHealthSafetyRoutes"), "wiring: health safety routes installed in core workflow");

const navPresentation = read("src/config/navPresentation.ts");
assert(navPresentation.includes('id: "healthSafety"'), "nav: Health & Safety group defined");
assert(
  navPresentation.includes('"healthSafety", "incidents", "healthSafetyRiddor", "healthSafetyCoshh", "loler"'),
  "nav: company roles group Incidents and Equipment under Health & Safety",
);
const complianceBlocks = navPresentation.match(/id: "compliance"[\s\S]*?itemIds: \[([^\]]+)\]/g) || [];
for (const block of complianceBlocks) {
  assert(!block.includes('"incidents"'), "nav: Incidents not duplicated in Compliance group");
  assert(!block.includes('"loler"'), "nav: Equipment not duplicated in Compliance group");
}

const permissions = read("src/permissions.ts");
assert(permissions.includes("canAccessHealthSafetyOverview"), "permissions: overview helper exported");
assert(permissions.includes('if (itemId === "healthSafetyCoshh")'), "permissions: COSHH nav gated");
assert(permissions.includes('if (itemId === "healthSafetyRiddor")'), "permissions: RIDDOR nav gated");

const appSource = read("App.tsx");
assert(appSource.includes('screen === "healthSafety"'), "App: overview screen routed");
assert(appSource.includes('screen === "healthSafetyCoshh"'), "App: COSHH screen routed");
assert(appSource.includes('screen === "healthSafetyRiddor"'), "App: RIDDOR screen routed");
assert(!appSource.includes("VITE_GODMODE"), "security: no VITE secret usage in App");

const safetyWorkspace = read("src/safety/SafetyWorkspace.tsx");
assert(safetyWorkspace.includes("RiddorAssessmentPanel"), "incidents: RIDDOR assessment panel integrated");

const riddorPanel = read("src/health-safety/components/RiddorAssessmentPanel.tsx");
assert(riddorPanel.includes("RIDDOR_DISCLAIMER"), "riddor: legal disclaimer visible in panel");

const pkg = JSON.parse(read("package.json"));
assert(Boolean(pkg.scripts?.["verify:health-safety"]), "package.json defines verify:health-safety");

console.log(`verify:health-safety passed (${caseCount} checks).`);
