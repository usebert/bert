import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import {
  handleSeedMasterRequest,
  hashPassword,
  installMasterAuthRoutes,
  masterOperatorsFilePath,
  findOperatorByIdentity,
  verifyPassword,
  upsertMasterOperator,
  MASTER_SESSION_COOKIE,
  MASTER_SESSION_MS,
} from "./master-auth.mjs";
import { bootstrapMasterOperatorFromEnv } from "./master-operator-bootstrap.mjs";
import { guardDemoOutboundEmail } from "./demo-email-guard.mjs";
import { getSessionCookieOptions } from "./session-cookie-options.mjs";
import {
  isUserAuthScryptHash,
  migrateAllPlainUserAuthKeys,
} from "./userauth-password.mjs";
import {
  USERS_TAB_COLUMNS,
  USERS_TAB_REQUIRED_COLUMNS,
  companyUserLoginReady as workbookCompanyUserLoginReady,
  findCompanyUsersTabRow as workbookFindCompanyUsersTabRow,
  managerInvitesEnabled,
  defaultAccessLevelForRole,
  migrateUsersTabColumns,
  migrateUsersTabCompanyColumns,
  parseCompanyAreas,
  parseRoleFromUsersSheet,
  readCompanyUsersTabRecord as workbookReadCompanyUsersTabRecord,
  sanitizeUsersTabRecords,
  setCompanyUserPasswordHash,
  touchCompanyUserLastLogin,
  verifyCompanyUserPassword,
  resolveCompanyUserEmailByHash,
  resolveCompanyContextForUser,
  updateCompanyUserRecord,
  writeUsersTabRecordByHeaders,
  isValidCompanyUserEmail,
} from "./company-users.mjs";
import {
  readCompanyUsers as workbookReadCompanyUsers,
  repairUsersTab,
  repairUsersTabSchema,
  resolveUsersTab,
} from "./users-tab-reader.mjs";
import { installDocumentDistributionRoutes } from "./document-distribution.mjs";
import { CONFIG_KEY_AREA_RESTRICTIONS, AREAS_TAB, AREAS_COLUMNS, installCompanyAreasRoutes } from "./company-areas.mjs";
import { installCompanyStructureRoutes } from "./company-structure.mjs";
import { CONFIG_KEY_DEFAULT_FORM_LANGUAGE } from "./template-languages.mjs";
import {
  installCompanyAuditMappingRoutes,
  ensureCompanyMappingTabs,
} from "./company-audit-mapping.mjs";
import { installEmailReminderRoutes, startEmailReminderScheduler } from "./email-reminders.mjs";
import { installAuditBuilderRoutes } from "./audit-builder.mjs";
import { createGoogleOAuthSessionStore } from "./google-oauth-session.mjs";
import {
  buildGoogleCredentialDiagnostics,
  probeGoogleSheetsWorkbookMetadata,
} from "./google-auth-diagnostics.mjs";
import { installSetupStatusRoutes } from "./setup-status.mjs";
import {
  isArchiveOrNonLiveWorkspaceName,
  logInviteCompleteFailure,
  normalizeWorkspaceFolderLabel,
} from "./invite-target.mjs";
import {
  diagnoseCompanyInviteTarget,
  prepareCompanyUserInviteTarget,
  repairCompanyInviteTarget,
} from "./resolve-invite-target.mjs";
import { installCompanyWorkspaceResetRoutes } from "./company-workspace-reset.mjs";
import { installCompanyUserResetRoutes } from "./company-user-reset.mjs";
import { installFoundationVerifyCleanupRoutes } from "./foundation-verify-cleanup.mjs";
import { createCompanySessionRevocationApi } from "./company-session-revocation.mjs";
import { installPasswordResetRoutes } from "./password-reset.mjs";
import {
  GOOGLE_FORMS_BODY_SCOPE,
  installGoogleFormTemplateRoutes,
} from "./google-form-templates.mjs";
import {
  installCompanyFormsRoutes,
  listCompanyGoogleFormsFromDrive,
  listGoogleFormsInFolderTree,
} from "./company-forms-service.mjs";
import {
  COMPANY_FOLDERS_TAB,
  COMPANY_FOLDERS_COLUMNS,
  ensureCompanyFolderStructure,
  ensureCompanyMasterSheet,
  installCompanyFolderStructureRoutes,
  resolveEvidenceUploadFolderId,
} from "./company-folder-structure.mjs";
import {
  assertCompanyWorkspaceAcceptsUserInvite,
  createInviteStoreApi,
  installCompanyOnboardingRoutes,
  isCompanyWorkspaceLiveForUserInvites,
} from "./company-onboarding.mjs";
import {
  ensureCompanyLiveIfReady,
  evaluateCompanyWorkspaceReadiness,
  findCompanyWorkspaceRegistryRecordInMap,
  getCanonicalCompanyRegistryRecord,
  getCompanyWorkspaceRegistryRecord,
  installCompanyWorkspaceRegistryRoutes,
  mergeDriveCompanyWithRegistry,
  buildGodmodeRegistryFallbackCompany,
  isGodmodeListableRegistryRecord,
  persistCompanyLive,
  persistCompanyWorkspaceSetup,
  readCanonicalCompanyWorkspaceRegistryMap,
  readCompanyWorkspaceRegistryMap,
  recordCompanyWorkspaceHealthCheck,
} from "./company-workspace-registry.mjs";
import { installCompanySetupProgressRoutes } from "./company-setup-progress.mjs";
import {
  installCompanyFolderPlacementRoutes,
  rejectIfCompanyFolderNotUnderCompaniesRoot,
} from "./company-folder-placement.mjs";
import {
  installCompanyFolderResolverRoutes,
  installCompanyFolderConnectRoutes,
  resolveCompanyFromFolder,
} from "./company-service.mjs";
import { installCompanyProvisioningRoutes } from "./company-provisioning-routes.mjs";
import {
  rowsToRecords as workbookRowsToRecords,
  getTabValues as workbookGetTabValues,
  ensureTabExists as workbookEnsureTabExists,
  ensureTabColumns as workbookEnsureTabColumns,
} from "./workbook-service.mjs";
import { installGodmodeRegistryActionRoutes, relinkCompanyRegistryForWorkspace } from "./godmode-registry-actions.mjs";
import { createBackgroundJobsService } from "./background-jobs-service.mjs";
import { BACKGROUND_INVITE_CREATED_MESSAGE } from "../shared/background-jobs.mjs";
import { SCHEDULES_TAB_COLUMNS } from "../shared/schedule-save.mjs";
import { NCR_TAB_COLUMNS } from "../shared/ncr.mjs";
import { isKnownStaleAuthIndexPairing } from "../shared/auth-index-trust.mjs";
import { installCoreWorkflowRoutes } from "./core-workflow-routes.mjs";
import { assertCompanyInviteReady } from "./company-invite-readiness.mjs";
import { enrichCompanyContextFromRegistry as enrichCompanyContextFromRegistryService, resolveCompanyContextFromLoginWorkbook, validateLiveCompanyContext } from "./company-context-service.mjs";
import {
  buildCompanySessionApiResponse,
  buildCompanySessionPayload,
  buildMasterSessionApiResponse,
  performCompanyLogin,
  performMasterLogin,
  probeCompanyLoginSheet as probeCompanyLoginSheetCore,
  queueCompanyLoginBackgroundJobs,
  resolveValidatedCompanyLoginContext,
  COMPANY_CONTEXT_INVALID,
  COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
  INVALID_CREDENTIALS,
  LOGIN_CONTEXT_FAILED,
} from "./auth-service.mjs";
import {
  createLoginTimingTrace,
  loginTimingEmailMeta,
  logLoginTimingMark,
  safeLoginRequestHintMeta,
} from "./login-timing.mjs";
import { buildCompanyLoginInputFromRequestBody } from "../shared/login-username.mjs";
import { debugVerifyUserPassword } from "./user-auth-service.mjs";
import { createAuthIndexApi, syncAuthIndexAfterUsersRead } from "./auth-index.mjs";
import { completeInviteToUserRow } from "./company-user-sheet-flow.mjs";
import {
  createInvite,
  resolveInviteCompanyContext,
  sanitizeCompanyUserInviteForClient,
} from "./invite-service.mjs";
import { listSchedulerAssignees } from "./schedule-service.mjs";
import { createCompanyUsersCacheApi } from "./company-users-cache.mjs";
import { createMasterSheetCacheApi } from "./master-sheet-cache.mjs";
import { invalidateUsersTabCache, wrapGetTabValuesWithUsersTabCache } from "./users-tab-cache.mjs";
import { rebuildUsersFromSheet } from "./company-users-foundation.mjs";
import {
  inspectConfiguredWorkspaceRoot,
  listFolderChildren,
  WORKSPACE_ROOT_INACCESSIBLE_ERROR,
} from "./google-workspace-root.mjs";
import { createGetInviteHandler, resolveCompanyUserInviteTokenAccess } from "./invite-routes.mjs";
import {
  canCreateCompanyInvite,
  canRevokeInvite,
  canViewInvite,
  COMPANY_NOT_LIVE_INVITE_MESSAGE,
  COMPANY_REGISTRY_STATUS_LIVE,
  COMPANY_USER_INVITE_TYPE,
  FORBIDDEN_INVITE_ROLE_MESSAGE,
  getCanonicalCompanyStatus,
  INVITE_EMAIL_UNAVAILABLE_COMPANY_MESSAGE,
  INVITE_GOOGLE_UNAVAILABLE_GODMODE_MESSAGE,
  INVITE_MANAGE_AUDITOR_ONLY_MESSAGE,
  INVITE_PARTIAL_SUCCESS_USER_MESSAGE,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
  INVITE_SENT_USER_MESSAGE,
  isCompanyAdminInviteRole,
  isCompanyInviteActor,
  isCompanyRegistryLive,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";
import {
  buildAvailableScheduleAssigneesFromUsers,
  inviteAccessLevelForRole,
} from "../shared/schedule-assignees.mjs";
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { isSystemTemplateCompany } from "../shared/system-template-company.mjs";
import { bertCorsMiddleware } from "./bert-cors.mjs";

dotenv.config();

const app = express();
app.disable("x-powered-by");
/** Paid pilot / production: trust first reverse-proxy hop for accurate req.ip (rate limits, logs). */
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
const port = Number(process.env.PORT) || 8787;
const rootDir = process.cwd();
const sessionsRootRaw = String(process.env.BERT_SESSIONS_DIR || "").trim();
const googleOAuthStore = createGoogleOAuthSessionStore({
  rootDir,
  sessionsDirEnv: sessionsRootRaw,
});
const sessionDir = googleOAuthStore.sessionDir;
let backgroundJobs = null;

const requiredEnv = {
  // Trim Google OAuth env values — Render/env pastes often introduce trailing newlines that cause invalid_grant.
  GOOGLE_CLIENT_ID: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
  GOOGLE_CLIENT_SECRET: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  GOOGLE_REDIRECT_URI: String(
    process.env.GOOGLE_REDIRECT_URI || "http://127.0.0.1:8787/auth/google/callback",
  ).trim(),
  GOOGLE_SHARED_DRIVE_ID: String(process.env.GOOGLE_SHARED_DRIVE_ID || "").trim(),
  GOOGLE_ONBOARDING_FORM_ID: String(process.env.GOOGLE_ONBOARDING_FORM_ID || "").trim(),
  GOOGLE_ONBOARDING_SHEET_ID: String(process.env.GOOGLE_ONBOARDING_SHEET_ID || "").trim(),
  /** Public origin of the SPA (must match where users open the app). Default matches Vite dev (`npm run dev`). Set in .env for real emails, e.g. https://app.example.com */
  FRONTEND_URL: process.env.FRONTEND_URL || "http://127.0.0.1:5173",
  SESSION_SECRET: process.env.SESSION_SECRET || "qms-local-dev-secret",
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: process.env.SMTP_PORT || "",
  SMTP_SECURE: process.env.SMTP_SECURE || "false",
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM || "",
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || process.env.APP_BRAND_NAME || "BERT",
  BERT_COMPANY_ONBOARDING_FORM_URL: process.env.BERT_COMPANY_ONBOARDING_FORM_URL || "",
};

/** Paid-pilot default when BERT_COMPANY_ONBOARDING_FORM_URL is unset (document in deployment runbook). */
const DEFAULT_COMPANY_ONBOARDING_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeWyvQiwz2zpW9L_V_gOhsVKtUs79LIxBZWGt7VMklED1QpNw/viewform?usp=sharing&ouid=113906459915409672747";
const APP_BRAND_NAME = (process.env.APP_BRAND_NAME || "BERT — Business. Evaluate. Report. Tool.").trim();
/** Customer-facing inbox for server-driven mail (e.g. incident notifications). Override with APP_SUPPORT_EMAIL or APP_ADMIN_EMAIL. */
const APP_SUPPORT_EMAIL = String(
  process.env.APP_SUPPORT_EMAIL || process.env.APP_ADMIN_EMAIL || "admin@usebert.co.uk",
).trim();
const ONBOARDING_INVITE_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.ONBOARDING_INVITE_TTL_MS || String(7 * 24 * 60 * 60 * 1000)),
);
const INVITE_STORE_PATH = path.join(sessionDir, "app-onboarding-invites.json");
const COMPANY_ONBOARDING_INVITE_STORE_PATH = path.join(sessionDir, "company-onboarding-invites.json");
const COMPANY_USERS_CACHE_PATH = path.join(sessionDir, "company-users-cache.json");
const MASTER_SHEET_CACHE_PATH = path.join(sessionDir, "master-sheet-cache.json");
const AUTH_INDEX_PATH = path.join(sessionDir, "auth-index.json");
const COMPANY_SESSION_REVOCATION_PATH = path.join(sessionDir, "company-session-revocation.json");
const companyOnboardingInviteStore = createInviteStoreApi(COMPANY_ONBOARDING_INVITE_STORE_PATH);
const companyUsersCacheApi = createCompanyUsersCacheApi(COMPANY_USERS_CACHE_PATH);
const masterSheetCacheApi = createMasterSheetCacheApi(MASTER_SHEET_CACHE_PATH);
const companySessionRevocationApi = createCompanySessionRevocationApi(COMPANY_SESSION_REVOCATION_PATH);
const authIndexApi = createAuthIndexApi(AUTH_INDEX_PATH);
/** Pilot visibility only: `demo` = current client-side password auth. See docs/security-hardening-plan.md */
const APP_AUTH_MODE = String(process.env.APP_AUTH_MODE || "demo").trim().toLowerCase();

/** Company sheet user session (httpOnly signed cookie; separate from Master). */
const COMPANY_SESSION_COOKIE = "bert_company_session";
const COMPANY_SESSION_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.COMPANY_USER_SESSION_TTL_MS || String(7 * 24 * 60 * 60 * 1000)),
);

const scopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  GOOGLE_FORMS_BODY_SCOPE,
];

/** Pause between sequential Sheets reads (values.get / spreadsheets.get) to stay under per-user per-minute read quotas. Override with SHEETS_READ_GAP_MS (50–3000). */
const SHEETS_READ_GAP_MS = Math.min(3000, Math.max(50, Number(process.env.SHEETS_READ_GAP_MS || 500)));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSheetsQuotaOrRateLimitError(err) {
  if (!err || typeof err !== "object") {
    return false;
  }
  const status = err.code ?? err.response?.status ?? err.status;
  if (status === 429) {
    return true;
  }
  const msg = String(err.message || (typeof err.toString === "function" ? err.toString() : "") || "");
  if (/quota|resource_exhausted|rate limit|429/i.test(msg)) {
    return true;
  }
  const apiStatus = err.response?.data?.error?.status;
  if (apiStatus === "RESOURCE_EXHAUSTED") {
    return true;
  }
  const reasons = err.errors || err.response?.data?.error?.errors;
  if (Array.isArray(reasons)) {
    for (const entry of reasons) {
      const reason = String(entry?.reason || "").toLowerCase();
      if (
        reason.includes("quota") ||
        reason.includes("ratelimit") ||
        reason === "userratelimitexceeded" ||
        reason === "ratelimitexceeded"
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Retries a Sheets API operation on HTTP 429 / quota / RESOURCE_EXHAUSTED (default 8 retries, exponential backoff capped at 45s, honors Retry-After when present).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxRetries?: number }} [options]
 * @returns {Promise<T>}
 */
async function withSheetsQuotaRetry(fn, { maxRetries = 8 } = {}) {
  const cap = Math.max(1, Number(process.env.SHEETS_QUOTA_MAX_RETRIES || maxRetries) || maxRetries);
  for (let attempt = 0; attempt <= cap; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isSheetsQuotaOrRateLimitError(err) || attempt === cap) {
        throw err;
      }
      let delayMs = Math.min(45_000, 1000 * 2 ** attempt);
      const retryAfter = err.response?.headers?.["retry-after"];
      if (retryAfter) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs) && secs > 0) {
          delayMs = Math.max(delayMs, Math.min(120_000, secs * 1000));
        }
      }
      try {
        console.info("sheets_quota_retry", {
          attempt: attempt + 1,
          maxRetries: cap,
          delayMs,
          status: err?.response?.status,
          code: err?.code,
          reason: err?.errors?.[0]?.reason || err?.response?.data?.error?.status,
        });
      } catch {
        /* retry log must never affect request */
      }
      await sleep(delayMs);
    }
  }
}

