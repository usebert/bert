#!/usr/bin/env node
/**
 * Seed Dovecote Manufacturing Ltd demo company data (repeatable / upsert-style).
 *
 * Safety:
 *   DEMO_COMPANY_SEED_CONFIRM=yes required
 *   Only seeds company name "Dovecote Manufacturing Ltd"
 *   Refuses TESTCO / Blank Company / other real companies
 *
 * Modes:
 *   Default: builds seed + writes local snapshot + report (no Google writes)
 *   --live: upserts into the company workbook when Google OAuth + folder/workbook ids are set
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes npm run seed:demo-company
 *   DEMO_COMPANY_SEED_CONFIRM=yes BERT_DEMO_COMPANY_FOLDER_ID=... BERT_DEMO_COMPANY_WORKBOOK_ID=... npm run seed:demo-company -- --live
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { google } from "googleapis";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_NAME,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SHARED_PASSWORD,
  DEMO_COMPANY_WORKBOOK_ENV,
  assertDemoCompanyAllowed,
  buildDemoCompanySeed,
  summarizeDemoSeed,
} from "../shared/demo-company-seed.mjs";
import {
  ensureRequiredTabs,
  ensureTabColumns,
  getTabValues,
  rowsToRecords,
  writeTabRecords,
} from "../server/workbook-service.mjs";
import { writeUsersTabRecordByHeaders } from "../server/company-users.mjs";
import { INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS } from "../server/incidents-service.mjs";
import { AUDIT_TEMPLATES_COLUMNS } from "../server/company-audit-mapping.mjs";
import { SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { NCR_TAB_COLUMNS } from "../shared/ncr.mjs";
import { BRIEFINGS_TAB_COLUMNS, BRIEFING_RECIPIENTS_TAB_COLUMNS } from "../shared/briefings.mjs";
import { GOOGLE_FORM_TEMPLATES_COLUMNS } from "../server/google-form-templates.mjs";
import { SITES_COLUMNS, DEPARTMENTS_COLUMNS, AREAS_STRUCTURE_COLUMNS } from "../shared/company-structure-access.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run the demo company seeder.`);
  process.exit(1);
}

const live = process.argv.includes("--live");
const companyNameArg = (() => {
  const idx = process.argv.indexOf("--company-name");
  return idx >= 0 ? String(process.argv[idx + 1] || "").trim() : DEMO_COMPANY_NAME;
})();

const nameGuard = assertDemoCompanyAllowed(companyNameArg);
if (!nameGuard.ok) {
  console.error(`ERROR: ${nameGuard.error}`);
  process.exit(1);
}

const { hashPassword } = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
const passwordHash = hashPassword(DEMO_COMPANY_SHARED_PASSWORD);
const seed = buildDemoCompanySeed({ passwordHash });

const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || "").trim()
  ? path.resolve(root, process.env.BERT_SESSIONS_DIR)
  : path.join(root, ".sessions");
const snapshotDir = path.join(sessionsRoot, "demo-company-seed");
fs.mkdirSync(snapshotDir, { recursive: true });

const snapshotPath = path.join(snapshotDir, "workbook-snapshot.json");
const reportPath = path.join(root, "demo-company-seed-report.json");

function upsertByKey(existingRows = [], nextRows = [], keyFields = []) {
  const map = new Map();
  for (const row of existingRows) {
    const key = keyFields.map((field) => String(row[field] || "").trim().toLowerCase()).join("|");
    if (key) map.set(key, row);
  }
  for (const row of nextRows) {
    const key = keyFields.map((field) => String(row[field] || "").trim().toLowerCase()).join("|");
    if (!key) continue;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }
  return [...map.values()];
}

function buildLocalWorkbook(seedPayload) {
  return {
    companyName: seedPayload.companyName,
    companyFolderId: seedPayload.companyFolderId,
    masterSheetId: seedPayload.masterSheetId,
    tabs: {
      Config: [{ Key: "CompanyName", Value: seedPayload.companyName }],
      Sites: seedPayload.sites,
      Departments: seedPayload.departments,
      Areas: seedPayload.areas,
      Users: seedPayload.users,
      AuditTemplates: seedPayload.audits,
      Schedules: seedPayload.schedules,
      Actions: seedPayload.actions,
      NCRs: seedPayload.ncrs,
      Incidents: seedPayload.incidents,
      Briefings: seedPayload.briefings,
      BriefingRecipients: seedPayload.briefingRecipients,
      GoogleFormTemplates: seedPayload.googleForms,
    },
    requiredTabs: seedPayload.requiredTabs,
    updatedAt: seedPayload.generatedAt,
  };
}

function loadGoogleAuth() {
  const sessionCandidates = [
    path.join(sessionsRoot, "google-oauth-token.json"),
    path.join(sessionsRoot, "google-session.json"),
    path.join(root, ".sessions", "google-session.json"),
    path.join(root, ".data", "google-oauth.json"),
  ];
  const sessionPath = sessionCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sessionPath) {
    throw new Error("Missing Google OAuth token — connect Google first (npm run google:connect).");
  }
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(session.tokens || session);
  return auth;
}

function buildDeps() {
  return {
    google,
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    ensureColumns: (auth, spreadsheetId, tab, columns) => ensureTabColumns(auth, buildDeps(), spreadsheetId, tab, columns),
    getTabValues: (auth, deps, sheetId, tab) => getTabValues(auth, deps, sheetId, tab),
    rowsToRecords,
  };
}

async function readExistingRows(auth, deps, sheetId, tab) {
  const values = await getTabValues(auth, deps, sheetId, tab);
  return rowsToRecords(values);
}

async function writeMergedTab(auth, deps, sheetId, tab, columns, nextRows, keyFields) {
  await ensureTabColumns(auth, deps, sheetId, tab, columns);
  const existing = await readExistingRows(auth, deps, sheetId, tab);
  const merged = upsertByKey(existing, nextRows, keyFields);
  await writeTabRecords(auth, deps, sheetId, tab, columns, merged);
  return merged.length;
}

async function applyLiveSeed(seedPayload) {
  const folderFromEnv = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
  const workbookFromEnv = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
  if (!folderFromEnv || !workbookFromEnv) {
    throw new Error(
      `--live requires ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV} (folder-first company + workbook).`,
    );
  }

  const auth = loadGoogleAuth();
  const deps = buildDeps();
  const companyFolderId = folderFromEnv;
  const masterSheetId = workbookFromEnv;

  seedPayload.companyFolderId = companyFolderId;
  seedPayload.masterSheetId = masterSheetId;

  const retarget = (rows = []) =>
    rows.map((row) => ({
      ...row,
      "Company ID": companyFolderId,
      CompanyId: companyFolderId,
      CompanyFolderId: companyFolderId,
      Company: DEMO_COMPANY_NAME,
      "Company Folder ID": companyFolderId,
      "Source Company ID": companyFolderId,
      "Source Company Name": DEMO_COMPANY_NAME,
    }));

  seedPayload.users = retarget(seedPayload.users);
  seedPayload.actions = retarget(seedPayload.actions);
  seedPayload.ncrs = retarget(seedPayload.ncrs);
  seedPayload.schedules = seedPayload.schedules.map((row) => ({
    ...row,
    "Company Folder ID": companyFolderId,
  }));
  seedPayload.googleForms = retarget(seedPayload.googleForms);

  await ensureRequiredTabs(auth, deps, masterSheetId);
  await ensureTabColumns(auth, deps, masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS);

  const siteCols = SITES_COLUMNS;
  const deptCols = DEPARTMENTS_COLUMNS;
  const areaCols = AREAS_STRUCTURE_COLUMNS;

  await writeMergedTab(auth, deps, masterSheetId, "Sites", siteCols, seedPayload.sites, ["SiteId"]);
  await writeMergedTab(auth, deps, masterSheetId, "Departments", deptCols, seedPayload.departments, [
    "DepartmentId",
  ]);
  await writeMergedTab(auth, deps, masterSheetId, "Areas", areaCols, seedPayload.areas, ["AreaId"]);
  await writeMergedTab(auth, deps, masterSheetId, "AuditTemplates", AUDIT_TEMPLATES_COLUMNS, seedPayload.audits, [
    "Audit ID",
  ]);
  await writeMergedTab(auth, deps, masterSheetId, "Schedules", SCHEDULES_TAB_COLUMNS, seedPayload.schedules, [
    "Schedule ID",
  ]);

  const actionCols = Object.keys(seedPayload.actions[0] || {});
  await writeMergedTab(auth, deps, masterSheetId, "Actions", actionCols, seedPayload.actions, ["Action ID"]);
  await writeMergedTab(auth, deps, masterSheetId, "NCRs", NCR_TAB_COLUMNS, seedPayload.ncrs, ["NCR ID"]);
  await writeMergedTab(auth, deps, masterSheetId, INCIDENTS_TAB, INCIDENTS_TAB_COLUMNS, seedPayload.incidents, [
    "IncidentId",
  ]);
  await writeMergedTab(auth, deps, masterSheetId, "Briefings", BRIEFINGS_TAB_COLUMNS, seedPayload.briefings, [
    "BriefingId",
  ]);
  await writeMergedTab(
    auth,
    deps,
    masterSheetId,
    "BriefingRecipients",
    BRIEFING_RECIPIENTS_TAB_COLUMNS,
    seedPayload.briefingRecipients,
    ["BriefingId", "RecipientEmail"],
  );
  await writeMergedTab(
    auth,
    deps,
    masterSheetId,
    "GoogleFormTemplates",
    GOOGLE_FORM_TEMPLATES_COLUMNS,
    seedPayload.googleForms,
    ["BERT Template ID"],
  );

  for (const user of seedPayload.users) {
    const write = await writeUsersTabRecordByHeaders(auth, masterSheetId, user, deps, {
      companyContext: {
        companyFolderId,
        companyId: companyFolderId,
        companyName: DEMO_COMPANY_NAME,
      },
    });
    if (!write.ok) {
      throw new Error(write.error || `Failed to upsert user ${user.Email}`);
    }
  }

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
    liveNote = "Seed upserted into the connected company workbook.";
  } catch (error) {
    liveNote = `Live apply failed: ${error instanceof Error ? error.message : String(error)}`;
    mode = "local-snapshot-live-failed";
    console.error(`WARNING: ${liveNote}`);
    console.error("Continuing with local snapshot + report.");
  }
}

const workbook = buildLocalWorkbook(seed);
if (fs.existsSync(snapshotPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    workbook.tabs.Users = upsertByKey(previous.tabs?.Users || [], workbook.tabs.Users, ["Email"]);
    workbook.tabs.Sites = upsertByKey(previous.tabs?.Sites || [], workbook.tabs.Sites, ["SiteId"]);
    workbook.tabs.Departments = upsertByKey(previous.tabs?.Departments || [], workbook.tabs.Departments, [
      "DepartmentId",
    ]);
    workbook.tabs.Areas = upsertByKey(previous.tabs?.Areas || [], workbook.tabs.Areas, ["AreaId"]);
    workbook.tabs.AuditTemplates = upsertByKey(previous.tabs?.AuditTemplates || [], workbook.tabs.AuditTemplates, [
      "Audit ID",
    ]);
    workbook.tabs.Schedules = upsertByKey(previous.tabs?.Schedules || [], workbook.tabs.Schedules, ["Schedule ID"]);
    workbook.tabs.Actions = upsertByKey(previous.tabs?.Actions || [], workbook.tabs.Actions, ["Action ID"]);
    workbook.tabs.NCRs = upsertByKey(previous.tabs?.NCRs || [], workbook.tabs.NCRs, ["NCR ID"]);
    workbook.tabs.Incidents = upsertByKey(previous.tabs?.Incidents || [], workbook.tabs.Incidents, ["IncidentId"]);
    workbook.tabs.Briefings = upsertByKey(previous.tabs?.Briefings || [], workbook.tabs.Briefings, ["BriefingId"]);
    workbook.tabs.GoogleFormTemplates = upsertByKey(
      previous.tabs?.GoogleFormTemplates || [],
      workbook.tabs.GoogleFormTemplates,
      ["BERT Template ID"],
    );
  } catch {
    /* first seed */
  }
}

