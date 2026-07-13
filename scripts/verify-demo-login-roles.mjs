#!/usr/bin/env node
/**
 * Exercise the same company login auth path as the UI for Admin / Manager / Auditor.
 *
 * Verifies cold login (no companyFolderId hint) and folder-hint login for:
 *   Admin:   bert.demo+mr.important@usebert.co.uk
 *   Manager: bert.demo+terry.terinson@usebert.co.uk
 *   Auditor: bert.demo+joe.jones@usebert.co.uk
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=... \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=... \
 *   npm run verify:demo-login-roles
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
  DEMO_COMPANY_SHARED_PASSWORD,
  DEMO_COMPANY_WORKBOOK_ENV,
  demoEmail,
} from "../shared/demo-company-seed.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import { getTabValues, ensureTabColumns } from "../server/workbook-service.mjs";
import {
  readCanonicalCompanyWorkspaceRegistryMap,
  getCanonicalCompanyRegistryRecord,
} from "../server/company-workspace-registry.mjs";
import {
  readCompanyUsersTabRecord,
  findCompanyUsersTabRow,
  migrateUsersTabColumns,
  writeUsersTabRecordByHeaders,
} from "../server/company-users.mjs";
import { authenticateCompanyUserLogin } from "../server/user-auth-service.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { resolveCompanyFromFolder } from "../server/company-folder-resolver.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();
const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const password = String(process.env.DEMO_LOGIN_PASSWORD || DEMO_COMPANY_SHARED_PASSWORD);

const CASES = [
  { label: "Admin", email: demoEmail("mr.important"), expectedRole: "Admin" },
  { label: "Manager", email: demoEmail("terry.terinson"), expectedRole: "Manager" },
  { label: "Auditor", email: demoEmail("joe.jones"), expectedRole: "Auditor" },
];

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

function buildDeps(authIndex) {
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
  deps.ensureColumns = (auth, spreadsheetId, tab, columns) =>
    ensureTabColumns(auth, deps, spreadsheetId, tab, columns);

  const userDeps = {
    ...deps,
    getConfig: async () => ({}),
    updateConfig: async () => ({}),
    readCompanyUsersTabRecord,
    findCompanyUsersTabRow,
    migrateUsersTabColumns,
    writeUsersTabRecordByHeaders,
  };

  return {
    ...deps,
    authIndex,
    getCompanyUsersDeps: () => userDeps,
    findMasterSheetIdsForCompanyLoginEmail: () => [],
    readCanonicalCompanyWorkspaceRegistryMap,
    isCompanyRegistryLive,
    migrateUsersTabColumns,
    readCompanyUsersTabRecord,
    resolveCompanyFromFolder,
    getCompanyResolverDeps: () => deps,
  };
}

function pad(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function printTable(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => String(row[col.key] ?? "").length), 4),
  );
  console.log(columns.map((col, index) => pad(col.header, widths[index])).join(" | "));
  console.log(widths.map((width) => "-".repeat(width)).join("-+-"));
  for (const row of rows) {
    console.log(columns.map((col, index) => pad(row[col.key] ?? "", widths[index])).join(" | "));
  }
}

async function runLogin(auth, loginDeps, email, hints = {}) {
  const started = Date.now();
  const result = await authenticateCompanyUserLogin(auth, loginDeps, {
    email,
    password,
    companyFolderId: hints.companyFolderId || "",
    masterSheetId: hints.masterSheetId || "",
  });
  return {
    ok: result.ok === true,
    role: String(result.entry?.role || result.row?.role || "").trim(),
    ms: Date.now() - started,
    blocker: result.blocker || result.reason || "",
    authFailureReason: result.authFailureReason || "",
    code: result.code || "",
    message: result.message || result.error || "",
    companyFolderId: result.companyContext?.companyFolderId || "",
    masterSheetId: result.companyContext?.masterSheetId || "",
  };
}

async function main() {
  console.log("=== Demo login roles verifier (UI auth path) ===\n");
  if (confirm !== "yes") {
    throw new Error(`Refusing to run without ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes`);
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error(`Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV}.`);
  }

  console.log(`Company: ${DEMO_COMPANY_NAME}`);
  console.log(`Folder: ${companyFolderId}`);
  console.log(`Workbook: ${masterSheetId}`);
  console.log(`Password: ${password ? "provided" : "missing"}`);
  console.log("");

  const auth = loadGoogleAuth();
  const authIndexPath = path.join(sessionsRoot, "auth-index-demo-login-roles.json");
  if (fs.existsSync(authIndexPath)) {
    fs.unlinkSync(authIndexPath);
  }
  const authIndex = createAuthIndexApi(authIndexPath);
  const loginDeps = buildDeps(authIndex);

  const registry = await getCanonicalCompanyRegistryRecord(auth, loginDeps, companyFolderId).catch(() => null);
  console.log(
    `Registry: source=${registry?.registrySource || "(none)"} live=${
      registry && isCompanyRegistryLive(registry) ? "yes" : "no"
    } sheet=${registry?.masterSheetId || "(blank)"}`,
  );
  console.log("");

  const rows = [];
  let failures = 0;

  for (const testCase of CASES) {
    const cold = await runLogin(auth, loginDeps, testCase.email, {});
    const folder = await runLogin(auth, loginDeps, testCase.email, { companyFolderId });

    const coldRoleOk = cold.ok && cold.role === testCase.expectedRole;
    const folderRoleOk = folder.ok && folder.role === testCase.expectedRole;
    const coldPass = cold.ok && coldRoleOk;
    const folderPass = folder.ok && folderRoleOk;
    if (!coldPass || !folderPass) {
      failures += 1;
    }

    rows.push({
      role: testCase.label,
      email: testCase.email,
      cold: coldPass ? `PASS (${cold.role}, ${cold.ms}ms)` : `FAIL (${cold.authFailureReason || cold.blocker || cold.code || "error"}, ${cold.ms}ms)`,
      folder: folderPass
        ? `PASS (${folder.role}, ${folder.ms}ms)`
        : `FAIL (${folder.authFailureReason || folder.blocker || folder.code || "error"}, ${folder.ms}ms)`,
    });

    if (!coldPass) {
      console.log(`Cold failure detail [${testCase.label}]:`, cold);
    }
    if (!folderPass) {
      console.log(`Folder-hint failure detail [${testCase.label}]:`, folder);
    }
  }

  printTable(rows, [
    { key: "role", header: "Role" },
    { key: "email", header: "Email" },
    { key: "cold", header: "Cold login (no hint)" },
    { key: "folder", header: "Folder-hint login" },
  ]);

  console.log(`\nVerdict: ${failures === 0 ? "ALL ROLE LOGINS PASS" : "FAILURES DETECTED"}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Verifier failed:", error?.stack || error);
  process.exit(1);
});