const APP_VERSION = (() => {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return String(packageJson.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
})();

const CURRENT_SCHEMA_VERSION = "3.0.0";
const REQUIRED_TABS = [
  "Config",
  "Onboarding",
  "Users",
  "Schedules",
  "Actions",
  "ActionComments",
  "NCRs",
  "AuditResults",
  "AuditFindings",
  "Evidence",
  "Incidents",
  "IncidentActions",
  "Reports",
  "SyncLog",
  "Notes",
  COMPANY_FOLDERS_TAB,
];
const TAB_COLUMNS = {
  Config: ["Key", "Value", "Updated At"],
  Onboarding: [
    "Record ID",
    "Company ID",
    "Company Name",
    "Created At",
    "Updated At",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  Users: USERS_TAB_COLUMNS,
  Actions: [
    "Action ID",
    "Company ID",
    "Source Audit ID",
    "Source Audit Name",
    "Source Question ID",
    "Source Question Text",
    "Source Answer",
    "Non Conformance ID",
    "Severity",
    "Status",
    "Assigned To User ID",
    "Assigned To Name",
    "Created By User ID",
    "Created At",
    "Updated At",
    "Due Date",
    "Closed At",
    "Verified By User ID",
    "Verification Notes",
    "Evidence Links",
    "Local Evidence Refs",
    "Comments",
    "Recurrence Flag",
    "Root Cause",
    "Corrective Action",
    "Preventive Action",
    "Risk Category",
    "Requires Manager Review",
    "Suggestion JSON",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
    "Version Number",
    "Local Updated At",
    "Remote Updated At",
    "Last Synced At",
  ],
  ActionComments: [
    "Comment ID",
    "Action ID",
    "Company ID",
    "Changed At",
    "Changed By",
    "From Status",
    "To Status",
    "Note",
    "Evidence Ref",
    "Created At",
    "Updated At",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  Schedule: [
    "Root ID",
    "Schedule ID",
    "Version Number",
    "Version Label",
    "Lifecycle",
    "Company Folder ID",
    "Schedule Name",
    "Area ID",
    "Audit ID",
    "Audit Name",
    "Days",
    "Frequency",
    "Live Time",
    "Completion Hours",
    "Auditors",
    "Assigned Role",
    "Assigned User",
    "Status",
    "Created At",
    "Start Date",
    "End Date",
    "Updated At",
    "Parent Schedule ID",
    "Archived At",
    "Reactivated At",
    "Escalation User IDs",
    "Trigger Reaudit On Failure",
    "Reaudit Delay Hours",
    "Missed Audit Count",
    "Last Completed At",
    "Next Due At",
    "Health State",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  Schedules: SCHEDULES_TAB_COLUMNS,
  AuditResults: [
    "Result ID",
    "Company ID",
    "Company Folder ID",
    "Schedule ID",
    "Completed By Email",
    "Completed By Name",
    "Completed At",
    "Status",
    "Answers JSON",
    "Findings JSON",
    "Evidence Refs",
    "Created At",
    "Updated At",
    "Local Submission ID",
    "Audit ID",
    "Area ID",
    "Audit Name",
    "Completed By",
    "Total Risk Score",
    "Highest Risk Level",
    "Critical Findings Count",
    "High Findings Count",
    "Signature Ref",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
    "Version Number",
    "Local Updated At",
    "Remote Updated At",
    "Last Synced At",
  ],
  NCRs: NCR_TAB_COLUMNS,
  AuditFindings: [
    "Finding ID",
    "Local Submission ID",
    "Result ID",
    "Audit ID",
    "Area ID",
    "Company ID",
    "Question ID",
    "Question Text",
    "Answer",
    "Risk Level",
    "Risk Category",
    "Auto Action Required",
    "Requires Photo Evidence",
    "Requires Manager Review",
    "Note",
    "Local Evidence Refs",
    "Created At",
    "Updated At",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  Evidence: [
    "Evidence ID",
    "Local Submission ID",
    "Company ID",
    "Audit ID",
    "Action ID",
    "Finding ID",
    "File Name",
    "Mime Type",
    "Drive File ID",
    "Drive Link",
    "Local Ref",
    "Created At",
    "Updated At",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  Incidents: [
    "Incident Record ID",
    "Incident ID",
    "Company ID",
    "Status",
    "Priority",
    "Incident Type",
    "Severity",
    "Incident Date",
    "Incident Time",
    "Reporter Name",
    "Reporter Email",
    "Department / Area",
    "Location",
    "Description",
    "Immediate Action",
    "Injured",
    "Injury Details",
    "Contributing Factors",
    "Witnesses",
    "Evidence Links",
    "Assigned To",
    "Investigation Notes",
    "Root Cause",
    "Corrective Actions",
    "Preventive Actions",
    "Action Owner",
    "Due Date",
    "Completion Date",
    "RIDDOR Required",
    "Closed By",
    "Closed At",
    "Notification Status",
    "Status History",
    "Created At",
    "Created By",
    "Updated At",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  IncidentActions: [
    "Action ID",
    "Incident Record ID",
    "Incident ID",
    "Company ID",
    "Description",
    "Owner",
    "Due Date",
    "Status",
    "Completed At",
    "Completed By",
    "Created At",
    "Created By",
    "Updated At",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  Reports: [
    "Report ID",
    "Company ID",
    "Report Type",
    "Title",
    "Created By",
    "Created At",
    "Visible To",
    "Export Links",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  SyncLog: [
    "Sync Item ID",
    "Local Submission ID",
    "Company ID",
    "Entity Type",
    "Entity ID",
    "Operation",
    "Status",
    "Created At",
    "Attempted At",
    "Completed At",
    "Retry Count",
    "Priority",
    "Last Error",
    "Payload",
    "Schema Version",
  ],
  Notes: [
    "Note ID",
    "Company ID",
    "Context Type",
    "Context ID",
    "Note",
    "Created At",
    "Updated At",
    "Created By",
    "Updated By",
    "Sync Status",
    "Sync Attempts",
    "Last Sync Error",
    "Remote Row ID",
    "Schema Version",
  ],
  [COMPANY_FOLDERS_TAB]: COMPANY_FOLDERS_COLUMNS,
};

const CONFIG_KEYS = [
  "schemaVersion",
  "companyId",
  "companyName",
  "createdAt",
  "lastValidatedAt",
  "lastRepairedAt",
  "appVersion",
  CONFIG_KEY_AREA_RESTRICTIONS,
  CONFIG_KEY_DEFAULT_FORM_LANGUAGE,
];

const APPEND_ONLY_TABS = new Set(["ActionComments", "AuditResults", "AuditFindings", "Evidence", "Reports", "SyncLog"]);
const ID_COLUMNS = {
  Actions: "Action ID",
  ActionComments: "Comment ID",
  AuditResults: "Result ID",
  AuditFindings: "Finding ID",
  Evidence: "Evidence ID",
  Incidents: "Incident Record ID",
  IncidentActions: "Action ID",
  Reports: "Report ID",
  Schedule: "Schedule ID",
  SyncLog: "Sync Item ID",
};

googleOAuthStore.ensureSessionDir();

function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.removeHeader("X-Powered-By");
  if (process.env.NODE_ENV === "production") {
    const xfProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (xfProto === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
  }
  next();
}

function httpRequestLogMiddleware(req, res, next) {
  const started = Date.now();
  res.on("finish", () => {
    const path = req.originalUrl || req.url || "";
    if (path.includes("/favicon")) {
      return;
    }
    console.log(`[http] ${req.method} ${path.split("?")[0]} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}

/** Simple in-memory fixed-window rate limiter (no extra deps). Not distributed across instances. */
function createWindowRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();
  return function windowRateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: "Too many requests; try again shortly." });
    }
    next();
  };
}

const isProdRuntime = () => process.env.NODE_ENV === "production";
const sensitivePostRateLimit = createWindowRateLimiter({
  name: "sensitive-post",
  windowMs: 60_000,
  max: isProdRuntime() ? 45 : 200,
});
const smtpStatusGetRateLimit = createWindowRateLimiter({
  name: "smtp-status-get",
  windowMs: 60_000,
  max: isProdRuntime() ? 30 : 120,
});

function sensitiveAbusePostRateLimit(req, res, next) {
  if (req.method !== "POST") {
    return next();
  }
  const p = req.path || req.url || "";
  if (
    p.startsWith("/api/onboarding") ||
    p === "/api/auth/master/login" ||
    p === "/api/auth/company/login" ||
    p === "/api/auth/password-reset/request" ||
    p === "/api/auth/password-reset/confirm" ||
    p === "/api/tools/migrate-userauth-passwords" ||
    p === "/api/manager/non-compliance-alert" ||
    p === "/api/ncr/escalation-alert" ||
    p === "/api/incidents/notify"
  ) {
    return sensitivePostRateLimit(req, res, next);
  }
  return next();
}

app.use(securityHeadersMiddleware);
app.use(bertCorsMiddleware);
app.use(express.json({ limit: "16mb" }));
app.use(cookieParser(requiredEnv.SESSION_SECRET));
installMasterAuthRoutes(app, {
  sessionDir,
  rejectInvalidCompanyFolder: async (companyFolderId, options = {}) => {
    const authed = getAuthedClient();
    if (!authed || !envConfigured()) {
      return null;
    }
    return rejectIfCompanyFolderNotUnderCompaniesRoot(
      authed,
      { google, sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID },
      companyFolderId,
      options,
    );
  },
});
const emailDeliveryDeps = {
  sessionDir,
  emailConfigured,
  createSmtpTransport,
  getFromAddress: () =>
    requiredEnv.SMTP_FROM_NAME
      ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
      : requiredEnv.SMTP_FROM_EMAIL,
  getApiPublicOrigin: () => {
    try {
      return new URL(requiredEnv.GOOGLE_REDIRECT_URI).origin;
    } catch {
      return `http://127.0.0.1:${port}`;
    }
  },
  getFrontendUrl: () => String(requiredEnv.FRONTEND_URL || "").trim(),
  appBrandName: APP_BRAND_NAME,
};

installDocumentDistributionRoutes(app, emailDeliveryDeps);
const emailReminderRunner = installEmailReminderRoutes(app, emailDeliveryDeps);
app.use(httpRequestLogMiddleware);
app.use(sensitiveAbusePostRateLimit);

app.get("/api/health", (_req, res) => {
  res.json(getHealthPayload());
});

app.get("/api/readiness", (_req, res) => {
  const body = getReadinessPayload();
  const statusCode = body.ready ? 200 : isProductionRuntime() ? 503 : 200;
  res.status(statusCode).json(body);
});

function createOAuthClient() {
  return new google.auth.OAuth2(
    requiredEnv.GOOGLE_CLIENT_ID,
    requiredEnv.GOOGLE_CLIENT_SECRET,
    requiredEnv.GOOGLE_REDIRECT_URI,
  );
}

function envConfigured() {
  return Boolean(
    requiredEnv.GOOGLE_CLIENT_ID &&
      requiredEnv.GOOGLE_CLIENT_SECRET &&
      requiredEnv.GOOGLE_REDIRECT_URI &&
      requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  );
}

const GOOGLE_WORKSPACE_UNAVAILABLE_ERROR = "Google workspace integration is not configured.";

function sendGoogleWorkspaceUnavailable(res) {
  return res.status(503).json({ ok: false, error: GOOGLE_WORKSPACE_UNAVAILABLE_ERROR });
}

const DEFAULT_SESSION_SECRET = "qms-local-dev-secret";

function nodeEnvLabel() {
  return String(process.env.NODE_ENV || "development").trim() || "development";
}

function isProductionRuntime() {
  return nodeEnvLabel() === "production";
}

/**
 * Production-only gates. Warnings are logged; blocking issues fail boot in production.
 * @returns {{ isProduction: boolean, blockingIssues: string[], warnings: string[] }}
 */
function evaluateProductionEnvironment() {
  const blockingIssues = [];
  const warnings = [];
  if (!isProductionRuntime()) {
    return { isProduction: false, blockingIssues, warnings };
  }

  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret || secret === DEFAULT_SESSION_SECRET) {
    blockingIssues.push("SESSION_SECRET must be set to a strong secret (not the local default) when NODE_ENV=production.");
  } else if (secret.length < 24) {
    blockingIssues.push("SESSION_SECRET is too short for production (use at least 24 random characters).");
  }

  if (parseBooleanEnv(process.env.ALLOW_INSECURE_OAUTH_STATE)) {
    blockingIssues.push("ALLOW_INSECURE_OAUTH_STATE must not be true in production.");
  }

  const allowedOrigins = String(process.env.BERT_ALLOWED_ORIGINS || "").trim();
  if (!allowedOrigins) {
    blockingIssues.push(
      "BERT_ALLOWED_ORIGINS must be set in production (comma-separated exact browser/Capacitor origins for credentialed CORS).",
    );
  }

  if (!String(process.env.BERT_SESSIONS_DIR || "").trim()) {
    warnings.push(
      "BERT_SESSIONS_DIR is not set. Google OAuth tokens and invite data use ephemeral .sessions under the app directory and will be lost on redeploy.",
    );
  }

  const fe = String(requiredEnv.FRONTEND_URL || "").trim();
  if (fe.startsWith("http://")) {
    const loopbackOk = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(fe);
    if (!loopbackOk) {
      warnings.push("FRONTEND_URL uses http:// for a non-loopback host; use https behind TLS in production.");
    }
  }

  const redirect = String(requiredEnv.GOOGLE_REDIRECT_URI || "").trim();
  if (redirect.startsWith("http://")) {
    const loopbackOk = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(redirect);
    if (!loopbackOk) {
      warnings.push("GOOGLE_REDIRECT_URI uses http:// for a non-loopback host; Google OAuth should use https in production.");
    }
  }

  if (!envConfigured()) {
    warnings.push(
      `Google workspace env is not configured (missing: ${collectMissingGoogleEnvKeys().join(", ") || "GOOGLE_*"}). API health and Master login still work; Drive/Sheets routes return 503 until configured.`,
    );
  }

  return { isProduction: true, blockingIssues, warnings };
}

function assertSafeProductionBoot() {
  const evaluation = evaluateProductionEnvironment();
  for (const w of evaluation.warnings) {
    console.warn(`[api][production] ${w}`);
  }
  if (evaluation.isProduction && evaluation.blockingIssues.length > 0) {
    console.error("[api] Refusing to start API in production with blocking configuration issues:");
    for (const issue of evaluation.blockingIssues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }
}

function sessionStoreWritable() {
  try {
    fs.accessSync(sessionDir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function smtpStartupLogPayload() {
  const config = smtpConfigSummary();
  const diag = smtpCredentialDiagnostics();
  if (isProductionRuntime()) {
    return {
      smtpConfigured: emailConfigured(),
      hostSet: Boolean(config.host),
      port: config.port,
      secure: config.secure,
      fromSet: Boolean(config.from),
      passwordProvided: diag.passwordProvided,
    };
  }
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    from: config.from,
    ...diag,
  };
}

function resolveBuildGitSha() {
  const full = String(process.env.RENDER_GIT_COMMIT || process.env.BERT_BUILD_GIT_SHA || "").trim();
  if (!full) {
    return { gitSha: "", shortSha: "" };
  }
  return { gitSha: full, shortSha: full.length > 12 ? full.slice(0, 7) : full };
}

function getHealthPayload() {
  const googleOk = envConfigured();
  const googleOAuthConnected = googleOAuthStore.hasTokens();
  const build = resolveBuildGitSha();
  return {
    ok: true,
    service: "bert-api",
    version: APP_VERSION,
    gitSha: build.gitSha || undefined,
    shortSha: build.shortSha || undefined,
    environment: nodeEnvLabel(),
    /** @deprecated use googleConfigured */
    configured: googleOk,
    googleConfigured: googleOk,
    googleEnvConfigured: googleOk,
    googleOAuthConnected,
    sharedDriveConfigured: Boolean(requiredEnv.GOOGLE_SHARED_DRIVE_ID),
    sessionsDirConfigured: googleOAuthStore.sessionsDirConfigured,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

function getReadinessPayload() {
  const evaluation = evaluateProductionEnvironment();
  const writable = sessionStoreWritable();
  const googleOk = envConfigured();
  const googleOAuthConnected = googleOAuthStore.hasTokens();
  const productionOk = !evaluation.isProduction || evaluation.blockingIssues.length === 0;
  const ready = writable && productionOk;
  const build = resolveBuildGitSha();
  return {
    ok: ready,
    ready,
    service: "bert-api",
    version: APP_VERSION,
    gitSha: build.gitSha || undefined,
    shortSha: build.shortSha || undefined,
    environment: nodeEnvLabel(),
    googleConfigured: googleOk,
    googleEnvConfigured: googleOk,
    googleOAuthConnected,
    sessionsDirConfigured: googleOAuthStore.sessionsDirConfigured,
    checks: {
      googleConfigured: googleOk,
      googleEnvConfigured: googleOk,
      googleOAuthConnected,
      sessionStoreWritable: writable,
      productionEnvOk: productionOk,
    },
    missingGoogleKeys: googleOk ? [] : collectMissingGoogleEnvKeys(),
    warnings: evaluation.warnings,
    errors: evaluation.blockingIssues,
  };
}

function collectMissingGoogleEnvKeys() {
  const missing = [];
  if (!requiredEnv.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!requiredEnv.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!requiredEnv.GOOGLE_REDIRECT_URI) missing.push("GOOGLE_REDIRECT_URI");
  if (!requiredEnv.GOOGLE_SHARED_DRIVE_ID) missing.push("GOOGLE_SHARED_DRIVE_ID");
  return missing;
}

function readStoredSession() {
  return googleOAuthStore.readSession();
}

function getGoogleConnectedEmail() {
  const session = readStoredSession();
  return String(session?.profile?.email || "").trim().toLowerCase();
}

function writeStoredSession(payload, options = {}) {
  googleOAuthStore.writeSession(payload);
  if (options.log !== false) {
    googleOAuthStore.logStorageState(options.logContext || "token_saved");
  }
}

function clearStoredSession(reason = "unspecified") {
  googleOAuthStore.clearSession();
  googleOAuthStore.logStorageState(`token_cleared reason=${reason}`);
}

installSetupStatusRoutes(app, {
  sessionDir,
  getReadinessPayload,
  getHealthPayload,
  emailConfigured,
  hasGoogleSession: () => googleOAuthStore.hasTokens(),
  getSharedDriveId: () => requiredEnv.GOOGLE_SHARED_DRIVE_ID,
});

installCompanyAreasRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  getConfig,
  updateConfig,
  ensureColumns,
  getTabValues,
  rowsToRecords,
  withSheetsQuotaRetry,
});

installCompanyAuditMappingRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  ensureColumns,
  getTabValues,
  rowsToRecords,
  withSheetsQuotaRetry,
});

function signedStateCookie(value) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    signed: true,
    maxAge: 10 * 60 * 1000,
  };
}

function sendCallbackPage(res, options) {
  const {
    title,
    message,
    success,
    redirectUrl = "http://127.0.0.1:4173/",
  } = options;

  res
    .status(success ? 200 : 500)
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta http-equiv="refresh" content="2;url=${redirectUrl}" />
    <style>
      body {
        margin: 0;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        max-width: 460px;
        width: 100%;
        background: rgba(15, 23, 42, 0.86);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p {
        margin: 0;
        line-height: 1.6;
        color: #cbd5e1;
      }
      a {
        color: #93c5fd;
      }
      .pill {
        display: inline-block;
        margin-bottom: 16px;
        padding: 6px 12px;
        border-radius: 999px;
        background: ${success ? "rgba(29,78,216,0.18)" : "rgba(245,158,11,0.14)"};
        color: ${success ? "#93c5fd" : "#fcd34d"};
        font-size: 12px;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="pill">${success ? "Google connected" : "Connection issue"}</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <p style="margin-top:16px;"><a href="${redirectUrl}">Return to ${APP_BRAND_NAME}</a></p>
    </div>
  </body>
</html>`);
}

function getAuthedClient() {
  const session = readStoredSession();
  if (!session?.tokens) {
    return null;
  }
  const auth = createOAuthClient();
  auth.setCredentials(session.tokens);
  auth.on("tokens", (tokens) => {
    try {
      const current = readStoredSession() || session;
      writeStoredSession(
        {
          ...current,
          tokens: { ...current.tokens, ...tokens },
        },
        { log: false },
      );
    } catch (error) {
      console.warn("[google-oauth] unable to persist refreshed tokens", {
        message: error instanceof Error ? error.message : "write failed",
      });
    }
  });
  return auth;
}

/**
 * Pilot: require stored Google OAuth on the API host (Drive/Sheets service identity).
 * Not end-user SSO. Use only where the SPA already expects Google (see docs/security-hardening-plan.md).
 */
function requireGoogleWorkspaceEnv(req, res, next) {
  if (!envConfigured()) {
    return sendGoogleWorkspaceUnavailable(res);
  }
  return next();
}

function requireGoogleWorkspaceSession(req, res, next) {
  if (!envConfigured()) {
    return sendGoogleWorkspaceUnavailable(res);
  }
  if (!getAuthedClient()) {
    return res.status(401).json({ ok: false, error: "Google connection required for this action." });
  }
  return next();
}

installGoogleFormTemplateRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  withSheetsQuotaRetry,
  requiredEnv,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  getCompanyFolderStructureDeps: () => ({
    google,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    getTabValues,
    withSheetsQuotaRetry,
    safeLower,
  }),
});

installCompanyFormsRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  rejectIfCompanyFolderNotUnderCompaniesRoot,
  parseBertActorFromRequest,
  sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  getWorkbook,
  ensureTabExists,
  ensureColumns,
  getTabValues,
  withSheetsQuotaRetry,
  safeLower,
});

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function buildOnboardingFormViewUrl(formId) {
  const clean = String(formId || "").trim();
  if (!clean) return "";
  if (clean.startsWith("1FAIpQL")) {
    return `https://docs.google.com/forms/d/e/${clean}/viewform`;
  }
  return `https://docs.google.com/forms/d/${clean}/viewform`;
}

function emailConfigured() {
  return Boolean(
    requiredEnv.SMTP_HOST &&
      requiredEnv.SMTP_PORT &&
      requiredEnv.SMTP_USER &&
      requiredEnv.SMTP_PASS &&
      requiredEnv.SMTP_FROM_EMAIL,
  );
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function smtpConfigSummary() {
  const port = Number(requiredEnv.SMTP_PORT || 0);
  const secure = parseBooleanEnv(requiredEnv.SMTP_SECURE, port === 465);
  return {
    host: requiredEnv.SMTP_HOST || "",
    port,
    secure,
    user: requiredEnv.SMTP_USER || "",
    from: requiredEnv.SMTP_FROM_EMAIL || "",
  };
}

function smtpCredentialDiagnostics() {
  const pass = String(requiredEnv.SMTP_PASS || "");
  return {
    passwordProvided: pass.length > 0,
    passwordLength: pass.length,
    userLooksEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requiredEnv.SMTP_USER || ""),
    fromLooksEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requiredEnv.SMTP_FROM_EMAIL || ""),
    userMatchesFrom:
      safeLower(requiredEnv.SMTP_USER || "") === safeLower(requiredEnv.SMTP_FROM_EMAIL || ""),
  };
}

function createSmtpTransport() {
  const config = smtpConfigSummary();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.port === 587,
    auth: {
      user: requiredEnv.SMTP_USER,
      pass: requiredEnv.SMTP_PASS,
    },
  });
}

let smtpVerificationState = {
  checkedAt: "",
  ok: false,
  error: "Not checked",
};

async function verifySmtpTransport() {
  if (!emailConfigured()) {
    smtpVerificationState = {
      checkedAt: new Date().toISOString(),
      ok: false,
      error: "SMTP is not configured.",
    };
    return smtpVerificationState;
  }
  try {
    const transporter = createSmtpTransport();
    await transporter.verify();
    smtpVerificationState = {
      checkedAt: new Date().toISOString(),
      ok: true,
      error: "",
    };
  } catch (error) {
    smtpVerificationState = {
      checkedAt: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : "SMTP verification failed.",
    };
  }
  return smtpVerificationState;
}

function buildOnboardingInviteMailto({ toEmail, inviteRole, invitedBy, onboardingFormUrl }) {
  const subject = `${APP_BRAND_NAME} ${inviteRole} onboarding`;
  const body = [
    `You have been invited to ${APP_BRAND_NAME} as ${inviteRole}.`,
    "",
    `Invited by: ${invitedBy}`,
    "",
    "Complete your onboarding form:",
    onboardingFormUrl,
  ].join("\n");
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function sendOnboardingInviteEmail({
  toEmail,
  inviteRole,
  invitedBy,
  onboardingFormUrl,
  companyFolderId = "",
}) {
  if (
    guardDemoOutboundEmail({
      channel: "onboarding-invite",
      toEmail,
      companyFolderId,
    }).suppressed
  ) {
    return;
  }
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.");
  }

  const transporter = createSmtpTransport();

  const lineManagerRule =
    inviteRole === "Admin"
      ? "Line manager can be left blank for Admin users."
      : "Line manager should be provided where applicable.";
  const requiredFields = [
    "Full name",
    "Job title",
    "Site based",
    "Mobile number",
    "Role / job title",
    "Line manager",
    "Information correct confirmation (Yes/No)",
  ];

  const textBody = [
    `You have been invited to ${APP_BRAND_NAME} as ${inviteRole}.`,
    "",
    `Invited by: ${invitedBy}`,
    "",
    "Complete your onboarding form:",
    onboardingFormUrl,
    "",
    "The form will collect:",
    ...requiredFields.map((field) => `- ${field}`),
    "",
    lineManagerRule,
    "",
    "After submission, your details will populate the Users tab in the Company Master Sheet.",
  ].join("\n");

  const htmlBody = `
    <p>You have been invited to ${APP_BRAND_NAME} as <strong>${inviteRole}</strong>.</p>
    <p><strong>Invited by:</strong> ${invitedBy}</p>
    <p>Complete your onboarding form:</p>
    <p><a href="${onboardingFormUrl}">${onboardingFormUrl}</a></p>
    <p>The form will collect:</p>
    <ul>
      ${requiredFields.map((field) => `<li>${field}</li>`).join("")}
    </ul>
    <p>${lineManagerRule}</p>
    <p>After submission, your details will populate the Users tab in the Company Master Sheet.</p>
  `;

  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: `${APP_BRAND_NAME} ${inviteRole} onboarding`,
    text: textBody,
    html: htmlBody,
  });
}

async function sendManagerNonComplianceAlertEmail({
  recipients,
  auditName,
  submittedBy,
  nonComplianceCount,
  queuedForSync,
  companyFolderId = "",
}) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.");
  }
  if (
    (recipients || []).some((email) =>
      guardDemoOutboundEmail({
        channel: "manager-non-compliance-alert",
        toEmail: email,
        companyFolderId,
      }).suppressed,
    )
  ) {
    return { suppressed: true };
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("At least one manager recipient is required.");
  }

  const transporter = createSmtpTransport();

  const syncLine = queuedForSync
    ? "Submission status: queued offline and will sync once the device reconnects."
    : "Submission status: received and marked for sync.";

  const textBody = [
    "Manager alert: non-compliance submitted.",
    "",
    `Audit: ${auditName}`,
    `Submitted by: ${submittedBy}`,
    `Non-compliance items: ${nonComplianceCount}`,
    syncLine,
    "",
    "Please review and take any required management action.",
  ].join("\n");

  const htmlBody = `
    <p><strong>Manager alert:</strong> non-compliance submitted.</p>
    <p><strong>Audit:</strong> ${auditName}<br />
    <strong>Submitted by:</strong> ${submittedBy}<br />
    <strong>Non-compliance items:</strong> ${nonComplianceCount}<br />
    <strong>${syncLine}</strong></p>
    <p>Please review and take any required management action.</p>
  `;

  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;

  await transporter.sendMail({
    from,
    to: recipients.join(", "),
    subject: `Manager alert: non-compliance in ${auditName}`,
    text: textBody,
    html: htmlBody,
  });
}

async function sendNcrEscalationEmail({
  toEmail,
  ncrReference,
  auditorName,
  site,
  raisedAt,
  auditQuestion,
  selectedAnswer,
  investigationLink,
  companyFolderId = "",
}) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.");
  }
  if (
    guardDemoOutboundEmail({
      channel: "ncr-escalation",
      toEmail,
      companyFolderId,
    }).suppressed
  ) {
    return { suppressed: true };
  }
  const transporter = createSmtpTransport();

  const subject = `[${ncrReference}] Non-Conformance Raised`;
  const textBody = [
    `${ncrReference} Non-Conformance Raised`,
    "",
    `NCR reference number: ${ncrReference}`,
    `Auditor name: ${auditorName}`,
    `Site: ${site}`,
    `Date and time raised: ${raisedAt}`,
    `Audit question: ${auditQuestion}`,
    `Selected answer: ${selectedAnswer}`,
    `Open NCR investigation form: ${investigationLink}`,
  ].join("\n");
  const htmlBody = `
    <p><strong>${ncrReference}</strong> Non-Conformance Raised</p>
    <p><strong>NCR reference number:</strong> ${ncrReference}<br />
    <strong>Auditor name:</strong> ${auditorName}<br />
    <strong>Site:</strong> ${site}<br />
    <strong>Date and time raised:</strong> ${raisedAt}<br />
    <strong>Audit question:</strong> ${auditQuestion}<br />
    <strong>Selected answer:</strong> ${selectedAnswer}</p>
    <p><a href="${investigationLink}">Open NCR investigation form</a></p>
  `;
  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;

  await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

async function sendIncidentReportEmail({
  incidentId,
  incidentType,
  severity,
  reporter,
  department,
  location,
  status,
  incidentDate,
  incidentTime,
  priority,
  escalated,
  viewLink,
}) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.");
  }
  const transporter = createSmtpTransport();
  const to = APP_SUPPORT_EMAIL;
  const subject = `New Incident Report - ${incidentId}${escalated ? " [ESCALATED]" : ""}`;
  const lines = [
    "A new accident / near miss report has been submitted.",
    "",
    `Incident Number: ${incidentId}`,
    `Incident Type: ${incidentType}`,
    `Severity: ${severity}`,
    `Reporter: ${reporter}`,
    `Department / Area: ${department}`,
    `Location: ${location}`,
    `Status: ${status}`,
    `Date and Time: ${incidentDate} ${incidentTime || ""}`.trim(),
    `Priority: ${priority}`,
    viewLink ? `View link: ${viewLink}` : "",
    "",
    escalated
      ? "Escalation: High severity incident. Immediate management review required."
      : "Escalation: Not required.",
  ].filter(Boolean);
  const textBody = lines.join("\n");
  const htmlBody = `
    <p>A new accident / near miss report has been submitted.</p>
    <p>
      <strong>Incident Number:</strong> ${incidentId}<br/>
      <strong>Incident Type:</strong> ${incidentType}<br/>
      <strong>Severity:</strong> ${severity}<br/>
      <strong>Reporter:</strong> ${reporter}<br/>
      <strong>Department / Area:</strong> ${department}<br/>
      <strong>Location:</strong> ${location}<br/>
      <strong>Status:</strong> ${status}<br/>
      <strong>Date and Time:</strong> ${incidentDate} ${incidentTime || ""}<br/>
      <strong>Priority:</strong> ${priority}
    </p>
    ${viewLink ? `<p><a href="${viewLink}">Open incident in app</a></p>` : ""}
    <p>${escalated ? "<strong>Escalation:</strong> High severity incident. Immediate management review required." : "Escalation: Not required."}</p>
  `;
  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;
  await transporter.sendMail({
    from,
    to,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

async function sendReportPackEmail({ title, html, recipients = [], workspaceName, createdBy, companyFolderId = "" }) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.");
  }
  const toList = Array.isArray(recipients)
    ? recipients.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (!toList.length) {
    throw new Error("Select at least one recipient before emailing this report.");
  }
  if (
    toList.some((email) =>
      guardDemoOutboundEmail({
        channel: "report-pack",
        toEmail: email,
        companyFolderId,
        companyName: workspaceName,
      }).suppressed,
    )
  ) {
    return { suppressed: true, recipientCount: 0 };
  }
  const reportTitle = String(title || "BERT report").trim() || "BERT report";
  const transporter = createSmtpTransport();
  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;
  const subject = `${reportTitle}${workspaceName ? ` — ${workspaceName}` : ""}`;
  const textBody = [
    `${reportTitle}`,
    workspaceName ? `Workspace: ${workspaceName}` : "",
    createdBy ? `Created by: ${createdBy}` : "",
    "",
    "Open the HTML version of this email to view the full report pack.",
  ]
    .filter(Boolean)
    .join("\n");
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:720px;">
      <p style="color:#475569;font-size:12px;margin:0 0 16px;">
        ${workspaceName ? `Workspace: <strong>${workspaceName}</strong><br/>` : ""}
        ${createdBy ? `Created by: <strong>${createdBy}</strong>` : ""}
      </p>
      ${html}
      <p style="margin-top:24px;font-size:12px;color:#64748b;">Sent from ${APP_BRAND_NAME}.</p>
    </div>
  `;
  await transporter.sendMail({
    from,
    to: toList.join(", "),
    subject,
    text: textBody,
    html: htmlBody,
  });
  return { recipientCount: toList.length };
}

function pickValue(record, matchers) {
  const entries = Object.entries(record || {});

  for (const [key, value] of entries) {
    const normalizedKey = safeLower(key);
    if (!value) {
      continue;
    }

    if (matchers.some((matcher) => matcher(normalizedKey))) {
      return String(value).trim();
    }
  }

  return "";
}

function normalizeOnboardingRecord(row, index) {
  const companyName =
    pickValue(row, [
      (key) => key.includes("company name"),
      (key) => key.includes("organisation"),
      (key) => key.includes("organization"),
      (key) => key.includes("business name"),
      (key) => key === "company",
      (key) => key === "client",
    ]) || `Submission ${index + 1}`;

  return {
    id: `onboarding-${index + 1}`,
    submittedAt:
      pickValue(row, [(key) => key === "timestamp", (key) => key.includes("submitted")]) || "",
    companyName,
    siteName: pickValue(row, [
      (key) => key.includes("site name"),
      (key) => key === "site",
      (key) => key.includes("location"),
    ]),
    mainContact: pickValue(row, [
      (key) => key.includes("main contact"),
      (key) => key.includes("primary contact"),
      (key) => key === "contact name",
    ]),
    contactEmail: pickValue(row, [
      (key) => key.includes("contact email"),
      (key) => key === "email address",
      (key) => key === "email",
    ]),
    reportingContact: pickValue(row, [
      (key) => key.includes("reporting contact"),
      (key) => key.includes("manager"),
      (key) => key.includes("reports to"),
    ]),
    auditRecipients: pickValue(row, [
      (key) => key.includes("audit recipients"),
      (key) => key.includes("audit recipient"),
      (key) => key.includes("audit distribution"),
    ]),
    overdueAlertRecipients: pickValue(row, [
      (key) => key.includes("overdue alert"),
      (key) => key.includes("escalation"),
      (key) => key.includes("alert recipients"),
    ]),
    companyFolderReference: pickValue(row, [
      (key) => key.includes("folder"),
      (key) => key.includes("drive reference"),
      (key) => key.includes("company code"),
    ]),
    raw: row,
  };
}

async function discoverOnboardingSource(auth) {
  const drive = google.drive({ version: "v3", auth });
  const resolved = {
    formId: requiredEnv.GOOGLE_ONBOARDING_FORM_ID,
    formName: "QMS Company Onboarding Form",
    sheetId: requiredEnv.GOOGLE_ONBOARDING_SHEET_ID,
    sheetName: "QMS Company Onboarding Responses",
    configured: Boolean(requiredEnv.GOOGLE_ONBOARDING_FORM_ID || requiredEnv.GOOGLE_ONBOARDING_SHEET_ID),
  };

  if (resolved.formId && resolved.sheetId) {
    return resolved;
  }

  const masterControlSearch = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${requiredEnv.GOOGLE_SHARED_DRIVE_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 100,
    orderBy: "name_natural",
  });

  const masterControl =
    (masterControlSearch.data.files || []).find((file) => safeLower(file.name).includes("master control")) ||
    null;

  if (!masterControl) {
    const fallbackSearch = await drive.files.list({
      corpora: "drive",
      driveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: "trashed = false and (mimeType = 'application/vnd.google-apps.form' or mimeType = 'application/vnd.google-apps.spreadsheet')",
      fields: "files(id,name,mimeType)",
      pageSize: 200,
      orderBy: "name_natural",
    });
    const fallbackFiles = fallbackSearch.data.files || [];
    const onboardingForm = fallbackFiles.find(
      (file) =>
        file.mimeType === "application/vnd.google-apps.form" &&
        safeLower(file.name).includes("onboarding"),
    );
    const onboardingSheet = fallbackFiles.find(
      (file) =>
        file.mimeType === "application/vnd.google-apps.spreadsheet" &&
        safeLower(file.name).includes("onboarding"),
    );
    return {
      formId: resolved.formId || onboardingForm?.id || "",
      formName: onboardingForm?.name || resolved.formName,
      sheetId: resolved.sheetId || onboardingSheet?.id || "",
      sheetName: onboardingSheet?.name || resolved.sheetName,
      configured: Boolean(resolved.formId || resolved.sheetId || onboardingForm || onboardingSheet),
    };
  }

  const contents = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${masterControl.id}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 100,
  });

  const files = contents.data.files || [];
  const onboardingForm = files.find(
    (file) =>
      file.mimeType === "application/vnd.google-apps.form" &&
      safeLower(file.name).includes("onboarding"),
  );
  const onboardingSheet = files.find(
    (file) =>
      file.mimeType === "application/vnd.google-apps.spreadsheet" &&
      safeLower(file.name).includes("onboarding"),
  );

  return {
    formId: resolved.formId || onboardingForm?.id || "",
    formName: onboardingForm?.name || resolved.formName,
    sheetId: resolved.sheetId || onboardingSheet?.id || "",
    sheetName: onboardingSheet?.name || resolved.sheetName,
    configured: Boolean(resolved.formId || resolved.sheetId || onboardingForm || onboardingSheet),
  };
}

async function readOnboardingSubmissions(auth, onboardingSource) {
  if (!onboardingSource?.sheetId) {
    return {
      headers: [],
      records: [],
    };
  }

  const sheets = google.sheets({ version: "v4", auth });
  const workbook = await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId: onboardingSource.sheetId,
      fields: "sheets(properties(title))",
    }),
  );

  const firstTab = workbook.data.sheets?.[0]?.properties?.title;
  const range = firstTab ? `${firstTab}!A1:ZZ500` : "A1:ZZ500";
  const valuesResponse = await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: onboardingSource.sheetId,
      range,
    }),
  );

  const rows = valuesResponse.data.values || [];
  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((value, index) => String(value || `Column ${index + 1}`).trim());
  const records = rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const record = headers.reduce((accumulator, header, headerIndex) => {
        accumulator[header] = String(row[headerIndex] || "").trim();
        return accumulator;
      }, {});

      return normalizeOnboardingRecord(record, index);
    })
    .reverse();

  return {
    headers,
    records,
  };
}

function readInviteStore() {
  try {
    const raw = fs.readFileSync(INVITE_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeInviteStore(store) {
  try {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    fs.writeFileSync(INVITE_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot write invite store (${INVITE_STORE_PATH}): ${msg}`);
  }
}

function createInviteRecord(payload) {
  const store = readInviteStore();
  const id = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const record = {
    ...payload,
    createdAt: now,
    expiresAt: now + ONBOARDING_INVITE_TTL_MS,
    consumedAt: null,
    provisionStatus: payload.provisionStatus ?? "idle",
    provisionStartedAt: payload.provisionStartedAt ?? null,
    provisionFinishedAt: payload.provisionFinishedAt ?? null,
    provisionError: payload.provisionError ?? null,
    provisionDriveFolderId: payload.provisionDriveFolderId ?? null,
    provisionMasterSheetId: payload.provisionMasterSheetId ?? null,
  };
  store[id] = record;
  writeInviteStore(store);
  return { id, record };
}

function getInviteRecord(id) {
  const store = readInviteStore();
  return store[id] || null;
}

function findCompanyUserInviteForResend({ email, masterSheetId, tokenId }) {
  const store = readInviteStore();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSheetId = String(masterSheetId || "").trim();
  const requestedTokenId = String(tokenId || "").trim();

  if (requestedTokenId && store[requestedTokenId]) {
    const record = store[requestedTokenId];
    if (
      record.kind === "company_user" &&
      !record.consumedAt &&
      Date.now() <= record.expiresAt &&
      String(record.email || "").trim().toLowerCase() === normalizedEmail
    ) {
      return { id: requestedTokenId, record };
    }
  }

  let best = null;
  for (const [id, record] of Object.entries(store)) {
    if (record.kind !== "company_user") continue;
    if (String(record.email || "").trim().toLowerCase() !== normalizedEmail) continue;
    if (String(record.masterSheetId || "").trim() !== normalizedSheetId) continue;
    if (record.consumedAt) continue;
    if (Date.now() > record.expiresAt) continue;
    if (!best || Number(record.createdAt) > Number(best.record.createdAt)) {
      best = { id, record };
    }
  }
  return best;
}

function revokeInviteRecord(id) {
  const store = readInviteStore();
  if (!store[id]) {
    return false;
  }
  delete store[id];
  writeInviteStore(store);
  return true;
}

function listCompanyUserInviteRecords() {
  const store = readInviteStore();
  return Object.entries(store)
    .filter(([, record]) => record.kind === "company_user")
    .map(([id, record]) => ({ id, ...record }));
}

function buildInvitePermissionSession(actor) {
  if (!actor) {
    return {};
  }
  if (actor.kind === "master" || actor.role === "Master") {
    return { kind: "master", role: "Master" };
  }
  return {
    kind: "company",
    role: actor.role,
    accessLevel: actor.accessLevel,
    companyId: actor.companyId,
    companyFolderId: actor.companyId,
  };
}

function publicCompanyUserInviteListItem({ id, record }) {
  return {
    id,
    tokenId: id,
    inviteType: COMPANY_USER_INVITE_TYPE,
    kind: "company_user",
    email: record.email || "",
    role: record.role || "",
    invitedBy: record.invitedBy || "",
    companyId: record.companyId || record.companyFolderId || "",
    companyFolderId: record.companyFolderId || record.companyId || "",
    companyName: record.companyName || "",
    masterSheetId: record.masterSheetId || "",
    status: record.consumedAt ? "active" : record.status || "PENDING",
    loginReady: record.provisionStatus === "succeeded" && Boolean(record.consumedAt),
    createdAt: record.createdAt || null,
    expiresAt: record.expiresAt || null,
    consumedAt: record.consumedAt || null,
  };
}

/** Master sheet IDs from company-user invites for this email (newest first). */
function findMasterSheetIdsForCompanyLoginEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) {
    return [];
  }
  if (isPlatformOwnerEmail(target, process.env)) {
    return [];
  }
  const store = readInviteStore();
  const matches = [];
  for (const record of Object.values(store)) {
    if (record.kind !== "company_user") {
      continue;
    }
    if (String(record.email || "").trim().toLowerCase() !== target) {
      continue;
    }
    const sheetId = String(record.masterSheetId || "").trim();
    if (!sheetId) {
      continue;
    }
    matches.push({ sheetId, createdAt: Number(record.createdAt) || 0 });
  }
  matches.sort((a, b) => b.createdAt - a.createdAt);
  const seen = new Set();
  const ordered = [];
  for (const { sheetId } of matches) {
    if (seen.has(sheetId)) {
      continue;
    }
    seen.add(sheetId);
    ordered.push(sheetId);
  }
  for (const sheetId of companyOnboardingInviteStore.findMasterSheetIdsForEmail(target)) {
    if (!ordered.includes(sheetId)) {
      ordered.push(sheetId);
    }
  }
  return ordered;
}

async function companyUserLoginReady(auth, masterSheetId, email) {
  if (!auth || !masterSheetId || !email) {
    return false;
  }
  try {
    await migrateUsersTabColumns(auth, masterSheetId, getCompanyUsersDeps());
    return workbookCompanyUserLoginReady(auth, masterSheetId, email, getCompanyUsersDeps());
  } catch {
    return false;
  }
}

