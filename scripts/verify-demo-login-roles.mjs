#!/usr/bin/env node
/**
 * Live verifier for Midlands Precast demo login personas (UI auth path).
 *
 * Uses shared/demo-environment.mjs as the sole Midlands source of truth.
 * Never mixes legacy Dovecote personas with Midlands workspace IDs.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_DEFAULT_PASSWORD='your-password' \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1i1c_Li1P4ZO2hsV0fOhYq2f071JW0UPb \
 *   BERT_DEMO_COMPANY_SPREADSHEET_ID=1_9kuJt1TiXIMA6wp_UYv77sfASJYK1jSIA2d0N_Smhg \
 *   npm run verify:demo-login-roles
 *
 * BERT_DEMO_COMPANY_WORKBOOK_ID is accepted as an alias for BERT_DEMO_COMPANY_SPREADSHEET_ID.
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
  DEMO_COMPANY_WORKBOOK_ENV,
  MIDLANDS_DEMO_COMPANY_NAME,
  MIDLANDS_SWITCH_PERSONAS,
  assertDemoCompanyAllowed,
  isMidlandsDemoCompanyName,
  normalizeDemoEmail,
  readDemoCompanyFolderId,
  readDemoCompanySpreadsheetId,
  readDemoDefaultPassword,
} from "../shared/demo-environment.mjs";
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
import {
  authenticateCompanyUserLogin,
  resolveCompanyLoginIdentity,
  verifyPassword,
} from "../server/user-auth-service.mjs";
import { createAuthIndexApi } from "../server/auth-index.mjs";
import { resolveCompanyFromFolder } from "../server/company-folder-resolver.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();
const companyFolderId = readDemoCompanyFolderId();
const masterSheetId = readDemoCompanySpreadsheetId();
const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
const password = String(process.env.DEMO_LOGIN_PASSWORD || readDemoDefaultPassword() || "").trim();

/** Legacy Dovecote personas — must never authenticate against Midlands workspace IDs. */
const LEGACY_DOVECOTE_LOGIN_EMAILS = [
  "bert.demo+mr.important@usebert.co.uk",
  "bert.demo+terry.terinson@usebert.co.uk",
  "bert.demo+joe.jones@usebert.co.uk",
];

const MIDLANDS_PERSONAS = MIDLANDS_SWITCH_PERSONAS.filter((persona) => persona.usersTab !== false);

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
    getCanonicalCompanyRegistryRecord,
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

function formatPassFail(ok, detail = "") {
  return ok ? `PASS${detail ? ` (${detail})` : ""}` : `FAIL${detail ? ` (${detail})` : ""}`;
}

async function runLogin(auth, loginDeps, identity, hints = {}) {
  const started = Date.now();
  const input = {
    password,
    companyFolderId: hints.companyFolderId || "",
    masterSheetId: hints.masterSheetId || "",
  };
  if (identity.includes("@")) {
    input.email = identity;
  } else {
    input.username = identity;
  }
  const result = await authenticateCompanyUserLogin(auth, loginDeps, input);
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
    devLoginTrace: result.devLoginTrace || null,
  };
}

