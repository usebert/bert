#!/usr/bin/env node
/**
 * Seed Midlands Precast six-month operational history (dry-run default).
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_DEFAULT_PASSWORD='...' npm run seed:demo-history
 *   ... npm run seed:demo-history -- --anchor-date=2026-07-24
 *   ... npm run seed:demo-history -- --live   # Google workbook upsert (requires demo env vars)
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SPREADSHEET_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  assertDemoCompanyAllowed,
  isDemoEnvironmentEnabled,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
} from "../shared/demo-environment.mjs";
import { buildMidlandsPrecastSeed } from "../shared/midlands-precast-seed.mjs";
import {
  buildMidlandsPrecastHistory,
  summarizeMidlandsHistory,
} from "../shared/midlands-precast-history.mjs";
import { AUDIT_RESULTS_TAB_COLUMNS } from "../server/completion-service.mjs";
import { NCR_TAB_COLUMNS } from "../shared/ncr.mjs";
import { BRIEFINGS_TAB_COLUMNS, BRIEFING_RECIPIENTS_TAB_COLUMNS } from "../shared/briefings.mjs";
import { SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS } from "../server/incidents-service.mjs";
import {
  LOLER_EQUIPMENT_TAB,
  LOLER_EQUIPMENT_TAB_COLUMNS,
  LOLER_SCHEDULES_TAB,
  LOLER_SCHEDULES_TAB_COLUMNS,
} from "../shared/loler.mjs";
import {
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
} from "../shared/loler-examinations.mjs";
import {
  RISK_ASSESSMENTS_TAB,
  RISK_ASSESSMENTS_TAB_COLUMNS,
  RISK_ASSESSMENT_HAZARDS_TAB,
  RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS,
  RISK_ASSESSMENT_LINKS_TAB,
  RISK_ASSESSMENT_LINKS_TAB_COLUMNS,
  RISK_ASSESSMENT_REVIEWS_TAB,
  RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS,
} from "../shared/risk-assessments.mjs";
import {
  buildWorkbookDeps,
  ensureWorkbookTabs,
  loadGoogleAuth,
  upsertByKey,
  writeMergedTab,
} from "./lib/demo-environment-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

function readArg(name) {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? String(process.argv[idx + 1] || "").trim() : "";
}

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run the Midlands history seeder.`);
  process.exit(1);
}

const live = process.argv.includes("--live");
const dryRunExplicit = process.argv.includes("--dry-run");
if (live && dryRunExplicit) {
  console.error("ERROR: Use either --live or --dry-run, not both.");
  process.exit(1);
}

const anchorDate = readArg("--anchor-date") || "";
const companyFolderId = readDemoCompanyFolderId();
const masterSheetId = readDemoCompanySpreadsheetId();

const guard = assertDemoCompanyAllowed({
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  companyFolderId,
  masterSheetId,
  requireWorkspaceIds: live,
  requireSpreadsheet: live,
});
if (!guard.ok) {
  console.error(`ERROR: ${guard.error}`);
  process.exit(1);
}

if (live && !isDemoEnvironmentEnabled()) {
  console.error("ERROR: --live requires DEMO_ENVIRONMENT_ENABLED=true");
  process.exit(1);
}

const password = String(process.env.BERT_DEMO_DEFAULT_PASSWORD || "").trim();
if (!password || password.length < 12) {
  console.error("ERROR: Set BERT_DEMO_DEFAULT_PASSWORD (>= 12 chars).");
  process.exit(1);
}

const { hashPassword } = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
const phase1 = buildMidlandsPrecastSeed({
  passwordHash: hashPassword(password),
  companyFolderId: companyFolderId || `demo-folder-midlands-precast-concrete-ltd`,
  masterSheetId: masterSheetId || `demo-workbook-midlands-precast-concrete-ltd`,
});

const history = buildMidlandsPrecastHistory({
  anchorDate: anchorDate || undefined,
  companyFolderId: phase1.companyFolderId,
  phase1Seed: phase1,
});

const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || "").trim()
  ? path.resolve(root, process.env.BERT_SESSIONS_DIR)
  : path.join(root, ".sessions");
const snapshotDir = path.join(sessionsRoot, "demo-environment-history");
fs.mkdirSync(snapshotDir, { recursive: true });
const snapshotPath = path.join(snapshotDir, "workbook-history-snapshot.json");
const reportPath = path.join(root, "demo-environment-history-report.json");

const AUDIT_FINDINGS_COLUMNS = [
  "Finding ID",
  "Local Submission ID",
  "Result ID",
  "Audit ID",
  "Area ID",
  "Company ID",
  "Question ID",
  "Question Text",
  "Answer",
  "Risk Level",
  "Risk Category",
  "Auto Action Required",
  "Requires Photo Evidence",
  "Requires Manager Review",
  "Note",
  "Local Evidence Refs",
  "Created At",
  "Updated At",
  "Created By",
  "Updated By",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
];

const ACTIONS_COLUMNS = [
  "Action ID",
  "Company ID",
  "Source Audit ID",
  "Source Audit Name",
  "Source Question ID",
  "Source Question Text",
  "Source Answer",
  "Non Conformance ID",
  "Severity",
  "Status",
  "Assigned To User ID",
  "Assigned To Name",
  "Created By User ID",
  "Created At",
  "Updated At",
  "Due Date",
  "Closed At",
  "Verified By User ID",
  "Verification Notes",
  "Evidence Links",
  "Local Evidence Refs",
  "Comments",
  "Recurrence Flag",
  "Root Cause",
  "Corrective Action",
  "Preventive Action",
  "Risk Category",
  "Requires Manager Review",
  "Suggestion JSON",
  "Sync Status",
  "Sync Attempts",
  "Last Sync Error",
  "Remote Row ID",
  "Schema Version",
  "Archived",
  "ArchivedAt",
  "ArchivedBy",
  "ArchiveReason",
];

async function applyLiveHistory(payload) {
  if (!companyFolderId || !masterSheetId) {
    throw new Error(`--live requires ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_SPREADSHEET_ENV}`);
  }
  const auth = loadGoogleAuth(sessionsRoot);
  const deps = buildWorkbookDeps();
  await ensureWorkbookTabs(auth, deps, masterSheetId);

  const writes = [
    ["Schedules", SCHEDULES_TAB_COLUMNS, payload.schedules, ["Schedule ID"]],
    ["AuditResults", AUDIT_RESULTS_TAB_COLUMNS, payload.auditResults, ["Result ID"]],
    ["AuditFindings", AUDIT_FINDINGS_COLUMNS, payload.auditFindings, ["Finding ID"]],
    ["Actions", ACTIONS_COLUMNS, payload.actions, ["Action ID"]],
    ["NCRs", NCR_TAB_COLUMNS, payload.ncrs, ["NCR ID"]],
    [INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS, payload.incidents, ["IncidentId"]],
    ["Briefings", BRIEFINGS_TAB_COLUMNS, payload.briefings, ["BriefingId"]],
    ["BriefingRecipients", BRIEFING_RECIPIENTS_TAB_COLUMNS, payload.briefingRecipients, ["BriefingId", "RecipientEmail"]],
    [LOLER_EQUIPMENT_TAB, LOLER_EQUIPMENT_TAB_COLUMNS, payload.lolerEquipment, ["EquipmentId"]],
    [LOLER_SCHEDULES_TAB, LOLER_SCHEDULES_TAB_COLUMNS, payload.lolerSchedules, ["LolerScheduleId"]],
    [LOLER_EXAMINATIONS_TAB, LOLER_EXAMINATIONS_TAB_COLUMNS, payload.lolerExaminations, ["ExaminationId"]],
    [RISK_ASSESSMENTS_TAB, RISK_ASSESSMENTS_TAB_COLUMNS, payload.riskAssessments, ["RiskAssessmentId"]],
    [RISK_ASSESSMENT_HAZARDS_TAB, RISK_ASSESSMENT_HAZARDS_TAB_COLUMNS, payload.riskHazards, ["HazardId"]],
    [RISK_ASSESSMENT_LINKS_TAB, RISK_ASSESSMENT_LINKS_TAB_COLUMNS, payload.riskLinks, ["LinkId"]],
    [RISK_ASSESSMENT_REVIEWS_TAB, RISK_ASSESSMENT_REVIEWS_TAB_COLUMNS, payload.riskReviews, ["ReviewId"]],
  ];

  for (const [tab, columns, rows, keys] of writes) {
    await writeMergedTab(auth, deps, masterSheetId, tab, columns, rows, keys);
    console.log(`[live] upserted ${rows.length} rows into ${tab}`);
  }

  return { companyFolderId, masterSheetId };
}

let mode = "local-snapshot";
let liveApplied = false;
let liveNote = "";

if (live) {
  try {
    await applyLiveHistory(history);
    liveApplied = true;
    mode = "live-workbook";
    liveNote = "History upserted into Midlands demo workbook.";
  } catch (error) {
    liveNote = `Live apply failed: ${error instanceof Error ? error.message : String(error)}`;
    mode = "local-snapshot-live-failed";
    console.error("WARNING:", error?.stack || error);
  }
}

const workbook = {
  companyName: MIDLANDS_DEMO_COMPANY_NAME,
  companyFolderId: phase1.companyFolderId,
  masterSheetId: phase1.masterSheetId,
  anchorDate: history.anchorDate,
  historyStart: history.historyStart,
  historyEnd: history.historyEnd,
  tabs: {
    Schedules: history.schedules,
    AuditResults: history.auditResults,
    AuditFindings: history.auditFindings,
    Actions: history.actions,
    NCRs: history.ncrs,
    Incidents: history.incidents,
    Briefings: history.briefings,
    BriefingRecipients: history.briefingRecipients,
    LOLEREquipment: history.lolerEquipment,
    LOLERSchedules: history.lolerSchedules,
    LOLERExaminations: history.lolerExaminations,
    RiskAssessments: history.riskAssessments,
    RiskAssessmentHazards: history.riskHazards,
    RiskAssessmentLinks: history.riskLinks,
    RiskAssessmentReviews: history.riskReviews,
  },
  updatedAt: new Date().toISOString(),
};

let mergedWorkbook = workbook;
if (fs.existsSync(snapshotPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    mergedWorkbook = {
      ...workbook,
      tabs: {
        ...workbook.tabs,
        Schedules: upsertByKey(previous.tabs?.Schedules, workbook.tabs.Schedules, ["Schedule ID"]),
        AuditResults: upsertByKey(previous.tabs?.AuditResults, workbook.tabs.AuditResults, ["Result ID"]),
        AuditFindings: upsertByKey(previous.tabs?.AuditFindings, workbook.tabs.AuditFindings, ["Finding ID"]),
        Actions: upsertByKey(previous.tabs?.Actions, workbook.tabs.Actions, ["Action ID"]),
        NCRs: upsertByKey(previous.tabs?.NCRs, workbook.tabs.NCRs, ["NCR ID"]),
        Incidents: upsertByKey(previous.tabs?.Incidents, workbook.tabs.Incidents, ["IncidentId"]),
        Briefings: upsertByKey(previous.tabs?.Briefings, workbook.tabs.Briefings, ["BriefingId"]),
        BriefingRecipients: upsertByKey(
          previous.tabs?.BriefingRecipients,
          workbook.tabs.BriefingRecipients,
          ["BriefingId", "RecipientEmail"],
        ),
        LOLEREquipment: upsertByKey(previous.tabs?.LOLEREquipment, workbook.tabs.LOLEREquipment, ["EquipmentId"]),
        LOLERSchedules: upsertByKey(previous.tabs?.LOLERSchedules, workbook.tabs.LOLERSchedules, ["LolerScheduleId"]),
        LOLERExaminations: upsertByKey(
          previous.tabs?.LOLERExaminations,
          workbook.tabs.LOLERExaminations,
          ["ExaminationId"],
        ),
        RiskAssessments: upsertByKey(
          previous.tabs?.RiskAssessments,
          workbook.tabs.RiskAssessments,
          ["RiskAssessmentId"],
        ),
        RiskAssessmentHazards: upsertByKey(
          previous.tabs?.RiskAssessmentHazards,
          workbook.tabs.RiskAssessmentHazards,
          ["HazardId"],
        ),
        RiskAssessmentLinks: upsertByKey(
          previous.tabs?.RiskAssessmentLinks,
          workbook.tabs.RiskAssessmentLinks,
          ["LinkId"],
        ),
        RiskAssessmentReviews: upsertByKey(
          previous.tabs?.RiskAssessmentReviews,
          workbook.tabs.RiskAssessmentReviews,
          ["ReviewId"],
        ),
      },
    };
  } catch {
    /* first run */
  }
}

