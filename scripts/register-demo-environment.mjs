#!/usr/bin/env node
/**
 * Register Midlands Precast Concrete Ltd in the platform company registry as LIVE
 * and rebuild auth-index for Users tab accounts.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_SPREADSHEET_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  assertDemoCompanyAllowed,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
} from "../shared/demo-environment.mjs";
import { COMPANY_REGISTRY_STATUS_LIVE, isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import {
  ensureTabColumns,
  ensureTabExists,
  getTabValues,
  rowsToRecords,
} from "../server/workbook-service.mjs";
import {
  getCanonicalCompanyRegistryRecord,
  persistAndVerifyCompanyLive,
} from "../server/company-workspace-registry.mjs";
import { persistFallbackCompanyLive } from "../server/company-registry-fallback.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { isPasswordHash, parseRoleFromUsersSheet, normalizeUserStatus } from "../server/users-tab-schema.mjs";
import { defaultAccessLevelForRole } from "../server/company-users.mjs";
import { loadGoogleAuth } from "./lib/demo-environment-script-utils.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();
const fallbackOnly = process.argv.includes("--fallback-only");

const companyFolderId = readDemoCompanyFolderId();
const masterSheetId = readDemoCompanySpreadsheetId();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const sharedDriveId = String(process.env.GOOGLE_SHARED_DRIVE_ID || "").trim();
const platformRegistrySheetId = String(process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "").trim();

function pickField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
}

async function rebuildDemoAuthIndex(auth, deps) {
  const authIndex = createAuthIndexApi(path.join(sessionsRoot, "auth-index.json"));
  const values = await getTabValues(auth, deps, masterSheetId, "Users");
  const records = rowsToRecords(values);
  let upserted = 0;
  for (const row of records) {
    const email = pickField(row, "Email", "email").toLowerCase();
    if (!email.includes("@")) {
      continue;
    }
    const status = normalizeUserStatus(pickField(row, "Status", "status"));
    if (status !== "ACTIVE") {
      continue;
    }
    const passwordHash = pickField(row, "PasswordHash", "passwordHash");
    if (!isPasswordHash(passwordHash)) {
      continue;
    }
    const roleRaw = pickField(row, "Role", "role");
    const role = parseRoleFromUsersSheet(roleRaw) || roleRaw || "User";
    const username =
      String(pickField(row, "Username", "username") || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "") || email.split("@")[0];
    authIndex.upsertEntry({
      email,
      username,
      name: pickField(row, "Name", "Full Name", "name") || email,
      role,
      accessLevel: pickField(row, "AccessLevel", "accessLevel") || defaultAccessLevelForRole(role),
      companyId: companyFolderId,
      companyFolderId,
      companyName: MIDLANDS_DEMO_COMPANY_NAME,
      masterSheetId,
      status: "ACTIVE",
      passwordHash,
      companyAreas: String(pickField(row, "CompanyAreas", "companyAreas") || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      indexedAt: Date.now(),
    });
    upserted += 1;
  }
  return upserted;
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
  console.error(`Main registry write failed: ${message}`);
  if (error?.stack) {
    console.error(error.stack);
  }
}

async function main() {
  if (confirm !== "yes") {
    throw new Error(`Refusing to register without ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes`);
  }
  const guard = assertDemoCompanyAllowed({
    companyName: MIDLANDS_DEMO_COMPANY_NAME,
    companyFolderId,
    masterSheetId,
  });
  if (!guard.ok) {
    throw new Error(guard.error);
  }

  const payload = {
    companyId: companyFolderId,
    companyFolderId,
    rootFolderId: companyFolderId,
    companyName: MIDLANDS_DEMO_COMPANY_NAME,
    masterSheetId,
    workbookId: masterSheetId,
    workbookFolderId: companyFolderId,
    status: COMPANY_REGISTRY_STATUS_LIVE,
    Status: COMPANY_REGISTRY_STATUS_LIVE,
    lifecycleStatus: "LIVE",
    isLive: true,
    active: true,
    companyFoldersMappingStatus: "Synced",
    firstAdminStatus: "Ready",
    healthStatus: "Good",
    needsAttention: "false",
    markLive: true,
    markSetupComplete: true,
  };

  console.log("Registering Midlands demo company:");
  console.log(`  companyName: ${payload.companyName}`);
  console.log(`  companyFolderId: ${payload.companyFolderId}`);
  console.log(`  masterSheetId: ${payload.masterSheetId}`);
  console.log(`  mode: ${fallbackOnly ? "fallback-only" : "main-registry-then-fallback"}`);
  console.log("");

  let mainError = "";
  let auth = null;
  let deps = null;

  if (!fallbackOnly) {
    auth = loadGoogleAuth(sessionsRoot);
    deps = buildDeps();
    try {
      const mainResult = await persistAndVerifyCompanyLive(auth, deps, payload);
      console.log("Main registry:", mainResult.alreadyLive ? "already LIVE" : mainResult.promoted ? "promoted to LIVE" : "updated");
    } catch (error) {
      mainError = String(error?.technicalError || error?.message || error);
      printRegistryError(error);
    }

    const verified = await getCanonicalCompanyRegistryRecord(auth, deps, companyFolderId).catch(() => null);
    if (verified && isCompanyRegistryLive(verified)) {
      const nameOk = String(verified.companyName || "").trim() === MIDLANDS_DEMO_COMPANY_NAME;
      const sheetOk = String(verified.masterSheetId || "").trim() === masterSheetId;
      if (!nameOk || !sheetOk) {
        throw new Error("Registry Live row incomplete after write.");
      }
      const upserted = await rebuildDemoAuthIndex(auth, deps);
      console.log(`Auth-index rebuilt for Midlands Users tab: ${upserted} ACTIVE accounts indexed.`);
      console.log("\nNext: npm run verify:demo-environment");
      return;
    }
  }

  const fallback = persistFallbackCompanyLive(sessionsRoot, payload);
  if (!fallback.synced) {
    throw new Error(
      `Failed to register Midlands demo company (main: ${mainError || "skipped"}; fallback: ${fallback.reason || "unknown"})`,
    );
  }

  console.log("\nFallback registry: LIVE written");
  console.log(`  file: ${fallback.filePath}`);
  if (mainError) {
    console.log(`Main registry underlying error was: ${mainError}`);
  }
}

main().catch((error) => {
  console.error("Register failed:", error?.stack || error);
  process.exit(1);
});