async function inspectPersona(auth, loginDeps, persona) {
  const email = normalizeDemoEmail(persona.email);
  const username = String(persona.username || "").trim();
  const userDeps = loginDeps.getCompanyUsersDeps();

  const identityByEmail = await resolveCompanyLoginIdentity(auth, loginDeps, {
    email,
    companyFolderId,
    masterSheetId,
  });
  const identityByUsername = username
    ? await resolveCompanyLoginIdentity(auth, loginDeps, {
        username,
        companyFolderId,
        masterSheetId,
      })
    : { ok: false, reason: "missing_username" };

  const usersTabRecord = await readCompanyUsersTabRecord(auth, masterSheetId, email, userDeps).catch(() => null);
  const usersTabMatch = Boolean(usersTabRecord?.email);
  const statusActive = String(usersTabRecord?.status || "").toUpperCase() === "ACTIVE";
  const passwordMatch = usersTabRecord?.passwordHash
    ? verifyPassword(password, usersTabRecord.passwordHash)
    : false;

  const registry = await getCanonicalCompanyRegistryRecord(auth, loginDeps, companyFolderId).catch(() => null);
  const folderResolved = await resolveCompanyFromFolder(auth, loginDeps, companyFolderId, {
    createIfMissing: false,
  }).catch(() => null);

  const workbookMatches = sanitizeIdsMatch(registry?.masterSheetId, masterSheetId) &&
    sanitizeIdsMatch(folderResolved?.masterSheetId, masterSheetId);
  const folderMatches = sanitizeIdsMatch(registry?.companyFolderId || registry?.companyId, companyFolderId) &&
    sanitizeIdsMatch(folderResolved?.companyFolderId || folderResolved?.companyId, companyFolderId);

  const coldEmail = await runLogin(auth, loginDeps, email, {});
  const coldUsername = username ? await runLogin(auth, loginDeps, username, {}) : null;
  const folderEmail = await runLogin(auth, loginDeps, email, { companyFolderId, masterSheetId });
  const folderUsername = username
    ? await runLogin(auth, loginDeps, username, { companyFolderId, masterSheetId })
    : null;

  const roleOk = (result) => result.ok && result.role === persona.role;
  const allLoginOk =
    roleOk(coldEmail) &&
    roleOk(folderEmail) &&
    (!coldUsername || roleOk(coldUsername)) &&
    (!folderUsername || roleOk(folderUsername));

  const allChecksOk =
    identityByEmail.ok &&
    identityByEmail.email === email &&
    identityByUsername.ok &&
    identityByUsername.email === email &&
    usersTabMatch &&
    statusActive &&
    passwordMatch &&
    workbookMatches &&
    folderMatches &&
    allLoginOk;

  return {
    persona,
    email,
    username,
    identityByEmail,
    identityByUsername,
    usersTabMatch,
    statusActive,
    passwordMatch,
    workbookMatches,
    folderMatches,
    registryCompanyName: String(registry?.companyName || folderResolved?.companyName || "").trim(),
    coldEmail,
    coldUsername,
    folderEmail,
    folderUsername,
    allChecksOk,
  };
}

function sanitizeIdsMatch(actual = "", expected = "") {
  return String(actual || "").trim() === String(expected || "").trim();
}

function printPersonaReport(report) {
  const { persona, email, username } = report;
  console.log(`\n--- ${persona.key} (${persona.role}) — ${persona.name} ---`);
  console.log(`Email: ${email}`);
  console.log(`Username: ${username || "(none)"}`);
  console.log(
    `Identity (email): ${formatPassFail(
      report.identityByEmail.ok && report.identityByEmail.email === email,
      report.identityByEmail.source || report.identityByEmail.reason || "",
    )}`,
  );
  console.log(
    `Identity (username): ${formatPassFail(
      report.identityByUsername.ok && report.identityByUsername.email === email,
      report.identityByUsername.source || report.identityByUsername.reason || "",
    )}`,
  );
  console.log(`Users tab match: ${formatPassFail(report.usersTabMatch)}`);
  console.log(`ACTIVE status: ${formatPassFail(report.statusActive)}`);
  console.log(`Password match: ${formatPassFail(report.passwordMatch)}`);
  console.log(`Workbook resolution: ${formatPassFail(report.workbookMatches)}`);
  console.log(`Folder resolution: ${formatPassFail(report.folderMatches)}`);
  console.log(
    `Cold login (email): ${formatPassFail(
      report.coldEmail.ok && report.coldEmail.role === persona.role,
      `${report.coldEmail.role || report.coldEmail.authFailureReason || report.coldEmail.code || "error"}, ${report.coldEmail.ms}ms`,
    )}`,
  );
  if (username) {
    console.log(
      `Cold login (username): ${formatPassFail(
        report.coldUsername?.ok && report.coldUsername.role === persona.role,
        `${report.coldUsername?.role || report.coldUsername?.authFailureReason || report.coldUsername?.code || "error"}, ${report.coldUsername?.ms || 0}ms`,
      )}`,
    );
  }
  console.log(
    `Folder-hint login (email): ${formatPassFail(
      report.folderEmail.ok && report.folderEmail.role === persona.role,
      `${report.folderEmail.role || report.folderEmail.authFailureReason || report.folderEmail.code || "error"}, ${report.folderEmail.ms}ms`,
    )}`,
  );
  if (username) {
    console.log(
      `Folder-hint login (username): ${formatPassFail(
        report.folderUsername?.ok && report.folderUsername.role === persona.role,
        `${report.folderUsername?.role || report.folderUsername?.authFailureReason || report.folderUsername?.code || "error"}, ${report.folderUsername?.ms || 0}ms`,
      )}`,
    );
  }
}