fs.writeFileSync(snapshotPath, JSON.stringify(mergedWorkbook, null, 2), "utf8");

const report = {
  ...summarizeMidlandsHistory(history),
  mode,
  liveApplied,
  liveNote: liveNote || undefined,
  snapshotPath,
  reportPath,
  safety: {
    dovetailUntouched: true,
    secretsExcluded: true,
  },
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("");
console.log("Midlands demo history seed complete");
console.log(`  Anchor date: ${history.anchorDate}`);
console.log(`  Range: ${history.historyStart} → ${history.historyEnd}`);
console.log(`  Mode: ${mode}`);
console.log(`  Fingerprint: ${history.summary.fingerprint}`);
console.log(`  Audit results: ${history.summary.counts.auditResults} (Rugby ${history.summary.counts.auditResultsRugby}, Coventry ${history.summary.counts.auditResultsCoventry})`);
console.log(`  Findings: ${history.summary.counts.auditFindings}`);
console.log(`  Actions: ${history.summary.counts.actions} (open ${history.summary.counts.actionsOpen}, overdue ${history.summary.counts.actionsOverdue})`);
console.log(`  NCRs: ${history.summary.counts.ncrs} (open ${history.summary.counts.ncrsOpen})`);
console.log(`  Incidents: ${history.summary.counts.incidents}`);
console.log(`  Briefings: ${history.summary.counts.briefings} (unsigned mandatory ${history.summary.counts.briefingUnsignedMandatory})`);
console.log(`  LOLER equipment: ${history.summary.counts.lolerEquipment}`);
console.log(`  Risk assessments: ${history.summary.counts.riskAssessments}`);
console.log(`  Snapshot: ${snapshotPath}`);
console.log(`  Report: ${reportPath}`);
if (liveNote) {
  console.log(`  Live note: ${liveNote}`);
}
console.log("");
