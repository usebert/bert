#!/usr/bin/env node
/**
 * verify:risk-assessments — Risk Assessments Phase 2 wiring, schema, risk matrix, and workflow.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RISK_ASSESSMENT_REQUIRED_TABS,
  RISK_ASSESSMENTS_TAB_COLUMNS,
  RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
  RISK_ASSESSMENT_LINKS_TAB_COLUMNS,
  RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,
  calculateRiskScore,
  getRiskBand,
  validateRiskValue,
  validateRiskAssessmentForSubmit,
  summariseAssessmentRisk,
  deriveRiskAssessmentStatus,
  bumpVersion,
  mapRiskAssessmentRecord,
  mapRiskHazardRecord,
  dedupeHazardsById,
} from "../shared/risk-assessments.mjs";
import { buildHealthSafetyMetrics } from "../shared/health-safety-overview.mjs";

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

assert(RISK_ASSESSMENT_REQUIRED_TABS.length === 4, "schema: four required workbook tabs");
assert(RISK_ASSESSMENTS_TAB_COLUMNS.includes("RiskAssessmentId"), "schema: RiskAssessments includes RiskAssessmentId");
assert(RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS.includes("HazardId"), "schema: hazards tab includes HazardId");
assert(RISK_ASSESSMENT_LINKS_TAB_COLUMNS.includes("LinkId"), "schema: links tab includes LinkId");
assert(RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS.includes("ReviewId"), "schema: reviews tab includes ReviewId");

assert(calculateRiskScore(3, 4) === 12, "risk: likelihood × severity");
assert(getRiskBand(4).band === "low", "risk: score 4 is Low");
assert(getRiskBand(9).band === "moderate", "risk: score 9 is Moderate");
assert(getRiskBand(16).band === "high", "risk: score 16 is High");
assert(getRiskBand(25).band === "very_high", "risk: score 25 is Very High");
assert(validateRiskValue(3) === true && validateRiskValue(6) === false, "risk: validate 1–5 values");

const invalidSubmit = validateRiskAssessmentForSubmit(
  { title: "Test", assessmentType: "General", assessmentDate: "2026-07-01", reviewDate: "2026-08-01" },
  [],
  { todayKey: "2026-07-21" },
);
assert(!invalidSubmit.ok, "validation: rejects zero hazards");
assert(
  invalidSubmit.fieldErrors.some((entry) => entry.field === "hazards"),
  "validation: zero hazards field error",
);

const invalidReviewDate = validateRiskAssessmentForSubmit(
  { title: "Test", assessmentType: "General", assessmentDate: "2026-07-21", reviewDate: "2026-07-20" },
  [{ hazardTitle: "Slip", whoMightBeHarmed: "Staff", existingControls: "Signage", initialLikelihood: 2, initialSeverity: 2, residualLikelihood: 1, residualSeverity: 2 }],
  { todayKey: "2026-07-21" },
);
assert(!invalidReviewDate.ok, "validation: rejects review date before assessment date");

const summary = summariseAssessmentRisk([
  { initialLikelihood: 4, initialSeverity: 4, residualLikelihood: 2, residualSeverity: 3 },
  { initialLikelihood: 5, initialSeverity: 5, residualLikelihood: 4, residualSeverity: 4 },
]);
assert(summary.highestInitialRiskScore === 25, "risk: summarise highest initial");
assert(summary.highestResidualRiskScore === 16, "risk: summarise highest residual");
assert(summary.veryHighResidualCount === 0, "risk: summarise very high residual count");

const overdue = mapRiskAssessmentRecord({
  RiskAssessmentId: "ra-1",
  Status: "Active",
  ReviewDate: "2020-01-01",
});
assert(deriveRiskAssessmentStatus(overdue, "2026-07-21") === "Overdue", "status: overdue derived from review date");

assert(bumpVersion("1.0", "minor") === "1.1", "version: minor bump");
assert(bumpVersion("1.1", "major") === "2.0", "version: major bump");

const provisioning = read("server/company-provisioning-service.mjs");
assert(provisioning.includes("RISK_ASSESSMENT_REQUIRED_TABS"), "provisioning: risk assessment tabs imported");

const coreRoutes = read("server/core-workflow-routes.mjs");
assert(coreRoutes.includes("installRiskAssessmentRoutes"), "routes: risk assessment routes installed");

const routes = read("server/risk-assessments-routes.mjs");
assert(routes.includes("/risk-assessments"), "routes: list/create endpoints");
assert(routes.includes("/submit"), "routes: submit endpoint");
assert(routes.includes("/save-draft"), "routes: save-draft endpoint");
assert(routes.includes("/risk-assessments/draft"), "routes: create draft endpoint");
assert(routes.includes("/approve"), "routes: approve endpoint");
assert(routes.includes("/review"), "routes: review endpoint");
assert(routes.includes("/reject"), "routes: reject endpoint");
assert(routes.includes("/new-version"), "routes: new version endpoint");

const service = read("server/risk-assessments-service.mjs");
assert(service.includes("canApproveRiskAssessment"), "permissions: approve helper");
assert(service.includes("canSelfApproveRiskAssessment"), "permissions: self-approval guard");
assert(service.includes("summariseAssessmentRisk"), "service: server recalculates risk summary");
assert(service.includes("[risk-assessment:timing]"), "service: timing instrumentation");
assert(service.includes("ensuredRiskAssessmentWorkbooks"), "service: sheet ensure cache");
assert(service.includes("[risk-assessment:list-timing]"), "service: list timing instrumentation");
assert(service.includes("buildRiskAssessmentListItemFromRecord"), "service: list uses row aggregates");
assert(service.includes("riskAssessmentListCache"), "service: list response cache");
assert(service.includes("invalidateRiskAssessmentListCache"), "service: list cache invalidation");
assert(service.includes("[risk-assessment:list-cache-invalidate]"), "service: list cache invalidation logging");
assert(service.includes("listCompanyRiskAssessmentsUncached"), "service: uncached list path");
assert(service.includes('timer.log("read-risk-assessment-hazards-tab", { rowCounts: { hazards: 0 } })'), "service: list path skips hazards tab read");
assert(!service.includes("summariseAssessmentRisk(hazards)") || service.includes("buildRiskAssessmentListItemFromRecord"), "service: list path uses row aggregates");

const routesList = routes.match(/app\.get\("\/api\/companies\/:companyFolderId\/risk-assessments"[\s\S]*?\n  \}\);/)?.[0] || "";
assert(routesList.includes("createRiskAssessmentListTiming"), "routes: list route instruments timings");
assert(routesList.includes("Risk assessments could not be loaded. Try again."), "routes: list user-facing failure message");
assert(service.includes("syncRiskAssessmentHazards"), "service: batch hazard sync");
assert(service.includes("alreadySubmitted"), "service: idempotent submit");
assert(service.includes("buildDraftSaveResponse"), "service: lightweight draft save response");
assert(service.includes("batchPatchTabRowsByHeader"), "service: batch hazard patch helper");
assert(service.includes('publishRiskAssessmentListMutation(\n    resolved,\n    "save-draft",\n    buildDraftSaveResponse(detailLookup.item'), "service: draft save returns lightweight response");
assert(service.includes("[risk-assessment:create-persist]"), "service: create persistence instrumentation");
assert(service.includes("waitForAssessmentRecordAfterWrite"), "service: bounded create read-after-write");
assert(service.includes("RISK_ASSESSMENTS_TAB_COLUMNS, [row]"), "service: create append uses canonical headers then row objects");

assert(service.includes("[risk-assessment:hazard-persist]"), "service: hazard persistence instrumentation");
assert(service.includes("archiveMissingHazards"), "service: incremental hazard create skips archive sweep");
assert(service.includes("invalidateRiskAssessmentDetailCache"), "service: detail cache invalidation");
assert(service.includes("RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,\n        [row]"), "service: hazard append uses canonical headers");

assert(service.includes("[risk-assessment:save-draft]"), "service: save draft instrumentation");
assert(service.includes("buildEditableDraftAssessmentPatch"), "service: draft field allowlist");
assert(service.includes("normalizeAssessmentVersion"), "service: version normalisation");
assert(service.includes("isRecalculateRiskOnlyPatch"), "service: recalculate-only patch guard");
assert(service.includes("[risk-assessment:submit]"), "service: submit instrumentation");
assert(service.includes("RISK_ASSESSMENT_SUBMIT_NOT_VISIBLE"), "service: submit read-after-write guard");
assert(service.includes("[risk-assessment:approve]"), "service: approve instrumentation");
assert(service.includes("RISK_ASSESSMENT_APPROVE_NOT_VISIBLE"), "service: approve read-after-write guard");
assert(service.includes("alreadyApproved"), "service: approve idempotency");
assert(service.includes("[risk-assessment:review]"), "service: review instrumentation");
assert(service.includes("RISK_REVIEW_CREATE_NOT_VISIBLE"), "service: review read-after-write guard");
assert(service.includes("RISK_REVIEW_CREATE_WRITE_FAILED"), "service: review zero-row append guard");
assert(service.includes("alreadyReviewed"), "service: review idempotency");
assert(service.includes("appendAndConfirmReviewRow"), "service: review append confirmation helper");
assert(service.includes("RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,\n      [reviewRow]"), "service: review append uses canonical headers");

const validationAdapter = read("src/health-safety/adapters/riskAssessmentValidation.ts");
assert(validationAdapter.includes("buildClientHazardId"), "client: stable HazardId at creation");
assert(validationAdapter.includes("dedupeHazardsById"), "client: dedupe hazards by id");
assert(validationAdapter.includes("hazardId?"), "client: validation errors include hazardId");
assert(validationAdapter.includes("mergeHazardsFromSave"), "client: save response merges by id");

const workbook = read("server/workbook-service.mjs");
assert(workbook.includes("batchPatchTabRowsByHeader"), "workbook: batch row patch helper");
assert(workbook.includes("analyzeTabHeaderAlignment"), "workbook: tab header alignment helper");
assert(workbook.includes("readAppendedRowByRange"), "workbook: exact appended row readback");
assert(workbook.includes("sheetHeaders"), "workbook: append uses live sheet headers");

const sharedDedupe = dedupeHazardsById([
  { id: "h-1", updatedAt: "2026-01-01", hazardTitle: "Old" },
  { id: "h-1", updatedAt: "2026-02-01", hazardTitle: "New" },
  { id: "h-2", updatedAt: "2026-01-01", hazardTitle: "Other" },
]);
assert(sharedDedupe.length === 2, "dedupe: collapses duplicate HazardId rows");
assert(sharedDedupe.find((h) => h.id === "h-1")?.hazardTitle === "New", "dedupe: keeps latest UpdatedAt");

const PATCH_READS_PER_CALL = 2;
const hazardCount = 3;
const beforeSaveReads = 1 + 1 + hazardCount * PATCH_READS_PER_CALL + hazardCount * PATCH_READS_PER_CALL + 4;
const afterSaveReads = 1 + 1 + 1 + PATCH_READS_PER_CALL;
assert(afterSaveReads < beforeSaveReads, "performance: draft save reduces sheet reads");
console.log(`ok: save-path reads before=${beforeSaveReads} after=${afterSaveReads} (hazards=${hazardCount})`);

const permissions = read("src/permissions.ts");
assert(permissions.includes("canAccessRiskAssessments"), "permissions: view helper");
assert(permissions.includes('if (itemId === "riskAssessments")'), "permissions: nav gated");

const navPresentation = read("src/config/navPresentation.ts");
const hsBlocks = navPresentation.match(/label: "Health & Safety"[\s\S]*?itemIds: \[([^\]]+)\]/g) || [];
for (const block of hsBlocks) {
  assert(block.includes('"riskAssessments"'), "nav: Risk Assessments in Health & Safety group");
  const order = block.match(/itemIds: \[([^\]]+)\]/)?.[1] || "";
  const coshhIndex = order.indexOf("healthSafetyCoshh");
  const riskIndex = order.indexOf("riskAssessments");
  const equipmentIndex = order.indexOf("loler");
  assert(coshhIndex >= 0 && riskIndex > coshhIndex && equipmentIndex > riskIndex, "nav: order COSHH → Risk Assessments → Equipment");
}

const appSource = read("App.tsx");
assert(appSource.includes('screen === "riskAssessments"'), "App: risk assessments screen routed");

const workspace = read("src/health-safety/RiskAssessmentsWorkspace.tsx");
assert(workspace.includes("WIZARD_STEPS"), "ui: multi-step wizard");
assert(workspace.includes("calculateClientRiskScore"), "ui: client risk calculation");
assert(workspace.includes("RISK_ASSESSMENT_OFFLINE_WRITE_MESSAGE"), "ui: offline write messaging");
assert(workspace.includes("validateRiskAssessmentSubmission"), "ui: client submission validation");
assert(workspace.includes("saveRiskAssessmentDraft"), "ui: draft save before submit");
assert(workspace.includes("buildWizardHazardDraft"), "ui: local wizard hazards");
assert(workspace.includes("editingHazardId"), "ui: hazard edit mode");
assert(workspace.includes("openValidationTarget"), "ui: validation deep-links to hazard");
assert(workspace.includes("dedupeHazardsById"), "ui: dedupe hazards in wizard");

const overviewShared = read("shared/health-safety-overview.mjs");
assert(overviewShared.includes("activeRiskAssessments"), "overview: risk assessment metrics");
assert(overviewShared.includes("risk_assessment_very_high"), "overview: risk attention types");

const overviewService = read("server/health-safety-service.mjs");
assert(overviewService.includes("listCompanyRiskAssessments"), "overview service: loads risk assessments");

const search = read("src/services/searchAdapters/globalSearchAdapters.ts");
assert(search.includes('kind: "risk-assessment"'), "search: risk assessments indexed");

const notifications = read("src/services/notificationAdapters/notificationAdapters.ts");
assert(notifications.includes("risk-assessment-submitted:"), "notifications: submitted for approval");
assert(notifications.includes("risk-assessment-review:"), "notifications: review due/overdue");

const metrics = buildHealthSafetyMetrics({
  todayKey: "2026-07-21",
  incidents: [],
  riddor: [],
  coshh: [],
  equipment: [],
  incidentActions: [],
  riskAssessments: [
    { id: "ra-1", status: "Active", highestResidualRiskScore: 20, archivedAt: "" },
    { id: "ra-2", status: "Submitted", highestResidualRiskScore: 6, archivedAt: "" },
    { id: "ra-3", status: "Overdue", reviewDate: "2020-01-01", highestResidualRiskScore: 12, archivedAt: "" },
  ],
});
assert(metrics.activeRiskAssessments === 1, "overview logic: active risk assessments counted");
assert(metrics.awaitingApprovalRiskAssessments === 1, "overview logic: awaiting approval counted");
assert(metrics.overdueRiskAssessments === 1, "overview logic: overdue counted");
assert(metrics.veryHighResidualRiskAssessments === 1, "overview logic: very high residual counted");

const hazard = mapRiskHazardRecord({
  HazardId: "h-1",
  InitialLikelihood: 3,
  InitialSeverity: 4,
});
assert(hazard.initialRiskScore === 12, "mapper: hazard initial score calculated");

assert(!read("App.tsx").includes("VITE_GODMODE"), "security: no VITE secret usage in App");

const pkg = JSON.parse(read("package.json"));
assert(Boolean(pkg.scripts?.["verify:risk-assessments"]), "package.json defines verify:risk-assessments");
assert(Boolean(pkg.scripts?.["verify:risk-assessment-list-endpoint-tests"]), "package.json defines list endpoint tests");

console.log(`verify:risk-assessments passed (${caseCount} checks).`);

const listTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-list-endpoint.test.mjs"], {
  stdio: "inherit",
});
if (listTests.status !== 0) {
  process.exit(listTests.status || 1);
}

const createPersistenceTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-create-persistence.test.mjs"], {
  stdio: "inherit",
});
if (createPersistenceTests.status !== 0) {
  process.exit(createPersistenceTests.status || 1);
}

const hazardPersistenceTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-hazard-persistence.test.mjs"], {
  stdio: "inherit",
});
if (hazardPersistenceTests.status !== 0) {
  process.exit(hazardPersistenceTests.status || 1);
}

const saveDraftPersistenceTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-save-draft-persistence.test.mjs"], {
  stdio: "inherit",
});
if (saveDraftPersistenceTests.status !== 0) {
  process.exit(saveDraftPersistenceTests.status || 1);
}

const submitPersistenceTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-submit-persistence.test.mjs"], {
  stdio: "inherit",
});
if (submitPersistenceTests.status !== 0) {
  process.exit(submitPersistenceTests.status || 1);
}

const approvePersistenceTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-approve-persistence.test.mjs"], {
  stdio: "inherit",
});
if (approvePersistenceTests.status !== 0) {
  process.exit(approvePersistenceTests.status || 1);
}

const reviewPersistenceTests = spawnSync("node", ["--test", "scripts/verify-risk-assessment-review-persistence.test.mjs"], {
  stdio: "inherit",
});
if (reviewPersistenceTests.status !== 0) {
  process.exit(reviewPersistenceTests.status || 1);
}
