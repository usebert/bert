#!/usr/bin/env node
/**
 * Verify EVERY ACTIVE demo user in the Dovecote Manufacturing Ltd workbook.
 *
 * Read-only: Users tab + platform registry. Uses the same scrypt verifier as live login.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   npm run verify:demo-accounts
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

const PASSWORD = String(process.env.DEMO_LOGIN_PASSWORD || DEMO_COMPANY_SHARED_PASSWORD);
const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();

/** Expected ACTIVE demo accounts (local-part slugs). */
const EXPECTED_ACTIVE_SLUGS = [
  "mr.important",
  "bertina.bertison",
  "bert.bertison",
  "derek.trotter",
  "ben.richards",
  "sarah.trent",
  "dominic.davies",
  "sally.cinamon",
  "deberah.disco",
  "mark.bark",
  "eric.erikson",
  "tracey.racey",
  "mary.holland",
  "terry.terinson",
  "jane.pain",
  "tony.balony",
  "joe.jones",
  "chris.dim",
  "simon.simple",
  "fred.red",
  "stu.bert",
  "dave.doubt",
  "lisa.little",
];

const EXPECTED_ACTIVE_EMAILS = EXPECTED_ACTIVE_SLUGS.map((slug) => demoEmail(slug).toLowerCase());

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

function emailOf(row) {
  return pickField(row, "Email", "email", "User Email", "Login Email").toLowerCase();
}

function pad(value, width) {
  const text = String(value ?? "");
  if (text.length >= width) {
    return text.slice(0, width);
  }
  return text + " ".repeat(width - text.length);
}

function printTable(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => String(row[col.key] ?? "").length), 4),
  );
  const header = columns.map((col, index) => pad(col.header, widths[index])).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-+-");
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(columns.map((col, index) => pad(row[col.key] ?? "", widths[index])).join(" | "));
  }
}

