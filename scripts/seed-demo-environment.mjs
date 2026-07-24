#!/usr/bin/env node
/**
 * Seed Midlands Precast Concrete Ltd demo company data (repeatable / upsert-style).
 *
 * Default: local snapshot + report (no Google writes)
 * --live: upserts into the configured company workbook
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
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
} from "../shared/demo-environment.mjs";
import {
  buildMidlandsPrecastSeed,
  summarizeMidlandsSeed,
} from "../shared/midlands-precast-seed.mjs";
import { USERS_TAB_COLUMNS } from "../server/users-tab-constants.mjs";
import { AUDIT_TEMPLATES_COLUMNS } from "../server/company-audit-mapping.mjs";
import { SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { SITES_COLUMNS, DEPARTMENTS_COLUMNS, AREAS_STRUCTURE_COLUMNS } from "../shared/company-structure-access.mjs";
import {
  buildLocalWorkbook,
  buildWorkbookDeps,
  ensureWorkbookTabs,
  loadGoogleAuth,
  mergeSnapshotWorkbook,
  retargetCompanyRows,
  writeMergedTab,
} from "./lib/demo-environment-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run the Midlands demo seeder.`);
  process.exit(1);
}

const live = process.argv.includes("--live");
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

const { hashPassword } = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
const password = String(process.env.BERT_DEMO_DEFAULT_PASSWORD || "").trim();
if (!password || password.length < 12) {
  console.error("ERROR: Set BERT_DEMO_DEFAULT_PASSWORD (>= 12 chars).");
  process.exit(1);
}
const passwordHash = hashPassword(password);

const seed = buildMidlandsPrecastSeed({
  passwordHash,
  companyFolderId: companyFolderId || `demo-folder-midlands-precast-concrete-ltd`,
  masterSheetId: masterSheetId || `demo-workbook-midlands-precast-concrete-ltd`,
});

const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || "").trim()
  ? path.resolve(root, process.env.BERT_SESSIONS_DIR)
  : path.join(root, ".sessions");
const snapshotDir = path.join(sessionsRoot, "demo-environment-seed");
fs.mkdirSync(snapshotDir, { recursive: true });

const snapshotPath = path.join(snapshotDir, "workbook-snapshot.json");
const reportPath = path.join(root, "demo-environment-seed-report.json");

async function applyLiveSeed(seedPayload) {
  if (!companyFolderId || !masterSheetId) {
    throw new Error(
      `--live requires ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_SPREADSHEET_ENV} (run create:demo-company --live first).`,
    );
  }

  const auth = loadGoogleAuth(sessionsRoot);
  const deps = buildWorkbookDeps();

  seedPayload.companyFolderId = companyFolderId;
  seedPayload.masterSheetId = masterSheetId;
  seedPayload.users = retargetCompanyRows(seedPayload.users, {
    companyFolderId,
    companyName: MIDLANDS_DEMO_COMPANY_NAME,
  });
  seedPayload.schedules = seedPayload.schedules.map((row) => ({
    ...row,
    "Company Folder ID": companyFolderId,
  }));

  await ensureWorkbookTabs(auth, deps, masterSheetId);
  await writeMergedTab(auth, deps, masterSheetId, "Sites", SITES_COLUMNS, seedPayload.sites, ["SiteId"]);
  await writeMergedTab(auth, deps, masterSheetId, "Departments", DEPARTMENTS_COLUMNS, seedPayload.departments, [
    "DepartmentId",
  ]);
  await writeMergedTab(auth, deps, masterSheetId, "Areas", AREAS_STRUCTURE_COLUMNS, seedPayload.areas, ["AreaId"]);
  await writeMergedTab(auth, deps, masterSheetId, "AuditTemplates", AUDIT_TEMPLATES_COLUMNS, seedPayload.audits, [
    "Audit ID",
  ]);
  await writeMergedTab(auth, deps, masterSheetId, "Schedules", SCHEDULES_TAB_COLUMNS, seedPayload.schedules, [
    "Schedule ID",
  ]);
  await writeMergedTab(auth, deps, masterSheetId, "Users", USERS_TAB_COLUMNS, seedPayload.users, ["Email"]);

  return { companyFolderId, masterSheetId };
}

let mode = "local-snapshot";
let liveApplied = false;
let liveNote = "";

if (live) {
  try {
    const applied = await applyLiveSeed(seed);
    seed.companyFolderId = applied.companyFolderId;
    seed.masterSheetId = applied.masterSheetId;
    mode = "live-workbook";
    liveApplied = true;
    liveNote = "Seed upserted into the connected Midlands demo workbook.";
  } catch (error) {
    liveNote = `Live apply failed: ${error instanceof Error ? error.message : String(error)}`;
    mode = "local-snapshot-live-failed";
    console.error("WARNING: Live apply failed:", error?.stack || error);
    console.error("Continuing with local snapshot + report.");
  }
}

let workbook = buildLocalWorkbook(seed);
if (fs.existsSync(snapshotPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    workbook = mergeSnapshotWorkbook(previous, workbook);
  } catch {
    /* first seed */
  }
}

fs.writeFileSync(snapshotPath, JSON.stringify(workbook, null, 2), "utf8");

const report = {
  ...summarizeMidlandsSeed(seed),
  mode,
  liveApplied,
  liveNote: liveNote || undefined,
  snapshotPath,
  reportPath,
  passwordNote: "Demo passwords are configured via BERT_DEMO_DEFAULT_PASSWORD (not written to this report).",
  safety: {
    confirmEnv: DEMO_COMPANY_SEED_CONFIRM_ENV,
    companyNameLockedTo: MIDLANDS_DEMO_COMPANY_NAME,
    dovetailUntouched: true,
  },
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("");
console.log("Midlands demo environment seed complete");
console.log(`  Company: ${seed.companyName}`);
console.log(`  Folder ID: ${seed.companyFolderId}`);
console.log(`  Workbook ID: ${seed.masterSheetId}`);
console.log(`  Mode: ${mode}`);
console.log(`  Users: ${seed.counts.users} (active ${seed.counts.activeUsers})`);
console.log(`  Switch personas: ${seed.counts.switchPersonas}`);
console.log(`  Sites: ${seed.counts.sites}`);
console.log(`  Departments: ${seed.counts.departments}`);
console.log(`  Areas: ${seed.counts.areas}`);
console.log(`  Audit templates: ${seed.counts.auditTemplates}`);
console.log(`  Schedules: ${seed.counts.schedules}`);
console.log(`  Snapshot: ${snapshotPath}`);
console.log(`  Report: ${reportPath}`);
console.log("");
console.log("Switch personas (password via BERT_DEMO_DEFAULT_PASSWORD):");
for (const persona of seed.switchPersonas) {
  const tab = persona.usersTab === false ? "master-operators.json" : "Users tab";
  console.log(`  - ${persona.name} <${persona.email}> (${persona.role}) [${tab}]`);
}
if (liveNote) {
  console.log("");
  console.log(`Live note: ${liveNote}`);
}
console.log("");