fs.writeFileSync(snapshotPath, JSON.stringify(workbook, null, 2), "utf8");

const report = {
  ...summarizeDemoSeed(seed),
  mode,
  liveApplied,
  liveNote: liveNote || undefined,
  snapshotPath,
  reportPath,
  passwordNote: `Shared demo password for seeded ACTIVE users: ${DEMO_COMPANY_SHARED_PASSWORD}`,
  safety: {
    confirmEnv: DEMO_COMPANY_SEED_CONFIRM_ENV,
    companyNameLockedTo: DEMO_COMPANY_NAME,
    refusedNames: ["TESTCO", "Blank Company", "Demo Company"],
  },
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("");
console.log("Demo company seed complete");
console.log(`  Company: ${seed.companyName}`);
console.log(`  Folder ID: ${seed.companyFolderId}`);
console.log(`  Workbook ID: ${seed.masterSheetId}`);
console.log(`  Mode: ${mode}`);
console.log(`  Users: ${seed.counts.users} (active ${seed.counts.activeUsers})`);
console.log(`  Roles: ${JSON.stringify(seed.counts.roles)}`);
console.log(`  Sites: ${seed.counts.sites}`);
console.log(`  Departments: ${seed.counts.departments}`);
console.log(`  Areas: ${seed.counts.areas}`);
console.log(`  Audit templates: ${seed.counts.auditTemplates}`);
console.log(`  Schedules: ${seed.counts.schedules}`);
console.log(`  Actions: ${seed.counts.actions}`);
console.log(`  NCRs: ${seed.counts.ncrs}`);
console.log(`  Incidents: ${seed.counts.incidents}`);
console.log(`  Briefings: ${seed.counts.briefings}`);
console.log(`  Archived records: ${seed.counts.archivedTotal}`);
console.log(`  Snapshot: ${snapshotPath}`);
console.log(`  Report: ${reportPath}`);
console.log("");
console.log("Login details (shared password for ACTIVE seeded users):");
console.log(`  Password: ${DEMO_COMPANY_SHARED_PASSWORD}`);
for (const login of seed.loginSummary) {
  console.log(`  - ${login.name} <${login.email}> (${login.role})`);
}
if (liveNote) {
  console.log("");
  console.log(`Live note: ${liveNote}`);
}
console.log("");