async function companyUserUsersRowPresent(auth, masterSheetId, email) {
  if (!auth || !masterSheetId || !email) {
    return false;
  }
  try {
    return Boolean(await readCompanyUsersTabRecord(auth, masterSheetId, email));
  } catch {
    return false;
  }
}

/**
 * Company-user invites write to the **company master spreadsheet** (Users tab + Config UserAuth),
 * not the operator Master login sheet. `masterSheetId` on the invite is that company spreadsheet ID.
 */
async function assessCompanyUserInviteReadiness(auth, masterSheetId, email, inviteRecord = null) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const sheetId = String(masterSheetId || "").trim();
  let usersRowPresent = false;
  let userAuthPresent = false;
  try {
    await migrateUsersTabColumns(auth, sheetId, getCompanyUsersDeps());
    const rec = await readCompanyUsersTabRecord(auth, sheetId, emailNorm, getCompanyUsersDeps());
    usersRowPresent = Boolean(rec);
    userAuthPresent = Boolean(
      rec?.status === "ACTIVE" && rec?.passwordHash && isUserAuthScryptHash(rec.passwordHash),
    );
  } catch {
    usersRowPresent = false;
    userAuthPresent = false;
  }
  const tokenConsumed = Boolean(inviteRecord?.consumedAt);
  const provisionSucceeded = inviteRecord?.provisionStatus === "succeeded";

  if (userAuthPresent && usersRowPresent) {
    return {
      status: "active",
      loginReady: true,
      usersRowPresent: true,
      userAuthPresent: true,
      setupIncomplete: false,
      recoverable: false,
      storageHint:
        "Company users are stored on the company master spreadsheet (Users tab and Config UserAuth), not the operator Master sheet.",
    };
  }

  if (tokenConsumed && provisionSucceeded) {
    return {
      status: "setup_incomplete",
      loginReady: false,
      usersRowPresent,
      userAuthPresent,
      setupIncomplete: true,
      recoverable: true,
      storageHint:
        "Setup did not finish on the company sheet. Revoke or send a fresh invite, or ask the recipient to open the invite link again.",
    };
  }

  return {
    status: "awaiting_setup",
    loginReady: false,
    usersRowPresent,
    userAuthPresent,
    setupIncomplete: false,
    recoverable: true,
    storageHint:
      "After the recipient completes the invite link, check this company's master spreadsheet Users tab and Config UserAuth.<email>.",
  };
}

async function resolveCompanyUserInviteLifecycle(auth, masterSheetId, email, tokenId = "") {
  const inviteRecord = tokenId ? getInviteRecord(tokenId) : null;
  return assessCompanyUserInviteReadiness(auth, masterSheetId, email, inviteRecord);
}

function getInviteTargetDeps() {
  return {
    getConfig,
    updateConfig,
    getTabValues,
    google,
    listDriveChildren,
    normalizeDriveFolderName,
    resolveIsoFoldersFromChildren,
    readInviteStore,
    writeInviteStore,
    platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
    sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  };
}

async function validatePreparedCompanyUserInviteTarget(auth, record, tokenId = "") {
  return prepareCompanyUserInviteTarget(auth, record, {
    deps: getInviteTargetDeps(),
    patchInviteRecord: tokenId ? (partial) => patchInviteRecord(tokenId, partial) : null,
    tokenId,
  });
}

async function resolvePreparedCompanyUserInviteContext(auth, record = {}) {
  return resolveInviteCompanyContext(auth, {
    getCompanyResolverDeps: () => ({ google, ...getCompanyWorkspaceRegistryDeps() }),
    resolveCompanyFromFolder,
  }, record);
}

function markInviteConsumed(id) {
  const store = readInviteStore();
  if (!store[id]) {
    return false;
  }
  store[id] = { ...store[id], consumedAt: Date.now() };
  writeInviteStore(store);
  return true;
}

/** @typedef {"idle"|"running"|"succeeded"|"failed"} InviteProvisionStatus */

const INVITE_PROVISION_STALE_RUNNING_MS = 10 * 60 * 1000;

/**
 * Serializes invite completion per tokenId so parallel POST /complete cannot double-provision.
 * Single-process dev server only — for production use a distributed lock or transactional store.
 */
function createPerTokenAsyncQueue() {
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map();
  return async (tokenId, fn) => {
    const prev = tails.get(tokenId) || Promise.resolve();
    let release = () => {};
    const next = new Promise((resolve) => {
      release = resolve;
    });
    tails.set(
      tokenId,
      prev.then(() => next, () => next),
    );
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

const runWithInviteCompletionLock = createPerTokenAsyncQueue();

function patchInviteRecord(id, partial) {
  const store = readInviteStore();
  if (!store[id]) {
    return null;
  }
  store[id] = { ...store[id], ...partial };
  writeInviteStore(store);
  return store[id];
}

function normalizeInviteProvisionFields(record) {
  if (!record) return null;
  const provisionStatus =
    record.provisionStatus ||
    (record.consumedAt ? "succeeded" : "idle");
  return {
    ...record,
    provisionStatus,
    provisionStartedAt: record.provisionStartedAt ?? null,
    provisionFinishedAt: record.provisionFinishedAt ?? null,
    provisionError: record.provisionError ?? null,
    provisionDriveFolderId: record.provisionDriveFolderId ?? null,
    provisionMasterSheetId: record.provisionMasterSheetId ?? null,
  };
}

function buildAppOnboardingUrl(tokenId) {
  const base = requiredEnv.FRONTEND_URL.replace(/\/$/, "");
  return `${base}/invite/company-user/${encodeURIComponent(tokenId)}`;
}

function buildAppOnboardingInviteMailto({ toEmail, subjectLine, invitedBy, onboardingUrl }) {
  const body = [
    `You have been invited to complete ${APP_BRAND_NAME} onboarding.`,
    "",
    `Invited by: ${invitedBy}`,
    "",
    "Open this link to finish setup in the app:",
    onboardingUrl,
  ].join("\n");
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body)}`;
}

function getCompanyOnboardingFormUrl() {
  const configured = String(requiredEnv.BERT_COMPANY_ONBOARDING_FORM_URL || "").trim();
  return configured || DEFAULT_COMPANY_ONBOARDING_FORM_URL;
}

function getCompanyOnboardingSenderEmail() {
  return String(requiredEnv.SMTP_FROM_EMAIL || APP_SUPPORT_EMAIL || "admin@usebert.co.uk").trim();
}

function companyOnboardingDeliverabilityNote(senderEmail) {
  return `If you were expecting this invite and cannot find it later, please check your Junk or Spam folder. Emails are sent from ${senderEmail}.`;
}

function buildCompanyOnboardingEmailDraft() {
  const onboardingFormUrl = getCompanyOnboardingFormUrl();
  const senderEmail = getCompanyOnboardingSenderEmail();
  const deliverabilityNote = companyOnboardingDeliverabilityNote(senderEmail);
  const subject = "Complete your BERT company onboarding";
  const textBody = [
    "Hi,",
    "",
    "You have been invited to complete your company onboarding for BERT.",
    "",
    "Please open the secure onboarding form below and submit your company details:",
    "",
    onboardingFormUrl,
    "",
    "Once submitted, the BERT team will complete your workspace setup.",
    "",
    deliverabilityNote,
    "",
    "Thanks,",
    "BERT Admin",
  ].join("\n");
  const htmlBody = `
    <p>Hi,</p>
    <p>You have been invited to complete your company onboarding for <strong>${APP_BRAND_NAME}</strong>.</p>
    <p>Please open the secure onboarding form below and submit your company details:</p>
    <p><a href="${onboardingFormUrl}" target="_blank" rel="noopener noreferrer">Complete company onboarding form</a></p>
    <p>Once submitted, the BERT team will complete your workspace setup.</p>
    <p style="font-size:13px;color:#64748b;">${deliverabilityNote}</p>
    <p>Thanks,<br/>BERT Admin</p>
  `;
  return { subject, textBody, htmlBody, onboardingFormUrl, senderEmail };
}

function buildCompanyOnboardingMailto(toEmail) {
  const { subject, textBody } = buildCompanyOnboardingEmailDraft();
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textBody)}`;
}

async function sendCompanyOnboardingFormEmail(toEmail) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured.");
  }
  if (guardDemoOutboundEmail({ channel: "company-onboarding-form", toEmail }).suppressed) {
    return { suppressed: true };
  }
  const { subject, textBody, htmlBody, onboardingFormUrl } = buildCompanyOnboardingEmailDraft();
  const transporter = createSmtpTransport();
  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;
  await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
  return { subject, body: textBody, onboardingFormUrl };
}

function buildCompanyUserInviteEmailDraft({ companyName, inviteUrl }) {
  const senderEmail = getCompanyOnboardingSenderEmail();
  const deliverabilityNote = companyOnboardingDeliverabilityNote(senderEmail);
  const displayCompany = String(companyName || "").trim() || "your company";
  const subject = `You've been invited to join ${displayCompany} on BERT`;
  const textBody = [
    "Hi,",
    "",
    `You've been invited to join ${displayCompany} on BERT.`,
    "",
    "Set up your BERT account:",
    inviteUrl,
    "",
    deliverabilityNote,
    "",
    "Thanks,",
    "BERT Admin",
  ].join("\n");
  const htmlBody = `
    <p>Hi,</p>
    <p>You've been invited to join <strong>${displayCompany}</strong> on <strong>${APP_BRAND_NAME}</strong>.</p>
    <p><a href="${inviteUrl}" target="_blank" rel="noopener noreferrer">Set up your BERT account</a></p>
    <p style="word-break:break-all;font-size:12px;color:#64748b;">${inviteUrl}</p>
    <p style="font-size:13px;color:#64748b;">${deliverabilityNote}</p>
    <p>Thanks,<br/>BERT Admin</p>
  `;
  return { subject, textBody, htmlBody, senderEmail };
}

function buildCompanyUserInviteMailto({ toEmail, companyName, inviteUrl }) {
  const { subject, textBody } = buildCompanyUserInviteEmailDraft({ companyName, inviteUrl });
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textBody)}`;
}

async function sendCompanyUserInviteEmail({ toEmail, companyName, inviteUrl, companyFolderId = "" }) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured.");
  }
  if (
    guardDemoOutboundEmail({
      channel: "company-user-invite",
      toEmail,
      companyName,
      companyFolderId,
    }).suppressed
  ) {
    return { suppressed: true };
  }
  const { subject, textBody, htmlBody } = buildCompanyUserInviteEmailDraft({ companyName, inviteUrl });
  const transporter = createSmtpTransport();
  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;
  await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

function safeSmtpErrorSummary(err) {
  const message = err instanceof Error ? err.message : "SMTP send failed";
  return String(message).slice(0, 240);
}

function buildCompanyUserInviteApiPayload({
  emailSent,
  emailPending = false,
  toEmail,
  inviteRole,
  inviteUrl,
  tokenId,
  senderEmail,
  lifecycle,
  smtpConfigured,
  emailDraft,
  mailtoUrl,
  smtpError,
  warnings = [],
  isGodmodeActor = false,
  backgroundJobId = "",
}) {
  const userMessage = emailPending
    ? BACKGROUND_INVITE_CREATED_MESSAGE
    : emailSent
      ? INVITE_SENT_USER_MESSAGE
      : INVITE_PARTIAL_SUCCESS_USER_MESSAGE;
  return {
    ok: true,
    inviteCreated: true,
    emailSent,
    emailPending,
    backgroundEmail: emailPending,
    backgroundJobId,
    sent: emailSent,
    inviteUrl,
    userMessage,
    warnings,
    smtpConfigured,
    email: toEmail,
    role: inviteRole,
    tokenId,
    senderEmail,
    status: lifecycle.status,
    loginReady: lifecycle.loginReady,
    setupIncomplete: lifecycle.setupIncomplete,
    storageHint: lifecycle.storageHint,
    emailDraft,
    mailtoUrl,
    ...(smtpError && isGodmodeActor ? { smtpError } : {}),
  };
}

function defaultCompanyUserInviteLifecycle() {
  return {
    status: "awaiting_setup",
    loginReady: false,
    setupIncomplete: false,
    storageHint:
      "After the recipient completes the invite link, check this company's master spreadsheet Users tab and Config UserAuth.",
  };
}

async function sendAppHostedOnboardingEmail({ toEmail, subjectLine, invitedBy, onboardingUrl, htmlIntro, companyFolderId = "" }) {
  if (!emailConfigured()) {
    throw new Error("SMTP is not configured.");
  }
  if (
    guardDemoOutboundEmail({
      channel: "app-hosted-onboarding",
      toEmail,
      companyFolderId,
    }).suppressed
  ) {
    return { suppressed: true };
  }
  const transporter = createSmtpTransport();
  const from = requiredEnv.SMTP_FROM_NAME
    ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
    : requiredEnv.SMTP_FROM_EMAIL;
  const textBody = [
    `You have been invited to complete ${APP_BRAND_NAME} onboarding.`,
    "",
    `Invited by: ${invitedBy}`,
    "",
    "Open this link to finish setup in the app:",
    onboardingUrl,
  ].join("\n");
  const htmlBody = `
    <p>${htmlIntro}</p>
    <p><strong>Invited by:</strong> ${invitedBy}</p>
    <p><a href="${onboardingUrl}" target="_blank" rel="noopener noreferrer">Complete onboarding in ${APP_BRAND_NAME}</a></p>
    <p style="word-break:break-all;font-size:12px;color:#64748b;">${onboardingUrl}</p>
  `;
  await transporter.sendMail({
    from,
    to: toEmail,
    subject: subjectLine,
    text: textBody,
    html: htmlBody,
  });
}

async function createDriveFolder(auth, name, parentId) {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name",
  });
  return res.data;
}

async function createBlankSpreadsheet(auth, name, parentId) {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [parentId],
    },
    fields: "id,name",
  });
  return res.data;
}

const ISO_READINESS_FOLDERS = [
  { key: "setupFolderId", checkKey: "setupFolder", name: "01 Company Setup" },
  { key: "auditFormsFolderId", checkKey: "auditFormsFolder", name: "02 Audit Forms" },
  { key: "recordsFolderId", checkKey: "recordsFolder", name: "03 Company Records" },
  { key: "evidenceFolderId", checkKey: "evidenceFolder", name: "04 Evidence" },
  { key: "exportsFolderId", checkKey: "exportsFolder", name: "05 Exports" },
  { key: "managementNotesFolderId", checkKey: "managementNotesFolder", name: "06 Management Notes" },
];

/** Legacy Drive folder names (pre–ISO readiness) matched case-insensitively; new folders use exact ISO names. */
const ISO_FOLDER_LEGACY_ALIASES = {
  setupFolderId: ["master data sheet", "company master sheet", "master sheet"],
  auditFormsFolderId: ["audit forms", "audits", "audit form folder"],
  recordsFolderId: ["company records"],
  evidenceFolderId: ["evidence", "evidence folder"],
  exportsFolderId: ["exports", "export folder"],
  managementNotesFolderId: ["management notes", "admin notes", "notes"],
};

function normalizeDriveFolderName(value = "") {
  return safeLower(value)
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LIVE_COMPANIES_FOLDER_LABEL = "Live Companies";

function isLiveCompaniesFolderName(name = "") {
  return normalizeDriveFolderName(name) === "live companies";
}

function isReservedGodmodeCompanyFolderName(name = "") {
  const normalized = normalizeWorkspaceFolderLabel(name);
  if (isArchiveOrNonLiveWorkspaceName(name)) {
    return true;
  }
  return (
    normalized === "live companies" ||
    normalized === "master control" ||
    normalized === "companies" ||
    normalized === "company" ||
    normalized === "shared drive" ||
    normalized === "shared drive root"
  );
}

function isDisallowedGodmodeCompanyDisplayName(name = "") {
  const normalized = normalizeWorkspaceFolderLabel(name);
  return !normalized || normalized === "bert";
}

function isSelectableGodmodeCompanyFolder(folder) {
  return (
    Boolean(String(folder?.id || "").trim()) &&
    !isSystemTemplateCompany(folder) &&
    !isReservedGodmodeCompanyFolderName(folder?.name) &&
    !isDisallowedGodmodeCompanyDisplayName(folder?.name)
  );
}

async function getConfiguredWorkspaceRoot(auth) {
  return inspectConfiguredWorkspaceRoot(auth, google, requiredEnv.GOOGLE_SHARED_DRIVE_ID);
}

async function listFolderChildrenInSharedDrive(auth, parentId, pageSize = 200) {
  const root = await getConfiguredWorkspaceRoot(auth);
  if (!root.ok) {
    throw new Error(root.error || WORKSPACE_ROOT_INACCESSIBLE_ERROR);
  }
  return listFolderChildren(auth, google, root, parentId || root.id, { pageSize });
}

async function resolveLiveCompaniesFolder(auth) {
  if (!requiredEnv.GOOGLE_SHARED_DRIVE_ID) {
    throw new Error("GOOGLE_SHARED_DRIVE_ID is not configured on the server.");
  }
  const root = await getConfiguredWorkspaceRoot(auth);
  if (!root.ok) {
    throw new Error(root.error || WORKSPACE_ROOT_INACCESSIBLE_ERROR);
  }
  const topLevelFolders = (await listFolderChildren(auth, google, root, root.id)).filter(
    (item) => item.mimeType === "application/vnd.google-apps.folder",
  );
  const liveCompaniesFolder =
    topLevelFolders.find((item) => isLiveCompaniesFolderName(item.name)) || null;
  return {
    liveCompaniesFolder,
    topLevelFolders,
    workspaceRoot: root,
  };
}

async function listDriveChildren(auth, folderId) {
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
  });
  return response.data.files || [];
}

function resolveIsoFoldersFromChildren(children) {
  const foldersByKey = {};
  const folderChildren = children.filter((file) => file.mimeType === "application/vnd.google-apps.folder");
  const usedFolderIds = new Set();
  for (const folderSpec of ISO_READINESS_FOLDERS) {
    const expectedNames = [
      normalizeDriveFolderName(folderSpec.name),
      ...(ISO_FOLDER_LEGACY_ALIASES[folderSpec.key] || []).map((name) => normalizeDriveFolderName(name)),
    ];
    const match =
      folderChildren.find((file) => {
        if (usedFolderIds.has(file.id)) {
          return false;
        }
        return expectedNames.includes(normalizeDriveFolderName(file.name));
      }) || null;
    if (match?.id) {
      usedFolderIds.add(match.id);
    }
    foldersByKey[folderSpec.key] = match;
  }
  return foldersByKey;
}

export async function ensureIsoReadinessFolders(auth, companyFolderId) {
  const companyFolder = await getDriveFile(auth, companyFolderId);
  if (companyFolder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The company folder ID is missing or invalid.");
  }
  const children = await listDriveChildren(auth, companyFolderId);
  const existingByKey = resolveIsoFoldersFromChildren(children);
  const ensured = {};
  for (const folderSpec of ISO_READINESS_FOLDERS) {
    const existing = existingByKey[folderSpec.key];
    if (existing?.id) {
      ensured[folderSpec.key] = existing.id;
      continue;
    }
    const created = await createDriveFolder(auth, folderSpec.name, companyFolderId);
    ensured[folderSpec.key] = created.id;
  }
  return ensured;
}

async function provisionNewCompanyWorkspace(
  auth,
  { companyName, adminEmail, adminFullName, password },
  onProvisionProgress,
) {
  if (!requiredEnv.GOOGLE_SHARED_DRIVE_ID) {
    throw new Error("GOOGLE_SHARED_DRIVE_ID is not configured on the server.");
  }
  const safeName = String(companyName || "New company")
    .trim()
    .slice(0, 120);
  const adminEmailDomain = String(adminEmail || "").includes("@")
    ? String(adminEmail)
        .split("@")
        .pop()
        ?.toLowerCase() || ""
    : "";
  console.log("[provision] new_company_workspace start", {
    companyNameLen: safeName.length,
    adminEmailDomain: adminEmailDomain || undefined,
  });
  const { liveCompaniesFolder } = await resolveLiveCompaniesFolder(auth);
  if (!liveCompaniesFolder?.id) {
    throw new Error("Live Companies folder not found. Check platform setup.");
  }
  const root = await createDriveFolder(auth, safeName, liveCompaniesFolder.id);
  console.log("[provision] milestone", { step: "company_root_folder", folderId: root.id });
  if (typeof onProvisionProgress === "function") {
    await onProvisionProgress({ provisionDriveFolderId: root.id });
  }
  const companyFolderStructureDeps = {
    google,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    getTabValues,
    withSheetsQuotaRetry,
    safeLower,
  };
  const structureBeforeSheet = await ensureCompanyFolderStructure(companyFolderStructureDeps, auth, {
    companyName: safeName,
    companyRootFolderId: root.id,
    syncWorkbookTab: false,
    placeFiles: false,
  });
  const workbookFolderId =
    structureBeforeSheet.folderIds.BERT_COMPANY_WORKBOOK || structureBeforeSheet.legacyRootIds.setupFolderId || root.id;
  const drive = google.drive({ version: "v3", auth });
  const masterSheetResult = await ensureCompanyMasterSheet(drive, {
    companyName: safeName,
    workbookFolderId,
    legacySetupFolderId: structureBeforeSheet.legacyRootIds.setupFolderId || "",
  });
  const masterSheet = { id: masterSheetResult.masterSheetId, name: masterSheetResult.masterSheetName };
  console.log("[provision] milestone", {
    step: "master_sheet_created",
    spreadsheetId: masterSheet.id,
    status: masterSheetResult.status,
  });
  if (typeof onProvisionProgress === "function") {
    await onProvisionProgress({ provisionMasterSheetId: masterSheet.id });
  }
  await ensureTabsAndColumns(auth, masterSheet.id, {
    companyId: root.id,
    companyName: safeName,
  });
  const structure = await ensureCompanyFolderStructure(companyFolderStructureDeps, auth, {
    companyName: safeName,
    companyRootFolderId: root.id,
    masterSheetId: masterSheet.id,
    syncWorkbookTab: true,
    placeFiles: true,
  });
  const isoFolders = structure.legacyFolderConfig;
  const userId = `app-${String(adminEmail || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")}`;
  await writeCompanyUsers(auth, masterSheet.id, root.id, [
    {
      id: userId,
      email: adminEmail,
      role: "Admin",
      name: adminFullName || adminEmail,
      password,
      invitedBy: APP_BRAND_NAME,
      senderEmail: "",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: "Synced",
    },
  ]);
  await updateConfig(auth, masterSheet.id, {
    ...(await getConfig(auth, masterSheet.id)),
    ...isoFolders,
    companyFolderStructureVersion: "1",
    companyFolderStructureCheckedAt: new Date().toISOString(),
  });
  console.log("[provision] new_company_workspace done", {
    companyFolderId: root.id,
    masterSheetId: masterSheet.id,
  });
  return {
    companyFolderId: root.id,
    companyFolderName: root.name,
    masterSheetId: masterSheet.id,
    folderIds: structure.folderIds,
    ...isoFolders,
  };
}

async function listCompanyFolders(auth, options = {}) {
  const parentFolderId = String(options.parentFolderId || "").trim();
  const drive = google.drive({ version: "v3", auth });
  let folders = (
    await listFolderChildrenInSharedDrive(auth, parentFolderId || requiredEnv.GOOGLE_SHARED_DRIVE_ID, 250)
  ).filter((item) => item.mimeType === "application/vnd.google-apps.folder");

  const results = await Promise.all(
    folders.map(async (folder) => {
      const files = await listDriveChildren(auth, folder.id);
      const isoFoldersByKey = resolveIsoFoldersFromChildren(files);
      const setupFolder = isoFoldersByKey.setupFolderId;
      const auditFormsFolder = isoFoldersByKey.auditFormsFolderId;

      let auditFolderContents = [];
      if (auditFormsFolder) {
        auditFolderContents = await listDriveChildren(auth, auditFormsFolder.id);
      }

      let setupFolderContents = [];
      if (setupFolder) {
        setupFolderContents = await listDriveChildren(auth, setupFolder.id);
      }

      const bertSystemFolder = files.find(
        (file) =>
          file.mimeType === "application/vnd.google-apps.folder" &&
          normalizeDriveFolderName(file.name) === "bert system files",
      );
      let companyWorkbookContents = [];
      if (bertSystemFolder?.id) {
        const bertChildren = await listDriveChildren(auth, bertSystemFolder.id);
        const companyWorkbookFolder = bertChildren.find(
          (file) =>
            file.mimeType === "application/vnd.google-apps.folder" &&
            normalizeDriveFolderName(file.name) === "company workbook",
        );
        if (companyWorkbookFolder?.id) {
          companyWorkbookContents = await listDriveChildren(auth, companyWorkbookFolder.id);
        }
      }

      const onboardingForm =
        files.find(
          (file) =>
            file.mimeType === "application/vnd.google-apps.form" &&
            file.name?.toLowerCase().includes("onboarding"),
        ) || null;

      const companyFormsResult = await listCompanyGoogleFormsFromDrive(drive, {
        companyFolderId: folder.id,
        companyId: folder.id,
        createIfMissing: false,
      });
      const auditForms = companyFormsResult.forms.filter(
        (file) => !file.name?.toLowerCase().includes("onboarding"),
      );

      const masterSheet =
        companyWorkbookContents.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
        setupFolderContents.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
        files.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
        null;

      const responseSheet =
        files.find(
          (file) =>
            file.mimeType === "application/vnd.google-apps.spreadsheet" &&
            (file.name?.toLowerCase().includes("response") ||
              file.name?.toLowerCase().includes("audit responses") ||
              file.name?.toLowerCase().includes("data")),
        ) || null;

      const masterSheetId = masterSheet?.id || responseSheet?.id || "";

      return {
        id: folder.id,
        name: folder.name,
        linkedAt: folder.createdTime || "",
        onboardingFormName: onboardingForm?.name || "Onboarding Form",
        onboardingFormId: onboardingForm?.id || "",
        onboardingVerified: Boolean(onboardingForm),
        auditFormCount: auditForms.length,
        auditFormIds: auditForms.map((file) => file.driveFileId || file.formId),
        auditFormsVerified: auditForms.length > 0,
        responseSheetName: masterSheet?.name || responseSheet?.name || "Company Master Sheet",
        responseSheetId: masterSheetId,
        responseSheetVerified: Boolean(masterSheetId),
      };
    }),
  );

  return results;
}

async function listGodmodeLiveCompanies(auth) {
  const { liveCompaniesFolder } = await resolveLiveCompaniesFolder(auth);
  if (!liveCompaniesFolder?.id) {
    return {
      liveCompaniesFolderId: "",
      liveCompaniesMissing: true,
      warning: "Live Companies folder not found. Check platform setup.",
      companies: [],
    };
  }

  const registryDeps = getCompanyWorkspaceRegistryDeps();
  const { map: registryMap } = await readCanonicalCompanyWorkspaceRegistryMap(auth, registryDeps).catch(() => ({
    map: new Map(),
  }));

  const driveCompanies = (await listCompanyFolders(auth, { parentFolderId: liveCompaniesFolder.id })).filter(
    (company) => isSelectableGodmodeCompanyFolder(company),
  );
  const companiesById = new Map();
  for (const company of driveCompanies) {
    companiesById.set(String(company.id || "").trim(), company);
  }
  // Keep linked registry workspaces visible in the picker even if folder placement drifted,
  // so operators can select folder-first companies without requiring registry LIVE.
  for (const record of registryMap.values()) {
    if (!isGodmodeListableRegistryRecord(record)) {
      continue;
    }
    const companyId = String(record?.companyId || record?.rootFolderId || record?.companyFolderId || "").trim();
    if (!companyId || companiesById.has(companyId)) {
      continue;
    }
    const fallbackCompany = buildGodmodeRegistryFallbackCompany(record);
    if (!isSelectableGodmodeCompanyFolder(fallbackCompany)) {
      continue;
    }
    companiesById.set(companyId, fallbackCompany);
  }
  const companies = Array.from(companiesById.values());
  return {
    liveCompaniesFolderId: liveCompaniesFolder.id,
    liveCompaniesMissing: false,
    warning: "",
    companies: companies.map((company) => {
      const registryMatch = findCompanyWorkspaceRegistryRecordInMap(registryMap, {
        companyId: company.id,
        companyFolderId: company.id,
        masterSheetId: company.masterSheetId || company.responseSheetId || "",
        companyName: company.name,
      });
      const registryRecord = registryMatch?.record || null;
      const merged = mergeDriveCompanyWithRegistry(company, registryRecord);
      const masterSheetId = String(merged.masterSheetId || merged.responseSheetId || "").trim();
      const setupStatus = masterSheetId ? "ready" : "incomplete";
      const setupStatusLabel =
        merged.setupStatusLabel ||
        (setupStatus === "ready" ? "Ready" : "Setup in progress");
      return {
        ...merged,
        setupStatus,
        setupStatusLabel,
        masterSheetId,
        registryLinkMissing: !registryRecord,
      };
    }),
  };
}

function getCompanyWorkspaceRegistryDeps() {
  return {
    google,
    getWorkbook,
    ensureTabExists,
    ensureColumns,
    getTabValues,
    withSheetsQuotaRetry,
    safeLower,
    sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
    platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
    sessionDir,
  };
}

async function getDriveFile(auth, fileId) {
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: "id,name,mimeType,createdTime",
  });
  return response.data;
}

async function listFormsInFolder(auth, folderId) {
  const folder = await getDriveFile(auth, folderId);

  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The provided Google Drive ID is not a folder.");
  }

  const drive = google.drive({ version: "v3", auth });
  const forms = await listGoogleFormsInFolderTree(drive, folderId);

  return {
    folder,
    forms,
  };
}

