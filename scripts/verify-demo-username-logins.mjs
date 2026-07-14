#!/usr/bin/env node
/**
 * Verify email and username login for Dovecote demo company (UI auth path).
 *
 * Tests Admin / Manager / Auditor via email and username, plus case/whitespace,
 * wrong password, and inactive/archived username rejection.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   npm run verify:demo-username-logins
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
  demoUsername,
} from "../shared/demo-company-seed.mjs";
import { deriveUsernameFromEmail } from "../shared/login-username.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import { getTabValues, ensureTabColumns, rowsToRecords } from "../server/workbook-service.mjs";
import {
  readCanonicalCompanyWorkspaceRegistryMap,
  getCanonicalCompanyRegistryRecord,
} from "../server/company-workspace-registry.mjs";
import {
  readCompanyUsersTabRecord,
  findCompanyUsersTabRow,
  writeUsersTabRecordByHeaders,
  defaultAccessLevelForRole,
} from "../server/company-users.mjs";
import { authenticateCompanyUserLogin } from "../server/user-auth-service.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { resolveCompanyFromFolder } from "../server/company-folder-resolver.mjs";
import { isPasswordHash, parseRoleFromUsersSheet, normalizeUserStatus } from "../server/users-tab-schema.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();
const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const password = String(process.env.DEMO_LOGIN_PASSWORD || DEMO_COMPANY_SHARED_PASSWORD);

const ROLE_CASES = [
  { label: "Admin", email: demoEmail("mr.important"), username: demoUsername("mr.important"), expectedRole: "Admin" },
  { label: "Manager", email: demoEmail("terry.terinson"), username: demoUsername("terry.terinson"), expectedRole: "Manager" },
  { label: "Auditor", email: demoEmail("joe.jones"), username: demoUsername("joe.jones"), expectedRole: "Auditor" },
];

const EXPECTED_ACTIVE_USERNAMES = [
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

function pickField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
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

  const noopMigrate = async () => ({ ok: true, addedColumns: [], backfilled: 0 });
  const userDeps = {
    ...deps,
    getConfig: async () => ({}),
    updateConfig: async () => ({}),
    readCompanyUsersTabRecord,
    findCompanyUsersTabRow,
    migrateUsersTabColumns: noopMigrate,
    writeUsersTabRecordByHeaders,
  };

  return {
    ...deps,
    authIndex,
    getCompanyUsersDeps: () => userDeps,
    findMasterSheetIdsForCompanyLoginEmail: () => [],
    readCanonicalCompanyWorkspaceRegistryMap,
    isCompanyRegistryLive,
    migrateUsersTabColumns: noopMigrate,
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

async function rebuildAuthIndexWithUsernames(auth, loginDeps, authIndex) {
  const values = await loginDeps.getTabValues(auth, masterSheetId, "Users");
  const records = rowsToRecords(values);
  let upserted = 0;
  const usernames = new Set();
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
        .replace(/\s+/g, "") || deriveUsernameFromEmail(email);
    authIndex.upsertEntry({
      email,
      username,
      name: pickField(row, "Name", "Full Name", "name") || email,
      role,
      accessLevel: pickField(row, "AccessLevel", "accessLevel") || defaultAccessLevelForRole(role),
      companyId: companyFolderId,
      companyFolderId,
      companyName: DEMO_COMPANY_NAME,
      masterSheetId,
      status: "ACTIVE",
      passwordHash,
      companyAreas: String(pickField(row, "CompanyAreas", "companyAreas") || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      indexedAt: Date.now(),
    });
    if (username) {
      usernames.add(username);
    }
    upserted += 1;
  }
  return { upserted, usernames: [...usernames].sort() };
}

async function runLogin(auth, loginDeps, identity, hints = {}, overridePassword = password) {
  const started = Date.now();
  const payload = identity.includes("@")
    ? { email: identity, password: overridePassword }
    : { email: identity, username: identity, password: overridePassword };
  const result = await authenticateCompanyUserLogin(auth, loginDeps, {
    ...payload,
    companyFolderId: hints.companyFolderId || "",
    masterSheetId: hints.masterSheetId || "",
  });
  return {
    ok: result.ok === true,
    role: String(result.entry?.role || result.row?.role || "").trim(),
    email: String(result.entry?.email || result.row?.email || "").trim().toLowerCase(),
    ms: Date.now() - started,
    blocker: result.blocker || result.reason || "",
    authFailureReason: result.authFailureReason || "",
    code: result.code || "",
    message: result.message || result.error || "",
  };
}

async function main() {
  console.log("=== Demo username logins verifier (UI auth path) ===\n");
  if (confirm !== "yes") {
    throw new Error(`Refusing to run without ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes`);
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error(`Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV}.`);
  }

  console.log(`Company: ${DEMO_COMPANY_NAME}`);
  console.log(`Folder: ${companyFolderId}`);
  console.log(`Workbook: ${masterSheetId}`);
  console.log("");

  const auth = loadGoogleAuth();
  const authIndexPath = path.join(sessionsRoot, "auth-index-demo-username-logins.json");
  if (fs.existsSync(authIndexPath)) {
    fs.unlinkSync(authIndexPath);
  }
  const authIndex = createAuthIndexApi(authIndexPath);
  const loginDeps = buildDeps(authIndex);

  const rebuilt = await rebuildAuthIndexWithUsernames(auth, loginDeps, authIndex);
  console.log(`Auth-index ACTIVE upserts: ${rebuilt.upserted}`);
  console.log(`Auth-index usernames: ${rebuilt.usernames.length}`);

  let failures = 0;
  const rows = [];

  for (const expected of EXPECTED_ACTIVE_USERNAMES) {
    if (!rebuilt.usernames.includes(expected)) {
      failures += 1;
      console.log(`FAIL missing active username alias: ${expected}`);
    }
  }
  if (rebuilt.usernames.includes("archived.example")) {
    failures += 1;
    console.log("FAIL archived username should not be in ACTIVE auth-index");
  }

  for (const testCase of ROLE_CASES) {
    const emailCold = await runLogin(auth, loginDeps, testCase.email, {});
    const emailSheet = await runLogin(auth, loginDeps, testCase.email, { masterSheetId });
    const userCold = await runLogin(auth, loginDeps, testCase.username, {});
    const userSheet = await runLogin(auth, loginDeps, testCase.username, { masterSheetId });

    const checks = [
      ["email-cold", emailCold],
      ["email-sheet", emailSheet],
      ["username-cold", userCold],
      ["username-sheet", userSheet],
    ];
    for (const [label, result] of checks) {
      const pass =
        result.ok &&
        result.role === testCase.expectedRole &&
        result.email === testCase.email.toLowerCase();
      if (!pass) {
        failures += 1;
        console.log(`FAIL ${testCase.label} ${label}:`, result);
      }
      rows.push({
        case: `${testCase.label} ${label}`,
        identity: label.startsWith("email") ? testCase.email : testCase.username,
        result: pass ? `PASS (${result.role}, ${result.ms}ms)` : `FAIL (${result.authFailureReason || result.blocker || result.code})`,
      });
    }
  }

  const upper = await runLogin(auth, loginDeps, "JOE.JONES", {});
  const spaced = await runLogin(auth, loginDeps, " joe.jones ", {});
  for (const [label, result] of [
    ["uppercase JOE.JONES", upper],
    ["spaced joe.jones", spaced],
  ]) {
    const pass = result.ok && result.role === "Auditor" && result.email === demoEmail("joe.jones");
    if (!pass) {
      failures += 1;
      console.log(`FAIL ${label}:`, result);
    }
    rows.push({
      case: label,
      identity: label,
      result: pass ? `PASS (${result.role}, ${result.ms}ms)` : `FAIL (${result.authFailureReason || result.blocker || result.code})`,
    });
  }

  const wrongPassword = await runLogin(auth, loginDeps, "joe.jones", {}, "DefinitelyWrongPassword!");
  if (wrongPassword.ok) {
    failures += 1;
    console.log("FAIL wrong password should not authenticate:", wrongPassword);
  } else {
    rows.push({ case: "wrong password", identity: "joe.jones", result: "PASS (rejected)" });
  }

  const archived = await runLogin(auth, loginDeps, "archived.example", { masterSheetId });
  if (archived.ok) {
    failures += 1;
    console.log("FAIL inactive archived username should not login:", archived);
  } else {
    rows.push({
      case: "inactive archived.example",
      identity: "archived.example",
      result: `PASS (rejected: ${archived.authFailureReason || archived.blocker || archived.code || "denied"})`,
    });
  }

  printTable(rows, [
    { key: "case", header: "Case" },
    { key: "identity", header: "Identity" },
    { key: "result", header: "Result" },
  ]);

  console.log(`\nVerdict: ${failures === 0 ? "ALL USERNAME LOGINS PASS" : "FAILURES DETECTED"}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Verifier failed:", error?.stack || error);
  process.exit(1);
});
