#!/usr/bin/env node
/**
 * Read-only diagnostic for the Dovecote Studio company workbook Users tab.
 * Prints safe identity columns only — never PasswordHash, passwords, or tokens.
 *
 * Usage (from repo root, after Google OAuth is connected on this machine):
 *   node scripts/diagnose-dovecote-users-tab.mjs
 *   node scripts/diagnose-dovecote-users-tab.mjs --fixture   # offline fixture fallback
 *
 * Production API (temporary): GET /api/diagnostics/dovecote-users-tab
 *   Requires ENABLE_USERS_TAB_DIAGNOSTICS=true, BERT_DIAGNOSTICS_SECRET, and Google OAuth on API host.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { google } from "googleapis";
import { getTabValues as workbookGetTabValues } from "../server/workbook-service.mjs";
import { resolveUsersTab, readCompanyUsers } from "../server/users-tab-reader.mjs";
import {
  buildUsersTabDiagnosticReportFromRows,
  DOVECOTE_USERS_TAB_TARGET_EMAILS,
  pickSafeUsersTabRowFields,
  readLiveUsersTabDiagnosticReport,
  recommendUsersTabLoginField,
} from "../server/dovecote-users-tab-diagnostics.mjs";
import {
  DOVECOTE_FOLDER_ID,
  DOVECOTE_MASTER_SHEET_ID,
  DOVECOTE_USERS_TAB_HEADERS,
  DOVECOTE_USERS_TAB_ROWS,
} from "./fixtures/dovecote-users-tab.fixture.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
dotenv.config();

const COMPANY_FOLDER_ID = String(process.env.BERT_DOVECOTE_FOLDER_ID || DOVECOTE_FOLDER_ID).trim();
const MASTER_SHEET_ID = String(process.env.BERT_DOVECOTE_MASTER_SHEET_ID || DOVECOTE_MASTER_SHEET_ID).trim();
const TARGET_EMAILS = DOVECOTE_USERS_TAB_TARGET_EMAILS;
const SOPHIE_EMAIL = "7oakcottages@gmail.com";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSheetsQuotaOrRateLimitError(err) {
  const status = Number(err?.response?.status || err?.status || 0);
  const message = String(err?.message || "").toLowerCase();
  return status === 429 || message.includes("quota") || message.includes("rate limit");
}

async function withSheetsQuotaRetry(fn, { maxRetries = 8 } = {}) {
  const cap = Math.max(1, Number(process.env.SHEETS_QUOTA_MAX_RETRIES || maxRetries) || maxRetries);
  for (let attempt = 0; attempt <= cap; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isSheetsQuotaOrRateLimitError(err) || attempt === cap) {
        throw err;
      }
      const delayMs = Math.min(45_000, 1000 * 2 ** attempt);
      await sleep(delayMs);
    }
  }
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
    return { auth: null, sessionPath: null };
  }
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth.setCredentials(session.tokens || session);
  return { auth: oauth, sessionPath };
}

function buildDeps(auth) {
  const deps = {
    google,
    withSheetsQuotaRetry,
    safeLower: (value = "") => String(value || "").trim().toLowerCase(),
    getTabValues: async (a, spreadsheetId, tabName, range = "A1:ZZ5000") =>
      workbookGetTabValues(a, deps, spreadsheetId, tabName, range),
    resolveUsersTab: (a, spreadsheetId, innerDeps, options) =>
      resolveUsersTab(a, spreadsheetId, innerDeps, options),
    readCompanyUsers: (a, spreadsheetId, innerDeps, options) =>
      readCompanyUsers(a, spreadsheetId, innerDeps, options),
  };
  return deps;
}

function buildFixtureRows() {
  return [DOVECOTE_USERS_TAB_HEADERS, ...DOVECOTE_USERS_TAB_ROWS];
}

async function main() {
  const forceFixture = process.argv.includes("--fixture");
  const { auth, sessionPath } = forceFixture ? { auth: null, sessionPath: null } : loadGoogleAuth();

  console.log("=== Dovecote Users tab diagnostic (read-only) ===");
  console.log(JSON.stringify({ companyFolderId: COMPANY_FOLDER_ID, masterSheetId: MASTER_SHEET_ID }, null, 2));

  let report;
  let dataSource;

  if (auth && !forceFixture) {
    const deps = buildDeps(auth);
    try {
      report = await readLiveUsersTabDiagnosticReport(auth, MASTER_SHEET_ID, deps);
      dataSource = report.dataSource;
      console.log(`\nData source: live Google Sheets (token: ${sessionPath})`);
    } catch (error) {
      console.error("\nLive read failed:", error instanceof Error ? error.message : String(error));
      console.log("Falling back to committed fixture data.\n");
      const rows = buildFixtureRows();
      report = buildUsersTabDiagnosticReportFromRows({
        masterSheetId: MASTER_SHEET_ID,
        resolved: { tabTitle: "Users", matchKind: "fixture" },
        rows,
        dataSource: "fixture-fallback",
        targetEmails: TARGET_EMAILS,
      });
      dataSource = report.dataSource;
    }
  } else {
    if (!forceFixture) {
      console.log(
        "\nNo Google OAuth token found — connect Google first (npm run google:connect) or pass --fixture.\n",
      );
    }
    const rows = buildFixtureRows();
    report = buildUsersTabDiagnosticReportFromRows({
      masterSheetId: MASTER_SHEET_ID,
      resolved: { tabTitle: "Users", matchKind: "fixture" },
      rows,
      dataSource: "fixture-fallback",
      targetEmails: TARGET_EMAILS,
    });
    dataSource = report.dataSource;
    console.log(`Data source: ${dataSource}`);
  }

  console.log("\n--- Users tab metadata ---");
  console.log(
    JSON.stringify(
      {
        tabTitle: report.tabTitle,
        matchKind: report.matchKind,
        headerCount: report.headerCount,
        rowCount: report.rowCount,
        dataSource,
      },
      null,
      2,
    ),
  );

  console.log("\n--- Headers ---");
  console.log(report.headers.join(" | "));

  console.log("\n--- Rows (safe fields only) ---");
  for (const row of report.rows) {
    console.log(`Row ${row.row}:`, JSON.stringify(row.fields, null, 2));
  }

  console.log("\n--- Target email scan (all non-secret columns) ---");
  for (const scan of report.targetEmailScan) {
    console.log(
      `${scan.email}: ${scan.found ? "FOUND" : "NOT FOUND"}${
        scan.found ? ` in ${scan.hits.map((h) => `row ${h.row} column "${h.column}"`).join(", ")}` : ""
      }`,
    );
  }

  if (report.serverLoginDiagnostics?.length) {
    console.log("\n--- Server login diagnostics (collectUsersTabLoginDiagnostics) ---");
    for (const diag of report.serverLoginDiagnostics) {
      console.log(diag.email, JSON.stringify(diag, null, 2));
    }
  }

  const sophieRecommendation = report.loginRecommendations.find((item) => item.email === SOPHIE_EMAIL);
  console.log("\n--- Sophie row (safe fields) ---");
  const sophieRow = report.rows.find((row) => row.fields.Email === SOPHIE_EMAIL || row.fields.Name?.toLowerCase().includes("sophie"));
  if (sophieRow) {
    console.log(JSON.stringify(sophieRow.fields, null, 2));
    const login = recommendUsersTabLoginField(sophieRow.fields, report.headers);
    console.log("\n--- Login recommendation for Sophie ---");
    console.log(
      JSON.stringify(
        {
          useThisValueToLogIn: sophieRecommendation?.useThisValueToLogIn || login.loginValue || SOPHIE_EMAIL,
          resolvedFrom: login.loginField,
          rowEmailCandidates: login.rowEmailCandidates,
          note: sophieRecommendation?.note || login.note,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("Sophie row not found in Users tab data.");
    console.log(
      JSON.stringify(
        sophieRecommendation || {
          useThisValueToLogIn: SOPHIE_EMAIL,
          note: "Expected email not present in tab — login will return user_not_found until row exists with valid Email header",
        },
        null,
        2,
      ),
    );
  }

  console.log("\n=== Done ===");
}

main().catch((error) => {
  console.error("Diagnostic failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
