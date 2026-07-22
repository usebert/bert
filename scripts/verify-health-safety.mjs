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
import {
  buildHealthSafetyAttentionItems,
  buildHealthSafetyMetrics,
  buildHealthSafetyOverviewPayload,
  buildHealthSafetyRecentActivity,
  buildHealthSafetyStatusSummary,
  isHighRiskIncident,
} from "../shared/health-safety-overview.mjs";

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
assert(navPresentation.includes('"healthSafety", "incidents", "healthSafetyRiddor", "healthSafetyCoshh", "riskAssessments", "loler"'),
  "nav: company roles group includes Risk Assessments between COSHH and Equipment",
);
assert(navPresentation.includes('loler: "Equipment"'), "nav: loler display label is Equipment");
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
assert(appSource.includes('screen === "riskAssessments"'), "App: Risk Assessments screen routed");
assert(!appSource.includes("VITE_GODMODE"), "security: no VITE secret usage in App");

const safetyWorkspace = read("src/safety/SafetyWorkspace.tsx");
assert(safetyWorkspace.includes("RiddorAssessmentPanel"), "incidents: RIDDOR assessment panel integrated");

const riddorPanel = read("src/health-safety/components/RiddorAssessmentPanel.tsx");
assert(riddorPanel.includes("RIDDOR_DISCLAIMER"), "riddor: legal disclaimer visible in panel");

const navItemsSource = read("src/config/navItems.ts");
assert(navItemsSource.includes('{ id: "loler", label: "Equipment"'), "nav: catalog labels Equipment for loler route");

const enLocale = read("src/i18n/locales/en.ts");
assert(enLocale.includes('loler: "Equipment"'), "i18n: nav.loler displays Equipment");

const lolerService = read("src/services/lolerService.ts");
assert(
  lolerService.includes("/api/companies/${encodeURIComponent(folderId)}/loler/equipment"),
  "client: LOLER equipment list path unchanged",
);
assert(lolerService.includes("logApiFetchFailure"), "client: LOLER fetch failures log diagnostics");
assert(lolerService.includes("Equipment data could not be loaded"), "client: friendly equipment load message");

const coreWorkflowRoutes = read("server/core-workflow-routes.mjs");
assert(coreWorkflowRoutes.includes('app.get("/api/companies/:companyFolderId/loler/equipment"'), "server: LOLER equipment route registered");

const pkg = JSON.parse(read("package.json"));
assert(Boolean(pkg.scripts?.["verify:health-safety"]), "package.json defines verify:health-safety");

const overviewScreen = read("src/screens/HealthSafetyOverviewScreen.tsx");
assert(overviewScreen.includes("Requires attention"), "overview ui: requires attention section");
assert(overviewScreen.includes("Module health"), "overview ui: module health section");
assert(overviewScreen.includes("Recent activity"), "overview ui: recent activity section");
assert(overviewScreen.includes("Quick actions"), "overview ui: quick actions section");
assert(overviewScreen.includes("Equipment inspections overdue") === false, "overview ui: no LOLER wording in screen");
assert(overviewScreen.includes("inspections overdue"), "overview ui: equipment inspections wording");
assert(overviewScreen.includes("does not replace competent Health & Safety review"), "overview ui: disclaimer note");
assert(overviewScreen.includes('aria-label="Refresh Health and Safety overview"'), "overview ui: accessible refresh");

const overviewShared = read("shared/health-safety-overview.mjs");
assert(overviewShared.includes("buildHealthSafetyStatusSummary"), "overview shared: status summary builder");
assert(overviewShared.includes("buildHealthSafetyAttentionItems"), "overview shared: attention builder");
assert(overviewShared.includes("buildHealthSafetyRecentActivity"), "overview shared: activity builder");

const service = read("server/health-safety-service.mjs");
assert(service.includes("buildHealthSafetyOverviewPayload"), "service: overview uses shared payload builder");
assert(service.includes("IncidentActions"), "service: reads incident actions for overview");
assert(service.includes("LOLER_EXAMINATIONS_TAB"), "service: reads examinations for activity");
assert(overviewShared.includes("activeRiskAssessments"), "overview shared: risk assessment metrics");
assert(service.includes("COSHH_ASSESSMENTS_TAB"), "service: reads assessments for activity");
assert(service.includes("listCompanyRiskAssessments"), "service: overview loads risk assessments");

