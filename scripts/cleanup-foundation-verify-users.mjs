#!/usr/bin/env node
/**
 * Remove foundation verifier pollution from a company Users tab.
 *
 * Dry-run by default — pass --apply to set Status=DELETED on matching rows.
 *
 * Usage:
 *   node scripts/cleanup-foundation-verify-users.mjs --masterSheetId=<id>
 *   node scripts/cleanup-foundation-verify-users.mjs --masterSheetId=<id> --apply
 *
 * Env: masterSheetId, companyFolderId (optional filter), GOOGLE_* OAuth session.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { google } from "googleapis";
import {
  FOUNDATION_VERIFY_PROTECTED_EMAILS,
  isFoundationVerifyPollutionTarget,
} from "../shared/foundation-verify-users.mjs";
import { getTabValues, patchTabRowByHeader, rowsToRecords } from "../server/workbook-service.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const LOG_PREFIX = "[cleanup:foundation-verify-users]";

function log(line) {
  console.log(`${LOG_PREFIX} ${line}`);
}

function parseArgs(argv) {
  const options = {
    masterSheetId: String(process.env.masterSheetId || process.env.MASTER_SHEET_ID || "").trim(),
    companyFolderId: String(process.env.companyFolderId || process.env.COMPANY_FOLDER_ID || "").trim(),
    apply: false,
  };
  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg.startsWith("--masterSheetId=")) {
      options.masterSheetId = arg.slice("--masterSheetId=".length).trim();
    } else if (arg.startsWith("--companyFolderId=")) {
      options.companyFolderId = arg.slice("--companyFolderId=".length).trim();
    }
  }
  return options;
}

function loadGoogleAuth() {
  const sessionsDirRaw = String(process.env.BERT_SESSIONS_DIR || "").trim();
  const sessionsDir = sessionsDirRaw
    ? path.isAbsolute(sessionsDirRaw)
      ? path.normalize(sessionsDirRaw)
      : path.resolve(root, sessionsDirRaw)
    : path.join(root, ".sessions");
  const sessionCandidates = [
    path.join(sessionsDir, "google-oauth-token.json"),
    path.join(sessionsDir, "google-session.json"),
    path.join(root, ".sessions", "google-session.json"),
    path.join(root, ".data", "google-oauth.json"),
  ];
  const sessionPath = sessionCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sessionPath) {
    throw new Error(
      "Missing Google OAuth token — connect Google on this machine first (see npm run google:connect).",
    );
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

function rowEmail(record) {
  return String(record.Email || record.email || record.Login || record.Username || "").trim().toLowerCase();
}

function rowName(record) {
  return String(record.Name || record["Full Name"] || record.FullName || "").trim();
}

function rowCompanyFolderId(record) {
  return String(record.CompanyFolderId || record.CompanyId || record["Company ID"] || "").trim();
}

function rowStatus(record) {
  return String(record.Status || record.status || "").trim().toUpperCase();
}

function buildDeps(auth) {
  return {
    google,
    withSheetsQuotaRetry: (fn) => fn(),
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    getTabValues: (a, deps, sheetId, tab) => getTabValues(a, deps, sheetId, tab),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.masterSheetId) {
    console.error(
      "Usage: node scripts/cleanup-foundation-verify-users.mjs --masterSheetId=<id> [--companyFolderId=<id>] [--apply]",
    );
    process.exit(1);
  }

  const auth = loadGoogleAuth();
  const deps = buildDeps(auth);
  const values = await getTabValues(auth, deps, options.masterSheetId, "Users");
  if (!values.length) {
    log("Users tab empty or unreadable.");
    process.exit(0);
  }

  const records = rowsToRecords(values);
  const targets = [];
  for (const record of records) {
    const email = rowEmail(record);
    const name = rowName(record);
    if (!email || FOUNDATION_VERIFY_PROTECTED_EMAILS.has(email)) {
      continue;
    }
    if (!isFoundationVerifyPollutionTarget(email, name)) {
      continue;
    }
    if (options.companyFolderId) {
      const folderId = rowCompanyFolderId(record);
      if (folderId && folderId !== options.companyFolderId) {
        continue;
      }
    }
    targets.push({
      email,
      name,
      status: rowStatus(record),
      companyFolderId: rowCompanyFolderId(record),
    });
  }

  log(`masterSheetId=${options.masterSheetId}`);
  if (options.companyFolderId) {
    log(`companyFolderId filter=${options.companyFolderId}`);
  }
  log(`mode=${options.apply ? "apply" : "dry-run"}`);
  log(`matching rows=${targets.length}`);

  if (targets.length === 0) {
    process.exit(0);
  }

  for (const target of targets) {
    log(`  - ${target.email} | ${target.name || "(no name)"} | status=${target.status || "(blank)"}`);
  }

  if (!options.apply) {
    log("Dry-run complete — pass --apply to set Status=DELETED on matching rows.");
    process.exit(0);
  }

  let deactivated = 0;
  const now = new Date().toISOString();
  for (const target of targets) {
    if (target.status === "DELETED" || target.status === "INACTIVE") {
      log(`skip already inactive: ${target.email} (${target.status})`);
      continue;
    }
    await patchTabRowByHeader(auth, deps, options.masterSheetId, "Users", "Email", target.email, {
      Status: "DELETED",
      UpdatedAt: now,
      "Updated By": "BERT foundation-verify cleanup",
    });
    deactivated += 1;
    log(`deactivated: ${target.email}`);
  }

  log(`deactivated count=${deactivated}`);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} failed:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
