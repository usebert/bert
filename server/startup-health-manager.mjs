/**
 * Startup health verification — read-only diagnostics at API boot.
 * Not a repair tool; surfaces dependency health for operators.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildGoogleCredentialDiagnostics,
  probeGoogleSheetsWorkbookMetadata,
} from "./google-auth-diagnostics.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";
import { resolveUsersTab } from "./users-tab-reader.mjs";

export const CHECK_STATUS = {
  PASS: "PASS",
  WARNING: "WARNING",
  FAIL: "FAIL",
};

export const OVERALL_STATUS = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  FAILED: "FAILED",
};

export const STARTUP_CHECK_KEYS = [
  "google",
  "registry",
  "authIndex",
  "workbook",
  "configuration",
  "backgroundJobs",
  "cache",
  "api",
];

export const STARTUP_CHECK_LABELS = {
  google: "Google",
  registry: "Registry",
  authIndex: "Auth Index",
  workbook: "Workbook",
  configuration: "Configuration",
  backgroundJobs: "Background Jobs",
  cache: "Cache",
  api: "API",
};

function trim(value) {
  return String(value ?? "").trim();
}

function nowMs() {
  return Date.now();
}

function makeCheckResult(name, status, message, durationMs, { critical = true } = {}) {
  return {
    key: name,
    name: STARTUP_CHECK_LABELS[name] || name,
    status,
    durationMs: Math.max(0, Math.round(durationMs)),
    message: trim(message) || undefined,
    critical: critical !== false,
  };
}

export function deriveOverallStatus(checks = []) {
  const list = Array.isArray(checks) ? checks : Object.values(checks);
  const hasCriticalFail = list.some((check) => check.status === CHECK_STATUS.FAIL && check.critical !== false);
  if (hasCriticalFail) {
    return OVERALL_STATUS.FAILED;
  }
  const hasWarnOrOptionalFail = list.some(
    (check) => check.status === CHECK_STATUS.WARNING || check.status === CHECK_STATUS.FAIL,
  );
  if (hasWarnOrOptionalFail) {
    return OVERALL_STATUS.DEGRADED;
  }
  return OVERALL_STATUS.HEALTHY;
}

export function analyzeRegistryIntegrity(map = new Map()) {
  const companyIdOwners = new Map();
  const workbookIdOwners = new Map();
  const liveMissingFields = [];

  for (const record of map.values()) {
    const companyId = trim(record?.companyId || record?.rootFolderId);
    const folderId = trim(record?.companyFolderId || record?.rootFolderId || record?.companyId);
    const masterSheetId = trim(record?.masterSheetId);

    if (companyId) {
      const existing = companyIdOwners.get(companyId) || 0;
      companyIdOwners.set(companyId, existing + 1);
    }
    if (masterSheetId) {
      const existing = workbookIdOwners.get(masterSheetId) || 0;
      workbookIdOwners.set(masterSheetId, existing + 1);
    }

    if (isCompanyRegistryLive(record)) {
      if (!folderId) {
        liveMissingFields.push(`LIVE company ${companyId || "(unknown)"} missing CompanyFolderId`);
      }
      if (!masterSheetId) {
        liveMissingFields.push(`LIVE company ${companyId || "(unknown)"} missing MasterSheetId`);
      }
    }
  }

  const duplicateCompanyIds = [...companyIdOwners.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const duplicateWorkbookIds = [...workbookIdOwners.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  return {
    loaded: map.size > 0,
    recordCount: map.size,
    duplicateCompanyIds,
    duplicateWorkbookIds,
    liveMissingFields,
  };
}

export function analyzeAuthIndexIntegrity(authIndexApi) {
  const snapshot =
    typeof authIndexApi?.getAuthIndexSnapshot === "function" ? authIndexApi.getAuthIndexSnapshot() : null;
  const entries = typeof authIndexApi?.readAllEntries === "function" ? authIndexApi.readAllEntries() : [];
  const emailKeys = new Set();
  const duplicateEmails = [];
  let ambiguousUsernameCount = 0;
  if (typeof authIndexApi?.readStore === "function") {
    const store = authIndexApi.readStore();
    for (const alias of Object.values(store?.byUsername || {})) {
      if (alias?.ambiguous === true && Array.isArray(alias.candidates) && alias.candidates.length > 1) {
        ambiguousUsernameCount += 1;
      }
    }
  } else {
    ambiguousUsernameCount = Number(snapshot?.ambiguousUsernameCount || 0);
  }
  let activeCount = 0;
  let unresolvedActive = 0;

  for (const entry of entries) {
    const email = trim(entry?.email).toLowerCase();
    if (email) {
      if (emailKeys.has(email)) {
        duplicateEmails.push(email);
      }
      emailKeys.add(email);
    }
    const status = trim(entry?.status).toUpperCase();
    if (status === "ACTIVE") {
      activeCount += 1;
      const folderId = trim(entry?.companyFolderId || entry?.companyId);
      const masterSheetId = trim(entry?.masterSheetId);
      if (!folderId || !masterSheetId || !email) {
        unresolvedActive += 1;
      }
    }
  }

  return {
    loaded: Boolean(snapshot && snapshot.empty === false),
    emailCount: Number(snapshot?.emailCount || emailKeys.size || 0),
    usernameCount: Number(snapshot?.usernameCount || 0),
    ambiguousUsernameCount,
    duplicateEmails,
    activeCount,
    unresolvedActive,
    empty: snapshot?.empty !== false && entries.length === 0,
  };
}

function pickRandomLiveWorkbook(map = new Map()) {
  const candidates = [...map.values()].filter((record) => {
    return isCompanyRegistryLive(record) && trim(record?.masterSheetId);
  });
  if (!candidates.length) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function timedCheck(name, runner, options = {}) {
  const started = nowMs();
  try {
    const result = await runner();
    const durationMs = nowMs() - started;
    if (typeof result === "string") {
      return makeCheckResult(name, CHECK_STATUS.PASS, result, durationMs, options);
    }
    return makeCheckResult(name, result.status, result.message, durationMs, {
      critical: result.critical ?? options.critical,
    });
  } catch (error) {
    return makeCheckResult(
      name,
      CHECK_STATUS.FAIL,
      error instanceof Error ? error.message : String(error),
      nowMs() - started,
      options,
    );
  }
}

function directoryWritable(dirPath) {
  const target = trim(dirPath);
  if (!target) {
    return { ok: false, reason: "path_missing" };
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
    const probe = path.join(target, `.bert-write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok", "utf8");
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runStartupHealthChecks(deps = {}) {
  const startedAt = nowMs();
  const checks = [];

  const googleEnvConfigured =
    typeof deps.envConfigured === "function" ? deps.envConfigured() : Boolean(deps.googleEnvConfigured);
  const auth = typeof deps.getAuthedClient === "function" ? deps.getAuthedClient() : null;

  checks.push(
    await timedCheck("google", async () => {
      const buildDiagnostics = deps.buildGoogleCredentialDiagnostics || buildGoogleCredentialDiagnostics;
      const probeSheets = deps.probeGoogleSheetsWorkbookMetadata || probeGoogleSheetsWorkbookMetadata;
      const diagnostics = buildDiagnostics({
        requiredEnv: deps.requiredEnv || {},
        oauthStore: deps.googleOAuthStore,
        processEnv: deps.processEnv || process.env,
      });
      if (!googleEnvConfigured) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "Google workspace env is not fully configured (non-blocking for Master login).",
          critical: false,
        };
      }
      if (!diagnostics.tokenStore?.hasRefreshToken) {
        return {
          status: CHECK_STATUS.FAIL,
          message: "Google credentials are not loaded (missing refresh token).",
        };
      }
      if (diagnostics.warnings?.some((warning) => warning.includes("invalid_grant"))) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "Google credential warnings suggest invalid_grant risk — reconnect OAuth if Sheets fails.",
        };
      }
      if (!auth) {
        return {
          status: CHECK_STATUS.FAIL,
          message: "Google OAuth client is unavailable despite stored tokens.",
        };
      }
      const probeId =
        typeof deps.resolveGoogleSheetsProbeWorkbookId === "function"
          ? deps.resolveGoogleSheetsProbeWorkbookId()
          : trim(deps.probeWorkbookId);
      if (!probeId) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "Google OAuth connected; no probe workbook id configured for access-token check.",
          critical: false,
        };
      }
      const probe = await probeSheets(auth, probeId, {
        google: deps.google,
        withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
      });
      if (!probe.ok) {
        const reason = trim(probe.reason);
        if (reason === "invalid_grant") {
          return {
            status: CHECK_STATUS.FAIL,
            message: "Google refresh token is invalid or revoked (invalid_grant).",
          };
        }
        return {
          status: CHECK_STATUS.FAIL,
          message: `Google access probe failed (${reason || "unknown"}).`,
        };
      }
      return {
        status: CHECK_STATUS.PASS,
        message: "Refresh token valid and access token obtainable.",
      };
    }),
  );

  let registryMap = new Map();
  checks.push(
    await timedCheck("registry", async () => {
      if (!googleEnvConfigured || !auth) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "Registry check skipped — Google OAuth not connected.",
          critical: false,
        };
      }
      const readMap = deps.readCanonicalCompanyWorkspaceRegistryMap;
      if (typeof readMap !== "function") {
        return { status: CHECK_STATUS.FAIL, message: "Registry reader is not configured." };
      }
      const registryDeps = typeof deps.getCompanyWorkspaceRegistryDeps === "function"
        ? deps.getCompanyWorkspaceRegistryDeps()
        : deps.registryDeps || {};
      const result = await readMap(auth, registryDeps).catch(() => ({ map: new Map() }));
      registryMap = result?.map instanceof Map ? result.map : new Map();
      const integrity = analyzeRegistryIntegrity(registryMap);
      if (!integrity.loaded) {
        return { status: CHECK_STATUS.WARNING, message: "Company registry loaded empty." };
      }
      if (integrity.duplicateCompanyIds.length) {
        return {
          status: CHECK_STATUS.FAIL,
          message: `Duplicate company IDs in registry (${integrity.duplicateCompanyIds.length}).`,
        };
      }
      if (integrity.duplicateWorkbookIds.length) {
        return {
          status: CHECK_STATUS.FAIL,
          message: `Duplicate workbook IDs in registry (${integrity.duplicateWorkbookIds.length}).`,
        };
      }
      if (integrity.liveMissingFields.length) {
        return {
          status: CHECK_STATUS.FAIL,
          message: integrity.liveMissingFields[0],
        };
      }
      return {
        status: CHECK_STATUS.PASS,
        message: `Registry loaded (${integrity.recordCount} companies).`,
      };
    }),
  );

  checks.push(
    await timedCheck("authIndex", async () => {
      const authIndexApi = deps.authIndexApi;
      if (!authIndexApi) {
        return { status: CHECK_STATUS.FAIL, message: "Auth index API is not initialised." };
      }
      const integrity = analyzeAuthIndexIntegrity(authIndexApi);
      if (!integrity.loaded && googleEnvConfigured && auth) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "Auth index is empty (may rebuild on first login).",
        };
      }
      if (integrity.duplicateEmails.length) {
        return {
          status: CHECK_STATUS.FAIL,
          message: `Duplicate emails in auth index (${integrity.duplicateEmails.length}).`,
        };
      }
      if (integrity.ambiguousUsernameCount > 0) {
        return {
          status: CHECK_STATUS.FAIL,
          message: `Ambiguous usernames in auth index (${integrity.ambiguousUsernameCount}).`,
        };
      }
      if (integrity.unresolvedActive > 0) {
        return {
          status: CHECK_STATUS.FAIL,
          message: `${integrity.unresolvedActive} ACTIVE auth-index entries missing company context.`,
        };
      }
      return {
        status: CHECK_STATUS.PASS,
        message: `Auth index loaded (${integrity.emailCount} emails, ${integrity.usernameCount} usernames).`,
      };
    }),
  );

  checks.push(
    await timedCheck("workbook", async () => {
      if (!googleEnvConfigured || !auth) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "Workbook connectivity check skipped — Google OAuth not connected.",
          critical: false,
        };
      }
      const target = pickRandomLiveWorkbook(registryMap);
      if (!target) {
        return {
          status: CHECK_STATUS.WARNING,
          message: "No LIVE company workbook available for connectivity probe.",
        };
      }
      const masterSheetId = trim(target.masterSheetId);
      const probeSheets = deps.probeGoogleSheetsWorkbookMetadata || probeGoogleSheetsWorkbookMetadata;
      const metadata = await probeSheets(auth, masterSheetId, {
        google: deps.google,
        withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
      });
      if (!metadata.ok) {
        return {
          status: CHECK_STATUS.FAIL,
          message: `Master workbook unreachable (${trim(metadata.reason) || "probe_failed"}).`,
        };
      }
      const userDeps =
        typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps.companyUsersDeps || {};
      const getTabValues = userDeps.getTabValues;
      if (typeof getTabValues !== "function") {
        return { status: CHECK_STATUS.FAIL, message: "Users tab reader is not configured." };
      }
      const resolveUsers = deps.resolveUsersTab || resolveUsersTab;
      const usersTab = await resolveUsers(auth, masterSheetId, userDeps, { createIfMissing: false }).catch(
        () => null,
      );
      if (!usersTab?.tabTitle) {
        return { status: CHECK_STATUS.FAIL, message: "Users tab is not readable on sampled LIVE workbook." };
      }
      const usersHeader = await getTabValues(auth, masterSheetId, usersTab.tabTitle, "A1:ZZ1").catch(() => null);
      if (!Array.isArray(usersHeader) || !usersHeader.length) {
        return { status: CHECK_STATUS.FAIL, message: "Users tab header row could not be read." };
      }
      const configHeader = await getTabValues(auth, masterSheetId, "Config", "A1:ZZ1").catch(() => null);
      if (!Array.isArray(configHeader) || !configHeader.length) {
        return { status: CHECK_STATUS.FAIL, message: "Config tab is not readable on sampled LIVE workbook." };
      }
      return {
        status: CHECK_STATUS.PASS,
        message: "Sampled LIVE workbook metadata, Users tab, and Config tab are readable.",
      };
    }),
  );

  checks.push(
    await timedCheck("configuration", async () => {
      const evaluation =
        typeof deps.evaluateProductionEnvironment === "function"
          ? deps.evaluateProductionEnvironment()
          : { blockingIssues: [], warnings: [] };
      const writable =
        typeof deps.sessionStoreWritable === "function" ? deps.sessionStoreWritable() : directoryWritable(deps.sessionDir).ok;
      const uploadDir = trim(deps.uploadDir || path.join(deps.sessionDir || "", "uploads"));
      const tempDir = trim(deps.tempDir || os.tmpdir());
      const cacheDir = trim(deps.sessionDir);
      const uploadOk = directoryWritable(uploadDir);
      const tempOk = directoryWritable(tempDir);
      const cacheOk = directoryWritable(cacheDir);
      const missingEnv = Array.isArray(deps.missingRequiredEnv) ? deps.missingRequiredEnv : [];

      if (evaluation.blockingIssues?.length) {
        return {
          status: CHECK_STATUS.FAIL,
          message: evaluation.blockingIssues[0],
        };
      }
      if (!writable || !cacheOk.ok) {
        return { status: CHECK_STATUS.FAIL, message: "Session/cache directory is not writable." };
      }
      if (!uploadOk.ok) {
        return { status: CHECK_STATUS.FAIL, message: "Upload directory is not writable." };
      }
      if (!tempOk.ok) {
        return { status: CHECK_STATUS.WARNING, message: "Temp directory is not writable." };
      }
      if (missingEnv.length) {
        return {
          status: CHECK_STATUS.WARNING,
          message: `Missing optional env: ${missingEnv.join(", ")}`,
          critical: false,
        };
      }
      if (evaluation.warnings?.length) {
        return {
          status: CHECK_STATUS.WARNING,
          message: evaluation.warnings[0],
          critical: false,
        };
      }
      return { status: CHECK_STATUS.PASS, message: "Required environment and writable paths verified." };
    }),
  );

  checks.push(
    await timedCheck("backgroundJobs", async () => {
      const processorRunning =
        typeof deps.isBackgroundProcessorRunning === "function" ? deps.isBackgroundProcessorRunning() : false;
      const notificationReady =
        typeof deps.isNotificationServiceReady === "function" ? deps.isNotificationServiceReady() : false;

      const issues = [];
      const warnings = [];
      if (!processorRunning) {
        issues.push("Background job processor is not running.");
      }
      if (!notificationReady) {
        warnings.push("Notification/email reminder service is not initialised or SMTP is disabled.");
      }
      if (issues.length) {
        return { status: CHECK_STATUS.FAIL, message: issues[0] };
      }
      if (warnings.length) {
        return {
          status: CHECK_STATUS.WARNING,
          message: warnings.join(" "),
          critical: false,
        };
      }
      return { status: CHECK_STATUS.PASS, message: "Background services are running." };
    }, { critical: false }),
  );

  checks.push(
    await timedCheck("cache", async () => {
      const sessionDir = trim(deps.sessionDir);
      if (!sessionDir) {
        return { status: CHECK_STATUS.FAIL, message: "Session directory is not configured." };
      }
      const cachePaths = [
        deps.authIndexPath,
        deps.companyUsersCachePath,
        deps.masterSheetCachePath,
        deps.backgroundJobsPath,
      ].filter(Boolean);
      const initPaths = cachePaths.length
        ? cachePaths
        : [
            path.join(sessionDir, "auth-index.json"),
            path.join(sessionDir, "company-users-cache.json"),
            path.join(sessionDir, "master-sheet-cache.json"),
          ];
      for (const filePath of initPaths) {
        const dir = path.dirname(filePath);
        const dirCheck = directoryWritable(dir);
        if (!dirCheck.ok) {
          return { status: CHECK_STATUS.FAIL, message: `Cache path not writable: ${dir}` };
        }
        if (!fs.existsSync(filePath)) {
          continue;
        }
        try {
          fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
          JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch {
          return {
            status: CHECK_STATUS.FAIL,
            message: `Cache file not readable/writable: ${path.basename(filePath)}`,
          };
        }
      }
      return { status: CHECK_STATUS.PASS, message: "Cache stores are initialised and writable." };
    }),
  );

  checks.push(
    await timedCheck("api", async () => {
      const api = deps.apiDiagnostics || {};
      if (api.routesLoaded === false) {
        return { status: CHECK_STATUS.FAIL, message: "API routes are not loaded." };
      }
      if (api.middlewareInitialised === false) {
        return { status: CHECK_STATUS.FAIL, message: "API middleware is not initialised." };
      }
      if (api.sessionMiddlewareActive === false) {
        return { status: CHECK_STATUS.FAIL, message: "Session middleware is not active." };
      }
      if (!trim(deps.sessionSecret)) {
        return { status: CHECK_STATUS.FAIL, message: "SESSION_SECRET is not configured." };
      }
      return { status: CHECK_STATUS.PASS, message: "API routes, middleware, and session handling are active." };
    }),
  );

  const status = deriveOverallStatus(checks);
  const failedCheck = checks.find((check) => check.status === CHECK_STATUS.FAIL);

  return {
    status,
    startedAt,
    completedAt: nowMs(),
    durationMs: nowMs() - startedAt,
    checks: checks.map(({ key, name, status: checkStatus, durationMs, message }) => ({
      name,
      status: checkStatus,
      durationMs,
      message,
    })),
    failedDependency: failedCheck?.name,
    failureReason: failedCheck?.message,
    remediation: failedCheck ? remediationForCheck(failedCheck.key, failedCheck.message) : undefined,
  };
}

function remediationForCheck(key, message = "") {
  const table = {
    google: "Reconnect Google OAuth on the API host (npm run google:connect) and verify refresh token storage under BERT_SESSIONS_DIR.",
    registry: "Repair the Companies registry sheet — remove duplicate IDs and ensure LIVE rows have folder and workbook IDs.",
    authIndex: "Rebuild the auth index (npm run register:demo-company or company login bootstrap) after fixing Users tab duplicates.",
    workbook: "Verify Google access to the company master workbook and required tabs (Users, Config).",
    configuration: "Fix production environment variables and ensure BERT_SESSIONS_DIR is mounted writable.",
    backgroundJobs: "Restart the API service and confirm background job processor starts with the server.",
    cache: "Ensure BERT_SESSIONS_DIR is writable and JSON cache files are not corrupted.",
    api: "Redeploy the API — session middleware and route installers failed initialisation checks.",
  };
  return table[key] || message || "Inspect API startup logs for the failed dependency.";
}

export function formatStartupVerificationReport(result = {}) {
  const lines = [
    "==============================",
    "BERT Startup Verification",
    "==============================",
    "",
  ];
  for (const key of STARTUP_CHECK_KEYS) {
    const check = (result.checks || []).find((row) => row.name === STARTUP_CHECK_LABELS[key]);
    const label = STARTUP_CHECK_LABELS[key];
    const status = check?.status || CHECK_STATUS.FAIL;
    lines.push(`${label.padEnd(20)} ${status}`);
  }
  lines.push("");
  lines.push(`Overall: ${result.status || OVERALL_STATUS.FAILED}`);
  if (result.status === OVERALL_STATUS.FAILED) {
    lines.push("");
    lines.push(`Failed dependency: ${result.failedDependency || "Unknown"}`);
    lines.push(`Likely cause: ${result.failureReason || "Unknown"}`);
    lines.push(`Remediation: ${result.remediation || "Inspect startup logs."}`);
  }
  return lines.join("\n");
}

export function buildSystemHealthApiPayload(result = {}, meta = {}) {
  return {
    status: result.status || OVERALL_STATUS.FAILED,
    apiVersion: meta.apiVersion,
    apiSha: meta.apiSha,
    startupTime: result.startedAt ? new Date(result.startedAt).toISOString() : undefined,
    uptime: meta.uptimeSeconds,
    checks: Array.isArray(result.checks) ? result.checks : [],
  };
}

export function createStartupHealthService(deps = {}) {
  let snapshot = null;
  return {
    getSnapshot: () => snapshot,
    async runChecks(overrideDeps = {}) {
      snapshot = await runStartupHealthChecks({ ...deps, ...overrideDeps });
      return snapshot;
    },
  };
}