async function assertLegacyDovecoteRejected(auth, loginDeps) {
  console.log("\n=== Legacy Dovecote persona regression (must not authenticate against Midlands IDs) ===\n");
  let rejected = 0;
  for (const legacyEmail of LEGACY_DOVECOTE_LOGIN_EMAILS) {
    const folderHint = await runLogin(auth, loginDeps, legacyEmail, { companyFolderId, masterSheetId });
    const rejectedOk =
      !folderHint.ok &&
      (folderHint.code === "USER_NOT_FOUND" || folderHint.authFailureReason === "USER_NOT_FOUND");
    if (rejectedOk) {
      rejected += 1;
    }
    console.log(
      `${legacyEmail}: ${formatPassFail(
        rejectedOk,
        folderHint.authFailureReason || folderHint.code || folderHint.blocker || "unexpected success",
      )}`,
    );
    if (!rejectedOk) {
      console.log("  detail:", folderHint);
    }
  }
  if (rejected !== LEGACY_DOVECOTE_LOGIN_EMAILS.length) {
    throw new Error("Legacy Dovecote personas must not authenticate against Midlands workspace IDs.");
  }
}

async function main() {
  console.log("=== Midlands demo login roles verifier (UI auth path) ===\n");
  if (confirm !== "yes") {
    throw new Error(`Refusing to run without ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes`);
  }
  if (!companyFolderId || !masterSheetId) {
    throw new Error(
      `Set ${DEMO_COMPANY_FOLDER_ENV} and ${DEMO_COMPANY_SPREADSHEET_ENV} (or ${DEMO_COMPANY_WORKBOOK_ENV}).`,
    );
  }
  if (!password) {
    throw new Error("Set BERT_DEMO_DEFAULT_PASSWORD (or DEMO_LOGIN_PASSWORD) for live login verification.");
  }

  const workspaceGuard = assertDemoCompanyAllowed({
    companyName: MIDLANDS_DEMO_COMPANY_NAME,
    companyFolderId,
    masterSheetId,
    requireWorkspaceIds: true,
  });
  if (!workspaceGuard.ok) {
    throw new Error(workspaceGuard.error);
  }

  console.log(`Expected company: ${MIDLANDS_DEMO_COMPANY_NAME}`);
  console.log(`Folder: ${companyFolderId}`);
  console.log(`Workbook: ${masterSheetId}`);
  console.log(`Spreadsheet env: ${process.env[DEMO_COMPANY_SPREADSHEET_ENV] ? DEMO_COMPANY_SPREADSHEET_ENV : DEMO_COMPANY_WORKBOOK_ENV}`);
  console.log(`Password: provided`);
  console.log(`Personas: ${MIDLANDS_PERSONAS.map((persona) => persona.key).join(", ")}`);
  console.log("");

  const auth = loadGoogleAuth();
  const authIndexPath = path.join(sessionsRoot, "auth-index-demo-login-roles.json");
  if (fs.existsSync(authIndexPath)) {
    fs.unlinkSync(authIndexPath);
  }
  const authIndex = createAuthIndexApi(authIndexPath);
  const loginDeps = buildDeps(authIndex);

  const registry = await getCanonicalCompanyRegistryRecord(auth, loginDeps, companyFolderId).catch(() => null);
  const folderResolved = await resolveCompanyFromFolder(auth, loginDeps, companyFolderId, {
    createIfMissing: false,
  }).catch(() => null);
  const registryCompanyName = String(
    registry?.companyName || folderResolved?.companyName || "",
  ).trim();

  console.log(
    `Registry: source=${registry?.registrySource || "(none)"} live=${
      registry && isCompanyRegistryLive(registry) ? "yes" : "no"
    } sheet=${registry?.masterSheetId || "(blank)"} name=${registryCompanyName || "(blank)"}`,
  );

  if (!registryCompanyName) {
    throw new Error("Could not read company name from registry or folder resolver.");
  }
  if (!isMidlandsDemoCompanyName(registryCompanyName)) {
    throw new Error(
      `Workspace company name must be "${MIDLANDS_DEMO_COMPANY_NAME}". Registry reports: ${registryCompanyName}`,
    );
  }
  const nameGuard = assertDemoCompanyAllowed({
    companyName: registryCompanyName,
    companyFolderId,
    masterSheetId,
    requireWorkspaceIds: true,
  });
  if (!nameGuard.ok) {
    throw new Error(nameGuard.error);
  }
  console.log(`Verified company name: ${registryCompanyName}`);
  console.log("");

  const reports = [];
  let failures = 0;

  for (const persona of MIDLANDS_PERSONAS) {
    const report = await inspectPersona(auth, loginDeps, persona);
    printPersonaReport(report);
    reports.push(report);
    if (!report.allChecksOk) {
      failures += 1;
    }
  }

  const summaryRows = reports.map((report) => ({
    persona: report.persona.key,
    role: report.persona.role,
    identity: formatPassFail(
      report.identityByEmail.ok &&
        report.identityByUsername.ok &&
        report.identityByEmail.email === report.email &&
        report.identityByUsername.email === report.email,
    ),
    usersTab: formatPassFail(report.usersTabMatch && report.statusActive && report.passwordMatch),
    workspace: formatPassFail(report.workbookMatches && report.folderMatches),
    coldEmail: formatPassFail(report.coldEmail.ok && report.coldEmail.role === report.persona.role),
    coldUser: formatPassFail(
      !report.username ||
        (report.coldUsername?.ok && report.coldUsername.role === report.persona.role),
    ),
    folderEmail: formatPassFail(report.folderEmail.ok && report.folderEmail.role === report.persona.role),
    folderUser: formatPassFail(
      !report.username ||
        (report.folderUsername?.ok && report.folderUsername.role === report.persona.role),
    ),
    verdict: formatPassFail(report.allChecksOk),
  }));

  console.log("\n=== Summary ===\n");
  printTable(summaryRows, [
    { key: "persona", header: "Persona" },
    { key: "role", header: "Role" },
    { key: "identity", header: "Identity" },
    { key: "usersTab", header: "Users tab" },
    { key: "workspace", header: "Workspace" },
    { key: "coldEmail", header: "Cold email" },
    { key: "coldUser", header: "Cold user" },
    { key: "folderEmail", header: "Folder email" },
    { key: "folderUser", header: "Folder user" },
    { key: "verdict", header: "Verdict" },
  ]);

  await assertLegacyDovecoteRejected(auth, loginDeps);

  console.log(`\nVerdict: ${failures === 0 ? "ALL MIDLANDS ROLE LOGINS PASS" : "FAILURES DETECTED"}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Verifier failed:", error?.stack || error);
  process.exit(1);
});