async function inspectCompanyFolder(auth, folderId) {
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  const folderResponse = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: "id,name,mimeType,createdTime",
  });

  const folder = folderResponse.data;
  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The provided Google Drive ID is not a folder.");
  }

  const children = await listDriveChildren(auth, folderId);
  const isoFoldersByKey = resolveIsoFoldersFromChildren(children);
  const auditFormsFolder = isoFoldersByKey.auditFormsFolderId;
  const setupFolder = isoFoldersByKey.setupFolderId;
  const recordsFolder = isoFoldersByKey.recordsFolderId;
  const evidenceFolder = isoFoldersByKey.evidenceFolderId;
  const exportsFolder = isoFoldersByKey.exportsFolderId;
  const managementNotesFolder = isoFoldersByKey.managementNotesFolderId;

  let auditFolderContents = [];
  if (auditFormsFolder) {
    auditFolderContents = await listDriveChildren(auth, auditFormsFolder.id);
  }

  let setupFolderContents = [];
  if (setupFolder) {
    setupFolderContents = await listDriveChildren(auth, setupFolder.id);
  }

  const bertSystemFolder = children.find(
    (file) =>
      file.mimeType === "application/vnd.google-apps.folder" &&
      normalizeDriveFolderName(file.name) === "bert system files",
  );
  let companyWorkbookContents = [];
  if (bertSystemFolder?.id) {
    const bertChildren = await listDriveChildren(auth, bertSystemFolder.id);
    const companyWorkbookFolder = bertChildren.find(
      (file) =>
        file.mimeType === "application/vnd.google-apps.folder" &&
        normalizeDriveFolderName(file.name) === "company workbook",
    );
    if (companyWorkbookFolder?.id) {
      companyWorkbookContents = await listDriveChildren(auth, companyWorkbookFolder.id);
    }
  }

  const masterSheet =
    companyWorkbookContents.find(
      (file) => file.mimeType === "application/vnd.google-apps.spreadsheet",
    ) ||
    setupFolderContents.find(
      (file) => file.mimeType === "application/vnd.google-apps.spreadsheet",
    ) ||
    children.find(
      (file) => file.mimeType === "application/vnd.google-apps.spreadsheet",
    ) ||
    null;

  let masterSheetTabs = [];
  if (masterSheet?.id) {
    const workbook = await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId: masterSheet.id,
        fields: "sheets(properties(title))",
      }),
    );

    masterSheetTabs =
      workbook.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) || [];
  }

  const companyFormsResult = await listCompanyGoogleFormsFromDrive(drive, {
    companyFolderId: folderId,
    companyId: folderId,
    masterSheetId: masterSheet?.id || "",
    createIfMissing: false,
  });

  const auditForms = companyFormsResult.forms.map((form) => ({
    id: form.driveFileId || form.formId,
    name: form.name,
  }));

  return {
    ok: true,
    folder: {
      id: folder.id,
      name: folder.name,
      createdTime: folder.createdTime || "",
    },
    checks: {
      setupFolder: Boolean(setupFolder),
      auditFormsFolder: Boolean(auditFormsFolder) || Boolean(companyFormsResult.googleFormsFolderId),
      googleFormsFolder: Boolean(companyFormsResult.googleFormsFolderId),
      recordsFolder: Boolean(recordsFolder),
      masterSheet: Boolean(masterSheet),
      evidenceFolder: Boolean(evidenceFolder),
      exportsFolder: Boolean(exportsFolder),
      managementNotesFolder: Boolean(managementNotesFolder),
    },
    auditFormsFolder: auditFormsFolder
      ? { id: auditFormsFolder.id, name: auditFormsFolder.name }
      : null,
    googleFormsFolder: companyFormsResult.googleFormsFolder || null,
    googleFormsStatus: companyFormsResult.ok
      ? companyFormsResult.formsFound > 0
        ? "found"
        : "empty"
      : companyFormsResult.status,
    googleFormsDiagnostics: companyFormsResult.diagnostics || null,
    googleFormsPermissionError: companyFormsResult.permissionError || "",
    setupFolder: setupFolder
      ? { id: setupFolder.id, name: setupFolder.name }
      : null,
    recordsFolder: recordsFolder
      ? { id: recordsFolder.id, name: recordsFolder.name }
      : null,
    masterSheet: masterSheet
      ? {
          id: masterSheet.id,
          name: masterSheet.name,
          tabs: masterSheetTabs,
        }
      : null,
    auditForms,
    companyGoogleForms: companyFormsResult.forms || [],
    blockingItems: [...(!masterSheet ? ["Company Master Sheet"] : [])],
    recommendedItems: [
      ...(!setupFolder ? ["01 Company Setup folder"] : []),
      ...(!auditFormsFolder && !companyFormsResult.googleFormsFolderId ? ["Google Forms folder"] : []),
      ...(!auditFormsFolder ? ["02 Audit Forms folder"] : []),
      ...(!recordsFolder ? ["03 Company Records folder"] : []),
      ...(!evidenceFolder ? ["04 Evidence folder"] : []),
      ...(!exportsFolder ? ["05 Exports folder"] : []),
      ...(!managementNotesFolder ? ["06 Management Notes folder"] : []),
    ],
    missingItems: [
      ...(!masterSheet ? ["Company Master Sheet"] : []),
      ...(!setupFolder ? ["01 Company Setup folder"] : []),
      ...(!auditFormsFolder && !companyFormsResult.googleFormsFolderId ? ["Google Forms folder"] : []),
      ...(!auditFormsFolder ? ["02 Audit Forms folder"] : []),
      ...(!recordsFolder ? ["03 Company Records folder"] : []),
      ...(!evidenceFolder ? ["04 Evidence folder"] : []),
      ...(!exportsFolder ? ["05 Exports folder"] : []),
      ...(!managementNotesFolder ? ["06 Management Notes folder"] : []),
    ],
    isoFolders: Object.fromEntries(
      ISO_READINESS_FOLDERS.map((folderSpec) => [folderSpec.key, isoFoldersByKey[folderSpec.key]?.id || ""]),
    ),
  };
}

function getWorkbookServiceDeps() {
  return { google, withSheetsQuotaRetry, safeLower, getWorkbook };
}

function rowsToRecords(values) {
  return workbookRowsToRecords(values);
}

function ensureSheetTab(workbook, tabName) {
  return workbook.data.sheets?.some((sheet) => safeLower(sheet.properties?.title) === safeLower(tabName));
}

function findSheetByTitle(workbook, tabName) {
  return workbook.data.sheets?.find((sheet) => safeLower(sheet.properties?.title) === safeLower(tabName));
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function toObjectArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

async function getWorkbook(auth, spreadsheetId) {
  const sheets = google.sheets({ version: "v4", auth });
  return withSheetsQuotaRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties(title),sheets(properties(sheetId,title))",
    }),
  );
}

async function getTabValues(auth, spreadsheetId, tabName, range = "A1:ZZ5000") {
  return workbookGetTabValues(auth, getWorkbookServiceDeps(), spreadsheetId, tabName, range);
}

async function createBackupSheets(auth, spreadsheetId, tabNames) {
  const workbook = await getWorkbook(auth, spreadsheetId);
  const backupRequests = tabNames
    .map((tabName) => findSheetByTitle(workbook, tabName))
    .filter(Boolean)
    .map((sheet) => ({
      duplicateSheet: {
        sourceSheetId: sheet.properties.sheetId,
        newSheetName: `${sheet.properties.title} Backup ${new Date().toISOString().replace(/[:.]/g, "-")}`.slice(0, 90),
      },
    }));

  if (backupRequests.length === 0) {
    return [];
  }

  const sheets = google.sheets({ version: "v4", auth });
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: backupRequests },
    }),
  );

  return backupRequests.map((request) => request.duplicateSheet.newSheetName);
}

/** When `existingWorkbook` is set, skips an extra spreadsheets.get for that tab check. */
async function ensureTabExists(auth, spreadsheetId, tabName, existingWorkbook = null) {
  return workbookEnsureTabExists(auth, getWorkbookServiceDeps(), spreadsheetId, tabName, existingWorkbook);
}

async function ensureColumns(auth, spreadsheetId, tabName, expectedHeaders) {
  return workbookEnsureTabColumns(auth, getWorkbookServiceDeps(), spreadsheetId, tabName, expectedHeaders);
}

async function getConfig(auth, spreadsheetId) {
  await ensureColumns(auth, spreadsheetId, "Config", TAB_COLUMNS.Config);
  const rows = rowsToRecords(await getTabValues(auth, spreadsheetId, "Config"));
  return rows.reduce((accumulator, row) => {
    const key = String(row.Key || row.key || "").trim();
    if (!key) {
      return accumulator;
    }
    accumulator[key] = String(row.Value || row.value || "").trim();
    return accumulator;
  }, {});
}

async function updateConfig(auth, spreadsheetId, patch) {
  await ensureColumns(auth, spreadsheetId, "Config", TAB_COLUMNS.Config);
  const sheets = google.sheets({ version: "v4", auth });
  const existingRows = rowsToRecords(await getTabValues(auth, spreadsheetId, "Config"));
  const merged = existingRows.reduce((accumulator, row) => {
    const key = String(row.Key || row.key || "").trim();
    if (!key) {
      return accumulator;
    }
    accumulator[key] = String(row.Value || row.value || "").trim();
    return accumulator;
  }, {});

  Object.assign(merged, patch);

  const orderedKeys = Array.from(new Set([...CONFIG_KEYS, ...Object.keys(merged)]));
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: "Config!A:C",
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Config!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          TAB_COLUMNS.Config,
          ...orderedKeys.map((key) => [key, merged[key] || "", new Date().toISOString()]),
        ],
      },
    }),
  );

  return merged;
}

function getCompanyUsersDeps() {
  return {
    getTabValues: wrapGetTabValuesWithUsersTabCache(getTabValues),
    getConfig,
    updateConfig,
    ensureColumns,
    google,
    getGoogleConnectedEmail,
    withSheetsQuotaRetry,
    resolveUsersTab,
    writeUsersTabRecordByHeaders,
    readCompanyUsers: workbookReadCompanyUsers,
    migrateUsersTabColumns,
    migrateUsersTabCompanyColumns,
    repairUsersTab,
    repairUsersTabSchema,
    companyUsersCache: {
      ...companyUsersCacheApi,
      rebuildFromSheet: async (auth, deps, context = {}) =>
        rebuildUsersFromSheet(auth, { ...deps, companyUsersCache: companyUsersCacheApi }, context),
    },
    masterSheetCache: masterSheetCacheApi,
  };
}

function getCompanyContextResolutionDeps() {
  return {
    ...getCompanyUsersDeps(),
    ...getCompanyWorkspaceRegistryDeps(),
    findMasterSheetIdsForCompanyLoginEmail,
    readCanonicalCompanyWorkspaceRegistryMap,
    isCompanyRegistryLive,
    migrateUsersTabColumns,
    migrateUsersTabCompanyColumns,
    readCompanyUsersTabRecord: workbookReadCompanyUsersTabRecord,
  };
}

function getCompanyContextEnrichmentDeps() {
  return {
    ...getCompanyWorkspaceRegistryDeps(),
    getConfig,
  };
}

async function enrichCompanyContextFromRegistry(auth, partial = {}) {
  return enrichCompanyContextFromRegistryService(auth, getCompanyContextEnrichmentDeps(), partial);
}

async function probeCompanyLoginSheet(auth, masterSheetId, email, password) {
  return probeCompanyLoginSheetCore(auth, masterSheetId, email, password, getCompanyUsersDeps());
}

async function readCompanyUsersTabRecord(auth, spreadsheetId, email) {
  await migrateUsersTabColumns(auth, spreadsheetId, getCompanyUsersDeps());
  return workbookReadCompanyUsersTabRecord(auth, spreadsheetId, email, getCompanyUsersDeps());
}

async function findCompanyUsersTabRow(auth, spreadsheetId, email) {
  await migrateUsersTabColumns(auth, spreadsheetId, getCompanyUsersDeps());
  return workbookFindCompanyUsersTabRow(auth, spreadsheetId, email, getCompanyUsersDeps());
}

async function deleteUsersTabRowByEmail(auth, spreadsheetId, email) {
  const match = await findCompanyUsersTabRow(auth, spreadsheetId, email);
  if (!match) {
    return false;
  }
  const workbook = await getWorkbook(auth, spreadsheetId);
  const sheet = findSheetByTitle(workbook, "Users");
  const usersSheetId = sheet?.properties?.sheetId;
  if (!sheet || usersSheetId === undefined || usersSheetId === null) {
    return false;
  }
  const sheets = google.sheets({ version: "v4", auth });
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: usersSheetId,
                dimension: "ROWS",
                startIndex: match.sheetRowIndex,
                endIndex: match.sheetRowIndex + 1,
              },
            },
          },
        ],
      },
    }),
  );
  invalidateUsersTabCache(spreadsheetId, { source: "deleteUsersTabRowByEmail" });
  return true;
}

async function removeCompanyUserAccount(auth, masterSheetId, companyFolderId, email) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const sheetId = String(masterSheetId || "").trim();
  const folderId = String(companyFolderId || "").trim();
  if (!sheetId || !emailNorm || !emailNorm.includes("@")) {
    throw new Error("Company master sheet, folder, and email are required.");
  }

  const row = await findCompanyUsersTabRow(auth, sheetId, emailNorm);
  if (!row) {
    return { ok: false, notFound: true, usersRowRemoved: false, userAuthRemoved: false };
  }
  if (folderId && row.companyId && row.companyId !== folderId) {
    return { ok: false, companyMismatch: true, usersRowRemoved: false, userAuthRemoved: false };
  }

  const userAuthKey = `UserAuth.${emailNorm}`;
  const cfg = await getConfig(auth, sheetId);
  const hadUserAuth = Boolean(cfg[userAuthKey] && String(cfg[userAuthKey]).trim());
  if (hadUserAuth) {
    const next = { ...cfg };
    delete next[userAuthKey];
    await updateConfig(auth, sheetId, next);
  }

  const usersRowRemoved = await deleteUsersTabRowByEmail(auth, sheetId, emailNorm);
  return {
    ok: usersRowRemoved || hadUserAuth,
    notFound: false,
    usersRowRemoved,
    userAuthRemoved: hadUserAuth,
  };
}

function parseBertActorFromRequest(req) {
  const masterRaw = req.signedCookies?.bert_master_session;
  if (masterRaw && typeof masterRaw === "string") {
    try {
      const data = JSON.parse(masterRaw);
      if (data.v === 1 && data.email) {
        const companyFolderId = String(data.companyFolderId || data.companyId || "").trim();
        return {
          kind: "master",
          role: "Master",
          email: String(data.email).trim().toLowerCase(),
          name: String(data.name || data.email).trim(),
          companyId: companyFolderId || undefined,
          companyFolderId: companyFolderId || undefined,
          companyName: String(data.companyName || data.selectedCompanyName || "").trim() || undefined,
          masterSheetId: String(data.masterSheetId || "").trim() || undefined,
        };
      }
    } catch {
      /* invalid session */
    }
  }
  const companyRaw = req.signedCookies?.[COMPANY_SESSION_COOKIE];
  if (companyRaw && typeof companyRaw === "string") {
    try {
      const data = JSON.parse(companyRaw);
      if (data.v === 1 && data.email && data.masterSheetId) {
        const companyFolderId = String(data.companyFolderId || data.companyId || "").trim();
        return {
          kind: "company",
          role: String(data.role || "").trim(),
          accessLevel: String(data.accessLevel || "").trim(),
          email: String(data.email).trim().toLowerCase(),
          name: String(data.name || data.email).trim(),
          masterSheetId: String(data.masterSheetId).trim(),
          companyId: companyFolderId,
          companyFolderId,
          companyName: String(data.companyName || "").trim() || undefined,
          companyAreas: Array.isArray(data.companyAreas) ? data.companyAreas : undefined,
        };
      }
    } catch {
      /* invalid session */
    }
  }
  return null;
}

async function resolveCompanyRegistryStatusForActor(auth, actor) {
  if (!auth || !actor) {
    return "";
  }
  let companyId = "";
  if (actor.kind === "company") {
    companyId = String(actor.companyId || "").trim();
    if (!companyId) {
      const masterSheetId = String(actor.masterSheetId || "").trim();
      if (masterSheetId) {
        try {
          const cfg = await getConfig(auth, masterSheetId);
          companyId = String(cfg.companyId || "").trim();
        } catch {
          /* best-effort */
        }
      }
    }
  }
  if (!companyId) {
    return "";
  }
  const record = await getCanonicalCompanyRegistryRecord(auth, getCompanyWorkspaceRegistryDeps(), companyId).catch(
    () => null,
  );
  return getCanonicalCompanyStatus(record || {});
}

async function assertCompanyAdminWorkspaceLive(auth, actor) {
  if (!actor || actor.kind !== "company" || !isCompanyAdminInviteRole(actor)) {
    return { ok: true };
  }
  const companyId = String(actor.companyId || actor.companyFolderId || "").trim();
  const masterSheetId = String(actor.masterSheetId || "").trim();
  if (!companyId) {
    return {
      ok: false,
      httpStatus: 409,
      code: "COMPANY_NOT_LIVE",
      error: COMPANY_NOT_LIVE_INVITE_MESSAGE,
    };
  }
  const inviteReady = await assertCompanyInviteReady(auth, getCompanyWorkspaceRegistryDeps(), companyId, {
    companyId,
    companyFolderId: companyId,
    masterSheetId,
  }).catch(() => null);
  if (!inviteReady?.ok) {
    return {
      ok: false,
      httpStatus: inviteReady?.httpStatus || 409,
      code: inviteReady?.code || "COMPANY_NOT_LIVE",
      error: inviteReady?.message || COMPANY_NOT_LIVE_INVITE_MESSAGE,
    };
  }
  return { ok: true };
}

function requireWorkspaceAdminActor(req, res, next) {
  const actor = parseBertActorFromRequest(req);
  if (!actor) {
    return res.status(403).json({
      ok: false,
      blocker: "forbidden",
      error: "Sign in as a Master operator or company Admin to manage users.",
    });
  }
  const role = actor.role === "Master" ? "Master" : parseRoleFromUsersSheet(actor.role);
  if (role !== "Master" && role !== "Admin") {
    return res.status(403).json({
      ok: false,
      blocker: "forbidden",
      error: "Only Master or Admin roles can remove company users.",
    });
  }
  req.bertActor = { ...actor, role };
  const auth = getAuthedClient();
  assertCompanyAdminWorkspaceLive(auth, req.bertActor)
    .then((gate) => {
      if (!gate.ok) {
        return res.status(gate.httpStatus || 409).json({
          ok: false,
          blocker: gate.code || "company_not_live",
          error: gate.error,
        });
      }
      return next();
    })
    .catch((error) => {
      console.error("[company-user] admin live gate failed:", error);
      return res.status(500).json({ ok: false, error: "Unable to verify company workspace status." });
    });
}

function requireMasterOnlyActor(req, res, next) {
  const actor = parseBertActorFromRequest(req);
  if (!actor || actor.kind !== "master" || actor.role !== "Master") {
    return res.status(403).json({
      ok: false,
      blocker: "forbidden",
      error: "Only platform Master operators can reset a company workspace.",
    });
  }
  req.bertActor = actor;
  return next();
}

function mapRowObjectToHeaders(headers, rowObject) {
  return headers.map((header) => normalizeCellValue(rowObject?.[header] ?? ""));
}

async function appendRowObjects(auth, spreadsheetId, tabName, rowObjects) {
  const sanitizedRows = toObjectArray(rowObjects);
  if (sanitizedRows.length === 0) {
    return { ok: true, written: 0, skipped: 0 };
  }

  const expectedHeaders = TAB_COLUMNS[tabName] || [];
  await ensureColumns(auth, spreadsheetId, tabName, expectedHeaders);

  const existingRows = await getTabValues(auth, spreadsheetId, tabName);
  const sheetHeaders = (existingRows[0] || expectedHeaders).map((header) => String(header || "").trim());

  const idColumn = ID_COLUMNS[tabName];
  const existingRecords = rowsToRecords(existingRows);
  const existingIds = new Set(
    idColumn ? existingRecords.map((record) => String(record[idColumn] || "").trim()).filter(Boolean) : [],
  );

  const uniqueRows = sanitizedRows.filter((row) => !idColumn || !existingIds.has(String(row[idColumn] || "").trim()));
  if (uniqueRows.length === 0) {
    return { ok: true, written: 0, skipped: sanitizedRows.length };
  }

  const sheets = google.sheets({ version: "v4", auth });
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: uniqueRows.map((row) => mapRowObjectToHeaders(sheetHeaders, row)),
      },
    }),
  );

  return { ok: true, written: uniqueRows.length, skipped: sanitizedRows.length - uniqueRows.length };
}

async function updateRowById(auth, spreadsheetId, tabName, idColumn, id, patch) {
  const headers = TAB_COLUMNS[tabName] || [];
  await ensureColumns(auth, spreadsheetId, tabName, headers);

  const rows = await getTabValues(auth, spreadsheetId, tabName);
  const existingHeaders = rows[0] || headers;
  const idIndex = existingHeaders.findIndex((header) => safeLower(header) === safeLower(idColumn));
  const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[idIndex] || "").trim() === id);

  const sheets = google.sheets({ version: "v4", auth });
  if (rowIndex === -1) {
    return appendRowObjects(auth, spreadsheetId, tabName, [{ [idColumn]: id, ...patch }]);
  }

  const currentRow = existingHeaders.reduce((accumulator, header, index) => {
    accumulator[header] = rows[rowIndex][index] || "";
    return accumulator;
  }, {});
  const nextRecord = { ...currentRow, ...patch };
  const nextRow = existingHeaders.map((header) => normalizeCellValue(nextRecord[header]));
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [nextRow] },
    }),
  );

  return { ok: true, updated: 1 };
}

async function writeSystemSyncLog(auth, spreadsheetId, entry) {
  try {
    await appendRowObjects(auth, spreadsheetId, "SyncLog", [entry]);
  } catch {
    return null;
  }
  return true;
}

async function ensureTabsAndColumns(auth, spreadsheetId, options = {}) {
  const { createBackup = false, companyId = "", companyName = "" } = options;
  let workbook = await getWorkbook(auth, spreadsheetId);
  const tabsAdded = [];
  const columnsAdded = {};
  const warnings = [];
  const errors = [];
  const tabsNeedingBackup = [];

  for (let tabIndex = 0; tabIndex < REQUIRED_TABS.length; tabIndex += 1) {
    const tab = REQUIRED_TABS[tabIndex];
    if (tabIndex > 0) {
      await sleep(SHEETS_READ_GAP_MS);
    }
    if (!ensureSheetTab(workbook, tab)) {
      tabsAdded.push(tab);
    } else {
      const rows = await getTabValues(auth, spreadsheetId, tab, "A1:ZZ2");
      const existingHeaders = rows[0] || [];
      const missing = (TAB_COLUMNS[tab] || []).filter(
        (header) => !existingHeaders.some((existing) => safeLower(existing) === safeLower(header)),
      );
      if (missing.length > 0) {
        columnsAdded[tab] = missing;
        tabsNeedingBackup.push(tab);
      }
    }
  }

  if (createBackup && tabsNeedingBackup.length > 0) {
    await createBackupSheets(auth, spreadsheetId, tabsNeedingBackup);
  }

  for (let tabIndex = 0; tabIndex < REQUIRED_TABS.length; tabIndex += 1) {
    const tab = REQUIRED_TABS[tabIndex];
    if (tabIndex > 0) {
      await sleep(SHEETS_READ_GAP_MS);
    }
    const { workbook: workbookAfterTab } = await ensureTabExists(auth, spreadsheetId, tab, workbook);
    workbook = workbookAfterTab;
    const { addedColumns } = await ensureColumns(auth, spreadsheetId, tab, TAB_COLUMNS[tab] || []);
    if (addedColumns.length > 0) {
      columnsAdded[tab] = Array.from(new Set([...(columnsAdded[tab] || []), ...addedColumns]));
    }
  }

  const config = await getConfig(auth, spreadsheetId);
  await updateConfig(auth, spreadsheetId, {
    ...config,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    companyId: companyId || config.companyId || "",
    companyName: companyName || config.companyName || "",
    createdAt: config.createdAt || new Date().toISOString(),
    lastRepairedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  });

  await writeSystemSyncLog(auth, spreadsheetId, {
    "Sync Item ID": `workspace-repair-${Date.now()}`,
    "Company ID": companyId || config.companyId || "",
    "Entity Type": "workspace",
    "Entity ID": spreadsheetId,
    Operation: "Append",
    Status: "Synced",
    "Created At": new Date().toISOString(),
    "Attempted At": new Date().toISOString(),
    "Completed At": new Date().toISOString(),
    "Retry Count": 0,
    Priority: 100,
    "Last Error": "",
    Payload: JSON.stringify({ tabsAdded, columnsAdded }),
    "Schema Version": CURRENT_SCHEMA_VERSION,
  });

  return { ok: errors.length === 0, tabsAdded, columnsAdded, warnings, errors };
}

async function writeCompanyUsers(auth, spreadsheetId, companyFolderId, users, options = {}) {
  const companyName = String(options.companyName || "").trim();
  await ensureTabsAndColumns(auth, spreadsheetId, { companyId: companyFolderId });
  const userDeps = getCompanyUsersDeps();
  await repairUsersTabSchema(auth, spreadsheetId, userDeps, {
    companyContext: { companyFolderId, companyId: companyFolderId, companyName },
  }).catch(() => null);
  await migrateUsersTabColumns(auth, spreadsheetId, userDeps, {
    companyContext: { companyFolderId, companyId: companyFolderId, companyName },
  });
  const rows = toObjectArray(users);
  const timestamp = new Date().toISOString();
  let written = 0;
  const companyContext = { companyFolderId, companyId: companyFolderId, companyName };

  for (const user of rows) {
    const email = String(user.email || user.Email || "").trim().toLowerCase();
    const role = String(user.role || user.Role || "").trim();
    if (!email || !role) {
      continue;
    }

    const userId =
      String(user.id || user["User ID"] || "").trim() ||
      `invite-${email.replace(/[^a-z0-9]+/gi, "-")}-${role.toLowerCase()}`;
    const fullName = String(user.name || user["Full Name"] || user.Name || email).trim() || email;
    const createdBy = String(user.invitedBy || user["Created By"] || APP_BRAND_NAME).trim() || APP_BRAND_NAME;
    const senderEmail = String(user.senderEmail || user["Updated By"] || "").trim();
    const createdAt = String(user.sentAt || user["Created At"] || user.CreatedAt || timestamp).trim() || timestamp;
    const updatedAt = String(user.updatedAt || user["Updated At"] || user.UpdatedAt || timestamp).trim() || timestamp;
    const companyAreas = String(user.companyAreas || user.CompanyAreas || "").trim();
    const accessLevel = String(user.accessLevel || user.AccessLevel || "").trim();
    const status = String(user.status || user.Status || "").trim();
    const plainPassword = String(user.password || "").trim();

    const record = {
      "User ID": userId,
      "Company ID": companyFolderId,
      Company: String(user.companyName || user.Company || companyName || "").trim(),
      CompanyId: companyFolderId,
      CompanyFolderId: companyFolderId,
      "Full Name": fullName,
      Name: fullName,
      Email: email,
      Role: role,
      AccessLevel: accessLevel || inviteAccessLevelForRole(role),
      CompanyAreas: companyAreas,
      Status: status || (plainPassword ? "ACTIVE" : "INVITED"),
      CreatedAt: createdAt,
      UpdatedAt: updatedAt,
      InvitedAt: String(user.invitedAt || user.InvitedAt || createdAt).trim() || createdAt,
      "Created By": createdBy,
      "Updated By": senderEmail || createdBy,
      "Sync Status": String(user.syncStatus || "Synced"),
      "Sync Attempts": Number(user.syncAttempts || 0),
      "Last Sync Error": String(user.lastSyncError || ""),
      "Remote Row ID": String(user.remoteRowId || ""),
      "Schema Version": String(user.schemaVersion || CURRENT_SCHEMA_VERSION),
    };

    if (plainPassword) {
      record.PasswordHash = hashPassword(plainPassword);
      record.PasswordUpdatedAt = timestamp;
      record.Status = "ACTIVE";
    }

    const writeResult = await writeUsersTabRecordByHeaders(auth, spreadsheetId, record, userDeps, {
      companyContext,
    });
    if (!writeResult.ok) {
      continue;
    }
    if (plainPassword) {
      const cfg = await getConfig(auth, spreadsheetId);
      const legacyKey = `UserAuth.${email}`;
      if (cfg[legacyKey]) {
        const next = { ...cfg };
        delete next[legacyKey];
        await updateConfig(auth, spreadsheetId, next);
      }
    }
    const verified = await workbookFindCompanyUsersTabRow(auth, spreadsheetId, email, userDeps);
    if (!verified || !isValidCompanyUserEmail(verified.email)) {
      continue;
    }
    written += 1;
  }

  return { ok: true, written };
}

async function writeCompanyActions(auth, spreadsheetId, companyFolderId, actions) {
  const sheets = google.sheets({ version: "v4", auth });
  await ensureTabsAndColumns(auth, spreadsheetId, { companyId: companyFolderId });

  const headers = TAB_COLUMNS.Actions;
  const existingRows = await getTabValues(auth, spreadsheetId, "Actions");
  const existingDataRows = existingRows.length > 0 ? existingRows.slice(1) : [];
  const companyIndex = headers.indexOf("Company ID");
  const actionIdIndex = headers.indexOf("Action ID");
  const remoteUpdatedIndex = headers.indexOf("Updated At");

  for (const row of existingDataRows) {
    if (String(row[companyIndex] || "").trim() !== companyFolderId) {
      continue;
    }
    const remoteActionId = String(row[actionIdIndex] || "").trim();
    const remoteUpdatedAt = String(row[remoteUpdatedIndex] || "").trim();
    const localAction = actions.find((action) => action.id === remoteActionId);
    const localUpdatedAt = localAction?.updatedAt || localAction?.localUpdatedAt || localAction?.createdAt;
    if (localUpdatedAt && remoteUpdatedAt && new Date(localUpdatedAt).getTime() < new Date(remoteUpdatedAt).getTime()) {
      throw new Error(`Conflict: action ${remoteActionId} changed in Google Sheets while this tablet was offline.`);
    }
  }

  const keptRows = existingDataRows.filter((row) => String(row[companyIndex] || "").trim() !== companyFolderId);
  const nextRows = actions.map((action) =>
    mapRowObjectToHeaders(headers, {
      "Action ID": action.id,
      "Company ID": action.companyId,
      "Source Audit ID": action.auditId,
      "Source Audit Name": action.auditName,
      "Source Question ID": action.questionId,
      "Source Question Text": action.questionText,
      "Source Answer": action.sourceAnswer,
      "Non Conformance ID": action.nonConformanceId || "",
      Severity: action.severity,
      Status: action.status,
      "Assigned To User ID": action.assignedToUserId,
      "Assigned To Name": action.assignedToName,
      "Created By User ID": action.createdByUserId,
      "Created At": action.createdAt,
      "Updated At": action.updatedAt || action.localUpdatedAt || action.createdAt,
      "Due Date": action.dueDate,
      "Closed At": action.closedAt,
      "Verified By User ID": action.verifiedByUserId,
      "Verification Notes": action.verificationNotes,
      "Evidence Links": (action.evidenceLinks || []).join(", "),
      "Local Evidence Refs": (action.localEvidenceRefs || []).join(", "),
      Comments: action.comments,
      "Recurrence Flag": String(Boolean(action.recurrenceFlag)),
      "Root Cause": action.rootCause,
      "Corrective Action": action.correctiveAction,
      "Preventive Action": action.preventiveAction,
      "Risk Category": action.riskCategory,
      "Requires Manager Review": String(Boolean(action.requiresManagerReview)),
      "Suggestion JSON":
        action.suggestionJson ||
        (action.suggestionRuleId || action.suggestionStatus
          ? JSON.stringify({
              suggestedActionTitle: action.suggestedActionTitle || "",
              suggestedActionDescription: action.suggestedActionDescription || "",
              suggestedOwnerRole: action.suggestedOwnerRole || "",
              suggestedDueDate: action.suggestedDueDate || "",
              suggestedEvidence: action.suggestedEvidence || [],
              suggestionReason: action.suggestionReason || "",
              suggestionRuleId: action.suggestionRuleId || "",
              suggestionStatus: action.suggestionStatus || "",
              similarIssueCount30d: action.similarIssueCount30d ?? 0,
            })
          : ""),
      "Sync Status": action.syncStatus || "Pending",
      "Sync Attempts": action.syncAttempts || 0,
      "Last Sync Error": action.lastSyncError || "",
      "Remote Row ID": action.remoteRowId || "",
      "Schema Version": action.schemaVersion || CURRENT_SCHEMA_VERSION,
      "Version Number": action.versionNumber || 1,
      "Local Updated At": action.localUpdatedAt || action.updatedAt || action.createdAt,
      "Remote Updated At": action.remoteUpdatedAt || "",
      "Last Synced At": action.lastSyncedAt || "",
    }),
  );

  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: "Actions!A:ZZ",
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Actions!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [headers, ...keptRows, ...nextRows],
      },
    }),
  );

  return { ok: true, written: nextRows.length };
}

