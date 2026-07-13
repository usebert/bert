#!/usr/bin/env node
/**
 * Register Dovecote Manufacturing Ltd in the platform company registry as LIVE
 * so cold login can discover the seeded workbook.
 *
 * Prefers the main BERT Platform Registry Companies tab. If that write fails,
 * falls back to .sessions/company-registry-fallback.json (local API host only).
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   npm run register:demo-company
 *
 * Optional:
 *   --fallback-only   skip main registry and only write local fallback JSON
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_NAME,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_WORKBOOK_ENV,
  assertDemoCompanyAllowed,
} from "../shared/demo-company-seed.mjs";
import { COMPANY_REGISTRY_STATUS_LIVE, isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import {
  ensureTabColumns,
  ensureTabExists,
  getTabValues,
} from "../server/workbook-service.mjs";
import {
  getCanonicalCompanyRegistryRecord,
  persistAndVerifyCompanyLive,
} from "../server/company-workspace-registry.mjs";
import { persistFallbackCompanyLive } from "../server/company-registry-fallback.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();
const fallbackOnly = process.argv.includes("--fallback-only");

const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const sharedDriveId = String(process.env.GOOGLE_SHARED_DRIVE_ID || "").trim();
const platformRegistrySheetId = String(process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "").trim();

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
  const deps = {
    google,
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    sharedDriveId,
    platformRegistrySheetId,
    sessionDir: sessionsRoot,
  };

  deps.getWorkbook = async (auth, spreadsheetId) => {
    const sheets = google.sheets({ version: "v4", auth });
    return sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties(title),sheets(properties(sheetId,title))",
    });
  };

  deps.ensureTabExists = (auth, spreadsheetId, tab, existingWorkbook = null) =>
    ensureTabExists(auth, deps, spreadsheetId, tab, existingWorkbook);

  deps.ensureColumns = (auth, spreadsheetId, tab, columns) =>
    ensureTabColumns(auth, deps, spreadsheetId, tab, columns);

  deps.getTabValues = (auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab) => {
    if (maybeDepsOrSheetId && typeof maybeDepsOrSheetId === "object" && maybeDepsOrSheetId.google) {
      return getTabValues(auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab);
    }
    return getTabValues(auth, deps, maybeDepsOrSheetId, maybeSheetIdOrTab);
  };

  return deps;
}

function printRegistryError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const technicalError = String(error?.technicalError || "").trim();
  console.error(`Main registry write failed: ${message}`);
  if (technicalError && technicalError !== message) {
    console.error(`Underlying technicalError: ${technicalError}`);
  }
  if (error?.code) {
    console.error(`code: ${error.code}`);
  }
  if (error?.reasonCode) {
    console.error(`reasonCode: ${error.reasonCode}`);
  }
  if (error?.registrySpreadsheetId) {
    console.error(`registrySpreadsheetId: ${error.registrySpreadsheetId}`);
  }
  if (error?.registryLocation) {
    console.error(`registryLocation: ${error.registryLocation}`);
  }
  if (Array.isArray(error?.missingColumns) && error.missingColumns.length) {
    console.error(`missingColumns: ${error.missingColumns.join(", ")}`);
  }
  if (error?.lookupKeys) {
    console.error(`lookupKeys: ${JSON.stringify(error.lookupKeys)}`);
  }
  if (error?.verifyReadback) {
    console.error(`verifyReadback: ${JSON.stringify(error.verifyReadback, null, 2)}`);
  }
  if (error?.stack) {
    console.error(error.stack);
  }
}

function printEnvDiagnostics() {
  console.log("Env diagnostics:");
  console.log(`  GOOGLE_SHARED_DRIVE_ID: ${sharedDriveId || "(blank)"}`);
  console.log(`  BERT_PLATFORM_REGISTRY_SHEET_ID: ${platformRegistrySheetId || "(blank)"}`);
  console.log(`  BERT_SESSIONS_DIR: ${process.env.BERT_SESSIONS_DIR || `(default ${sessionsRoot})`}`);
  if (sharedDriveId && companyFolderId && sharedDriveId === companyFolderId) {
    console.error(
      "WARNING: GOOGLE_SHARED_DRIVE_ID equals the demo company folder ID. " +
        "It must be the workspace/shared-drive root that contains \"BERT Platform Registry\" and \"Live Companies\", " +
        "not the Dovecote company folder. Main registry writes will fail until this is corrected " +
        "(or set BERT_PLATFORM_REGISTRY_SHEET_ID to the registry spreadsheet id).",
    );
  }
  if (!platformRegistrySheetId && !sharedDriveId) {
    console.error(
      "WARNING: Neither BERT_PLATFORM_REGISTRY_SHEET_ID nor GOOGLE_SHARED_DRIVE_ID is set. Main registry cannot be resolved.",
    );
  }
  console.log("");
}

async function main() {
  if (confirm !== "yes") {
    throw new Error(`Refusing to register without ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes`);
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error(`Requires ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV}`);
  }
  assertDemoCompanyAllowed(DEMO_COMPANY_NAME);

  const payload = {
    companyId: companyFolderId,
    companyFolderId,
    rootFolderId: companyFolderId,
    companyName: DEMO_COMPANY_NAME,
    masterSheetId,
    workbookId: masterSheetId,
    status: COMPANY_REGISTRY_STATUS_LIVE,
    Status: COMPANY_REGISTRY_STATUS_LIVE,
    lifecycleStatus: "LIVE",
    isLive: true,
    active: true,
    markLive: true,
  };

  console.log("Registering demo company:");
  console.log(`  companyName: ${payload.companyName}`);
  console.log(`  companyId: ${payload.companyId}`);
  console.log(`  companyFolderId: ${payload.companyFolderId}`);
  console.log(`  rootFolderId: ${payload.rootFolderId}`);
  console.log(`  masterSheetId: ${payload.masterSheetId}`);
  console.log(`  workbookId: ${payload.workbookId}`);
  console.log(`  status/Status: ${payload.status}`);
  console.log(`  lifecycleStatus: ${payload.lifecycleStatus}`);
  console.log(`  isLive: ${payload.isLive}`);
  console.log(`  active: ${payload.active}`);
  console.log(`  mode: ${fallbackOnly ? "fallback-only" : "main-registry-then-fallback"}`);
  console.log("");
  printEnvDiagnostics();

  let mainError = "";
  let auth = null;
  let deps = null;

  if (!fallbackOnly) {
    auth = loadGoogleAuth();
    deps = buildDeps();
    try {
      const mainResult = await persistAndVerifyCompanyLive(auth, deps, payload);
      console.log("Main registry:", mainResult.alreadyLive ? "already LIVE" : mainResult.promoted ? "promoted to LIVE" : "updated");
      console.log(`  synced: ${Boolean(mainResult.synced)}`);
      console.log(`  registryStatus: ${mainResult.registryStatus || ""}`);
      console.log(`  companyId: ${mainResult.companyId || ""}`);
      console.log(`  masterSheetId: ${mainResult.masterSheetId || ""}`);
    } catch (error) {
      mainError = String(error?.technicalError || error?.message || error);
      printRegistryError(error);
    }

    const verified = await getCanonicalCompanyRegistryRecord(auth, deps, companyFolderId).catch(() => null);
    if (verified && isCompanyRegistryLive(verified)) {
      console.log("\nCanonical registry check: LIVE");
      console.log(`  source: ${verified.registrySource || "main"}`);
      console.log(`  status: ${verified.status || ""}`);
      console.log(`  Status: ${verified.Status || verified.status || ""}`);
      console.log(`  lifecycleStatus: ${verified.lifecycleStatus || ""}`);
      console.log(`  isLive: ${verified.isLive}`);
      console.log(`  active: ${verified.active}`);
      console.log(`  masterSheetId: ${verified.masterSheetId || ""}`);
      console.log(`  workbookId: ${verified.workbookId || verified.masterSheetId || ""}`);
      console.log(`  rootFolderId: ${verified.rootFolderId || ""}`);
      console.log(`  companyFolderId: ${verified.companyFolderId || ""}`);
      console.log("\nNext: rebuild auth-index in Godmode (or retry login with companyFolderId), then sign in as bert.demo+mr.important@usebert.co.uk");
      return;
    }
  }

  const fallback = persistFallbackCompanyLive(sessionsRoot, payload);
  if (!fallback.synced) {
    throw new Error(
      `Failed to register demo company (main: ${mainError || "skipped"}; fallback: ${fallback.reason || "unknown"})`,
    );
  }

  const record = fallback.record || {};
  console.log("\nFallback registry: LIVE written");
  console.log(`  file: ${fallback.filePath}`);
  console.log(`  companyId: ${record.companyId || companyFolderId}`);
  console.log(`  companyFolderId: ${record.companyFolderId || ""}`);
  console.log(`  rootFolderId: ${record.rootFolderId || ""}`);
  console.log(`  masterSheetId: ${record.masterSheetId || ""}`);
  console.log(`  workbookId: ${record.workbookId || ""}`);
  console.log(`  status: ${record.status || ""}`);
  console.log(`  Status: ${record.Status || ""}`);
  console.log(`  lifecycleStatus: ${record.lifecycleStatus || ""}`);
  console.log(`  isLive: ${record.isLive}`);
  console.log(`  active: ${record.active}`);
  console.log(
    "\nNote: fallback JSON only helps the API process using this BERT_SESSIONS_DIR. Deployed live apps need the main platform Companies registry row.",
  );
  if (mainError) {
    console.log(`Main registry underlying error was: ${mainError}`);
  }
  if (sharedDriveId && companyFolderId && sharedDriveId === companyFolderId) {
    console.log(
      "Fix GOOGLE_SHARED_DRIVE_ID (workspace root, not the company folder) or set BERT_PLATFORM_REGISTRY_SHEET_ID, then re-run register:demo-company to write the main registry.",
    );
  }
}

main().catch((error) => {
  console.error("Register failed:", error?.stack || error);
  process.exit(1);
});