const highRisk = { id: "inc-1", status: "Under Investigation", severity: "Major Incident" };
assert(isHighRiskIncident(highRisk), "overview logic: major incident is high risk");
const metrics = buildHealthSafetyMetrics({
  todayKey: "2026-07-21",
  incidents: [
    { id: "inc-1", status: "Open" },
    { id: "inc-2", status: "Under Investigation", severity: "Minor" },
  ],
  riddor: [{ id: "rid-1", decisionStatus: "decision_required", submissionStatus: "not_started" }],
  coshh: [{ id: "cosh-1", status: "missing_sds", productName: "Acetone" }],
  equipment: [{ id: "eq-1", status: "active", nextExaminationDueDate: "2026-01-01" }],
  incidentActions: [],
});
assert(metrics.openIncidents === 2, "overview logic: open incidents counted");
assert(metrics.riddorDecisionsRequired === 1, "overview logic: riddor decisions counted");
assert(metrics.chemicalsMissingSds === 1, "overview logic: missing sds counted");
assert(metrics.equipmentInspectionsOverdue === 1, "overview logic: overdue equipment counted");

const attention = buildHealthSafetyAttentionItems({
  todayKey: "2026-07-21",
  incidents: [{ id: "inc-1", status: "Under Investigation", severity: "Fatality", description: "Fall" }],
  riddor: [
    { id: "rid-1", incidentId: "INC-1", decisionStatus: "decision_required" },
    { id: "rid-1", incidentId: "INC-1", decisionStatus: "decision_required" },
  ],
  coshh: [],
  equipment: [],
  incidentActions: [],
});
assert(attention.length === 2, "overview logic: high-risk investigation and riddor decision");
assert(attention[0].priority < attention[1].priority, "overview logic: attention ranking");
assert(new Set(attention.map((item) => `${item.type}::${item.recordId}`)).size === attention.length, "overview logic: no duplicate attention");

const urgentSummary = buildHealthSafetyStatusSummary(
  { ...metrics, highRiskIncidents: 1, equipmentInspectionsOverdue: 1, highPriorityOverdueActions: 0, riddorReportableActionsDue: 0 },
  attention,
);
assert(urgentSummary.level === "urgent", "overview logic: urgent status when drivers present");

const goodSummary = buildHealthSafetyStatusSummary(
  {
    openIncidents: 0,
    highRiskIncidents: 0,
    riddorDecisionsRequired: 0,
    coshhReviewsOverdue: 0,
    chemicalsMissingSds: 0,
    equipmentInspectionsDueSoon: 0,
    overdueHealthSafetyActions: 0,
    highPriorityOverdueActions: 0,
    riddorReportableActionsDue: 0,
    coshhReviewsDueSoon: 0,
  },
  [],
);
assert(goodSummary.level === "good", "overview logic: good status when clear");

const activity = buildHealthSafetyRecentActivity({
  incidents: [{ id: "inc-1", createdAt: "2026-07-21T10:00:00.000Z", incidentType: "Near Miss", reporterName: "Alex" }],
  riddor: [],
  coshh: [],
  assessments: [],
  equipment: [],
  examinations: [],
  incidentActions: [],
});
assert(activity.length === 1 && activity[0].type === "incident_created", "overview logic: recent activity from incidents");

const payload = buildHealthSafetyOverviewPayload({
  todayKey: "2026-07-21",
  incidents: [],
  riddor: [],
  coshh: [],
  equipment: [],
  incidentActions: [],
  assessments: [],
  examinations: [],
});
assert(payload.statusSummary && payload.metrics && Array.isArray(payload.attentionItems), "overview payload: extended response shape");
assert(payload.summary && Array.isArray(payload.attention), "overview payload: legacy fields retained");
assert(typeof payload.summary.equipmentInspectionsOverdue === "number", "overview payload: legacy summary equipment metric");

console.log(`verify:health-safety passed (${caseCount} checks).`);