async function uploadDataUrlToDrive(auth, folderId, fileName, mimeType, dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return { id: "", link: "" };
  }

  const [, parsedMimeType, encoded] = match;
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName || `evidence-${Date.now()}`,
      parents: [folderId],
      mimeType: mimeType || parsedMimeType,
    },
    media: {
      mimeType: mimeType || parsedMimeType,
      body: Buffer.from(encoded, "base64"),
    },
    fields: "id,webViewLink",
  });

  return {
    id: response.data.id || "",
    link: response.data.webViewLink || "",
  };
}

async function resolveCompanyEvidenceFolderIdForUpload(
  authed,
  { companyFolderId, sheetId, clientEvidenceFolderId = "", evidenceKind = "photo" },
) {
  const clientId = String(clientEvidenceFolderId || "").trim();
  try {
    const structure = await ensureCompanyFolderStructure(
      {
        google,
        ensureTabExists,
        ensureColumns,
        getWorkbook,
        getTabValues,
        withSheetsQuotaRetry,
        safeLower,
      },
      authed,
      {
        companyRootFolderId: companyFolderId,
        masterSheetId: sheetId,
        syncWorkbookTab: false,
        placeFiles: false,
      },
    );
    return resolveEvidenceUploadFolderId(structure.folderIds, clientId, { kind: evidenceKind });
  } catch {
    return clientId;
  }
}

async function appendEvidenceRecords(auth, spreadsheetId, companyFolderId, evidenceRecords, evidenceFolderId = "") {
  const enrichedRecords = [];
  for (const record of toObjectArray(evidenceRecords)) {
    const nextRecord = { ...record };
    if (
      evidenceFolderId &&
      !nextRecord["Drive File ID"] &&
      typeof nextRecord["Local Ref"] === "string" &&
      nextRecord["Local Ref"].startsWith("data:")
    ) {
      const upload = await uploadDataUrlToDrive(
        auth,
        evidenceFolderId,
        nextRecord["File Name"] || `evidence-${nextRecord["Evidence ID"] || Date.now()}`,
        nextRecord["Mime Type"] || "",
        nextRecord["Local Ref"],
      );
      nextRecord["Drive File ID"] = upload.id;
      nextRecord["Drive Link"] = upload.link;
      nextRecord["Sync Status"] = "Synced";
      nextRecord["Remote Row ID"] = nextRecord["Remote Row ID"] || upload.id;
    }
    enrichedRecords.push(nextRecord);
  }

  const payload = await appendRowObjects(auth, spreadsheetId, "Evidence", enrichedRecords);
  await writeSystemSyncLog(auth, spreadsheetId, {
    "Sync Item ID": `evidence-sync-${Date.now()}`,
    "Company ID": companyFolderId,
    "Entity Type": "evidenceUpload",
    "Entity ID": companyFolderId,
    Operation: "UploadEvidence",
    Status: "Synced",
    "Created At": new Date().toISOString(),
    "Attempted At": new Date().toISOString(),
    "Completed At": new Date().toISOString(),
    "Retry Count": 0,
    Priority: 60,
    "Last Error": "",
    Payload: JSON.stringify({ count: enrichedRecords.length }),
    "Schema Version": CURRENT_SCHEMA_VERSION,
  });
  return { ...payload, records: enrichedRecords };
}

async function validateWorkspace(auth, input) {
  const {
    companyFolderId,
    sheetId,
    setupFolderId,
    auditFormsFolderId,
    recordsFolderId,
    evidenceFolderId,
    exportsFolderId,
    managementNotesFolderId,
  } = input;
  const validation = {
    ok: false,
    status: "Broken",
    schemaVersion: "",
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    lastValidatedAt: "",
    lastRepairedAt: "",
    folders: {
      companyFolder: false,
      setupFolder: false,
      auditFormsFolder: false,
      recordsFolder: false,
      evidenceFolder: false,
      exportsFolder: false,
      managementNotesFolder: false,
    },
    tabs: {},
    missingTabs: [],
    missingColumns: {},
    warnings: [],
    issues: [],
    repairableIssues: [],
    blockingIssues: [],
  };

  const folderChecks = [
    ["companyFolder", companyFolderId, "Company folder ID is missing or invalid.", true],
    ["setupFolder", setupFolderId, "The 01 Company Setup folder is missing or invalid.", false],
    ["auditFormsFolder", auditFormsFolderId, "The audit forms folder is missing or invalid.", false],
    ["recordsFolder", recordsFolderId, "The company records folder is missing or invalid.", false],
    ["evidenceFolder", evidenceFolderId, "The evidence folder is missing or invalid.", false],
    ["exportsFolder", exportsFolderId, "The exports folder is missing or invalid.", false],
    ["managementNotesFolder", managementNotesFolderId, "The management notes folder is missing or invalid.", false],
  ];

  for (const [key, id, message, blocking] of folderChecks) {
    if (!id) {
      validation[blocking ? "blockingIssues" : "repairableIssues"].push(message);
      continue;
    }
    try {
      const file = await getDriveFile(auth, id);
      validation.folders[key] = file.mimeType === "application/vnd.google-apps.folder";
      if (!validation.folders[key]) {
        validation[blocking ? "blockingIssues" : "repairableIssues"].push(message);
      }
    } catch {
      validation[blocking ? "blockingIssues" : "repairableIssues"].push(message);
    }
  }

  if (!sheetId) {
    validation.blockingIssues.push("The Company Master Sheet link is missing.");
  } else {
    try {
      const payload = await readCompanySheetById(auth, sheetId);
      for (const tab of REQUIRED_TABS) {
        validation.tabs[tab] = payload.tabs.some((name) => safeLower(name) === safeLower(tab));
        if (!validation.tabs[tab]) {
          validation.missingTabs.push(tab);
          validation.repairableIssues.push(`The Company Master Sheet is missing the ${tab} tab.`);
        }
      }

      const config = await getConfig(auth, sheetId);
      validation.schemaVersion = config.schemaVersion || "";
      validation.lastValidatedAt = config.lastValidatedAt || "";
      validation.lastRepairedAt = config.lastRepairedAt || "";

      if (!validation.schemaVersion) {
        validation.repairableIssues.push("The Config tab does not record the sheet format version yet.");
      } else if (validation.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        validation.warnings.push(
          `Company sheet format mismatch: on sheet ${validation.schemaVersion}, this app expects ${CURRENT_SCHEMA_VERSION}.`,
        );
        validation.repairableIssues.push("The company master sheet format is older than this app version.");
      }

      const tabColumnEntries = Object.entries(TAB_COLUMNS);
      for (let entryIndex = 0; entryIndex < tabColumnEntries.length; entryIndex += 1) {
        const [tab, headers] = tabColumnEntries[entryIndex];
        let existingHeaders = Array.isArray(payload.headerRowByTab?.[tab]) ? payload.headerRowByTab[tab] : null;
        if (!existingHeaders) {
          if (entryIndex > 0) {
            await sleep(SHEETS_READ_GAP_MS);
          }
          existingHeaders = (await getTabValues(auth, sheetId, tab, "A1:ZZ2"))[0] || [];
        }
        const missing = headers.filter(
          (header) => !existingHeaders.some((existing) => safeLower(existing) === safeLower(header)),
        );
        if (missing.length > 0) {
          validation.missingColumns[tab] = missing;
          validation.repairableIssues.push(`The ${tab} tab is missing: ${missing.join(", ")}.`);
        }
      }

      try {
        const nextValidationStamp = new Date().toISOString();
        const updatedConfig = await updateConfig(auth, sheetId, {
          ...config,
          schemaVersion: config.schemaVersion || CURRENT_SCHEMA_VERSION,
          lastValidatedAt: nextValidationStamp,
          appVersion: APP_VERSION,
        });
        validation.lastValidatedAt = updatedConfig.lastValidatedAt || nextValidationStamp;
      } catch {
        validation.blockingIssues.push("The app can read this Company Master Sheet but cannot safely write validation metadata to Config.");
      }
    } catch (error) {
      validation.blockingIssues.push(
        error instanceof Error
          ? `The Company Master Sheet could not be read: ${error.message}`
          : "The Company Master Sheet could not be read.",
      );
    }
  }

  validation.issues = [
    ...validation.blockingIssues,
    ...validation.repairableIssues,
    ...validation.warnings,
  ];
  validation.status =
    validation.blockingIssues.length > 0
      ? "Broken"
      : validation.repairableIssues.length > 0 || validation.warnings.length > 0
        ? "Warning"
        : "Healthy";
  validation.ok = validation.status !== "Broken";
  return validation;
}

function logCompanySheetLoadTimings(stage, stageStartMs, meta = {}) {
  try {
    console.info("company_sheet_load_timings", {
      stage,
      durationMs: Date.now() - stageStartMs,
      ...meta,
    });
  } catch {
    /* timing log must never affect request */
  }
}

