#!/usr/bin/env node
/**
 * Ensure the dedicated BERT Verification Audit exists for production smoke testing.
 *
 * Idempotent upsert into Dovecote Manufacturing Ltd workbook:
 * - AuditTemplates row
 * - AuditTemplateTranslations row (3 safe Pass/Fail/N/A questions)
 * - UserAuditAccess row for the smoke account
 * - LIVE Schedules row assigned to mr.important
 *
 * Usage:
 *   set -a && source .env && set +a
 *   DEMO_COMPANY_SEED_CONFIRM=yes \
 *   BERT_DEMO_COMPANY_FOLDER_ID=1tDKluapYfY-RkuxXc6eoRnGHL38XCswx \
 *   BERT_DEMO_COMPANY_WORKBOOK_ID=1MntKgSgVmTmlpzZhnCZdDQtdmPw7GcXptlAp88Ewrkc \
 *   npm run ensure:production-verification-audit
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_COMPANY_FOLDER_ENV,
  DEMO_COMPANY_NAME,
  DEMO_COMPANY_SEED_CONFIRM_ENV,
  DEMO_COMPANY_WORKBOOK_ENV,
  assertDemoCompanyAllowed,
} from "../shared/demo-company-seed.mjs";
import {
  PRODUCTION_VERIFICATION_AUDIT_ID,
  PRODUCTION_VERIFICATION_SCHEDULE_ID,
  PRODUCTION_VERIFICATION_SMOKE_EMAIL,
  buildProductionVerificationAuditTemplateRow,
  buildProductionVerificationScheduleRows,
  buildProductionVerificationTranslationRow,
  buildProductionVerificationUserAuditAccessRow,
} from "../shared/production-verification-audit.mjs";
import {
  AUDIT_TEMPLATES_COLUMNS,
  USER_AUDIT_ACCESS_COLUMNS,
  USER_AUDIT_ACCESS_TAB,
} from "../server/company-audit-mapping.mjs";
import {
  AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS,
  AUDIT_TEMPLATE_TRANSLATIONS_TAB,
} from "../server/template-languages.mjs";
import { SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { ensureRequiredTabs } from "../server/workbook-service.mjs";
import {
  buildCompanyProvisionScriptDeps,
  loadGoogleAuth,
  writeMergedTab,
} from "./lib/demo-environment-script-utils.mjs";
import { createFetchTransport, performProductionSmokeLogin } from "./lib/production-auth-health-core.mjs";

dotenv.config();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = String(process.env.BERT_SESSIONS_DIR || path.join(root, ".sessions")).trim();

const confirm = String(process.env[DEMO_COMPANY_SEED_CONFIRM_ENV] || "").trim().toLowerCase();
if (confirm !== "yes") {
  console.error(`ERROR: Set ${DEMO_COMPANY_SEED_CONFIRM_ENV}=yes to run this provisioning script.`);
  process.exit(1);
}

const companyFolderId = String(
  process.env.BERT_SMOKE_COMPANY_FOLDER_ID || process.env[DEMO_COMPANY_FOLDER_ENV] || "",
).trim();
const masterSheetId = String(
  process.env.BERT_SMOKE_MASTER_SHEET_ID || process.env[DEMO_COMPANY_WORKBOOK_ENV] || "",
).trim();

const nameGuard = assertDemoCompanyAllowed(DEMO_COMPANY_NAME);
if (!nameGuard.ok) {
  console.error(`ERROR: ${nameGuard.error}`);
  process.exit(1);
}

if (!companyFolderId || !masterSheetId) {
  console.error(
    [
      "ERROR: Company folder and workbook IDs are required.",
      `  - BERT_DEMO_COMPANY_FOLDER_ID or BERT_SMOKE_COMPANY_FOLDER_ID`,
      `  - BERT_DEMO_COMPANY_WORKBOOK_ID or BERT_SMOKE_MASTER_SHEET_ID`,
    ].join("\n"),
  );
  process.exit(1);
}

function scheduleAssignedToSmoke(schedules = []) {
  return schedules.some((schedule) => {
    const scheduleId = String(schedule?.id || schedule?.scheduleId || "").trim();
    if (scheduleId !== PRODUCTION_VERIFICATION_SCHEDULE_ID) {
      return false;
    }
    const emails = String(schedule?.assignedUserEmails || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (emails.includes(PRODUCTION_VERIFICATION_SMOKE_EMAIL)) {
      return true;
    }
    if (Array.isArray(schedule?.assignedUsers)) {
      return schedule.assignedUsers.some(
        (user) => String(user?.email || "").trim().toLowerCase() === PRODUCTION_VERIFICATION_SMOKE_EMAIL,
      );
    }
    return false;
  });
}

async function verifyAssignedChecksApi() {
  const apiBase = String(process.env.BERT_SMOKE_API_ORIGIN || "https://api.usebert.co.uk").replace(/\/$/, "");
  const appOrigin = String(process.env.BERT_SMOKE_APP_ORIGIN || "https://app.usebert.co.uk").replace(/\/$/, "");
  const password = String(
    process.env.BERT_SMOKE_PASSWORD ||
      process.env.DEMO_LOGIN_PASSWORD ||
      process.env.BERT_DEMO_DEFAULT_PASSWORD ||
      "BertDemo123!",
  ).trim();
  if (!password) {
    return { ok: false, skipped: true, reason: "BERT_SMOKE_PASSWORD not set for live API verification." };
  }

  const config = {
    username: "mr.important",
    password,
    companyFolderId,
    masterSheetId,
    expectedEmail: PRODUCTION_VERIFICATION_SMOKE_EMAIL,
    expectedRole: "Admin",
    apiBase,
    appOrigin,
    timeoutMs: 180_000,
    missing: [],
  };

  const transport = createFetchTransport(apiBase, appOrigin, config.timeoutMs);
  const login = await performProductionSmokeLogin(config, transport);
  if (!login.ok) {
    return { ok: false, reason: login.failureReason || "Smoke login failed.", httpStatus: login.httpStatus };
  }

  const assigned = await transport.request("GET", "/api/me/assigned-checks?diagnostics=1");
  if (assigned.status !== 200 || assigned.json?.ok !== true) {
    return {
      ok: false,
      reason: `GET /api/me/assigned-checks failed (HTTP ${assigned.status}).`,
      response: assigned.json,
    };
  }

  const schedules = Array.isArray(assigned.json?.schedules) ? assigned.json.schedules : [];
  const found = schedules.find(
    (schedule) => String(schedule?.id || schedule?.scheduleId || "").trim() === PRODUCTION_VERIFICATION_SCHEDULE_ID,
  );
  if (!found) {
    return {
      ok: false,
      reason: "Verification schedule not visible in assigned-checks API.",
      scheduleCount: schedules.length,
      diagnostics: assigned.json?.diagnostics,
    };
  }

  return {
    ok: true,
    scheduleCount: schedules.length,
    scheduleName: found.scheduleName || found.name,
    assignedUserEmails: found.assignedUserEmails,
    apiSha: assigned.json?.diagnostics ? undefined : undefined,
  };
}

async function main() {
  const startedAt = Date.now();
  const auth = loadGoogleAuth(sessionsRoot);
  const deps = buildCompanyProvisionScriptDeps({
    sessionDir: sessionsRoot,
    sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID || "",
    platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
  });

  console.log(`[ensure:production-verification-audit] Company: ${DEMO_COMPANY_NAME}`);
  console.log(`[ensure:production-verification-audit] Folder:  ${companyFolderId}`);
  console.log(`[ensure:production-verification-audit] Workbook: ${masterSheetId}`);

  await ensureRequiredTabs(auth, deps, masterSheetId);

  const now = new Date();
  const auditRow = buildProductionVerificationAuditTemplateRow({ now, companyFolderId });
  const translationRow = buildProductionVerificationTranslationRow({ now });
  const accessRow = buildProductionVerificationUserAuditAccessRow();
  const scheduleRows = buildProductionVerificationScheduleRows({ companyFolderId, now });

  const auditCount = await writeMergedTab(
    auth,
    deps,
    masterSheetId,
    "AuditTemplates",
    AUDIT_TEMPLATES_COLUMNS,
    [auditRow],
    ["Audit ID"],
  );
  const translationCount = await writeMergedTab(
    auth,
    deps,
    masterSheetId,
    AUDIT_TEMPLATE_TRANSLATIONS_TAB,
    AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS,
    [translationRow],
    ["BERT Template ID", "Language"],
  );
  const accessCount = await writeMergedTab(
    auth,
    deps,
    masterSheetId,
    USER_AUDIT_ACCESS_TAB,
    USER_AUDIT_ACCESS_COLUMNS,
    [accessRow],
    ["Email", "Audit ID"],
  );
  const scheduleCount = await writeMergedTab(
    auth,
    deps,
    masterSheetId,
    "Schedules",
    SCHEDULES_TAB_COLUMNS,
    scheduleRows,
    ["Schedule ID"],
  );

  console.log("");
  console.log("Upsert complete (idempotent):");
  console.log(`  Template ID:  ${PRODUCTION_VERIFICATION_AUDIT_ID}`);
  console.log(`  Schedule ID:  ${PRODUCTION_VERIFICATION_SCHEDULE_ID}`);
  console.log(`  Assigned to:  ${PRODUCTION_VERIFICATION_SMOKE_EMAIL} (mr.important)`);
  console.log(`  Tab rows:     AuditTemplates=${auditCount}, Translations=${translationCount}, Access=${accessCount}, Schedules=${scheduleCount}`);
  console.log("");

  const apiCheck = await verifyAssignedChecksApi();
  if (apiCheck.skipped) {
    console.warn(`Live API check skipped: ${apiCheck.reason}`);
  } else if (!apiCheck.ok) {
    console.warn(`Live API check warning: ${apiCheck.reason}`);
    if (apiCheck.httpStatus) {
      console.warn(`  HTTP status: ${apiCheck.httpStatus}`);
    }
    if (apiCheck.scheduleCount !== undefined) {
      console.warn(`  scheduleCount=${apiCheck.scheduleCount}`);
    }
    console.warn("Workbook upsert succeeded — re-run verify:production-audit-workflow to confirm assigned checks.");
  } else {
    console.log("Live API check PASS:");
    console.log(`  assigned schedules for smoke user: ${apiCheck.scheduleCount}`);
    console.log(`  verification schedule: ${apiCheck.scheduleName || PRODUCTION_VERIFICATION_SCHEDULE_ID}`);
  }

  console.log(`Done in ${Date.now() - startedAt}ms`);
}

main().catch((error) => {
  console.error(
    "[ensure:production-verification-audit] Unhandled error:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