async function main() {
  console.log("=== Demo accounts verifier (read-only) ===\n");

  if (confirm !== "yes") {
    throw new Error(`Refusing to run without ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes`);
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error(`Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV}.`);
  }

  line("Company", DEMO_COMPANY_NAME);
  line("Company folder ID", companyFolderId);
  line("Workbook ID", masterSheetId);
  line("Shared password", PASSWORD ? "BertDemo123! (provided)" : "(missing)");
  line("Expected ACTIVE accounts", String(EXPECTED_ACTIVE_EMAILS.length));
  console.log("");

  const auth = loadGoogleAuth();
  const deps = buildDeps();

  const values = await getTabValues(auth, deps, masterSheetId, "Users");
  const records = rowsToRecords(values);
  line("Users tab rows total", String(records.length));

  const byEmail = new Map();
  for (const row of records) {
    const email = emailOf(row);
    if (!email) {
      continue;
    }
    if (!byEmail.has(email)) {
      byEmail.set(email, []);
    }
    byEmail.get(email).push(row);
  }

  const authIndexPath = path.join(sessionsRoot, "auth-index.json");
  const authIndex = createAuthIndexApi(authIndexPath);
  const indexEntry = authIndex.lookupByEmail(EXPECTED_ACTIVE_EMAILS[0]);

  const registryRecord = await getCanonicalCompanyRegistryRecord(auth, deps, companyFolderId).catch((error) => {
    line("Registry lookup error", error instanceof Error ? error.message : String(error));
    return null;
  });
  const registryMap = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({ map: new Map() }));
  const liveCompanies = [...(registryMap.map || [])].filter(([, record]) => isCompanyRegistryLive(record));

  const registrySource = String(registryRecord?.registrySource || "").trim();
  const registryLive = Boolean(registryRecord && isCompanyRegistryLive(registryRecord));
  const coldDiscoverable =
    Boolean(indexEntry?.masterSheetId || indexEntry?.companyFolderId) ||
    (registryLive && String(registryRecord?.masterSheetId || "").trim() === masterSheetId);

  console.log("\n--- Discovery / registry ---");
  line("Registry record", registryRecord ? "found" : "not found");
  line("Registry source", registrySource || "(blank)");
  line("Registry LIVE", registryLive ? "yes" : "no");
  line("Registry companyName", String(registryRecord?.companyName || "(blank)"));
  line("Registry masterSheetId", String(registryRecord?.masterSheetId || "(blank)"));
  line("LIVE companies visible", String(liveCompanies.length));
  line("Cold login can discover workbook", coldDiscoverable ? "yes" : "no");

  const discoveryFailures = [];
  if (registrySource !== "main") {
    discoveryFailures.push(`registry_source=${registrySource || "blank"} (expected main)`);
  }
  if (!registryLive) {
    discoveryFailures.push("registry_not_live");
  }
  if (!coldDiscoverable) {
    discoveryFailures.push("cold_discovery_failed");
  }

  const activeRows = [];
  const skippedRows = [];

  for (const [email, rows] of byEmail.entries()) {
    const row = rows[0];
    const status = pickField(row, "Status", "status");
    const statusUpper = status.toUpperCase();
    const name = pickField(row, "Name", "Full Name", "name") || "(blank)";
    const role = pickField(row, "Role", "role");
    const rowFolderId = pickField(row, "CompanyFolderId", "CompanyId", "Company Folder ID", "Company ID");
    const passwordHash = pickField(row, "PasswordHash", "passwordHash");
    const hashOk = isPasswordHash(passwordHash);
    const passwordOk = hashOk ? verifyPassword(PASSWORD, passwordHash) : false;
    const folderOk = rowFolderId === companyFolderId;
    const roleOk = Boolean(role);
    const isActive = statusUpper === "ACTIVE";

    const entry = {
      email,
      name,
      role: role || "(blank)",
      status: status || "(blank)",
      duplicates: rows.length,
      hashPresent: passwordHash ? "yes" : "no",
      hashShape: hashOk ? "scrypt" : passwordHash ? "invalid" : "missing",
      password: passwordOk ? "PASS" : "FAIL",
      folder: folderOk ? "PASS" : `FAIL (${rowFolderId || "blank"})`,
      roleOk: roleOk ? "PASS" : "FAIL",
      result: "?",
      failures: [],
    };

    if (!isActive) {
      entry.result = "SKIP";
      skippedRows.push(entry);
      continue;
    }

    if (!email) {
      entry.failures.push("missing_email");
    }
    if (!roleOk) {
      entry.failures.push("missing_role");
    }
    if (!passwordHash) {
      entry.failures.push("missing_password_hash");
    } else if (!hashOk) {
      entry.failures.push("invalid_password_hash_shape");
    } else if (!passwordOk) {
      entry.failures.push("password_compare_failed");
    }
    if (!folderOk) {
      entry.failures.push("company_folder_mismatch");
    }
    if (rows.length > 1) {
      entry.failures.push(`duplicate_rows=${rows.length}`);
    }

    entry.result = entry.failures.length ? "FAIL" : "PASS";
    activeRows.push(entry);
  }

  // Expected ACTIVE emails must exist and pass.
  const foundActive = new Set(activeRows.map((row) => row.email));
  for (const expected of EXPECTED_ACTIVE_EMAILS) {
    if (!foundActive.has(expected) && !byEmail.has(expected)) {
      activeRows.push({
        email: expected,
        name: "(missing)",
        role: "(missing)",
        status: "(missing)",
        duplicates: 0,
        hashPresent: "no",
        hashShape: "missing",
        password: "FAIL",
        folder: "FAIL",
        roleOk: "FAIL",
        result: "FAIL",
        failures: ["expected_user_missing_from_users_tab"],
      });
    } else if (!foundActive.has(expected) && byEmail.has(expected)) {
      const status = pickField(byEmail.get(expected)[0], "Status", "status");
      activeRows.push({
        email: expected,
        name: pickField(byEmail.get(expected)[0], "Name", "Full Name", "name") || "(blank)",
        role: pickField(byEmail.get(expected)[0], "Role", "role") || "(blank)",
        status: status || "(blank)",
        duplicates: byEmail.get(expected).length,
        hashPresent: "n/a",
        hashShape: "n/a",
        password: "FAIL",
        folder: "FAIL",
        roleOk: "FAIL",
        result: "FAIL",
        failures: [`expected_active_but_status=${status || "blank"}`],
      });
    }
  }

  activeRows.sort((a, b) => a.email.localeCompare(b.email));
  skippedRows.sort((a, b) => a.email.localeCompare(b.email));

  console.log("\n--- ACTIVE demo accounts ---");
  printTable(activeRows, [
    { key: "result", header: "Result" },
    { key: "email", header: "Email" },
    { key: "name", header: "Name" },
    { key: "role", header: "Role" },
    { key: "status", header: "Status" },
    { key: "password", header: "Password" },
    { key: "folder", header: "CompanyFolderId" },
    { key: "hashShape", header: "Hash" },
    { key: "roleOk", header: "RoleOk" },
  ]);

  if (skippedRows.length) {
    console.log("\n--- Skipped (inactive / archived) ---");
    printTable(skippedRows, [
      { key: "result", header: "Result" },
      { key: "email", header: "Email" },
      { key: "name", header: "Name" },
      { key: "role", header: "Role" },
      { key: "status", header: "Status" },
    ]);
  }

  const failedUsers = activeRows.filter((row) => row.result === "FAIL");
  console.log("\n--- Summary ---");
  line("ACTIVE checked", String(activeRows.length));
  line("ACTIVE passed", String(activeRows.length - failedUsers.length));
  line("ACTIVE failed", String(failedUsers.length));
  line("Skipped inactive", String(skippedRows.length));
  line("Discovery failures", discoveryFailures.length ? discoveryFailures.join("; ") : "(none)");

  if (failedUsers.length) {
    console.log("\nFailed accounts:");
    for (const row of failedUsers) {
      console.log(`  - ${row.email}: ${row.failures.join("; ") || "unknown"}`);
    }
  }

  const ok = failedUsers.length === 0 && discoveryFailures.length === 0;
  console.log(`\nVerdict: ${ok ? "ALL ACTIVE DEMO ACCOUNTS PASS" : "FAILURES DETECTED"}`);
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Verifier failed:", error?.stack || error);
  process.exit(1);
});