async function readCompanySheetById(auth, spreadsheetId) {
  const totalStart = Date.now();
  const sheets = google.sheets({ version: "v4", auth });
  const metadataStart = Date.now();
  const workbook = await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties(title),sheets(properties(title))",
    }),
  );
  logCompanySheetLoadTimings("spreadsheet_metadata", metadataStart, {
    spreadsheetId,
    tabCount: workbook.data.sheets?.length || 0,
  });

  const availableTabs = workbook.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) || [];
  const tabData = {};
  /** First row per required tab (for validation without a second values.get pass). */
  const headerRowByTab = {};

  for (let tabIndex = 0; tabIndex < REQUIRED_TABS.length; tabIndex += 1) {
    const tab = REQUIRED_TABS[tabIndex];
    if (tabIndex > 0) {
      const gapStart = Date.now();
      await sleep(SHEETS_READ_GAP_MS);
      logCompanySheetLoadTimings("inter_tab_gap", gapStart, {
        spreadsheetId,
        tab,
        gapMs: SHEETS_READ_GAP_MS,
      });
    }
    const tabReadStart = Date.now();
    if (safeLower(tab) === "users") {
      try {
        const usersRead = await workbookReadCompanyUsers(auth, spreadsheetId, getCompanyUsersDeps(), {
          createIfMissing: false,
        });
        headerRowByTab[tab] = usersRead.resolved?.headers || [];
        tabData[tab] = usersRead.records || [];
      } catch {
        tabData[tab] = [];
        headerRowByTab[tab] = [];
      }
      logCompanySheetLoadTimings("tab_read", tabReadStart, {
        spreadsheetId,
        tab,
        via: "workbookReadCompanyUsers",
        rowCount: Array.isArray(tabData[tab]) ? tabData[tab].length : 0,
      });
      continue;
    }

    if (!availableTabs.some((name) => safeLower(name) === safeLower(tab))) {
      tabData[tab] = [];
      headerRowByTab[tab] = [];
      logCompanySheetLoadTimings("tab_read", tabReadStart, {
        spreadsheetId,
        tab,
        skipped: true,
        reason: "tab_missing",
      });
      continue;
    }

    const response = await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!A1:ZZ500`,
      }),
    );
    const rawValues = response.data.values || [];
    headerRowByTab[tab] = rawValues[0] || [];
    const mapStart = Date.now();
    let records = rowsToRecords(rawValues);
    if (safeLower(tab) === "config") {
      records = records.map((row) => {
        const key = String(row.Key || row.key || "").trim();
        if (key.toLowerCase().startsWith("userauth.")) {
          return { ...row, Value: "", value: "" };
        }
        return row;
      });
    }
    tabData[tab] = records;
    logCompanySheetLoadTimings("tab_read", tabReadStart, {
      spreadsheetId,
      tab,
      via: "values_get",
      rawRowCount: rawValues.length,
    });
    logCompanySheetLoadTimings("row_mapping", mapStart, {
      spreadsheetId,
      tab,
      recordCount: records.length,
    });
  }

  const responsePrepStart = Date.now();
  const payload = {
    ok: true,
    sheetId: spreadsheetId,
    sheetName: workbook.data.properties?.title || "Company Master Sheet",
    tabs: availableTabs,
    data: tabData,
    headerRowByTab,
  };
  logCompanySheetLoadTimings("response_preparation", responsePrepStart, {
    spreadsheetId,
    requiredTabCount: REQUIRED_TABS.length,
    loadedTabCount: Object.keys(tabData).length,
  });
  logCompanySheetLoadTimings("total", totalStart, {
    spreadsheetId,
    requiredTabCount: REQUIRED_TABS.length,
    availableTabCount: availableTabs.length,
  });
  return payload;
}

async function readCompanyMasterSheet(auth, folderId) {
  const inspection = await inspectCompanyFolder(auth, folderId);
  if (!inspection.masterSheet?.id) {
    throw new Error("The company folder does not contain a Company Master Sheet.");
  }
  return readCompanySheetById(auth, inspection.masterSheet.id);
}

function resolveGoogleSheetsProbeWorkbookId() {
  return (
    String(process.env.BERT_GOOGLE_SHEETS_HEALTH_WORKBOOK_ID || "").trim() ||
    String(process.env.BERT_DEMO_COMPANY_WORKBOOK_ID || "").trim() ||
    String(requiredEnv.GOOGLE_ONBOARDING_SHEET_ID || "").trim()
  );
}

function getGoogleCredentialDiagnosticsPayload() {
  return buildGoogleCredentialDiagnostics({
    requiredEnv,
    processEnv: process.env,
    oauthStore: googleOAuthStore,
  });
}

app.get("/api/google/status", async (_req, res) => {
  const authed = getAuthedClient();
  const oauthConnected = googleOAuthStore.hasTokens();
  const sharedDriveId = String(requiredEnv.GOOGLE_SHARED_DRIVE_ID || "").trim();

  let companies = [];
  let sharedDriveVerified = false;
  let sharedDriveVerifyError = "";
  let sharedDriveWarning = "";
  let onboardingSource = {
    configured: Boolean(requiredEnv.GOOGLE_ONBOARDING_FORM_ID || requiredEnv.GOOGLE_ONBOARDING_SHEET_ID),
    formId: requiredEnv.GOOGLE_ONBOARDING_FORM_ID || "",
    formName: requiredEnv.GOOGLE_ONBOARDING_FORM_ID ? "QMS Company Onboarding Form" : "",
    sheetId: requiredEnv.GOOGLE_ONBOARDING_SHEET_ID || "",
    sheetName: requiredEnv.GOOGLE_ONBOARDING_SHEET_ID ? "QMS Company Onboarding Responses" : "",
  };

  if (!sharedDriveId) {
    sharedDriveVerifyError =
      "GOOGLE_SHARED_DRIVE_ID is not set on the API server. Set it on the Render API service, then redeploy.";
  } else if (authed && envConfigured()) {
    const rootStatus = await inspectConfiguredWorkspaceRoot(authed, google, sharedDriveId);
    if (!rootStatus.ok) {
      sharedDriveVerifyError = rootStatus.error || WORKSPACE_ROOT_INACCESSIBLE_ERROR;
    } else {
      sharedDriveVerified = true;
      if (rootStatus.warning) {
        sharedDriveWarning = rootStatus.warning;
      }
      try {
        const liveCompanies = await listGodmodeLiveCompanies(authed);
        companies = liveCompanies.companies;
        if (liveCompanies.warning) {
          sharedDriveWarning = [sharedDriveWarning, liveCompanies.warning].filter(Boolean).join(" ");
        }
        onboardingSource = await discoverOnboardingSource(authed);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to list company workspaces from the configured Drive root.";
        sharedDriveWarning = [sharedDriveWarning, message].filter(Boolean).join(" ");
      }
    }
  } else if (sharedDriveId && !authed) {
    sharedDriveVerifyError = "Connect Google Workspace to verify shared drive access.";
  }

  res.json({
    ok: true,
    configured: envConfigured(),
    connected: oauthConnected,
    googleOAuthConnected: oauthConnected,
    googleConnectedEmail: getGoogleConnectedEmail() || undefined,
    sharedDriveId,
    sharedDriveConfigured: Boolean(sharedDriveId),
    sharedDriveVerified,
    sharedDriveWarning: sharedDriveWarning || undefined,
    sharedDriveVerifyError: sharedDriveVerifyError || undefined,
    companiesCount: companies.length,
    companies,
    onboardingSource,
    googleAuth: getGoogleCredentialDiagnosticsPayload(),
  });
});

/**
 * Standalone Google OAuth + Sheets metadata health check.
 * Forces a live workbook metadata read so refresh-token failures surface as invalid_grant.
 * Never returns secrets or tokens.
 */
app.get("/api/google/auth-health", async (req, res) => {
  const diagnostics = getGoogleCredentialDiagnosticsPayload();
  const requestedWorkbookId = String(req.query?.spreadsheetId || req.query?.workbookId || "").trim();
  const spreadsheetId = requestedWorkbookId || resolveGoogleSheetsProbeWorkbookId();
  const authed = getAuthedClient();

  let sheetsProbe = null;
  if (!envConfigured()) {
    sheetsProbe = {
      ok: false,
      reason: "google_env_not_configured",
      message: "Google workspace environment variables are incomplete.",
      missingKeys: collectMissingGoogleEnvKeys(),
    };
  } else if (!authed) {
    sheetsProbe = {
      ok: false,
      reason: "google_oauth_not_connected",
      message: "No stored Google OAuth refresh token on this API host.",
    };
  } else if (!spreadsheetId) {
    sheetsProbe = {
      ok: false,
      reason: "missing_spreadsheet_id",
      message:
        "Set BERT_GOOGLE_SHEETS_HEALTH_WORKBOOK_ID or BERT_DEMO_COMPANY_WORKBOOK_ID, or pass ?spreadsheetId=...",
    };
  } else {
    sheetsProbe = await probeGoogleSheetsWorkbookMetadata(authed, spreadsheetId, {
      google,
      withSheetsQuotaRetry,
    });
  }

  const ok = Boolean(sheetsProbe?.ok);
  return res.status(ok ? 200 : 503).json({
    ok,
    service: "bert-api-google-auth-health",
    authMode: diagnostics.authMode,
    selectedCredentialPath: diagnostics.selectedCredentialPath,
    googleAuth: diagnostics,
    sheetsProbe,
  });
});

app.get("/api/godmode/live-companies", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (_req, res) => {
  const authed = getAuthedClient();
  if (!authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before loading Godmode companies.",
    });
  }
  try {
    const payload = await listGodmodeLiveCompanies(authed);
    return res.json({
      ok: true,
      liveCompaniesFolderId: payload.liveCompaniesFolderId,
      liveCompaniesMissing: payload.liveCompaniesMissing,
      warning: payload.warning || undefined,
      setupActions: payload.liveCompaniesMissing ? ["platformSetup"] : [],
      companies: payload.companies,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Live Companies.";
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

app.post("/api/google/verify-shared-drive", async (_req, res) => {
  const authed = getAuthedClient();
  const sharedDriveId = String(requiredEnv.GOOGLE_SHARED_DRIVE_ID || "").trim();

  if (!envConfigured()) {
    return sendGoogleWorkspaceUnavailable(res);
  }
  if (!sharedDriveId) {
    return res.status(400).json({
      ok: false,
      sharedDriveId: "",
      sharedDriveConfigured: false,
      sharedDriveVerified: false,
      error: "Set GOOGLE_SHARED_DRIVE_ID on the Render API service, then redeploy.",
    });
  }
  if (!authed) {
    return res.status(401).json({
      ok: false,
      sharedDriveId,
      sharedDriveConfigured: true,
      sharedDriveVerified: false,
      error: "Connect Google Workspace before verifying the shared drive.",
    });
  }

  const rootStatus = await inspectConfiguredWorkspaceRoot(authed, google, sharedDriveId);
  if (!rootStatus.ok) {
    console.warn("[google] shared drive verify failed", {
      sharedDriveIdPrefix: sharedDriveId.slice(0, 8),
      message: rootStatus.error,
    });
    return res.status(400).json({
      ok: false,
      sharedDriveId,
      sharedDriveConfigured: true,
      sharedDriveVerified: false,
      companiesCount: 0,
      error: rootStatus.error,
    });
  }

  let companies = [];
  let warning = rootStatus.warning || "";
  try {
    const liveCompanies = await listGodmodeLiveCompanies(authed);
    companies = liveCompanies.companies;
    if (liveCompanies.warning) {
      warning = [warning, liveCompanies.warning].filter(Boolean).join(" ");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to list company workspaces from the configured Drive root.";
    warning = [warning, message].filter(Boolean).join(" ");
  }

  console.log("[google] workspace root verified", {
    sharedDriveIdPrefix: sharedDriveId.slice(0, 8),
    rootKind: rootStatus.kind,
    companiesCount: companies.length,
  });
  return res.json({
    ok: true,
    sharedDriveId,
    sharedDriveConfigured: true,
    sharedDriveVerified: true,
    sharedDriveWarning: warning || undefined,
    companiesCount: companies.length,
  });
});

app.get("/api/onboarding/submissions", async (_req, res) => {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before loading onboarding submissions.",
    });
  }

  try {
    const onboardingSource = await discoverOnboardingSource(authed);
    const submissions = await readOnboardingSubmissions(authed, onboardingSource);

    return res.json({
      ok: true,
      onboardingSource,
      headers: submissions.headers,
      records: submissions.records,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load onboarding submissions.",
    });
  }
});

app.get("/api/company-folder/:folderId", async (req, res) => {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before checking the company folder.",
    });
  }

  try {
    const folderId = String(req.params.folderId || "").trim();
    const folderDenial = await rejectIfCompanyFolderNotUnderCompaniesRoot(
      authed,
      { google, sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID },
      folderId,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }
    const inspection = await inspectCompanyFolder(authed, folderId);
    return res.json(inspection);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to inspect the company folder.",
    });
  }
});

app.get("/api/google-file/:fileId", async (req, res) => {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before checking Google Drive items.",
    });
  }

  try {
    const file = await getDriveFile(authed, req.params.fileId);
    return res.json({ ok: true, file });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load the Google Drive item.",
    });
  }
});

app.get("/api/google-forms-folder/:folderId", async (req, res) => {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before checking the audit forms folder.",
    });
  }

  try {
    const payload = await listFormsInFolder(authed, req.params.folderId);
    return res.json({
      ok: true,
      folder: payload.folder,
      forms: payload.forms,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load the audit forms folder.",
    });
  }
});

app.get("/api/company-sheet/:folderId", async (req, res) => {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before loading the company master sheet.",
    });
  }

  try {
    const folderId = String(req.params.folderId || "").trim();
    const folderDenial = await rejectIfCompanyFolderNotUnderCompaniesRoot(
      authed,
      { google, sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID },
      folderId,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }
    const payload = await readCompanyMasterSheet(authed, folderId);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to read the company master sheet.",
    });
  }
});

async function handleScheduleAssigneesRequest(req, res) {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before loading schedule assignees.",
    });
  }

  const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
  const companyFolderId = String(req.query.companyFolderId || req.query.companyId || "").trim();
  const selectedArea = String(req.query.area || "").trim();
  const includeDiagnostics =
    String(req.query.diagnostics || "").trim() === "1" ||
    String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true";

  if (!companyFolderId && !masterSheetId) {
    return res.status(400).json({
      ok: false,
      code: "COMPANY_CONTEXT_MISSING",
      error: "companyFolderId or masterSheetId is required to load schedule assignees.",
      message: "companyFolderId or masterSheetId is required to load schedule assignees.",
    });
  }

  try {
    const result = await listSchedulerAssignees(
      authed,
      { ...getCompanyWorkspaceRegistryDeps(), ...getCompanyUsersDeps() },
      {
        companyFolderId,
        companyId: companyFolderId,
        masterSheetId,
        companyName: String(req.query.companyName || "").trim(),
        selectedArea,
        includeDiagnostics,
      },
    );

    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({
        ok: false,
        code: result.code,
        error: result.error || result.message,
        message: result.message || result.error,
        diagnostics: result.diagnostics,
        technicalError: result.technicalError,
      });
    }

    return res.json({
      ok: true,
      companyId: result.companyId,
      companyFolderId: result.companyFolderId,
      companyName: result.companyName,
      masterSheetId: result.masterSheetId,
      assignees: result.assignees,
      auditors: result.auditors,
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      code: "USERS_TAB_READ_FAILED",
      error: error instanceof Error ? error.message : "Unable to load schedule assignees.",
      message: error instanceof Error ? error.message : "Unable to load schedule assignees.",
    });
  }
}

app.get("/api/schedules/assignees", handleScheduleAssigneesRequest);
app.get("/api/schedules/auditors", handleScheduleAssigneesRequest);

function respondLegacySheetByIdWriteRetired(res, tab = "") {
  return res.status(410).json({
    ok: false,
    code: "LEGACY_SHEET_WRITE_RETIRED",
    error:
      "Sheet-by-id write routes are retired on the rebuild branch. Use folder-first company API routes instead.",
    tab: tab || undefined,
  });
}

app.get("/api/google-sheet-by-id/:sheetId", async (req, res) => {
  const routeStart = Date.now();
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before loading the company master sheet.",
    });
  }

  try {
    const validationStart = Date.now();
    const sheetId = String(req.params.sheetId || "").trim();
    logCompanySheetLoadTimings("context_permission_validation", validationStart, {
      spreadsheetId: sheetId,
      authenticated: true,
    });
    const payload = await readCompanySheetById(authed, sheetId);
    logCompanySheetLoadTimings("route_total", routeStart, {
      spreadsheetId: sheetId,
      ok: payload?.ok === true,
    });
    return res.json(payload);
  } catch (error) {
    logCompanySheetLoadTimings("route_total", routeStart, {
      spreadsheetId: String(req.params.sheetId || "").trim(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to read the company master sheet.",
    });
  }
});

app.post("/api/google-sheet-by-id/:sheetId/schedules", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "Schedules");
});

app.patch(
  "/api/companies/:companyFolderId/users/:email",
  requireGoogleWorkspaceSession,
  requireWorkspaceAdminActor,
  async (req, res) => {
    try {
      const auth = getAuthedClient();
      const companyFolderId = String(req.params.companyFolderId || "").trim();
      const email = String(req.params.email || "")
        .trim()
        .toLowerCase();
      const masterSheetId = String(req.query?.masterSheetId || req.body?.masterSheetId || "").trim();
      const actor = req.bertActor;

      if (!companyFolderId || !email || !email.includes("@")) {
        return res.status(400).json({ ok: false, error: "Company folder ID and a valid email are required." });
      }
      if (!masterSheetId) {
        return res.status(400).json({
          ok: false,
          blocker: "missing_master_sheet",
          error: "Company master spreadsheet ID is required to update this user.",
        });
      }

      if (actor.kind === "company" && actor.masterSheetId && actor.masterSheetId !== masterSheetId) {
        return res.status(403).json({
          ok: false,
          blocker: "forbidden",
          error: "You can only update users in your own company workspace.",
        });
      }

      if (actor.kind === "company" && actor.email === email) {
        const roleChangeRequested = req.body?.role !== undefined && String(req.body.role || "").trim();
        const statusChangeRequested =
          req.body?.status !== undefined && String(req.body.status || "").trim().toLowerCase() !== "active";
        if (roleChangeRequested || statusChangeRequested) {
          return res.status(403).json({
            ok: false,
            blocker: "self_edit_forbidden",
            error: "You cannot change your own role or deactivate your own account while signed in.",
          });
        }
      }

      const updates = {};
      if (req.body?.name !== undefined) {
        updates.name = req.body.name;
      }
      if (req.body?.role !== undefined) {
        updates.role = req.body.role;
      }
      if (req.body?.status !== undefined) {
        updates.status = req.body.status;
      }
      if (req.body?.companyAreas !== undefined) {
        updates.companyAreas = req.body.companyAreas;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ ok: false, error: "No user fields were provided to update." });
      }

      const result = await updateCompanyUserRecord(auth, masterSheetId, email, updates, getCompanyUsersDeps());
      if (!result.ok) {
        const reason = String(result.reason || "").trim();
        if (reason === "user_not_found") {
          return res.status(404).json({ ok: false, error: "No user with this email was found on the company Users tab." });
        }
        if (reason === "name_required") {
          return res.status(400).json({ ok: false, error: "Display name is required." });
        }
        if (reason === "invalid_role") {
          return res.status(400).json({ ok: false, error: "Role must be Company Admin, Manager, Auditor, or User." });
        }
        if (reason === "invalid_email") {
          return res.status(400).json({ ok: false, error: "Email address is invalid." });
        }
        return res.status(400).json({ ok: false, error: "Unable to update user.", reason });
      }

      const { parseRoleForClient } = await import("../shared/schedule-assignees.mjs");
      const user = result.user;
      const companyAreas = Array.isArray(user.companyAreas) ? user.companyAreas : parseCompanyAreas(user.companyAreasRaw);
      const clientUser = sanitizeUsersTabRecords([
        {
          email: user.email,
          name: user.name || email,
          role: parseRoleForClient(user.role),
          accessLevel: user.accessLevel || "",
          status: user.status || "ACTIVE",
          companyId: companyFolderId,
          companyFolderId,
          companyAreas,
          companyAreasRaw: companyAreas.join(", "),
        },
      ])[0];

      console.log("[company-user] patch", {
        email,
        companyFolderId,
        masterSheetIdPrefix: masterSheetId.slice(0, 8),
        actorKind: actor.kind,
        actorRole: actor.role,
        fields: Object.keys(updates),
      });

      const fullRec = await readCompanyUsersTabRecord(auth, masterSheetId, email);
      const patchCompanyName = String(actor?.companyName || req.body?.companyName || "").trim();
      if (fullRec?.email && fullRec.passwordHash) {
        authIndexApi.upsertEntry(
          authIndexApi.entryFromUsersTabRow(
            {
              ...fullRec,
              roleRaw: fullRec.role,
            },
            {
              companyFolderId,
              companyName: patchCompanyName,
              masterSheetId,
            },
          ) || {
            email: fullRec.email,
            name: fullRec.name,
            role: fullRec.role,
            accessLevel: fullRec.accessLevel,
            companyId: companyFolderId,
            companyFolderId,
            companyName: patchCompanyName,
            masterSheetId,
            status: fullRec.status,
            passwordHash: fullRec.passwordHash,
            updatedAt: fullRec.updatedAt,
            companyAreas: fullRec.companyAreas,
          },
        );
      }

      return res.json({ ok: true, user: clientUser });
    } catch (error) {
      console.error("[company-user] patch failed:", error);
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update company user.",
      });
    }
  },
);

app.delete(
  "/api/companies/:companyFolderId/users/:email",
  requireGoogleWorkspaceSession,
  requireWorkspaceAdminActor,
  async (req, res) => {
    try {
      const auth = getAuthedClient();
      const companyFolderId = String(req.params.companyFolderId || "").trim();
      const email = String(req.params.email || "")
        .trim()
        .toLowerCase();
      const masterSheetId = String(req.query?.masterSheetId || req.body?.masterSheetId || "").trim();
      const actor = req.bertActor;

      if (!companyFolderId || !email || !email.includes("@")) {
        return res.status(400).json({ ok: false, error: "Company folder ID and a valid email are required." });
      }
      if (!masterSheetId) {
        return res.status(400).json({
          ok: false,
          blocker: "missing_master_sheet",
          error: "Company master spreadsheet ID is required to remove this user.",
        });
      }

      if (actor.kind === "company" && actor.masterSheetId && actor.masterSheetId !== masterSheetId) {
        return res.status(403).json({
          ok: false,
          blocker: "forbidden",
          error: "You can only remove users from your own company workspace.",
        });
      }

      if (actor.kind === "company" && actor.email === email) {
        return res.status(403).json({
          ok: false,
          blocker: "self_remove",
          error: "You cannot remove your own account while signed in.",
        });
      }

      const result = await removeCompanyUserAccount(auth, masterSheetId, companyFolderId, email);
      console.log("[company-user] remove", {
        email,
        companyFolderId,
        masterSheetIdPrefix: masterSheetId.slice(0, 8),
        actorKind: actor.kind,
        actorRole: actor.role,
        usersRowRemoved: result.usersRowRemoved,
        userAuthRemoved: result.userAuthRemoved,
        ok: result.ok,
      });

      if (result.companyMismatch) {
        return res.status(403).json({
          ok: false,
          blocker: "company_mismatch",
          error: "This user belongs to a different company folder.",
        });
      }
      if (result.notFound) {
        return res.status(404).json({
          ok: false,
          blocker: "user_not_found",
          error: "No user with this email was found on the company Users tab.",
        });
      }
      if (!result.ok) {
        return res.status(500).json({
          ok: false,
          error: "Unable to remove user from the company sheet.",
        });
      }

      return res.json({
        ok: true,
        removed: true,
        email,
        usersRowRemoved: result.usersRowRemoved,
        userAuthRemoved: result.userAuthRemoved,
      });
    } catch (error) {
      console.error("[company-user] remove failed:", error);
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to remove company user.",
      });
    }
  },
);

app.post("/api/google-sheet-by-id/:sheetId/users", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "Users");
});

app.post("/api/google-sheet-by-id/:sheetId/actions", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "Actions");
});

app.post("/api/google-sheet-by-id/:sheetId/action-comments", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "ActionComments");
});

app.post("/api/google-sheet-by-id/:sheetId/audit-results", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "AuditResults");
});

app.post("/api/google-sheet-by-id/:sheetId/audit-findings", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "AuditFindings");
});

app.post("/api/google-sheet-by-id/:sheetId/evidence", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "Evidence");
});

app.post("/api/google-sheet-by-id/:sheetId/incidents", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "Incidents");
});

app.post("/api/google-sheet-by-id/:sheetId/incident-actions", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "IncidentActions");
});

app.post("/api/google-sheet-by-id/:sheetId/sync-log", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "SyncLog");
});

app.post("/api/google-sheet-by-id/:sheetId/audit-bundle", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "AuditResults");
});

app.post("/api/google-sheet-by-id/:sheetId/reports", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "Reports");
});

app.post("/api/google-sheet-by-id/:sheetId/validate", async (req, res) => {
  const authed = getAuthedClient();

  if (!envConfigured() || !authed) {
    return res.status(401).json({
      ok: false,
      error: "Please connect Google before checking the workspace.",
    });
  }

  try {
    const config = await getConfig(authed, req.params.sheetId);
    const companyFolderId = String(req.body?.companyFolderId || "").trim();
    const payload = await validateWorkspace(authed, {
      companyFolderId,
      sheetId: req.params.sheetId,
      setupFolderId: String(req.body?.setupFolderId || config.setupFolderId || "").trim(),
      auditFormsFolderId: String(req.body?.auditFormsFolderId || config.auditFormsFolderId || "").trim(),
      recordsFolderId: String(req.body?.recordsFolderId || config.recordsFolderId || "").trim(),
      evidenceFolderId: String(req.body?.evidenceFolderId || config.evidenceFolderId || "").trim(),
      exportsFolderId: String(req.body?.exportsFolderId || config.exportsFolderId || "").trim(),
      managementNotesFolderId: String(req.body?.managementNotesFolderId || config.managementNotesFolderId || "").trim(),
    });
    if (companyFolderId) {
      const companyFoldersOk = Boolean(payload.folders?.companyFolder ?? payload.ok);
      await recordCompanyWorkspaceHealthCheck(authed, getCompanyWorkspaceRegistryDeps(), {
        companyId: companyFolderId,
        companyFolderId,
        rootFolderId: companyFolderId,
        masterSheetId: req.params.sheetId,
        companyName: String(req.body?.companyName || config.companyName || "").trim(),
        workbookFolderId: String(config.workbookFolderId || "").trim(),
        companyFoldersMappingStatus: companyFoldersOk ? "mapped" : "incomplete",
        firstAdminStatus: String(req.body?.firstAdminStatus || "").trim(),
        healthOk: Boolean(payload.ok),
        healthSummary: payload.ok ? "healthy" : "health_check_failed",
        unlinkReason: payload.ok
          ? ""
          : [
              ...(payload.missingTabs?.length ? [`missing_tabs:${payload.missingTabs.join(",")}`] : []),
              ...(payload.repairableIssues?.length ? payload.repairableIssues : []),
            ].join("; "),
      }).catch(() => {});
    }
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to check the workspace.",
    });
  }
});

app.post("/api/google-sheet-by-id/:sheetId/repair", async (_req, res) => {
  return respondLegacySheetByIdWriteRetired(res, "WorkspaceRepair");
});

/**
 * API route protection (paid pilot) — classification:
 * - publicSafe: GET /api/health, GET /api/readiness, OAuth browser callbacks
 * - inviteToken: app-hosted invite fetch/complete; new-company POST (may run before API Google is connected)
 * - googleSession: requireGoogleWorkspaceSession on company-user invite POST (SPA already requires Google)
 * - deferredAuth: legacy onboarding + notification POSTs — same-origin trust today; rate-limited (see docs/security-hardening-plan.md)
 */
app.post("/api/onboarding/invite", async (req, res) => {
  const toEmail = String(req.body?.email || "").trim().toLowerCase();
  const inviteRole = String(req.body?.role || "").trim();
  const invitedBy = String(req.body?.invitedBy || APP_BRAND_NAME).trim();
  const onboardingFormId = String(req.body?.onboardingFormId || "").trim();

  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return res.status(400).json({ ok: false, error: "A valid email address is required." });
  }
  if (!inviteRole) {
    return res.status(400).json({ ok: false, error: "Invite role is required." });
  }
  if (!onboardingFormId) {
    return res.status(400).json({ ok: false, error: "Onboarding form is not configured." });
  }

  try {
    const onboardingFormUrl = buildOnboardingFormViewUrl(onboardingFormId);
    const manualFallback = () => ({
      ok: true,
      delivery: "manual",
      senderEmail: requiredEnv.SMTP_FROM_EMAIL || "",
      onboardingUrl: onboardingFormUrl,
      mailtoUrl: buildOnboardingInviteMailto({
        toEmail,
        inviteRole,
        invitedBy,
        onboardingFormUrl,
      }),
    });
    if (!emailConfigured()) {
      return res.json(manualFallback());
    }
    await sendOnboardingInviteEmail({
      toEmail,
      inviteRole,
      invitedBy,
      onboardingFormUrl,
    });

    return res.json({ ok: true, delivery: "smtp", senderEmail: requiredEnv.SMTP_FROM_EMAIL || "" });
  } catch (error) {
    console.warn("[smtp] invite send failed; using manual fallback", {
      ...smtpConfigSummary(),
      ...smtpCredentialDiagnostics(),
      error: error instanceof Error ? error.message : "Unable to send onboarding invite email.",
    });
    const onboardingFormUrl = buildOnboardingFormViewUrl(onboardingFormId);
    return res.json({
      ok: true,
      delivery: "manual",
      senderEmail: requiredEnv.SMTP_FROM_EMAIL || "",
      onboardingUrl: onboardingFormUrl,
      mailtoUrl: buildOnboardingInviteMailto({
        toEmail,
        inviteRole,
        invitedBy,
        onboardingFormUrl,
      }),
    });
  }
});

app.post("/api/onboarding/app-invites/new-company", requireGoogleWorkspaceSession, requireMasterOnlyActor, (_req, res) => {
  res.status(410).json({
    ok: false,
    code: "deprecated_onboarding_path",
    error:
      "Google Form company onboarding is retired. Use Send company onboarding invite in Godmode to email the app-hosted setup link.",
  });
});

async function processCompanyUserInvite(req, res) {
    const toEmail = String(req.body?.email || "").trim().toLowerCase();
    const inviteRole = String(req.body?.role || "").trim();
    const invitedBy = String(req.body?.invitedBy || APP_BRAND_NAME).trim();
    let companyFolderId = String(req.body?.companyFolderId || "").trim();
    let masterSheetId = String(req.body?.masterSheetId || "").trim();
    const companyName = String(req.body?.companyName || "").trim();
    const resendRequested = req.body?.resend === true;
    const resendTokenId = String(req.body?.tokenId || "").trim();

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      res.status(400).json({ ok: false, error: "A valid email address is required." });
      return;
    }
    if (isPlatformOwnerEmail(toEmail, process.env)) {
      res.status(400).json({
        ok: false,
        code: "INVITE_INVALID",
        error: "The platform owner account cannot be used for company user invites.",
      });
      return;
    }
    if (!["Admin", "Manager", "Auditor"].includes(inviteRole)) {
      res.status(400).json({ ok: false, error: "Role must be Admin, Manager, or Auditor." });
      return;
    }
    if (!companyFolderId) {
      companyFolderId = String(req.body?.companyId || "").trim();
    }
    if (!companyFolderId) {
      res.status(400).json({
        ok: false,
        code: "company_folder_missing",
        error: "Company folder ID is required before inviting users.",
        blocker: "company_folder_missing",
      });
      return;
    }

    const inviteActor = parseBertActorFromRequest(req);
    if (inviteActor?.kind === "company") {
      const actorRole = parseRoleFromUsersSheet(inviteActor.role);
      inviteActor.role = actorRole;
      if (inviteActor.masterSheetId && masterSheetId && inviteActor.masterSheetId !== masterSheetId) {
        res.status(403).json({
          ok: false,
          code: "FORBIDDEN_COMPANY",
          error: "Your account is not linked to this company workspace.",
          blocker: "forbidden",
        });
        return;
      }
      if (inviteActor.masterSheetId) {
        masterSheetId = inviteActor.masterSheetId;
      }
      const authForScope = getAuthedClient();
      if (authForScope && masterSheetId) {
        try {
          const cfg = await getConfig(authForScope, masterSheetId);
          const ownCompanyFolderId = String(cfg.companyId || inviteActor.companyId || "").trim();
          if (ownCompanyFolderId) {
            if (companyFolderId && companyFolderId !== ownCompanyFolderId) {
              console.warn("[invite] company_user client companyFolderId overridden by actor config", {
                clientCompanyFolderId: companyFolderId,
                actorCompanyFolderId: ownCompanyFolderId,
                actorRole,
              });
            }
            companyFolderId = ownCompanyFolderId;
          }
        } catch (configErr) {
          console.warn("[invite] company_user actor scope check failed:", configErr);
        }
      }
      const permissionSession = buildInvitePermissionSession(inviteActor);
      const targetCompanyId =
        companyFolderId || String(inviteActor.companyId || "").trim();
      if (!canCreateCompanyInvite(permissionSession, targetCompanyId, inviteRole)) {
        const blockedRole =
          isCompanyInviteActor(permissionSession) && inviteRole !== "Auditor";
        res.status(403).json({
          ok: false,
          code: blockedRole ? "FORBIDDEN_INVITE_ROLE" : "FORBIDDEN_ROLE",
          error: blockedRole ? FORBIDDEN_INVITE_ROLE_MESSAGE : INVITE_ROLE_FORBIDDEN_MESSAGE,
          blocker: "forbidden",
        });
        return;
      }
    } else if (inviteActor && !isGodmodeInviteSession(buildInvitePermissionSession(inviteActor))) {
      res.status(403).json({
        ok: false,
        code: "FORBIDDEN_ROLE",
        error: INVITE_ROLE_FORBIDDEN_MESSAGE,
        blocker: "forbidden",
      });
      return;
    }

    const permissionSession = buildInvitePermissionSession(inviteActor);
    const isGodmodeActor = isGodmodeInviteSession(permissionSession);
    const isCompanyActor = isCompanyInviteActor(permissionSession);
    const auth = getAuthedClient();
    const warnings = [];

    let resolvedCompanyName = companyName;
    let resolvedCompanyFolderId = companyFolderId;
    let resolvedMasterSheetId = masterSheetId;
    let resolvedCompanyId = companyFolderId;

    if (auth) {
      const contextResult = await resolvePreparedCompanyUserInviteContext(auth, {
        companyFolderId,
        masterSheetId,
        companyName,
      });
      if (!contextResult.ok) {
        res.status(contextResult.httpStatus || 409).json({
          ok: false,
          code: contextResult.code || contextResult.reason,
          error: contextResult.message,
          blocker: contextResult.code || contextResult.reason,
        });
        return;
      }

      resolvedCompanyName = contextResult.companyContext?.companyName || companyName || "";
      resolvedCompanyFolderId = contextResult.companyContext?.companyFolderId || companyFolderId;
      resolvedMasterSheetId = contextResult.companyContext?.masterSheetId || masterSheetId;
      resolvedCompanyId = contextResult.companyContext?.companyId || companyFolderId;

      const isMasterInviter = inviteActor?.kind === "master" && inviteActor?.role === "Master";
      if (
        isSystemTemplateCompany({
          companyName: resolvedCompanyName,
          name: resolvedCompanyName,
        })
      ) {
        res.status(403).json({
          ok: false,
          code: "system_template_company",
          error: "This workspace is a system template and cannot be used for live company access.",
          blocker: "system_template_company",
        });
        return;
      }
    } else if (isCompanyActor) {
      warnings.push("platform_google_unavailable");
    } else {
      res.status(503).json({
        ok: false,
        code: "google_not_connected",
        error: isGodmodeActor
          ? INVITE_GOOGLE_UNAVAILABLE_GODMODE_MESSAGE
          : INVITE_EMAIL_UNAVAILABLE_COMPANY_MESSAGE,
        blocker: "google_not_connected",
      });
      return;
    }

    try {
      let id;
      if (resendRequested || resendTokenId) {
        const existing = findCompanyUserInviteForResend({
          email: toEmail,
          masterSheetId: resolvedMasterSheetId,
          tokenId: resendTokenId,
        });
        if (existing) {
          id = existing.id;
          console.log(`[invite] company_user resend token=${id.slice(0, 8)} recipient=${toEmail}`);
        } else {
          if (resendTokenId) {
            revokeInviteRecord(resendTokenId);
          }
          ({ id } = createInvite(
            { createInviteRecord },
            {
              email: toEmail,
              role: inviteRole,
              accessLevel: inviteAccessLevelForRole(inviteRole),
              invitedBy,
              companyFolderId: resolvedCompanyFolderId,
              masterSheetId: resolvedMasterSheetId,
              companyName: resolvedCompanyName || companyName,
            },
          ));
          console.log(`[invite] company_user replace token=${id.slice(0, 8)} recipient=${toEmail}`);
        }
      } else {
        ({ id } = createInvite(
          { createInviteRecord },
          {
            email: toEmail,
            role: inviteRole,
            accessLevel: inviteAccessLevelForRole(inviteRole),
            invitedBy,
            companyFolderId: resolvedCompanyFolderId,
            masterSheetId: resolvedMasterSheetId,
            companyName: resolvedCompanyName || companyName,
          },
        ));
        console.log(`[invite] company_user created token=${id.slice(0, 8)} recipient=${toEmail}`);
      }

      const inviteUrl = buildAppOnboardingUrl(id);
      const emailCompanyName = resolvedCompanyName || companyName;
      const { subject, textBody, senderEmail } = buildCompanyUserInviteEmailDraft({
        companyName: emailCompanyName,
        inviteUrl,
      });
      const smtpConfigured = emailConfigured();
      const lifecycle = auth
        ? await resolveCompanyUserInviteLifecycle(auth, resolvedMasterSheetId, toEmail, id)
        : defaultCompanyUserInviteLifecycle();
      const emailDraft = { subject, body: textBody };
      const mailtoUrl = buildCompanyUserInviteMailto({ toEmail, companyName: emailCompanyName, inviteUrl });

      if (!smtpConfigured) {
        console.warn("[smtp] company user invite email skipped; SMTP not configured");
        res.json(
          buildCompanyUserInviteApiPayload({
            emailSent: false,
            toEmail,
            inviteRole,
            inviteUrl,
            tokenId: id,
            senderEmail,
            lifecycle,
            smtpConfigured,
            emailDraft,
            mailtoUrl,
            warnings,
            isGodmodeActor,
          }),
        );
        return;
      }

      if (backgroundJobs?.queueInviteEmailJob) {
        const emailJob = backgroundJobs.queueInviteEmailJob({
          toEmail,
          companyName: emailCompanyName,
          inviteUrl,
          tokenId: id,
          companyId: resolvedCompanyId || resolvedCompanyFolderId,
          companyFolderId: resolvedCompanyFolderId,
          requestedBy: invitedBy,
        });
        console.log(`[invite] company_user email queued token=${id.slice(0, 8)} job=${emailJob?.jobId || ""}`);
        res.json(
          buildCompanyUserInviteApiPayload({
            emailSent: false,
            emailPending: true,
            backgroundJobId: emailJob?.jobId || "",
            toEmail,
            inviteRole,
            inviteUrl,
            tokenId: id,
            senderEmail,
            lifecycle,
            smtpConfigured: true,
            emailDraft,
            mailtoUrl,
            warnings,
            isGodmodeActor,
          }),
        );
        return;
      }

      try {
        await sendCompanyUserInviteEmail({ toEmail, companyName: emailCompanyName, inviteUrl });
        console.log(`[smtp] company user invite email sent recipient=${toEmail}`);
        res.json(
          buildCompanyUserInviteApiPayload({
            emailSent: true,
            toEmail,
            inviteRole,
            inviteUrl,
            tokenId: id,
            senderEmail,
            lifecycle,
            smtpConfigured: true,
            emailDraft,
            mailtoUrl,
            warnings,
            isGodmodeActor,
          }),
        );
      } catch (err) {
        const smtpError = safeSmtpErrorSummary(err);
        console.warn(`[smtp] company user invite email failed; manual fallback ${smtpError}`);
        res.json(
          buildCompanyUserInviteApiPayload({
            emailSent: false,
            toEmail,
            inviteRole,
            inviteUrl,
            tokenId: id,
            senderEmail,
            lifecycle,
            smtpConfigured,
            emailDraft,
            mailtoUrl,
            smtpError,
            warnings,
            isGodmodeActor,
          }),
        );
      }
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create onboarding invite.",
      });
    }
}

app.post("/api/onboarding/app-invites/company-user", requireGoogleWorkspaceEnv, (req, res) => {
  void processCompanyUserInvite(req, res).catch((err) => {
    console.error("[api] POST /api/onboarding/app-invites/company-user", err);
    if (!res.headersSent) {
      try {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : "Unable to create onboarding invite.",
        });
      } catch (sendErr) {
        console.error("[api] failed to write JSON error for company-user invite", sendErr);
      }
    }
  });
});

app.get("/api/onboarding/app-invites", requireGoogleWorkspaceEnv, (req, res) => {
  const actor = parseBertActorFromRequest(req);
  const permissionSession = buildInvitePermissionSession(actor);
  if (!actor || (!isGodmodeInviteSession(permissionSession) && !isCompanyInviteActor(permissionSession))) {
    res.status(403).json({
      ok: false,
      code: "FORBIDDEN_ROLE",
      error: INVITE_ROLE_FORBIDDEN_MESSAGE,
      blocker: "forbidden",
    });
    return;
  }
  const invites = listCompanyUserInviteRecords()
    .filter((entry) =>
      canViewInvite(permissionSession, {
        ...entry,
        inviteType: COMPANY_USER_INVITE_TYPE,
        type: COMPANY_USER_INVITE_TYPE,
      }),
    )
    .map((entry) => ({
      ...sanitizeCompanyUserInviteForClient({ id: entry.id, record: entry }),
      inviteUrl: buildAppOnboardingUrl(entry.id),
    }));
  res.json({ ok: true, invites });
});

app.delete("/api/onboarding/app-invites/:tokenId", requireGoogleWorkspaceEnv, (req, res) => {
  const run = async () => {
    const tokenId = String(req.params.tokenId || "").trim();
    if (!tokenId) {
      res.status(400).json({ ok: false, error: "Invite token is required." });
      return;
    }
    const record = getInviteRecord(tokenId);
    if (!record) {
      res.status(404).json({ ok: false, error: "Invite not found." });
      return;
    }
    const actor = parseBertActorFromRequest(req);
    const permissionSession = buildInvitePermissionSession(actor);
    if (
      !canRevokeInvite(permissionSession, {
        ...record,
        id: tokenId,
        inviteType: COMPANY_USER_INVITE_TYPE,
        type: COMPANY_USER_INVITE_TYPE,
      })
    ) {
      res.status(403).json({
        ok: false,
        code: "FORBIDDEN_ROLE",
        error: INVITE_MANAGE_AUDITOR_ONLY_MESSAGE,
        blocker: "forbidden",
      });
      return;
    }
    if (record.consumedAt) {
      if (record.kind === "company_user") {
        const auth = getAuthedClient();
        const assessment = await assessCompanyUserInviteReadiness(
          auth,
          record.masterSheetId,
          record.email,
          record,
        );
        if (assessment.setupIncomplete) {
          revokeInviteRecord(tokenId);
          console.log(`[invite] revoked setup_incomplete token=${tokenId.slice(0, 8)} email=${record.email}`);
          res.json({
            ok: true,
            revoked: true,
            wasSetupIncomplete: true,
            status: assessment.status,
            loginReady: false,
          });
          return;
        }
      }
      res.status(409).json({
        ok: false,
        error: "This invite was already completed and cannot be revoked.",
        blocker: "invite_already_active",
        hint: "Company users live on the company master spreadsheet (Users + UserAuth), not the operator Master sheet.",
      });
      return;
    }
    revokeInviteRecord(tokenId);
    console.log(`[invite] revoked token=${tokenId.slice(0, 8)} kind=${record.kind}`);
    res.json({ ok: true, revoked: true, tokenId });
  };

  void run().catch((err) => {
    console.error("[api] DELETE /api/onboarding/app-invites/:tokenId", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "Unable to revoke invite." });
    }
  });
});

app.post("/api/onboarding/repair-company-invite-target", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
  try {
    const authed = getAuthedClient();
    if (!authed) {
      return res.status(401).json({
        ok: false,
        code: "google_not_connected",
        error: "Connect Google Workspace before repairing invite links.",
      });
    }
    const companyId = String(req.body?.companyId || req.body?.companyFolderId || "").trim();
    const companyFolderId = String(req.body?.companyFolderId || companyId).trim();
    const masterSheetId = String(req.body?.masterSheetId || "").trim();
    const companyName = String(req.body?.companyName || "").trim();
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId is required." });
    }
    const result = await repairCompanyInviteTarget(
      authed,
      { companyId, companyFolderId, masterSheetId, companyName },
      getInviteTargetDeps(),
    );
    return res.json({
      ok: result.ok,
      code: result.code,
      message: result.message,
      repairedInvites: result.repairedInvites,
      masterSheetId: result.resolved?.masterSheetId || masterSheetId,
      companyFolderId: result.resolved?.companyFolderId || companyFolderId,
      registryUpdated: Boolean(result.resolved?.registryUpdated),
      promotedLive: Boolean(result.resolved?.promotedLive),
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to repair invite/company sheet link.",
    });
  }
});

app.get("/api/onboarding/company-invite-target-diagnostics", requireGoogleWorkspaceSession, requireMasterOnlyActor, async (req, res) => {
  try {
    const authed = getAuthedClient();
    if (!authed) {
      return res.status(401).json({
        ok: false,
        code: "google_not_connected",
        error: "Connect Google Workspace before checking invite diagnostics.",
      });
    }
    const companyId = String(req.query?.companyId || req.query?.companyFolderId || "").trim();
    const companyFolderId = String(req.query?.companyFolderId || companyId).trim();
    const masterSheetId = String(req.query?.masterSheetId || "").trim();
    const companyName = String(req.query?.companyName || "").trim();
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId is required." });
    }
    const result = await diagnoseCompanyInviteTarget(
      authed,
      { companyId, companyFolderId, masterSheetId, companyName },
      getInviteTargetDeps(),
    );
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load invite target diagnostics.",
    });
  }
});

const handleGetInviteToken = createGetInviteHandler({ sessionDir, getInviteRecord });

app.get("/api/invites/:token", handleGetInviteToken);

app.get("/api/onboarding/app-invites/:tokenId", (req, res) => {
  req.query = { ...req.query, expectedType: "COMPANY_USER" };
  return handleGetInviteToken(req, res);
});

async function handleAppInviteComplete(req, res) {
  try {
    const authed = getAuthedClient();
    const tokenId = String(req.params.tokenId || "").trim();
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.fullName || "").trim();
    const companyName = String(req.body?.companyName || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "");

    if (!tokenId) {
      return res.status(400).json({ ok: false, error: "Invite token is required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    }
    if (confirmPassword && confirmPassword !== password) {
      return res.status(400).json({ ok: false, error: "Password confirmation does not match." });
    }
    if (!fullName) {
      return res.status(400).json({ ok: false, error: "Full name is required." });
    }

    if (!envConfigured()) {
      return sendGoogleWorkspaceUnavailable(res);
    }
    if (!authed) {
      return res.status(401).json({
        ok: false,
        code: "google_not_connected",
        error:
          "Account setup is not available right now because Google Workspace is not connected on the server. Ask your administrator to reconnect Google, then try again.",
      });
    }

    await runWithInviteCompletionLock(tokenId, async () => {
      let record = normalizeInviteProvisionFields(getInviteRecord(tokenId));
      if (!record) {
        res.status(404).json({
          ok: false,
          code: "INVITE_INVALID",
          error: "This invite link is not valid. Ask your administrator to send a new invite.",
        });
        return;
      }

      if (record.kind === "new_company") {
        res.status(400).json({
          ok: false,
          code: "INVITE_WRONG_TYPE",
          error: "New company setup uses the company onboarding link from your email.",
        });
        return;
      }

      if (isPlatformOwnerEmail(String(record.email || "").trim(), process.env)) {
        res.status(400).json({
          ok: false,
          code: "INVITE_INVALID",
          error: "The platform owner account cannot be used for invite flows.",
        });
        return;
      }

      const tokenAccess = resolveCompanyUserInviteTokenAccess(record, tokenId);
      if (!tokenAccess.ok && tokenAccess.code !== "INVITE_ALREADY_USED") {
        res.status(tokenAccess.httpStatus).json({
          ok: false,
          code: tokenAccess.code,
          error: tokenAccess.error,
        });
        return;
      }

      if (record.consumedAt) {
        const status = record.provisionStatus || "succeeded";
        if (status === "succeeded") {
          if (record.kind === "new_company") {
            const fid = record.provisionDriveFolderId;
            res.json({
              ok: true,
              outcome: "new_company",
              companyFolderId: fid || "",
              masterSheetId: record.provisionMasterSheetId || "",
              folderUrl: fid ? `https://drive.google.com/drive/folders/${fid}` : "",
            });
            return;
          }
          if (record.kind === "company_user") {
            const assessment = await assessCompanyUserInviteReadiness(
              authed,
              record.masterSheetId,
              record.email,
              record,
            );
            if (assessment.loginReady) {
              res.json({
                ok: true,
                outcome: "company_user",
                loginReady: true,
                status: "active",
                masterSheetId: record.masterSheetId,
                companyFolderId: record.companyFolderId,
              });
              return;
            }
            const retryContext = await resolvePreparedCompanyUserInviteContext(authed, record);
            if (!retryContext.ok) {
              logInviteCompleteFailure({
                code: retryContext.code,
                email: record.email,
                tokenId,
                company: record.companyName || record.companyFolderId,
                masterSheetIdPresent: Boolean(record.masterSheetId),
              });
              res.status(retryContext.httpStatus || 409).json({
                ok: false,
                code: retryContext.code,
                message: retryContext.message,
                error: retryContext.message,
                setupIncomplete: true,
                canRetrySetup: false,
              });
              return;
            }
            record = {
              ...record,
              companyId: retryContext.companyContext?.companyId || record.companyId || record.companyFolderId,
              companyFolderId: retryContext.companyContext?.companyFolderId || record.companyFolderId,
              masterSheetId: retryContext.companyContext?.masterSheetId || record.masterSheetId,
              companyName: retryContext.companyContext?.companyName || record.companyName,
            };
            console.warn("[invite] company_user retry incomplete setup", {
              tokenIdPrefix: tokenId.slice(0, 8),
              email: record.email,
              masterSheetId: record.masterSheetId,
              companyFolderId: record.companyFolderId,
              usersRowPresent: assessment.usersRowPresent,
              userAuthPresent: assessment.userAuthPresent,
            });
            patchInviteRecord(tokenId, {
              consumedAt: null,
              provisionStatus: "failed",
              provisionFinishedAt: Date.now(),
              provisionError: "Previous setup did not finish. Retrying account creation.",
            });
            record = normalizeInviteProvisionFields(getInviteRecord(tokenId));
          }
        }
        if (record?.consumedAt) {
          res.status(410).json({
            ok: false,
            code: "invite_already_used",
            error: "This invite has already been used. Sign in with your email and password, or ask for a new invite.",
          });
          return;
        }
      }

      if (Date.now() > record.expiresAt) {
        res.status(410).json({
          ok: false,
          code: "invite_expired",
          error: "This invite has expired. Ask your administrator to send a new invite.",
        });
        return;
      }

      if (record.kind === "company_user") {
        const contextResult = await resolvePreparedCompanyUserInviteContext(authed, record);
        if (!contextResult.ok) {
          logInviteCompleteFailure({
            code: contextResult.code,
            email: record.email,
            tokenId,
            company: record.companyName || record.companyFolderId,
            masterSheetIdPresent: Boolean(record.masterSheetId),
          });
          res.status(contextResult.httpStatus || 409).json({
            ok: false,
            code: contextResult.code,
            message: contextResult.message,
            error: contextResult.message,
            setupIncomplete: contextResult.code === "INVITE_COMPANY_LINK_MISSING",
            canRetrySetup: false,
          });
          return;
        }
        record = {
          ...record,
          companyId: contextResult.companyContext?.companyId || record.companyId || record.companyFolderId,
          companyFolderId: contextResult.companyContext?.companyFolderId || record.companyFolderId,
          masterSheetId: contextResult.companyContext?.masterSheetId || record.masterSheetId,
          companyName: contextResult.companyContext?.companyName || record.companyName,
        };
      }

      if (record.provisionStatus === "running" && record.provisionStartedAt != null) {
        const elapsed = Date.now() - Number(record.provisionStartedAt);
        if (elapsed >= 0 && elapsed < INVITE_PROVISION_STALE_RUNNING_MS) {
          res.status(202).json({
            ok: false,
            code: "invite_in_progress",
            provisionStatus: "running",
            error: "Your account setup is already in progress. Keep this page open for a few minutes.",
          });
          return;
        }
        patchInviteRecord(tokenId, {
          provisionStatus: "failed",
          provisionFinishedAt: Date.now(),
          provisionError:
            record.kind === "company_user"
              ? "The previous account creation attempt appears stuck or timed out. You can try again."
              : "The previous workspace setup attempt appears stuck or timed out. You can try completing onboarding again.",
        });
      }

      if (record.kind === "new_company" && !companyName) {
        res.status(400).json({ ok: false, error: "Company name is required." });
        return;
      }

      try {
        /**
         * On failure after Drive/Sheets partial work we mark failed and do NOT consume the invite,
         * so the same token can be retried (may orphan folders — same as pre–Phase 2 behaviour).
         * Success writes succeeded + consumedAt in one patch so GET never exposes a succeeded unconsumed window.
         */
        patchInviteRecord(tokenId, {
          provisionStatus: "running",
          provisionStartedAt: Date.now(),
          provisionFinishedAt: null,
          provisionError: null,
        });

        if (record.kind === "new_company") {
          const inviteEmailDomain = String(record.email || "").includes("@")
            ? String(record.email)
                .split("@")
                .pop()
                ?.toLowerCase() || ""
            : "";
          console.log("[invite] new_company provision start", {
            tokenIdPrefix: tokenId.slice(0, 8),
            companyNameLen: companyName.trim().length,
            inviteEmailDomain: inviteEmailDomain || undefined,
          });
          const result = await provisionNewCompanyWorkspace(
            authed,
            {
              companyName,
              adminEmail: record.email,
              adminFullName: fullName,
              password,
            },
            async (progressPatch) => {
              patchInviteRecord(tokenId, progressPatch);
            },
          );
          console.log("[invite] new_company provision done", {
            companyFolderId: result.companyFolderId,
            masterSheetId: result.masterSheetId,
          });
          patchInviteRecord(tokenId, {
            provisionStatus: "succeeded",
            provisionFinishedAt: Date.now(),
            provisionError: null,
            provisionDriveFolderId: result.companyFolderId,
            provisionMasterSheetId: result.masterSheetId,
            consumedAt: Date.now(),
          });
          res.json({
            ok: true,
            outcome: "new_company",
            companyFolderId: result.companyFolderId,
            masterSheetId: result.masterSheetId,
            folderUrl: `https://drive.google.com/drive/folders/${result.companyFolderId}`,
          });
          return;
        }

        if (record.kind === "company_user") {
          let usersWriteOk = false;
          let userAuthWriteOk = false;
          let completedMarked = false;
          const inviteAccessLevel =
            String(record.accessLevel || "").trim() || inviteAccessLevelForRole(record.role);
          console.log("[invite] company_user completion start", {
            tokenIdPrefix: tokenId.slice(0, 8),
            email: record.email,
            masterSheetId: record.masterSheetId,
            companyFolderId: record.companyFolderId,
            role: record.role,
          });
          try {
            const completion = await completeInviteToUserRow(
              authed,
              record,
              { fullName, password, confirmPassword },
              {
                getCompanyUsersDeps,
                getCompanyResolverDeps: () => ({ google, ...getCompanyWorkspaceRegistryDeps() }),
                resolveCompanyFromFolder,
                authIndex: authIndexApi,
              },
            );
            usersWriteOk = completion.ok;
            userAuthWriteOk = completion.ok;
            if (!completion.ok) {
              throw new Error(
                "Account setup could not be verified on the company sheet (Users tab PasswordHash).",
              );
            }
            const inviteFolderId = String(record.companyFolderId || record.companyId || "").trim();
            const inviteCompanyName = String(record.companyName || "").trim();
            patchInviteRecord(tokenId, {
              inviteType: "COMPANY_USER",
              status: "USED",
              provisionStatus: "succeeded",
              provisionFinishedAt: Date.now(),
              provisionError: null,
              consumedAt: Date.now(),
            });
            completedMarked = true;

            const responseUser = {
              email: record.email,
              name: fullName,
              role: record.role,
              accessLevel: inviteAccessLevel,
              status: "ACTIVE",
              companyId: inviteFolderId,
              companyName: inviteCompanyName,
            };
            console.log("[invite] company_user completion ok", {
              tokenIdPrefix: tokenId.slice(0, 8),
              email: record.email,
              masterSheetId: record.masterSheetId,
              companyFolderId: inviteFolderId,
              usersWriteOk,
              userAuthWriteOk,
              completedMarked,
            });
            res.json({
              ok: true,
              accountCreated: true,
              user: responseUser,
              nextAction: "SIGN_IN",
              outcome: "company_user",
              loginReady: true,
              status: "active",
              email: record.email,
              masterSheetId: record.masterSheetId,
              companyFolderId: inviteFolderId,
              companyName: inviteCompanyName,
            });
            return;
          } catch (completionErr) {
            const msg =
              completionErr instanceof Error
                ? completionErr.message
                : "Unable to complete company user setup.";
            const failureCode = /not found/i.test(msg) ? "stale_invite_target" : "USER_ACCOUNT_CREATE_FAILED";
            const friendlyMessage =
              failureCode === "stale_invite_target"
                ? "The company master sheet for this invite could not be found. Ask your administrator to send a new invite."
                : "We couldn't finish creating your account. Please try again.";
            logInviteCompleteFailure({
              code: failureCode,
              email: record.email,
              tokenId,
              company: record.companyName || record.companyFolderId,
              masterSheetIdPresent: Boolean(record.masterSheetId),
            });
            console.warn("[invite] company_user completion failed", {
              tokenIdPrefix: tokenId.slice(0, 8),
              email: record.email,
              masterSheetId: record.masterSheetId,
              companyFolderId: record.companyFolderId,
              usersWriteOk,
              userAuthWriteOk,
              completedMarked,
              message: msg,
              code: failureCode,
            });
            patchInviteRecord(tokenId, {
              provisionStatus: "failed",
              provisionFinishedAt: Date.now(),
              provisionError: friendlyMessage,
              consumedAt: null,
            });
            res.status(failureCode === "stale_invite_target" ? 409 : 500).json({
              ok: false,
              code: failureCode,
              message: friendlyMessage,
              provisionStatus: "failed",
              setupIncomplete: failureCode !== "stale_invite_target",
              canRetrySetup: failureCode !== "stale_invite_target",
              usersWriteOk,
              userAuthWriteOk,
              error: friendlyMessage,
            });
            return;
          }
        }

        patchInviteRecord(tokenId, {
          provisionStatus: "failed",
          provisionFinishedAt: Date.now(),
          provisionError: "Unknown invite type.",
        });
        res.status(400).json({ ok: false, error: "Unknown invite type." });
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : "Unable to complete onboarding.";
        const failureCode =
          record?.kind === "company_user"
            ? /not found/i.test(rawMsg)
              ? "stale_invite_target"
              : "USER_ACCOUNT_CREATE_FAILED"
            : /not found/i.test(rawMsg)
              ? "stale_invite_target"
              : "USER_SETUP_FAILED";
        const friendlyMessage =
          failureCode === "stale_invite_target"
            ? record?.kind === "company_user"
              ? "The company master sheet for this invite could not be found. Ask your administrator to send a new invite."
              : "The company workspace for this invite could not be found. Ask your administrator to send a new invite."
            : record?.kind === "company_user"
              ? "We couldn't finish creating your account. Please try again."
              : "We couldn't finish setting up your account. Ask your administrator to check your invite.";
        logInviteCompleteFailure({
          code: failureCode,
          email: record?.email,
          tokenId,
          company: record?.companyName || record?.companyFolderId,
          masterSheetIdPresent: Boolean(record?.masterSheetId),
        });
        console.error("[invite] complete provision stage failed", {
          tokenIdPrefix: tokenId.slice(0, 8),
          inviteKind: record?.kind,
          message: rawMsg,
          code: failureCode,
        });
        patchInviteRecord(tokenId, {
          provisionStatus: "failed",
          provisionFinishedAt: Date.now(),
          provisionError: friendlyMessage,
          ...(record?.kind === "company_user" ? { consumedAt: null } : {}),
        });
        res.status(failureCode === "stale_invite_target" ? 409 : 500).json({
          ok: false,
          code: failureCode,
          message: friendlyMessage,
          provisionStatus: "failed",
          canRetrySetup: failureCode !== "stale_invite_target",
          error: friendlyMessage,
        });
      }
    });
  } catch (error) {
    console.error("[invite] complete unexpected failure", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to complete onboarding.",
      });
    }
  }
}

