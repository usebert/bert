#!/usr/bin/env node
/**
 * Regenerate PasswordHash for a single ACTIVE demo user in the company workbook.
 * Does not touch other Users-tab rows. Optionally refreshes that user's auth-index entry.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1i1c_Li1P4ZO2hsV0fOhYq2f071JW0UPb \
 *   BERT_DEMO_COMPANY_SPREADSHEET_ID=1_9kuJt1TiXIMA6wp_UYv77sfASJYK1jSIA2d0N_Smhg \
 *   npm run reset:demo-user-password -- --email demo.midlands.admin@usebert.co.uk
 *
 * Or:
 *   npm run reset:demo-user-password -- --username demo.midlands.admin
 *
 * Optional:
 *   --password "BertDemo123!"   (default: BERT_DEMO_DEFAULT_PASSWORD or BertDemo123!)
 *   --skip-auth-index           (only rewrite Users tab PasswordHash)
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import {
  findCompanyUsersTabRow,
  setCompanyUserPasswordHash,
  defaultAccessLevelForRole,
} from "../server/company-users.mjs";
import { verifyPassword } from "../server/master-auth.mjs";
import { rowsToRecords } from "../server/workbook-service.mjs";
import {
  isPasswordHash,
  normalizeUserStatus,
  parseRoleFromUsersSheet,
  rowMatchesLoginIdentity,
} from "../server/users-tab-schema.mjs";
import { resolveUsernameFromUserFields } from "../shared/login-username.mjs";
import {
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  assertDemoCompanyAllowed,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
  readDemoDefaultPassword,
  isDemoCompanyEmail,
} from "../shared/demo-environment.mjs";
import {
  buildCompanyProvisionScriptDeps,
  loadGoogleAuth,
} from "./lib/demo-environment-script-utils.mjs";

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

const companyFolderId = readDemoCompanyFolderId();
const masterSheetId = readDemoCompanySpreadsheetId();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const skipAuthIndex = process.argv.includes("--skip-auth-index");
const usernameArg = readArg("--username");
const emailArg = readArg("--email").toLowerCase();
const newPassword = readArg("--password") || readDemoDefaultPassword() || "BertDemo123!";

function pickField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return "";
}

function buildDeps() {
  return buildCompanyProvisionScriptDeps({
    sessionDir: sessionsRoot,
    sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID || "",
    platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
  });
}

async function resolveTargetUser(auth, deps) {
  if (emailArg) {
    if (!isDemoCompanyEmail(emailArg)) {
      throw new Error(`Refusing to reset non-demo email: ${emailArg}`);
    }
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
    const email = String(row.email).trim().toLowerCase();
    if (!isDemoCompanyEmail(email)) {
      throw new Error(`Refusing to reset non-demo email resolved from username: ${email}`);
    }
    return { identity: usernameArg, email };
  }
  throw new Error("Provide --username or --email for the demo user to reset.");
}

async function main() {
  if (confirm !== "yes") {
    throw new Error(`Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run this script.`);
  }
  const allowed = assertDemoCompanyAllowed({
    companyName: MIDLANDS_DEMO_COMPANY_NAME,
    companyFolderId,
    masterSheetId,
  });
  if (!allowed.ok) {
    throw new Error(allowed.error || "Demo company guard failed.");
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error("Set BERT_DEMO_COMPANY_FOLDER_ID and BERT_DEMO_COMPANY_SPREADSHEET_ID.");
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const auth = loadGoogleAuth(sessionsRoot);
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
  let authIndexVerified = false;
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
      companyName: MIDLANDS_DEMO_COMPANY_NAME,
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
    const indexed = authIndex.lookupByEmail(email);
    authIndexVerified =
      Boolean(indexed?.passwordHash) &&
      indexed.passwordHash === afterRow.passwordHash &&
      verifyPassword(newPassword, indexed.passwordHash);
    if (!authIndexVerified) {
      throw new Error("Auth index entry was written but password hash verification failed.");
    }
  }

  const values = await deps.getTabValues(auth, masterSheetId, "Users");
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
        usersTabPasswordHashUpdated: verified,
        authIndexUpdated,
        authIndexPasswordVerified: authIndexVerified,
        migratedLegacyUserAuth: resetResult.migratedUserAuth === true,
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
