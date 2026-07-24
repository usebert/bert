#!/usr/bin/env node
/**
 * Regenerate PasswordHash for a single ACTIVE demo user in the Dovecote workbook.
 * Does not touch other Users-tab rows. Optionally refreshes that user's auth-index entry.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   npm run reset:demo-user-password -- --username mr.important
 *
 * Or:
 *   npm run reset:demo-user-password -- --email bert.demo+mr.important@usebert.co.uk
 *
 * Optional:
 *   --password "BertDemo123!"   (default: DEMO_COMPANY_SHARED_PASSWORD)
 *   --skip-auth-index           (only rewrite Users tab PasswordHash)
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
  assertDemoCompanyAllowed,
  demoEmail,
} from "../shared/demo-company-seed.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import {
  findCompanyUsersTabRow,
  setCompanyUserPasswordHash,
  defaultAccessLevelForRole,
} from "../server/company-users.mjs";
import { verifyPassword } from "../server/master-auth.mjs";
import {
  getTabValues,
  rowsToRecords,
  getConfig,
  updateConfig,
} from "../server/workbook-service.mjs";
import {
  isPasswordHash,
  normalizeUserStatus,
  parseRoleFromUsersSheet,
  rowMatchesLoginIdentity,
} from "../server/users-tab-schema.mjs";
import { resolveUsernameFromUserFields } from "../shared/login-username.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return "";
  }
  return String(process.argv[index + 1] || "").trim();
}

const companyFolderId = String(process.env[DEMO_COMPANY_FOLDER_ENV] || "").trim();
const masterSheetId = String(process.env[DEMO_COMPANY_WORKBOOK_ENV] || "").trim();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const skipAuthIndex = process.argv.includes("--skip-auth-index");
const usernameArg = readArg("--username");
const emailArg = readArg("--email").toLowerCase();
const newPassword = readArg("--password") || DEMO_COMPANY_SHARED_PASSWORD;

function pickField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
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
    getConfig,
    updateConfig,
    getTabValues: async (authClient, spreadsheetId, tabTitle) =>
      getTabValues(authClient, deps, spreadsheetId, tabTitle),
  };
  deps.getWorkbook = async (authClient, spreadsheetId) => {
    const sheets = google.sheets({ version: "v4", auth: authClient });
    const response = await sheets.spreadsheets.get({ spreadsheetId });
    return response.data;
  };
  return deps;
}

async function resolveTargetUser(auth, deps) {
  if (emailArg) {
    return { identity: emailArg, email: emailArg };
  }
  if (usernameArg) {
    const row = await findCompanyUsersTabRow(auth, masterSheetId, usernameArg, {
      ...deps,
      companyFolderId,
      preferredCompanyFolderId: companyFolderId,
    });
    if (!row?.email) {
      throw new Error(`No Users-tab row matches username "${usernameArg}".`);
    }
    return { identity: usernameArg, email: String(row.email).trim().toLowerCase() };
  }
  throw new Error("Provide --username or --email for the demo user to reset.");
}

async function main() {
  if (confirm !== "yes") {
    throw new Error(`Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run this script.`);
  }
  const allowed = assertDemoCompanyAllowed(DEMO_COMPANY_NAME);
  if (!allowed.ok) {
    throw new Error(allowed.error || "Demo company guard failed.");
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error(`Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_WORKBOOK_ENV}.`);
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const auth = loadGoogleAuth();
  const deps = buildDeps();
  const { identity, email } = await resolveTargetUser(auth, deps);
  const beforeRow = await findCompanyUsersTabRow(auth, masterSheetId, email, {
    ...deps,
    companyFolderId,
    preferredCompanyFolderId: companyFolderId,
  });
  if (!beforeRow) {
    throw new Error(`User not found in Users tab: ${email}`);
  }
  const status = normalizeUserStatus(beforeRow.status);
  const folderId = pickField(beforeRow.rowObject || beforeRow, "CompanyFolderId", "companyFolderId");
  const username = resolveUsernameFromUserFields({
    username: pickField(beforeRow.rowObject || beforeRow, "Username", "username"),
    email,
  });

  console.log("reset-demo-user-password: target", {
    identity,
    email,
    username,
    status,
    companyFolderId: folderId || "(missing)",
    passwordHashPresent: Boolean(beforeRow.passwordHash),
    passwordHashValid: isPasswordHash(beforeRow.passwordHash),
  });

  if (folderId && folderId !== companyFolderId) {
    throw new Error(
      `Refusing to reset user outside demo folder (row folder=${folderId}, expected=${companyFolderId}).`,
    );
  }

  const resetResult = await setCompanyUserPasswordHash(auth, masterSheetId, email, newPassword, deps);
  if (!resetResult.ok) {
    throw new Error(`Password reset failed: ${resetResult.reason || "unknown"}`);
  }

  const afterRow = await findCompanyUsersTabRow(auth, masterSheetId, email, {
    ...deps,
    companyFolderId,
    preferredCompanyFolderId: companyFolderId,
  });
  const verified = verifyPassword(newPassword, afterRow?.passwordHash || "");
  if (!verified) {
    throw new Error("Password hash was written but verification failed — check Users tab manually.");
  }

  let authIndexUpdated = false;
  if (!skipAuthIndex) {
    const authIndex = createAuthIndexApi(path.join(sessionsRoot, "auth-index.json"));
    const roleRaw = pickField(afterRow.rowObject || afterRow, "Role", "role");
    const role = parseRoleFromUsersSheet(roleRaw) || roleRaw || "User";
    authIndex.upsertEntry({
      email,
      username,
      name: pickField(afterRow.rowObject || afterRow, "Name", "name") || email,
      role,
      accessLevel:
        pickField(afterRow.rowObject || afterRow, "AccessLevel", "accessLevel") ||
        defaultAccessLevelForRole(role),
      companyId: companyFolderId,
      companyFolderId,
      companyName: DEMO_COMPANY_NAME,
      masterSheetId,
      status: "ACTIVE",
      passwordHash: afterRow.passwordHash,
      companyAreas: String(pickField(afterRow.rowObject || afterRow, "CompanyAreas", "companyAreas") || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      indexedAt: Date.now(),
    });
    authIndexUpdated = true;
  }

  // Safety: ensure we only touched the intended row (scan for unexpected password changes).
  const values = await getTabValues(auth, deps, masterSheetId, "Users");
  const records = rowsToRecords(values);
  const touched = records.filter((row) => rowMatchesLoginIdentity(row, email));
  if (touched.length !== 1) {
    console.warn("reset-demo-user-password: unexpected duplicate rows for email — review Users tab.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        username,
        status,
        passwordVerified: verified,
        migratedLegacyUserAuth: resetResult.migratedUserAuth === true,
        authIndexUpdated,
        expectedDemoEmail: demoEmail(username.replace(/^bert\.demo\+/, "").split("@")[0]),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