app.post("/api/onboarding/app-invites/:tokenId/complete", handleAppInviteComplete);
app.post("/api/invites/company-user/:tokenId/complete", handleAppInviteComplete);

app.get("/api/invites/smtp/status", smtpStatusGetRateLimit, async (_req, res) => {
  const config = smtpConfigSummary();
  const diagnostics = smtpCredentialDiagnostics();
  const verification = await verifySmtpTransport();
  return res.json({
    ok: verification.ok,
    host: config.host,
    port: config.port,
    user: config.user,
    from: config.from,
    secure: config.secure,
    verification,
    diagnostics,
  });
});

app.post("/api/manager/non-compliance-alert", async (req, res) => {
  const recipients = Array.isArray(req.body?.emails)
    ? req.body.emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const auditName = String(req.body?.auditName || "").trim();
  const submittedBy = String(req.body?.submittedBy || "Unknown").trim();
  const nonComplianceCount = Number(req.body?.nonComplianceCount || 0);
  const queuedForSync = Boolean(req.body?.queuedForSync);

  if (recipients.length === 0) {
    return res.status(400).json({ ok: false, error: "At least one manager email is required." });
  }
  if (!auditName) {
    return res.status(400).json({ ok: false, error: "Audit name is required." });
  }
  if (!Number.isFinite(nonComplianceCount) || nonComplianceCount <= 0) {
    return res.status(400).json({ ok: false, error: "nonComplianceCount must be greater than zero." });
  }

  try {
    await sendManagerNonComplianceAlertEmail({
      recipients,
      auditName,
      submittedBy,
      nonComplianceCount,
      queuedForSync,
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send manager alert email.",
    });
  }
});

app.post("/api/ncr/escalation-alert", async (req, res) => {
  const toEmail = String(req.body?.email || "").trim().toLowerCase();
  const ncrReference = String(req.body?.ncrReference || "").trim();
  const auditorName = String(req.body?.auditorName || "Unknown").trim();
  const site = String(req.body?.site || "Unknown").trim();
  const raisedAt = String(req.body?.raisedAt || "").trim();
  const auditQuestion = String(req.body?.auditQuestion || "").trim();
  const selectedAnswer = String(req.body?.selectedAnswer || "").trim();
  const investigationLink = String(req.body?.investigationLink || "").trim();

  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return res.status(400).json({ ok: false, error: "A valid manager email is required." });
  }
  if (!ncrReference || !auditQuestion || !raisedAt || !investigationLink) {
    return res.status(400).json({ ok: false, error: "Missing required NCR escalation details." });
  }

  try {
    await sendNcrEscalationEmail({
      toEmail,
      ncrReference,
      auditorName,
      site,
      raisedAt,
      auditQuestion,
      selectedAnswer,
      investigationLink,
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send NCR escalation email.",
    });
  }
});

app.post("/api/incidents/notify", async (req, res) => {
  const incidentId = String(req.body?.incidentId || "").trim();
  const incidentType = String(req.body?.incidentType || "").trim();
  const severity = String(req.body?.severity || "").trim();
  const reporter = String(req.body?.reporter || "").trim();
  const department = String(req.body?.department || "").trim();
  const location = String(req.body?.location || "").trim();
  const status = String(req.body?.status || "Open").trim();
  const incidentDate = String(req.body?.incidentDate || "").trim();
  const incidentTime = String(req.body?.incidentTime || "").trim();
  const priority = String(req.body?.priority || "Normal").trim();
  const escalated = Boolean(req.body?.escalated);
  const viewLink = String(req.body?.viewLink || "").trim();

  if (!incidentId || !incidentType || !severity || !reporter || !department || !location || !incidentDate) {
    return res.status(400).json({ ok: false, error: "Missing required incident notification fields." });
  }

  try {
    await sendIncidentReportEmail({
      incidentId,
      incidentType,
      severity,
      reporter,
      department,
      location,
      status,
      incidentDate,
      incidentTime,
      priority,
      escalated,
      viewLink,
    });
    return res.json({ ok: true, escalated });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send incident notification email.",
    });
  }
});

