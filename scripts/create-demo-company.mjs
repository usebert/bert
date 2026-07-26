#!/usr/bin/env node
/**
 * Provision Midlands Precast Concrete Ltd demo company workspace (folder + workbook).
 *
 * Default: dry-run plan (no Google writes).
 * --live: creates or resumes provisioning via provisionCompanyWorkspace.
 *
 * Usage:
 *   DEMO_COMPANY_SEED_CONFIRM=yes npm run create:demo-company
 *   DEMO_COMPANY_SEED_CONFIRM=yes npm run create:demo-company -- --live
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { google } from "googleapis";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SPREADSHEET_ENV,
  DEMO_DEFAULT_PASSWORD_ENV,
  DEMO_MASTER_EMAIL_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  assertDemoCompanyAllowed,
  resolveDemoWorkspaceIdMode,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
  readDemoDefaultPassword,
  readDemoMasterEmail,
} from "../shared/demo-environment.mjs";
import { describeLiveCompaniesResolutionFailure } from "../shared/company-folder-placement.mjs";
import { provisionCompanyWorkspace } from "../server/company-provisioning-service.mjs";
import { resolveLiveCompaniesFolder } from "../server/company-folder-placement.mjs";
import { loadGoogleAuth, buildCompanyProvisionScriptDeps } from "./lib/demo-environment-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const live = process.argv.includes("--live");
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run the demo company creator.`);
  process.exit(1);
}

const companyName = MIDLANDS_DEMO_COMPANY_NAME;
const folderFromEnv = readDemoCompanyFolderId();
const spreadsheetFromEnv = readDemoCompanySpreadsheetId();
const defaultPassword = readDemoDefaultPassword();
const masterEmail = readDemoMasterEmail();

const guard = assertDemoCompanyAllowed({
  companyName,
  requireWorkspaceIds: false,
});
if (!guard.ok) {
  console.error(`ERROR: ${guard.error}`);
  process.exit(1);
}

const workspaceIdMode = resolveDemoWorkspaceIdMode({
  companyFolderId: folderFromEnv,
  masterSheetId: spreadsheetFromEnv,
});
if (!workspaceIdMode.ok) {
  console.error(`ERROR: ${workspaceIdMode.error}`);
  process.exit(1);
}

if (!defaultPassword || defaultPassword.length < 12) {
  console.error(`ERROR: Set ${DEMO_DEFAULT_PASSWORD_ENV} (>= 12 chars) for demo user seeding.`);
  process.exit(1);
}

const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || "").trim()
  ? path.resolve(root, process.env.BERT_SESSIONS_DIR)
  : path.join(root, ".sessions");
const manifestPath = path.join(sessionsRoot, "demo-environment-manifest.json");

const adminPersona = {
  name: "Olivia Bennett",
  email: "demo.midlands.admin@usebert.co.uk",
  username: "demo.midlands.admin",
};

function buildDeps() {
  return buildCompanyProvisionScriptDeps({
    sessionDir: sessionsRoot,
    sharedDriveId: String(process.env.GOOGLE_SHARED_DRIVE_ID || "").trim(),
    platformRegistrySheetId: String(process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "").trim(),
    resolveLiveCompaniesFolder,
  });
}

function buildProvisionInput(overrides = {}) {
  return {
    companyName,
    companyType: "Manufacturing",
    firstAdminName: adminPersona.name,
    firstAdminEmail: adminPersona.email,
    firstAdminUsername: adminPersona.username,
    adminPassword: defaultPassword,
    confirmPassword: defaultPassword,
    ...overrides,
  };
}

async function runProvisioning(auth, deps, input) {
  return provisionCompanyWorkspace(
    auth,
    deps,
    input,
    async (event) => {
      if (event.type === "stage") {
        console.log(`[provision] ${event.stage}: ${event.status}`);
      }
    },
  );
}

async function assertLiveCompaniesWorkspaceReady(auth, deps) {
  const resolution = await resolveLiveCompaniesFolder(auth, deps);
  const failure = describeLiveCompaniesResolutionFailure(resolution, {
    sharedDriveId: deps.sharedDriveId,
    companyFolderId: folderFromEnv,
  });
  if (failure.ok) {
    console.log(
      `Live Companies preflight ok: workspace root "${failure.diagnostics.workspaceRootName || deps.sharedDriveId}", folder "${failure.diagnostics.liveCompaniesFolderName || "Live Companies"}".`,
    );
    return resolution;
  }
  console.error("Live Companies preflight failed:");
  console.error(`  reason: ${failure.reasonCode}`);
  console.error(`  ${failure.message}`);
  console.error(`  diagnostics: ${JSON.stringify(failure.diagnostics, null, 2)}`);
  if (failure.setupHint) {
    console.error("");
    console.error(failure.setupHint);
  }
  const error = new Error(failure.message);
  error.reasonCode = failure.reasonCode;
  error.diagnostics = failure.diagnostics;
  error.setupHint = failure.setupHint;
  throw error;
}

function printProvisionFailure(result) {
  console.error(`Provisioning failed at ${result.failedStage || "unknown"}: ${result.error || "unknown error"}`);
  if (result.reasonCode) {
    console.error(`  reason: ${result.reasonCode}`);
  }
  if (result.diagnostics) {
    console.error(`  diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`);
  }
  if (result.setupHint) {
    console.error("");
    console.error(result.setupHint);
  }
}

async function verifyExistingWorkspace(auth, folderId, spreadsheetId) {
  const drive = google.drive({ version: "v3", auth });
  const folder = await drive.files.get({
    fileId: folderId,
    fields: "id,name,trashed",
    supportsAllDrives: true,
  });
  const folderName = String(folder.data.name || "").trim();
  if (folder.data.trashed) {
    throw new Error(`Configured folder ${folderId} is in trash.`);
  }
  if (folderName.toLowerCase() !== companyName.toLowerCase()) {
    throw new Error(`Folder name mismatch: expected "${companyName}", got "${folderName}".`);
  }
  const workbook = await drive.files.get({
    fileId: spreadsheetId,
    fields: "id,name,trashed,parents",
    supportsAllDrives: true,
  });
  if (workbook.data.trashed) {
    throw new Error(`Configured workbook ${spreadsheetId} is in trash.`);
  }
  return { folderName, workbookName: workbook.data.name || "" };
}

async function seedMasterOperator() {
  const masterSecret = String(process.env.BERT_MASTER_SEED_SECRET || "").trim();
  if (!masterSecret || masterSecret.length < 16) {
    console.warn(
      `WARNING: Skipping master operator seed — set BERT_MASTER_SEED_SECRET (>= 16 chars) to upsert ${masterEmail}.`,
    );
    return { seeded: false };
  }
  const { upsertMasterOperator } = await import(pathToFileURL(path.join(root, "server/master-auth.mjs")).href);
  upsertMasterOperator({
    sessionDir: sessionsRoot,
    email: masterEmail,
    name: "Master Demo Operator",
    password: defaultPassword,
  });
  return { seeded: true, email: masterEmail };
}

async function main() {
  const plan = {
    companyName,
    mode: live ? "live" : "dry-run",
    workspaceMode: workspaceIdMode.mode,
    folderId:
      workspaceIdMode.mode === "resume"
        ? workspaceIdMode.companyFolderId
        : folderFromEnv || "(provision on --live)",
    spreadsheetId:
      workspaceIdMode.mode === "resume"
        ? workspaceIdMode.masterSheetId
        : spreadsheetFromEnv || "(provision on --live)",
    admin: adminPersona,
    masterEmail,
    generatedAt: new Date().toISOString(),
  };

  if (!live) {
    console.log("Midlands demo company create — dry run");
    console.log(JSON.stringify(plan, null, 2));
    console.log("");
    console.log("No Google writes performed. Re-run with --live to provision.");
    fs.mkdirSync(sessionsRoot, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ ...plan, liveApplied: false }, null, 2), "utf8");
    console.log(`Manifest: ${manifestPath}`);
    return;
  }

  let companyFolderId = folderFromEnv;
  let masterSheetId = spreadsheetFromEnv;

  const auth = loadGoogleAuth(sessionsRoot);

  if (workspaceIdMode.mode === "resume") {
    companyFolderId = workspaceIdMode.companyFolderId;
    masterSheetId = workspaceIdMode.masterSheetId;
    const verified = await verifyExistingWorkspace(auth, companyFolderId, masterSheetId);
    console.log(`Validated existing workspace: ${verified.folderName} / ${verified.workbookName}`);
    const deps = buildDeps();
    const result = await runProvisioning(
      auth,
      deps,
      buildProvisionInput({
        companyFolderId,
        masterSheetId,
        completedStages: ["creating_company_folder", "creating_workbook", "preparing_workbook_tabs"],
      }),
    );
    if (!result.ok) {
      printProvisionFailure(result);
      throw new Error(result.error || `Provisioning failed at ${result.failedStage || "unknown"}`);
    }
    companyFolderId = result.companyFolderId || companyFolderId;
    masterSheetId = result.masterSheetId || masterSheetId;
    console.log("Resumed provisioning from existing workspace:");
    console.log(`  ${DEMO_COMPANY_FOLDER_ENV}=${companyFolderId}`);
    console.log(`  ${DEMO_COMPANY_SPREADSHEET_ENV}=${masterSheetId}`);
  } else {
    const deps = buildDeps();
    await assertLiveCompaniesWorkspaceReady(auth, deps);
    const result = await runProvisioning(auth, deps, buildProvisionInput());
    if (!result.ok) {
      printProvisionFailure(result);
      throw new Error(result.error || `Provisioning failed at ${result.failedStage || "unknown"}`);
    }
    companyFolderId = result.companyFolderId;
    masterSheetId = result.masterSheetId;
    console.log("Provisioned workspace:");
    console.log(`  ${DEMO_COMPANY_FOLDER_ENV}=${companyFolderId}`);
    console.log(`  ${DEMO_COMPANY_SPREADSHEET_ENV}=${masterSheetId}`);
  }

  const postGuard = assertDemoCompanyAllowed({
    companyName,
    companyFolderId,
    masterSheetId,
    requireWorkspaceIds: true,
    requireSpreadsheet: true,
  });
  if (!postGuard.ok) {
    throw new Error(postGuard.error || "Provisioned workspace failed demo environment validation.");
  }
  companyFolderId = postGuard.companyFolderId;
  masterSheetId = postGuard.masterSheetId;

  const master = await seedMasterOperator();
  const manifest = {
    ...plan,
    liveApplied: true,
    companyFolderId,
    masterSheetId,
    masterOperatorSeeded: master.seeded,
    masterEmail: master.seeded ? master.email : masterEmail,
  };
  fs.mkdirSync(sessionsRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log("");
  console.log("Midlands demo company workspace ready.");
  console.log(`  Folder: ${companyFolderId}`);
  console.log(`  Workbook: ${masterSheetId}`);
  console.log(`  Master operator: ${master.seeded ? master.email : "not seeded (missing BERT_MASTER_SEED_SECRET)"}`);
  console.log(`  Manifest: ${manifestPath}`);
  console.log("");
  console.log("Next: npm run seed:demo-environment -- --live");
  console.log("Then: npm run register:demo-environment");
}

main().catch((error) => {
  console.error("Create failed:", error?.message || error);
  if (error?.reasonCode) {
    console.error(`  reason: ${error.reasonCode}`);
  }
  if (error?.diagnostics) {
    console.error(`  diagnostics: ${JSON.stringify(error.diagnostics, null, 2)}`);
  }
  if (error?.setupHint) {
    console.error("");
    console.error(error.setupHint);
  }
  if (error?.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
