#!/usr/bin/env node
/**
 * Safe local verifier for demo company login against a seeded workbook.
 *
 * Does not mutate the workbook. Reads Users tab + platform/fallback registry
 * and checks PasswordHash with the same scrypt verifier used by live login.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   BERT_DEMO_COMPANY_FOLDER_ID=... BERT_DEMO_COMPANY_WORKBOOK_ID=... \
 *     npm run verify:demo-company-login
 *
 * Optional overrides:
 *   DEMO_LOGIN_EMAIL=bert.demo+mr.important@usebert.co.uk
 *   DEMO_LOGIN_PASSWORD=BertDemo123!
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_NAME,
  DEMO_COMPANY_SHARED_PASSWORD,
  DEMO_COMPANY_WORKBOOK_ENV,
} from "../shared/demo-company-seed.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import { verifyPassword } from "../server/master-auth.mjs";
import { getTabValues, rowsToRecords } from "../server/workbook-service.mjs";
import {
  getCanonicalCompanyRegistryRecord,
  readCanonicalCompanyWorkspaceRegistryMap,
} from "../server/company-workspace-registry.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { isPasswordHash } from "../server/users-tab-schema.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();

const EMAIL = String(process.env.DEMO_LOGIN_EMAIL || "bert.demo+mr.important@usebert.co.uk")
  .trim()
  .toLowerCase();
const PASSWORD = String(process.env.DEMO_LOGIN_PASSWORD || DEMO_COMPANY_SHARED_PASSWORD);
const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();

function line(label, value) {
  console.log(`${label}: ${value}`);
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
  const deps = {
    google,
    withSheetsQuotaRetry: async (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID || "",
    platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
    sessionDir: sessionsRoot,
  };

  deps.getTabValues = (auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab) => {
    if (maybeDepsOrSheetId && typeof maybeDepsOrSheetId === "object" && maybeDepsOrSheetId.google) {
      return getTabValues(auth, maybeDepsOrSheetId, maybeSheetIdOrTab, maybeTab);
    }
    return getTabValues(auth, deps, maybeDepsOrSheetId, maybeSheetIdOrTab);
  };

  return deps;
}

function pickField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
}

function emailCandidates(row) {
  return [pickField(row, "Email", "email", "User Email", "Login Email")]
    .map((value) => value.toLowerCase())
    .filter(Boolean);
}

async function main() {
  console.log("=== Demo company login verifier (read-only) ===\n");

  if (!companyFolderId || !masterSheetId) {
    throw new Error(
      `Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV} to the seeded company folder/workbook.`,
    );
  }

  line("Email", EMAIL);
  line("Password provided", PASSWORD ? "yes" : "no");
  line("Company name expected", DEMO_COMPANY_NAME);
  line("Company folder ID used", companyFolderId);
  line("Workbook used", masterSheetId);
  console.log("");

  const auth = loadGoogleAuth();
  const deps = buildDeps();

  const values = await getTabValues(auth, deps, masterSheetId, "Users");
  const records = rowsToRecords(values);
  const matches = records.filter((row) => emailCandidates(row).includes(EMAIL));

  line("Users tab rows total", String(records.length));
  line("Matching email rows", String(matches.length));

  if (matches.length === 0) {
    line("User found", "no");
    line("Password check", "skipped");
    line("Reason", "user_not_found_in_seeded_workbook");
    console.log("\nVerdict: seeded workbook does not contain this email. Do not blame registry yet.");
    process.exitCode = 2;
    return;
  }

  if (matches.length > 1) {
    console.log("WARNING: duplicate email rows found; showing each candidate:");
    matches.forEach((row, index) => {
      console.log(
        `  [${index}] status=${pickField(row, "Status", "status") || "(blank)"} ` +
          `role=${pickField(row, "Role", "role") || "(blank)"} ` +
          `folder=${pickField(row, "CompanyFolderId", "CompanyId", "Company Folder ID") || "(blank)"} ` +
          `hash=${pickField(row, "PasswordHash") ? "present" : "missing"}`,
      );
    });
  }

  const row = matches[0];
  const status = pickField(row, "Status", "status");
  const role = pickField(row, "Role", "role");
  const rowFolderId = pickField(row, "CompanyFolderId", "CompanyId", "Company Folder ID", "Company ID");
  const passwordHash = pickField(row, "PasswordHash", "passwordHash");
  const hashLooksValid = isPasswordHash(passwordHash);
  const passwordOk = hashLooksValid ? verifyPassword(PASSWORD, passwordHash) : false;

  line("User found", "yes");
  line("Status", status || "(blank)");
  line("Role", role || "(blank)");
  line("Row CompanyFolderId", rowFolderId || "(blank)");
  line("PasswordHash present", passwordHash ? "yes" : "no");
  line("PasswordHash format", hashLooksValid ? "scrypt$… (valid shape)" : passwordHash ? "invalid/unexpected" : "missing");
  line("Password check", passwordOk ? "passed" : "failed");

  const reasons = [];
  if (String(status || "").toUpperCase() !== "ACTIVE") {
    reasons.push(`status_not_active (${status || "blank"})`);
  }
  if (rowFolderId && rowFolderId !== companyFolderId) {
    reasons.push(`row_company_folder_mismatch (row=${rowFolderId}, expected=${companyFolderId})`);
  }
  if (!passwordHash) {
    reasons.push("no_password_hash");
  } else if (!hashLooksValid) {
    reasons.push("password_hash_format_invalid");
  } else if (!passwordOk) {
    reasons.push("password_compare_failed");
  }

  console.log("\n--- Discovery path (why cold live login may still fail) ---");

  const authIndexPath = path.join(sessionsRoot, "auth-index.json");
  const authIndex = createAuthIndexApi(authIndexPath);
  const indexEntry = authIndex.lookupByEmail(EMAIL);
  line("Auth-index entry", indexEntry ? "found" : "not found");
  if (indexEntry) {
    line("Auth-index folder", String(indexEntry.companyFolderId || "(blank)"));
    line("Auth-index workbook", String(indexEntry.masterSheetId || "(blank)"));
  }

  const registryRecord = await getCanonicalCompanyRegistryRecord(auth, deps, companyFolderId).catch((error) => {
    line("Registry lookup error", error instanceof Error ? error.message : String(error));
    return null;
  });
  if (!registryRecord) {
    line("Registry record", "not found");
    line("Registry LIVE", "no");
    reasons.push("company_not_in_registry");
  } else {
    const registryStatus = String(registryRecord.status || registryRecord.registryStatus || "").trim();
    const live = isCompanyRegistryLive(registryRecord);
    line("Registry record", "found");
    line("Registry source", String(registryRecord.registrySource || "unknown"));
    line("Registry status", registryStatus || "(blank)");
    line("Registry LIVE", live ? "yes" : "no");
    line("Registry masterSheetId", String(registryRecord.masterSheetId || "(blank)"));
    line("Registry rootFolderId", String(registryRecord.rootFolderId || registryRecord.companyFolderId || "(blank)"));
    if (!live) {
      reasons.push(`registry_not_live (${registryStatus || "blank"})`);
    }
    if (
      registryRecord.masterSheetId &&
      String(registryRecord.masterSheetId).trim() !== masterSheetId
    ) {
      reasons.push(
        `registry_workbook_mismatch (registry=${registryRecord.masterSheetId}, expected=${masterSheetId})`,
      );
    }
  }

  const registryMap = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({ map: new Map() }));
  const liveCompanies = [...(registryMap.map || [])].filter(([, record]) => isCompanyRegistryLive(record));
  line("LIVE companies visible to login fallback", String(liveCompanies.length));

  console.log("\n--- Cold login implication ---");
  const coldDiscoverable =
    Boolean(indexEntry?.masterSheetId || indexEntry?.companyFolderId) ||
    (registryRecord && isCompanyRegistryLive(registryRecord));
  line("Cold login can discover this workbook", coldDiscoverable ? "yes" : "no");
  if (!coldDiscoverable) {
    reasons.push("no_login_discovery_path (needs LIVE registry, auth-index, invite hint, or companyFolderId)");
  }

  if (reasons.length) {
    line("Reason if failed", reasons.join("; "));
  } else {
    line("Reason if failed", "(none — workbook password path looks good and discovery path exists)");
  }

  console.log("\nVerdict:");
  if (passwordOk && String(status || "").toUpperCase() === "ACTIVE" && !coldDiscoverable) {
    console.log(
      "Workbook credentials are valid. Live app rejects login because Dovecote is not discoverable on cold login (missing LIVE registry / auth-index / invite hint).",
    );
    console.log("Register the company, then rebuild auth-index or log in with companyFolderId.");
    console.log("Use: npm run register:demo-company");
    process.exitCode = 3;
  } else if (!passwordOk || String(status || "").toUpperCase() !== "ACTIVE") {
    console.log("Seeded Users row itself fails auth checks. Investigate hash/status before registry.");
    process.exitCode = 2;
  } else {
    console.log("User + password + discovery look OK locally. If live app still fails, the deployed API host likely lacks this registry/auth-index state.");
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error("Verifier failed:", error?.stack || error);
  process.exit(1);
});