app.post("/api/reports/email-pdf", async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const html = String(req.body?.html || "").trim();
  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const workspaceName = String(req.body?.workspaceName || "").trim();
  const createdBy = String(req.body?.createdBy || "").trim();

  if (!title || !html) {
    return res.status(400).json({ ok: false, error: "Report title and content are required." });
  }
  if (!recipients.length) {
    return res.status(400).json({ ok: false, error: "Select at least one recipient before emailing this report." });
  }

  try {
    const result = await sendReportPackEmail({ title, html, recipients, workspaceName, createdBy });
    return res.json({
      ok: true,
      message: `Report emailed to ${result.recipientCount} recipient${result.recipientCount === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to email this report.",
      message: error instanceof Error ? error.message : "Unable to email this report.",
    });
  }
});

app.get("/auth/google/login", (req, res) => {
  if (!envConfigured()) {
    return sendGoogleWorkspaceUnavailable(res);
  }

  const auth = createOAuthClient();
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("qms_google_state", state, signedStateCookie(state));

  const authUrl = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
  });

  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    if (!envConfigured()) {
      return sendCallbackPage(res, {
        title: "Google workspace not configured",
        message: GOOGLE_WORKSPACE_UNAVAILABLE_ERROR,
        success: false,
      });
    }
    const state = req.query.state;
    const code = req.query.code;

    if (!state || !code || typeof state !== "string" || typeof code !== "string") {
      return res.status(400).send("Missing Google callback parameters.");
    }

    const signedState = req.signedCookies.qms_google_state;
    const localDevBypass =
      process.env.ALLOW_INSECURE_OAUTH_STATE === "true" ||
      process.env.NODE_ENV !== "production";

    if ((!signedState || signedState !== state) && !localDevBypass) {
      return sendCallbackPage(res, {
        title: "Google connection could not be completed",
        message: `The sign-in state could not be verified. Please start the connection again from ${APP_BRAND_NAME}.`,
        success: false,
      });
    }

    const auth = createOAuthClient();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    let profile = null;
    try {
      const oauth2 = google.oauth2({ version: "v2", auth });
      const response = await oauth2.userinfo.get();
      profile = response.data;
    } catch {
      profile = null;
    }

    writeStoredSession(
      {
        tokens,
        profile,
        connectedAt: new Date().toISOString(),
      },
      { logContext: "oauth_callback" },
    );

    res.clearCookie("qms_google_state");
    return sendCallbackPage(res, {
      title: "Google connection completed",
      message: `Your Google Drive root folder is now linked. Returning to ${APP_BRAND_NAME} now.`,
      success: true,
      redirectUrl: `${requiredEnv.FRONTEND_URL.replace(/\/$/, "")}/?google=connected`,
    });
  } catch (error) {
    console.error("Google sign-in callback failed:", error);
    return sendCallbackPage(res, {
      title: "Google connection failed",
      message: error instanceof Error ? error.message : "Google sign-in could not be completed.",
      success: false,
    });
  }
});

async function disconnectGoogleWorkspace() {
  const session = readStoredSession();
  if (session?.tokens?.access_token) {
    try {
      const auth = createOAuthClient();
      auth.setCredentials(session.tokens);
      await auth.revokeCredentials();
    } catch {
      // Ignore revoke errors in local dev.
    }
  }
  clearStoredSession("admin_disconnect");
}

/** Explicit admin disconnect — clears API-wide Google Workspace OAuth (Initial Setup only). */
async function handleGoogleWorkspaceDisconnect(_req, res) {
  await disconnectGoogleWorkspace();
  return res.json({ ok: true, disconnected: true });
}

app.post("/auth/google/disconnect", handleGoogleWorkspaceDisconnect);
app.post("/api/google/disconnect", handleGoogleWorkspaceDisconnect);

/** User sign-out must not clear workspace OAuth; use /auth/google/disconnect from Initial Setup. */
app.post("/auth/google/logout", (_req, res) => {
  return res.json({
    ok: true,
    workspaceTokenCleared: false,
    hint: "Google Workspace remains connected. Use POST /auth/google/disconnect to remove the API OAuth token.",
  });
});

function readDiagnosticCompanySessionFolderId(req) {
  try {
    const raw = req.signedCookies?.[COMPANY_SESSION_COOKIE];
    if (!raw || typeof raw !== "string") {
      return "";
    }
    const data = JSON.parse(raw);
    return String(data?.companyFolderId || data?.companyId || "").trim();
  } catch {
    return "";
  }
}

app.post("/api/auth/company/login", async (req, res) => {
  const routeTiming = createLoginTimingTrace({ route: "company_login" });
  routeTiming.mark("route_entered");
  routeTiming.mark("login_request_hints", safeLoginRequestHintMeta(req.body));
  try {
    const tParse = Date.now();
    const loginInput = buildCompanyLoginInputFromRequestBody(
      req.body || {},
      readDiagnosticCompanySessionFolderId(req),
    );
    const loginIdentity = loginInput.email || loginInput.username || "";
    const loginPassword = loginInput.password;
    routeTiming.phase("request_parsed", tParse, {
      ...loginTimingEmailMeta(loginIdentity.includes("@") ? loginIdentity : ""),
      hasPassword: Boolean(loginPassword),
      hasCompanyFolderId: Boolean(loginInput.companyFolderId || loginInput.sessionCompanyFolderId),
      identityIsUsername: Boolean(loginIdentity) && !loginIdentity.includes("@"),
    });

    if (loginIdentity.includes("@") && isPlatformOwnerEmail(loginIdentity, process.env)) {
      const masterResult = performMasterLogin(
        {
          sessionDir,
          findOperatorByIdentity,
          verifyPassword,
          upsertMasterOperator,
          loginTiming: routeTiming,
        },
        { email: loginIdentity, password: loginPassword },
      );
      if (!masterResult.ok) {
        logLoginTimingMark("total_login_duration", {
          durationMs: routeTiming.totalMs(),
          ok: false,
          flow: "master",
        });
        return res.status(masterResult.httpStatus || 401).json({
          ok: false,
          code: masterResult.code || "INVALID_CREDENTIALS",
          reasonCode: masterResult.reasonCode || "master_invalid_credentials",
          blocker: "invalid_credentials",
          error: masterResult.error || "Sign in failed.",
          timingMs: masterResult.timing,
        });
      }
      res.cookie(MASTER_SESSION_COOKIE, masterResult.sessionPayload, getSessionCookieOptions({ maxAge: MASTER_SESSION_MS }));
      logLoginTimingMark("total_login_duration", {
        durationMs: routeTiming.totalMs(),
        ok: true,
        flow: "master",
      });
      return res.json({
        ...buildMasterSessionApiResponse({ email: masterResult.email, name: masterResult.name }),
        timingMs: masterResult.timing,
      });
    }

    const auth = getAuthedClient();
    const result = await performCompanyLogin(
      auth,
      {
        ...getCompanyContextResolutionDeps(),
        authIndex: authIndexApi,
        getCompanyUsersDeps,
        getCompanyResolverDeps: () => ({ google, ...getCompanyWorkspaceRegistryDeps() }),
        resolveCompanyFromFolder,
        findMasterSheetIdsForCompanyLoginEmail,
        sessionRevocation: companySessionRevocationApi,
        isPlatformOwner: isPlatformOwnerEmail,
        masterSheetCache: masterSheetCacheApi,
        loginTiming: routeTiming,
      },
      loginInput,
    );

    if (!result.ok) {
      const invalidCredentials =
        result.code === INVALID_CREDENTIALS || result.blocker === "invalid_credentials";
      routeTiming.total("total_login_duration", { ok: false, flow: "company" });
      return res.status(result.httpStatus || 400).json({
        ok: false,
        code: result.code,
        message: result.message || result.error,
        blocker: result.blocker,
        error: result.error,
        reasonCode: result.diagnostics?.reasonCode || result.reasonCode,
        authFailureReason: result.authFailureReason,
        diagnostics: result.diagnostics,
        ...(invalidCredentials
          ? {}
          : { companyContextValid: result.companyContextValid ?? false }),
        timingMs: result.timing,
      });
    }

    res.cookie(COMPANY_SESSION_COOKIE, result.sessionPayload, getSessionCookieOptions({ maxAge: COMPANY_SESSION_MS }));

    const responseStarted = Date.now();
    res.on("finish", () => {
      const responseSentMs = Date.now() - responseStarted;
      console.log(`[login] response_sent durationMs=${responseSentMs}`);
      routeTiming.phase("response_sent", responseStarted, { flow: "company" });
      if (result.timing) {
        result.timing.response_sent = responseSentMs;
      }
      const tJobs = Date.now();
      routeTiming.mark("background_jobs_queued_start", { flow: "company_post_response" });
      try {
        queueCompanyLoginBackgroundJobs(
          {
            authIndex: authIndexApi,
            getAuthedClient,
            getCompanyUsersDeps,
            enqueueBackgroundJob: (input) => backgroundJobs?.enqueueJob?.(input),
          },
          result.backgroundJobs,
        );
      } catch (error) {
        console.warn("[login] post-response background job queue failed", error);
      } finally {
        routeTiming.phase("background_jobs_queued_end", tJobs, { flow: "company_post_response" });
        routeTiming.total("total_login_duration", {
          ok: true,
          flow: "company",
          includeResponse: true,
        });
      }
    });

    return res.json({
      ok: true,
      clearClientHints: result.clearClientHints === true,
      companyContextValid: true,
      user: result.user,
      masterSheetId: result.masterSheetId,
      company: result.company,
      timingMs: result.timing,
    });
  } catch (error) {
    console.error("[company-auth] login failed:", error);
    const email = String(req.body?.email || req.body?.username || "").trim().toLowerCase();
    return res.status(500).json({
      ok: false,
      code: LOGIN_CONTEXT_FAILED,
      message: "Unable to complete sign in.",
      error: "Unable to complete sign in.",
      companyContextValid: false,
      diagnostics: {
        email,
        failedStep: "session_create",
        companyName: "",
        companyId: "",
        companyFolderId: "",
        masterSheetId: String(req.body?.masterSheetId || "").trim(),
        reasonCode: "unexpected_error",
      },
    });
  }
});

app.post("/api/auth/company/logout", (req, res) => {
  console.log("[auth] company logout");
  res.clearCookie(COMPANY_SESSION_COOKIE, getSessionCookieOptions());
  return res.json({ ok: true });
});

async function respondCompanyUserSession(req, res, options = {}) {
  const sendCompanySessionResult = (status, body) => {
    const payload =
      options.includeSessionKind && body?.ok === true ? { sessionKind: "company", ...body } : body;
    return res.status(status).json(payload);
  };
  try {
    const raw = req.signedCookies?.[COMPANY_SESSION_COOKIE];
    if (!raw || typeof raw !== "string") {
      return res.status(401).json({ ok: false, error: "No company session." });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid session." });
    }
    if (data.v !== 1 || !data.email || !data.masterSheetId) {
      return res.status(401).json({ ok: false, error: "Invalid session." });
    }
    if (
      companySessionRevocationApi.isCompanyUserSessionRevoked(
        data.email,
        data.companyId,
        data.masterSheetId,
      )
    ) {
      res.clearCookie(COMPANY_SESSION_COOKIE, getSessionCookieOptions());
      return res.status(401).json({ ok: false, error: "Session invalid." });
    }
    const sessionCompanyAreas = Array.isArray(data.companyAreas) ? data.companyAreas : [];
    const companyIdFromSession = String(data.companyId || "").trim();
    const companyNameFromSession = String(data.companyName || "").trim();
    if (isKnownStaleAuthIndexPairing(data.email, companyNameFromSession)) {
      authIndexApi.removeEntry?.(data.email);
      res.clearCookie(COMPANY_SESSION_COOKIE, getSessionCookieOptions());
      return res.status(409).json({
        ok: false,
        code: COMPANY_CONTEXT_INVALID,
        companyContextValid: false,
        error: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
        reasonCode: COMPANY_CONTEXT_INVALID,
      });
    }
    if (!envConfigured()) {
      const companyFolderId = companyIdFromSession;
      return sendCompanySessionResult(
        200,
        buildCompanySessionApiResponse({
          email: data.email,
          role: data.role || "Admin",
          name: data.name || data.email,
          accessLevel: data.accessLevel || "",
          companyAreas: sessionCompanyAreas,
          companyId: companyFolderId,
          companyFolderId,
          companyName: companyNameFromSession,
          masterSheetId: String(data.masterSheetId || "").trim(),
          companyContextValid: Boolean(companyFolderId && data.masterSheetId),
        }),
      );
    }
    const auth = getAuthedClient();
    if (!auth) {
      return res.status(401).json({ ok: false, error: "Google connection required for this action." });
    }
    const rec = await readCompanyUsersTabRecord(auth, data.masterSheetId, data.email);
    if (!rec || rec.status !== "ACTIVE") {
      authIndexApi.removeEntry?.(data.email);
      res.clearCookie(COMPANY_SESSION_COOKIE, getSessionCookieOptions());
      return res.status(401).json({ ok: false, error: "Session invalid." });
    }

    const masterSheetId = String(data.masterSheetId || "").trim();
    const trusted = await authIndexApi
      .verifyAuthIndexEntryMatchesUsersWorkbook(auth, getCompanyContextEnrichmentDeps(), data.email, {
        masterSheetId,
        companyFolderId: companyIdFromSession,
        companyName: companyNameFromSession,
      })
      .catch(() => ({ ok: false, removeEntry: true }));
    if (!trusted.ok) {
      authIndexApi.removeEntry?.(data.email);
      res.clearCookie(COMPANY_SESSION_COOKIE, getSessionCookieOptions());
      return res.status(409).json({
        ok: false,
        code: COMPANY_CONTEXT_INVALID,
        companyContextValid: false,
        error: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
        reasonCode: COMPANY_CONTEXT_INVALID,
      });
    }

    const validation = trusted.validation || {};

    const companyId = String(validation.companyFolderId || "").trim();
    const resolvedCompanyName = String(validation.companyName || "").trim();
    const resolvedMasterSheetId = String(validation.masterSheetId || masterSheetId).trim();
    const folderPlacementOk = validation.folderPlacementOk !== false;

    if (
      companyNameFromSession &&
      resolvedCompanyName &&
      companyNameFromSession.trim().toLowerCase() !== resolvedCompanyName.trim().toLowerCase()
    ) {
      res.clearCookie(COMPANY_SESSION_COOKIE, getSessionCookieOptions());
      authIndexApi.removeEntry(data.email);
      return res.status(409).json({
        ok: false,
        code: COMPANY_CONTEXT_INVALID,
        companyContextValid: false,
        error: validation.message || COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
        reasonCode: COMPANY_CONTEXT_INVALID,
      });
    }

    const registryRecord = companyId
      ? await getCanonicalCompanyRegistryRecord(auth, getCompanyWorkspaceRegistryDeps(), companyId).catch(() => null)
      : null;
    const registryStatus = getCanonicalCompanyStatus(registryRecord || { registryStatus: validation.registryStatus });
    const readiness = evaluateCompanyWorkspaceReadiness(registryRecord || {}, {
      rootFolderId: companyId,
      masterSheetId: resolvedMasterSheetId,
      skipHealthCheck: true,
      folderPlacementOk,
    });

    if (
      companyId !== companyIdFromSession ||
      resolvedMasterSheetId !== masterSheetId
    ) {
      res.cookie(
        COMPANY_SESSION_COOKIE,
        buildCompanySessionPayload({
          email: data.email,
          masterSheetId: resolvedMasterSheetId,
          companyId,
          companyFolderId: companyId,
          companyName: resolvedCompanyName,
          role: rec.role,
          name: rec.name,
          accessLevel: rec.accessLevel || data.accessLevel || "",
          companyAreas: rec.companyAreas?.length ? rec.companyAreas : sessionCompanyAreas,
        }),
        getSessionCookieOptions({ maxAge: COMPANY_SESSION_MS }),
      );
    }
    return sendCompanySessionResult(
      200,
      buildCompanySessionApiResponse({
        email: data.email,
        role: rec.role,
        name: rec.name,
        accessLevel: rec.accessLevel || data.accessLevel || "",
        companyAreas: rec.companyAreas?.length ? rec.companyAreas : sessionCompanyAreas,
        companyId,
        companyFolderId: companyId,
        companyName: resolvedCompanyName,
        masterSheetId: resolvedMasterSheetId,
        registryStatus,
        status: registryStatus,
        live: isCompanyRegistryLive({ status: registryStatus, registryStatus }) && folderPlacementOk,
        needsAttention: readiness.needsAttention || !folderPlacementOk,
        setupBlockers: readiness.setupBlockers,
        folderPlacementOk,
        folderPlacement: validation.folderPlacement,
        companyContextValid: true,
      }),
    );
  } catch (error) {
    console.error("[company-auth] session read failed:", error);
    return res.status(401).json({ ok: false, error: "Session invalid." });
  }
}

app.get("/api/auth/company/session", respondCompanyUserSession);

function respondMasterUserSession(req, res) {
  const raw = req.signedCookies?.[MASTER_SESSION_COOKIE];
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (!data?.email || data.v !== 1) {
      return null;
    }
    const found = findOperatorByIdentity(sessionDir, data.email);
    const op = found?.operator;
    if (!op) {
      res.clearCookie(MASTER_SESSION_COOKIE, getSessionCookieOptions());
      return null;
    }
    return {
      sessionKind: "master",
      ...buildMasterSessionApiResponse({
        email: op.email,
        name: op.name,
        companyId: data.companyId,
        companyFolderId: data.companyFolderId,
        companyName: data.companyName,
        masterSheetId: data.masterSheetId,
        selectedCompanyName: data.selectedCompanyName || data.companyName,
      }),
    };
  } catch {
    return null;
  }
}

app.get("/api/session", async (req, res) => {
  const masterSession = respondMasterUserSession(req, res);
  if (masterSession) {
    return res.json(masterSession);
  }
  const companyRaw = req.signedCookies?.[COMPANY_SESSION_COOKIE];
  if (!companyRaw || typeof companyRaw !== "string") {
    return res.status(401).json({ ok: false, error: "No session." });
  }
  return respondCompanyUserSession(req, res, { includeSessionKind: true });
});

app.get("/api/company/registry-status", async (req, res) => {
  try {
    const raw = req.signedCookies?.[COMPANY_SESSION_COOKIE];
    if (!raw || typeof raw !== "string") {
      return res.status(401).json({ ok: false, error: "No company session." });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid session." });
    }
    if (data.v !== 1 || !data.email || !data.masterSheetId) {
      return res.status(401).json({ ok: false, error: "Invalid session." });
    }
    if (!envConfigured()) {
      return res.status(503).json({ ok: false, error: "Registry status is unavailable in this environment." });
    }
    const auth = getAuthedClient();
    if (!auth) {
      return res.status(401).json({ ok: false, error: "Google connection required for this action." });
    }
    let companyId = String(data.companyId || "").trim();
    if (!companyId) {
      try {
        const cfg = await getConfig(auth, data.masterSheetId);
        companyId = String(cfg.companyId || "").trim();
      } catch {
        /* best-effort */
      }
    }
    if (!companyId) {
      return res.status(409).json({ ok: false, error: "Company workspace is not linked to the registry." });
    }
    const masterSheetId = String(data.masterSheetId || "").trim();
    await ensureCompanyLiveIfReady(auth, getCompanyWorkspaceRegistryDeps(), {
      companyId,
      companyFolderId: companyId,
      checks: {
        rootFolderId: companyId,
        masterSheetId,
        skipHealthCheck: true,
      },
    }).catch(() => {});
    const record = await getCanonicalCompanyRegistryRecord(auth, getCompanyWorkspaceRegistryDeps(), companyId).catch(
      () => null,
    );
    const registryStatus = getCanonicalCompanyStatus(record || {});
    const readiness = evaluateCompanyWorkspaceReadiness(record || {}, {
      rootFolderId: companyId,
      masterSheetId,
      skipHealthCheck: true,
    });
    return res.json({
      ok: true,
      companyId,
      registryStatus,
      status: registryStatus,
      live: isCompanyRegistryLive({ status: registryStatus, registryStatus }),
      registrySource: record?.registrySource || "",
      fallbackRegistry: Boolean(record?.fallbackRegistry),
      needsAttention: readiness.needsAttention,
      setupBlockers: readiness.setupBlockers,
      blockers: readiness.blockers,
    });
  } catch (error) {
    console.error("[company-auth] registry status read failed:", error);
    return res.status(500).json({ ok: false, error: "Unable to load company registry status." });
  }
});

/**
 * Operational bootstrap / maintenance — not exposed to the SPA. Requires
 * `X-Bert-Tool-Secret` header matching `BERT_TOOL_SECRET` (same as other `/api/tools/*` routes).
 */
function requireBertToolSecret(req, res, next) {
  const toolSecret = String(process.env.BERT_TOOL_SECRET || "").trim();
  if (!toolSecret) {
    return res.status(404).json({ ok: false, error: "Not found." });
  }
  const headerSecret = String(req.headers["x-bert-tool-secret"] || "").trim();
  if (headerSecret !== toolSecret) {
    return res.status(403).json({ ok: false, error: "Forbidden." });
  }
  return next();
}

/** Bootstrap Master operator on hosted API when shell access is unavailable (e.g. Render free tier). */
app.post("/api/tools/seed-master", requireBertToolSecret, async (req, res) => {
  try {
    const outcome = handleSeedMasterRequest({ sessionDir, body: req.body || {} });
    if (outcome.body.reset) {
      console.log(`[tools] Master operator seeded/reset: ${outcome.body.email} store=${masterOperatorsFilePath(sessionDir)}`);
    } else if (outcome.body.masterConfigured) {
      console.log(`[tools] Master operator already configured: ${outcome.body.email}`);
    }
    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to seed Master operator.";
    if (message.includes("email")) {
      return res.status(400).json({ ok: false, error: message });
    }
    console.error("[tools] seed-master failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ ok: false, error: "Unable to seed Master operator." });
  }
});

app.post("/api/tools/migrate-users-tab", requireBertToolSecret, requireGoogleWorkspaceSession, async (req, res) => {
  try {
    const masterSheetId = String(req.body?.masterSheetId || "").trim();
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }
    const auth = getAuthedClient();
    const result = await migrateUsersTabColumns(auth, masterSheetId, getCompanyUsersDeps());
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("[tools] migrate-users-tab failed:", error);
    return res.status(500).json({ ok: false, error: "Users tab migration failed." });
  }
});

app.post(
  "/api/godmode/rebuild-auth-index",
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  async (req, res) => {
    try {
      const auth = getAuthedClient();
      if (!auth) {
        return res.status(401).json({ ok: false, error: "Please connect Google before rebuilding the auth index." });
      }
      const registryMap = await readCanonicalCompanyWorkspaceRegistryMap(auth, getCompanyWorkspaceRegistryDeps()).catch(
        () => ({ map: new Map() }),
      );
      const rebuilt = await authIndexApi
        .rebuildAuthIndex(auth, {
          ...getCompanyContextEnrichmentDeps(),
          readCanonicalCompanyWorkspaceRegistryMap,
          getCompanyUsersDeps,
        })
        .catch(() => null);
      if (!rebuilt?.ok) {
        return res.status(502).json({ ok: false, error: "Rebuild auth index failed." });
      }
      return res.json({
        ok: true,
        companies: rebuilt.companies || 0,
        upserted: rebuilt.upserted || 0,
        conflicts: rebuilt.conflicts || [],
        authIndexEntriesRemoved: rebuilt.authIndexEntriesRemoved || 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[godmode] rebuild-auth-index failed:", message);
      return res.status(500).json({ ok: false, error: "Rebuild auth index failed.", technicalError: message });
    }
  },
);

app.post(
  "/api/godmode/debug/verify-user-password",
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  async (req, res) => {
    try {
      const auth = getAuthedClient();
      if (!auth) {
        return res.status(401).json({ ok: false, error: "Please connect Google before running password diagnostics." });
      }
      const companyId = String(req.body?.companyId || req.body?.masterSheetId || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();
      const testPassword = String(req.body?.testPassword || req.body?.password || "");
      if (!companyId || !email || !testPassword) {
        return res.status(400).json({ ok: false, error: "companyId, email, and testPassword are required." });
      }
      const result = await debugVerifyUserPassword(
        auth,
        { getCompanyUsersDeps },
        { companyId, masterSheetId: companyId, email, testPassword },
      );
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[godmode] verify-user-password failed:", message);
      return res.status(500).json({ ok: false, error: "Password diagnostic failed.", technicalError: message });
    }
  },
);

app.post(
  "/api/godmode/companies/:companyId/rebuild-users-from-sheet",
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  async (req, res) => {
    try {
      const companyFolderId = String(req.params?.companyId || req.body?.companyFolderId || "").trim();
      let masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
      const companyName = String(req.body?.companyName || "").trim();
      const auth = getAuthedClient();
      if (!auth) {
        return res.status(401).json({ ok: false, error: "Please connect Google before rebuilding users." });
      }
      if (!companyFolderId) {
        return res.status(400).json({ ok: false, error: "companyFolderId is required." });
      }
      if (!masterSheetId) {
        const folderResolved = await resolveCompanyFromFolder(
          auth,
          { google, ...getCompanyWorkspaceRegistryDeps() },
          companyFolderId,
          { companyName, ensureStructure: false },
        );
        if (folderResolved?.ok) {
          masterSheetId = String(folderResolved.masterSheetId || "").trim();
        }
      }
      const result = await rebuildUsersFromSheet(
        auth,
        { ...getCompanyWorkspaceRegistryDeps(), ...getCompanyUsersDeps() },
        { companyFolderId, companyId: companyFolderId, masterSheetId, companyName },
      );
      if (!result.ok) {
        return res.status(result.httpStatus || 502).json({
          ok: false,
          error: result.message || result.error || "Could not rebuild users from sheet.",
          reasonCode: result.reasonCode,
          diagnostics: result.diagnostics,
        });
      }
      await authIndexApi
        .rebuildCompanyAuthIndexFromSheet(
          auth,
          { getCompanyUsersDeps },
          {
            companyFolderId: result.companyFolderId || companyFolderId,
            masterSheetId: result.masterSheetId || masterSheetId,
            companyName: result.companyName || companyName,
          },
        )
        .catch(() => null);
      return res.json({
        ok: true,
        companyFolderId: result.companyFolderId,
        masterSheetId: result.masterSheetId,
        activeCount: result.activeCount,
        users: result.users,
        removed: result.removed,
        kept: result.kept,
        cacheUsersBefore: result.cacheUsersBefore,
        cacheOnlyUsersRemoved: result.cacheOnlyUsersRemoved,
        diagnostics: result.diagnostics,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[godmode] rebuild-users-from-sheet failed:", message);
      return res.status(500).json({
        ok: false,
        error: "Rebuild users from sheet failed.",
        technicalError: message,
      });
    }
  },
);

app.post(
  "/api/godmode/companies/:companyId/repair-users-tab",
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  async (req, res) => {
    try {
      const companyFolderId = String(req.params?.companyId || req.body?.companyFolderId || "").trim();
      let masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
      const auth = getAuthedClient();
      if (!auth) {
        return res.status(401).json({ ok: false, error: "Please connect Google before repairing the Users tab." });
      }
      if (!masterSheetId && companyFolderId) {
        const folderResolved = await resolveCompanyFromFolder(
          auth,
          { google, ...getCompanyWorkspaceRegistryDeps() },
          companyFolderId,
          {
            companyName: String(req.body?.companyName || "").trim(),
            ensureStructure: false,
          },
        );
        if (folderResolved?.ok) {
          masterSheetId = String(folderResolved.masterSheetId || "").trim();
        }
      }
      if (!masterSheetId) {
        return res.status(400).json({ ok: false, error: "masterSheetId is required to repair the Users tab." });
      }
      const result = await repairUsersTab(auth, masterSheetId, getCompanyUsersDeps());
      return res.json({
        ok: true,
        companyFolderId: companyFolderId || undefined,
        masterSheetId,
        tabTitle: result.tabTitle,
        created: result.created,
        matchKind: result.matchKind,
        legacySource: result.legacySource,
        addedHeaders: result.addedHeaders,
        rowCount: result.rowCount,
        migration: result.migration,
        schemaRepair: result.schemaRepair,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[godmode] repair-users-tab failed:", message);
      return res.status(500).json({
        ok: false,
        error: "Users tab repair failed.",
        technicalError: message,
        reasonCode: error?.reasonCode || error?.code,
      });
    }
  },
);

app.post(
  "/api/godmode/companies/:companyId/repair-users-tab-schema",
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  async (req, res) => {
    try {
      const companyFolderId = String(req.params?.companyId || req.body?.companyFolderId || "").trim();
      let masterSheetId = String(req.body?.masterSheetId || req.query?.masterSheetId || "").trim();
      const auth = getAuthedClient();
      if (!auth) {
        return res.status(401).json({ ok: false, error: "Please connect Google before repairing the Users tab." });
      }
      if (!masterSheetId && companyFolderId) {
        const folderResolved = await resolveCompanyFromFolder(
          auth,
          { google, ...getCompanyWorkspaceRegistryDeps() },
          companyFolderId,
          {
            companyName: String(req.body?.companyName || "").trim(),
            ensureStructure: false,
          },
        );
        if (folderResolved?.ok) {
          masterSheetId = String(folderResolved.masterSheetId || "").trim();
        }
      }
      if (!masterSheetId) {
        return res.status(400).json({ ok: false, error: "masterSheetId is required to repair the Users tab schema." });
      }
      const companyName = String(req.body?.companyName || "").trim();
      const deps = getCompanyUsersDeps();
      const schemaRepair = await repairUsersTabSchema(auth, masterSheetId, deps, {
        companyContext: { companyFolderId, companyId: companyFolderId, companyName },
      });
      if (typeof deps.companyUsersCache?.rebuildFromSheet === "function" && companyFolderId) {
        await deps.companyUsersCache
          .rebuildFromSheet(auth, deps, { companyFolderId, masterSheetId })
          .catch(() => null);
      }
      const readResult = await workbookReadCompanyUsers(auth, masterSheetId, deps);
      return res.json({
        ok: true,
        companyFolderId: companyFolderId || undefined,
        masterSheetId,
        ...schemaRepair,
        rowCount: readResult.rowCount,
        users: readResult.records,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[godmode] repair-users-tab-schema failed:", message);
      return res.status(500).json({
        ok: false,
        error: "Users tab schema repair failed.",
        technicalError: message,
        reasonCode: error?.reasonCode || error?.code,
      });
    }
  },
);

app.post("/api/tools/migrate-userauth-passwords", requireBertToolSecret, requireGoogleWorkspaceSession, async (req, res) => {
  try {
    const masterSheetId = String(req.body?.masterSheetId || "").trim();
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }
    const auth = getAuthedClient();
    const result = await migrateAllPlainUserAuthKeys(auth, masterSheetId, getConfig, updateConfig);
    return res.json({ ok: true, migrated: result.migrated });
  } catch (error) {
    console.error("[tools] migrate-userauth-passwords failed:", error);
    return res.status(500).json({ ok: false, error: "Migration failed." });
  }
});

installCompanyWorkspaceResetRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  readInviteStore,
  writeInviteStore,
  getConfig,
  updateConfig,
  getWorkbook,
  ensureColumns,
  withSheetsQuotaRetry,
  TAB_COLUMNS,
});

installCompanyUserResetRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  readInviteStore,
  writeInviteStore,
  getWorkbook,
  ensureColumns,
  withSheetsQuotaRetry,
  companyUsersCache: companyUsersCacheApi,
  authIndex: authIndexApi,
  sessionRevocation: companySessionRevocationApi,
  registryDeps: getCompanyWorkspaceRegistryDeps(),
});

installFoundationVerifyCleanupRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  getCompanyUsersDeps,
});

installPasswordResetRoutes(app, {
  sessionDir,
  emailConfigured,
  createSmtpTransport,
  getFromAddress: () =>
    requiredEnv.SMTP_FROM_NAME
      ? `"${requiredEnv.SMTP_FROM_NAME}" <${requiredEnv.SMTP_FROM_EMAIL}>`
      : requiredEnv.SMTP_FROM_EMAIL,
  getFrontendUrl: () => String(requiredEnv.FRONTEND_URL || "").trim(),
  appBrandName: APP_BRAND_NAME,
  hashPepper: requiredEnv.SESSION_SECRET,
  findMasterSheetIdsForCompanyLoginEmail,
  getAuthedClient,
  getConfig,
  updateConfig,
  getTabValues,
  envConfigured,
  getCompanyUsersDeps,
  getCompanyResolverDeps: () => ({ google, ...getCompanyWorkspaceRegistryDeps() }),
  resolveCompanyFromFolder,
  authIndex: authIndexApi,
  resolveCompanyUserEmailByHash,
  isProdRuntime,
});

installCompanyFolderStructureRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireWorkspaceAdminActor,
  ensureTabsAndColumns,
  ensureCompanyMappingTabs,
  ensureAreasTab: async (auth, spreadsheetId) => {
    await ensureColumns(auth, spreadsheetId, AREAS_TAB, AREAS_COLUMNS);
  },
  updateConfig,
  getConfig,
  getDriveFile,
  ensureTabExists,
  ensureColumns,
  getWorkbook,
  getTabValues,
  withSheetsQuotaRetry,
  safeLower,
});

installCompanyWorkspaceRegistryRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  google,
  getWorkbook,
  ensureTabExists,
  ensureColumns,
  getTabValues,
  withSheetsQuotaRetry,
  safeLower,
  sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
  queueCompanyHealthCheckIfReady: (...args) => backgroundJobs.queueCompanyHealthCheckIfReady(...args),
  parseBertActorFromRequest,
});

installCompanySetupProgressRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  google,
  getDriveFile,
  getConfig,
  updateConfig,
  getTabValues,
  ensureTabsAndColumns,
  ensureIsoReadinessFolders,
  ensureCompanyMappingTabs,
  ensureAreasTab: async (auth, spreadsheetId) => {
    await ensureColumns(auth, spreadsheetId, AREAS_TAB, AREAS_COLUMNS);
  },
  validateWorkspace,
  ensureTabExists,
  ensureColumns,
  getWorkbook,
  withSheetsQuotaRetry,
  safeLower,
  registryDeps: getCompanyWorkspaceRegistryDeps(),
});

backgroundJobs = createBackgroundJobsService(sessionDir, {
  getAuthedClient,
  envConfigured,
  emailConfigured,
  sendCompanyUserInviteEmail,
  relinkCompanyRegistryForWorkspace,
  google,
  getTabValues,
  ensureTabExists,
  ensureColumns,
  getWorkbook,
  withSheetsQuotaRetry,
  authIndex: authIndexApi,
  getCompanyUsersDeps,
  ...getCompanyWorkspaceRegistryDeps(),
});
backgroundJobs.installRoutes(app, { requireMasterOnlyActor });
backgroundJobs.startProcessor();

installGodmodeRegistryActionRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  parseBertActorFromRequest,
  processCompanyUserInvite,
  queueCompanySetupJobs: backgroundJobs.queueCompanySetupJobs.bind(backgroundJobs),
  ...getCompanyWorkspaceRegistryDeps(),
});

installCompanyFolderResolverRoutes(app, {
  getAuthedClient,
  getGoogleConnectedEmail,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  google,
  withSheetsQuotaRetry,
  sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  ...getWorkbookServiceDeps(),
});

installCompanyFolderConnectRoutes(app, {
  getAuthedClient,
  getGoogleConnectedEmail,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  google,
  withSheetsQuotaRetry,
  sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  getCompanyUsersDeps,
  getConfig,
  updateConfig,
  ensureTabsAndColumns,
  currentSchemaVersion: CURRENT_SCHEMA_VERSION,
  authIndex: authIndexApi,
  getCompanyWorkspaceRegistryDeps,
  ...getWorkbookServiceDeps(),
});

installCompanyProvisioningRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  google,
  resolveLiveCompaniesFolder,
  getCompanyUsersDeps,
  getCompanyWorkspaceRegistryDeps,
  authIndex: authIndexApi,
  ensureTabExists,
  ensureColumns,
  getWorkbook,
  getTabValues,
  withSheetsQuotaRetry,
  safeLower,
  getConfig,
  updateConfig,
  ensureTabsAndColumns,
  currentSchemaVersion: CURRENT_SCHEMA_VERSION,
  ...getWorkbookServiceDeps(),
});

installCompanyFolderPlacementRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  google,
  sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
});

installCompanyStructureRoutes(app, {
  google,
  getAuthedClient,
  envConfigured,
  ensureColumns,
  getTabValues,
  rowsToRecords,
  withSheetsQuotaRetry,
  requireGoogleWorkspaceSession,
  requireWorkspaceAdminActor,
  parseBertActorFromRequest,
  getCompanyUsersDeps,
  resolveCompanyFromFolder,
  ensureRequiredTabs: async (auth, deps, spreadsheetId, options = {}) => {
    const { ensureRequiredTabs } = await import("./workbook-service.mjs");
    return ensureRequiredTabs(auth, deps, spreadsheetId, options);
  },
});

installCoreWorkflowRoutes(app, {
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceEnv,
  requireGoogleWorkspaceSession,
  parseBertActorFromRequest,
  processCompanyUserInvite,
  getInviteRecord,
  handleGetInviteToken,
  handleAppInviteComplete,
  readCompanySheetById,
  getCompanyUsersDeps,
  registryDeps: getCompanyWorkspaceRegistryDeps(),
  getConfig,
  getTabValues,
  ensureTabExists,
  ensureColumns,
  getWorkbook,
  withSheetsQuotaRetry,
  google,
  backgroundJobs,
  authIndex: authIndexApi,
  sessionDir,
  rowsToRecords,
  writeCompanyActions,
});

installCompanyOnboardingRoutes(app, {
  sessionDir,
  requiredEnv,
  appBrandName: APP_BRAND_NAME,
  emailConfigured,
  createSmtpTransport,
  getAuthedClient,
  envConfigured,
  requireGoogleWorkspaceSession,
  requireMasterOnlyActor,
  parseBertActorFromRequest,
  provisionNewCompanyWorkspace,
  appendRowObjects,
  getConfig,
  updateConfig,
  getSessionCookieOptions,
  companySessionCookie: COMPANY_SESSION_COOKIE,
  companySessionMs: COMPANY_SESSION_MS,
  hashPassword,
  readCompanyUsersTabRecord,
  writeCompanyUsers,
  probeCompanyLoginSheet,
  repairCompanyInviteTarget,
  inviteTargetDeps: getInviteTargetDeps(),
  getWorkbook,
  ensureTabExists,
  ensureColumns,
  getTabValues,
  withSheetsQuotaRetry,
  google,
  sharedDriveId: requiredEnv.GOOGLE_SHARED_DRIVE_ID,
  platformRegistrySheetId: process.env.BERT_PLATFORM_REGISTRY_SHEET_ID || "",
  onboardingInviteTtlMs: ONBOARDING_INVITE_TTL_MS,
  currentSchemaVersion: CURRENT_SCHEMA_VERSION,
});

installAuditBuilderRoutes(app, {
  sessionDir,
  parseBertActorFromRequest,
  getAuthedClient,
  envConfigured,
  ensureColumns,
  getTabValues,
  rowsToRecords,
  withSheetsQuotaRetry,
  google,
  appendRowObjects,
  resolveCompanyFromFolder,
});

app.use((req, res, next) => {
  const path = String(req.path || req.url || "");
  if (path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      code: "API_ROUTE_NOT_FOUND",
      message: `API route not found: ${req.method} ${req.originalUrl || path}`,
    });
  }
  return next();
});

app.use((err, req, res, _next) => {
  if (res.headersSent) {
    console.error("[express] error after headers sent:", err);
    return;
  }
  const path = String(req.path || req.url || "");
  const isApiRoute = path.startsWith("/api/");
  const technicalError = err instanceof Error ? err.message : String(err);
  console.error("[express] unhandled error:", technicalError);
  if (isApiRoute) {
    return res.status(500).json({
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      technicalError:
        String(process.env.BERT_GODMODE_DIAGNOSTICS || "").trim().toLowerCase() === "true"
          ? technicalError
          : undefined,
    });
  }
  return res.status(500).json({
    ok: false,
    error: technicalError || "Internal server error",
  });
});

assertSafeProductionBoot();

const httpServer = app.listen(port, "0.0.0.0", () => {
  googleOAuthStore.logStorageState("startup");
  const googleCreds = getGoogleCredentialDiagnosticsPayload();
  console.log("[google-auth] startup", {
    authMode: googleCreds.authMode,
    selectedCredentialPath: googleCreds.selectedCredentialPath,
    serviceAccountConfigured: googleCreds.serviceAccountConfigured,
    env: {
      GOOGLE_CLIENT_ID: { set: googleCreds.env.GOOGLE_CLIENT_ID.set },
      GOOGLE_CLIENT_SECRET: {
        set: googleCreds.env.GOOGLE_CLIENT_SECRET.set,
        hasLeadingOrTrailingWhitespace: googleCreds.env.GOOGLE_CLIENT_SECRET.hasLeadingOrTrailingWhitespace,
        hasEmbeddedNewline: googleCreds.env.GOOGLE_CLIENT_SECRET.hasEmbeddedNewline,
      },
      GOOGLE_REDIRECT_URI: { set: googleCreds.env.GOOGLE_REDIRECT_URI.set },
      GOOGLE_SHARED_DRIVE_ID: { set: googleCreds.env.GOOGLE_SHARED_DRIVE_ID.set },
      BERT_SESSIONS_DIR: googleCreds.env.BERT_SESSIONS_DIR,
    },
    tokenStore: {
      sessionsDirConfigured: googleCreds.tokenStore.sessionsDirConfigured,
      tokenFilePresent: googleCreds.tokenStore.tokenFilePresent,
      hasRefreshToken: googleCreds.tokenStore.hasRefreshToken,
      hasAccessToken: googleCreds.tokenStore.hasAccessToken,
      accessTokenExpired: googleCreds.tokenStore.accessTokenExpired,
      profileEmailSet: googleCreds.tokenStore.profileEmailSet,
    },
    warningCount: googleCreds.warnings.length,
  });
  for (const warning of googleCreds.warnings) {
    console.warn(`[google-auth] ${warning}`);
  }
  console.log(
    `[api] listening on http://127.0.0.1:${port} (NODE_ENV=${nodeEnvLabel()}, googleEnvConfigured=${envConfigured()}, googleOAuthConnected=${googleOAuthStore.hasTokens()}, sessionStoreWritable=${sessionStoreWritable()})`,
  );
  console.log(`[api] PORT env: ${process.env.PORT || "(unset, using 8787)"}`);
  try {
    const masterBootstrap = bootstrapMasterOperatorFromEnv(sessionDir);
    if (masterBootstrap.ran) {
      console.log("[master-bootstrap] startup complete", {
        email: masterBootstrap.email,
        username: masterBootstrap.username,
        created: masterBootstrap.created === true,
        updated: masterBootstrap.updated === true,
      });
    }
  } catch (error) {
    console.error(
      "[master-bootstrap] startup failed:",
      error instanceof Error ? error.message : error,
    );
  }
  if (
    isProductionRuntime() &&
    (!process.env.APP_AUTH_MODE || APP_AUTH_MODE === "demo" || APP_AUTH_MODE === "local")
  ) {
    console.warn(
      "[api][security] APP_AUTH_MODE is unset, demo, or local — SPA auth remains client-side (localStorage). OK only inside a trusted pilot boundary. Public self-serve needs provider/server app auth; see docs/security-hardening-plan.md.",
    );
  }
  console.log("[smtp] startup", smtpStartupLogPayload());
  void (async () => {
    if (!envConfigured()) {
      return;
    }
    const auth = getAuthedClient();
    if (!auth) {
      console.warn("[auth-index] startup skipped: Google OAuth not connected");
      return;
    }
    const rebuildDeps = {
      ...getCompanyContextEnrichmentDeps(),
      readCanonicalCompanyWorkspaceRegistryMap,
      getCompanyUsersDeps,
    };
    try {
      const snapshot = typeof authIndexApi.getAuthIndexSnapshot === "function"
        ? authIndexApi.getAuthIndexSnapshot()
        : { empty: true, emailCount: 0, usernameCount: 0, ambiguousUsernameCount: 0 };
      console.log("[auth-index] startup", {
        empty: snapshot.empty === true,
        emailCount: Number(snapshot.emailCount || 0),
        usernameCount: Number(snapshot.usernameCount || 0),
        ambiguousUsernameCount: Number(snapshot.ambiguousUsernameCount || 0),
        rebuiltAt: snapshot.rebuiltAt || null,
      });
      if (snapshot.empty === true && typeof authIndexApi.bootstrapAuthIndexIfEmpty === "function") {
        const boot = await authIndexApi.bootstrapAuthIndexIfEmpty(auth, rebuildDeps);
        console.log("[auth-index] startup rebuild", {
          ok: boot?.ok === true,
          rebuilt: boot?.rebuilt === true,
          reason: boot?.reason || "",
          companies: Number(boot?.companies || 0),
          upserted: Number(boot?.upserted || 0),
          emailCount: Number(boot?.after?.emailCount || 0),
          usernameCount: Number(boot?.after?.usernameCount || 0),
          durationMs: Number(boot?.durationMs || 0),
        });
      }
    } catch (error) {
      console.warn(
        "[auth-index] startup bootstrap failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      const pruned = await authIndexApi.pruneAuthIndexGhostEntries(auth, getCompanyContextEnrichmentDeps());
      if (pruned?.authIndexEntriesRemoved > 0) {
        console.log(`[auth-index] startup pruned ${pruned.authIndexEntriesRemoved} ghost entries`);
      }
    } catch (error) {
      console.warn(
        "[auth-index] startup prune failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  })();
  void verifySmtpTransport().then((result) => {
    if (isProductionRuntime()) {
      console.log("[smtp] verify", { ok: result.ok, checkedAt: result.checkedAt });
    } else {
      console.log("[smtp] verify", result);
    }
  });
  startEmailReminderScheduler(emailReminderRunner);
});

httpServer.on("error", (err) => {
  if (err && "code" in err && err.code === "EADDRINUSE") {
    console.error(
      `[api] Port ${port} is already in use. You already have an API on this port (another terminal running \`npm run server\` or \`npm run dev:full\`). Stop that process first, or use a different port: PORT=8790 npm run server`,
    );
    process.exit(1);
    return;
  }
  console.error("[api] Failed to listen:", err);
  process.exit(1);
});
