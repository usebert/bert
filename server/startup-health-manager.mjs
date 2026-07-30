/**
 * Startup health verification — read-only diagnostics at API boot.
 * Phase 2.1: critical checks gate listen(); deferred checks complete readiness.
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

export const CRITICAL_BOOT_CHECK_KEYS = ["google", "registry", "authIndex", "configuration", "cache", "api"];

export const DEFERRED_READINESS_CHECK_KEYS = ["workbook", "backgroundJobs"];

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

export const DEFAULT_CHECK_TIMEOUT_MS = 30_000;
export const DEFAULT_CRITICAL_BUDGET_MS = 120_000;

function trim(value) {
  return String(value ?? "").trim();
}

function nowMs() {
  return Date.now();
}

function makeCheckResult(name, status, message, durationMs, { critical = true, phase = "critical" } = {}) {
  return {
    key: name,
    name: STARTUP_CHECK_LABELS[name] || name,
    status,
    durationMs: Math.max(0, Math.round(durationMs)),
    message: trim(message) || undefined,
    critical: critical !== false,
    phase,
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

export function isCriticalBootBlocked(checks = []) {
  return checks.some((check) => check.status === CHECK_STATUS.FAIL && check.critical !== false);
}

export function deriveCriticalBootStatus(checks = []) {
  if (isCriticalBootBlocked(checks)) {
    return OVERALL_STATUS.FAILED;
  }
  if (checks.some((check) => check.status === CHECK_STATUS.WARNING)) {
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
      companyIdOwners.set(companyId, (companyIdOwners.get(companyId) || 0) + 1);
    }
    if (masterSheetId) {
      workbookIdOwners.set(masterSheetId, (workbookIdOwners.get(masterSheetId) || 0) + 1);
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

  return {
    loaded: map.size > 0,
    recordCount: map.size,
    duplicateCompanyIds: [...companyIdOwners.entries()].filter(([, count]) => count > 1).map(([id]) => id),
    duplicateWorkbookIds: [...workbookIdOwners.entries()].filter(([, count]) => count > 1).map(([id]) => id),
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
  const candidates = [...map.values()].filter((record) => isCompanyRegistryLive(record) && trim(record?.masterSheetId));
  if (!candidates.length) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function withTimeout(promise, timeoutMs, stage) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${stage} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function timedCheck(name, runner, options = {}) {
  const started = nowMs();
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_CHECK_TIMEOUT_MS;
  const phase = options.phase || "critical";
  try {
    const result = await withTimeout(Promise.resolve().then(() => runner()), timeoutMs, STARTUP_CHECK_LABELS[name] || name);
    const durationMs = nowMs() - started;
    if (typeof result === "string") {
      return makeCheckResult(name, CHECK_STATUS.PASS, result, durationMs, { ...options, phase });
    }
    return makeCheckResult(name, result.status, result.message, durationMs, {
      critical: result.critical ?? options.critical,
      phase,
    });
  } catch (error) {
    return makeCheckResult(
      name,
      CHECK_STATUS.FAIL,
      error instanceof Error ? error.message : String(error),
      nowMs() - started,
      { ...options, phase },
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
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function serializeChecks(checks = []) {
  return checks.map(({ name, status, durationMs, message }) => ({
    name,
    status,
    durationMs,
    message,
  }));
}

function finalizeResult(checks, startedAt, { bootBlocked = false, phase = "all" } = {}) {
  const status = phase === "critical" ? deriveCriticalBootStatus(checks) : deriveOverallStatus(checks);
  const failedCheck = checks.find((check) => check.status === CHECK_STATUS.FAIL);
  return {
    status,
    phase,
    bootBlocked: bootBlocked || (phase === "critical" && isCriticalBootBlocked(checks)),
    startedAt,
    completedAt: nowMs(),
    durationMs: nowMs() - startedAt,
    checks: serializeChecks(checks),
    failedDependency: failedCheck?.name,
    failureReason: failedCheck?.message,
    remediation: failedCheck ? remediationForCheck(failedCheck.key, failedCheck.message) : undefined,
  };
}

async function runGoogleCheck(deps, ctx, { phase = "critical" } = {}) {
  const googleEnvConfigured =
    typeof deps.envConfigured === "function" ? deps.envConfigured() : Boolean(deps.googleEnvConfigured);
  const auth = typeof deps.getAuthedClient === "function" ? deps.getAuthedClient() : null;
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
    return { status: CHECK_STATUS.FAIL, message: "Google credentials are not loaded (missing refresh token)." };
  }
  if (!auth) {
    return { status: CHECK_STATUS.FAIL, message: "Google OAuth client is unavailable despite stored tokens." };
  }

  if (phase === "critical") {
    const probeId =
      typeof deps.resolveGoogleSheetsProbeWorkbookId === "function"
        ? deps.resolveGoogleSheetsProbeWorkbookId()
        : trim(deps.probeWorkbookId);
    if (!probeId) {
      return {
        status: CHECK_STATUS.PASS,
        message: "Google credentials loaded; token refresh probe deferred until workbook check.",
      };
    }
    const probe = await probeSheets(auth, probeId, {
      google: deps.google,
      withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
    });
    if (!probe.ok) {
      const reason = trim(probe.reason);
      if (reason === "invalid_grant") {
        return { status: CHECK_STATUS.FAIL, message: "Google refresh token is invalid or revoked (invalid_grant)." };
      }
      return { status: CHECK_STATUS.FAIL, message: `Google token probe failed (${reason || "unknown"}).` };
    }
    return { status: CHECK_STATUS.PASS, message: "Google credentials loaded and access token obtainable." };
  }

  return { status: CHECK_STATUS.PASS, message: "Google credentials remain available." };
}

async function runRegistryCheck(deps, ctx) {
  const googleEnvConfigured =
    typeof deps.envConfigured === "function" ? deps.envConfigured() : Boolean(deps.googleEnvConfigured);
  const auth = typeof deps.getAuthedClient === "function" ? deps.getAuthedClient() : null;
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
  const registryDeps =
    typeof deps.getCompanyWorkspaceRegistryDeps === "function"
      ? deps.getCompanyWorkspaceRegistryDeps()
      : deps.registryDeps || {};
  const result = await readMap(auth, registryDeps).catch(() => ({ map: new Map() }));
  ctx.registryMap = result?.map instanceof Map ? result.map : new Map();
  const integrity = analyzeRegistryIntegrity(ctx.registryMap);
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
    return { status: CHECK_STATUS.FAIL, message: integrity.liveMissingFields[0] };
  }
  return { status: CHECK_STATUS.PASS, message: `Registry loaded (${integrity.recordCount} companies).` };
}

async function runAuthIndexCheck(deps, ctx) {
  const googleEnvConfigured =
    typeof deps.envConfigured === "function" ? deps.envConfigured() : Boolean(deps.googleEnvConfigured);
  const auth = typeof deps.getAuthedClient === "function" ? deps.getAuthedClient() : null;
  const authIndexApi = deps.authIndexApi;
  if (!authIndexApi) {
    return { status: CHECK_STATUS.FAIL, message: "Auth index API is not initialised." };
  }
  const integrity = analyzeAuthIndexIntegrity(authIndexApi);
  if (!integrity.loaded && googleEnvConfigured && auth) {
    return { status: CHECK_STATUS.WARNING, message: "Auth index is empty (may rebuild on first login)." };
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
}

async function runWorkbookCheck(deps, ctx) {
  const googleEnvConfigured =
    typeof deps.envConfigured === "function" ? deps.envConfigured() : Boolean(deps.googleEnvConfigured);
  const auth = typeof deps.getAuthedClient === "function" ? deps.getAuthedClient() : null;
  if (!googleEnvConfigured || !auth) {
    return {
      status: CHECK_STATUS.WARNING,
      message: "Workbook connectivity check skipped — Google OAuth not connected.",
      critical: false,
    };
  }
  const registryMap = ctx.registryMap instanceof Map ? ctx.registryMap : new Map();
  const target = pickRandomLiveWorkbook(registryMap);
  if (!target) {
    return {
      status: CHECK_STATUS.WARNING,
      message: "No LIVE company workbook available for connectivity probe.",
      critical: false,
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
      status: CHECK_STATUS.WARNING,
      message: `Master workbook probe warning (${trim(metadata.reason) || "probe_failed"}).`,
      critical: false,
    };
  }
  const userDeps =
    typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps.companyUsersDeps || {};
  const getTabValues = userDeps.getTabValues;
  if (typeof getTabValues !== "function") {
    return { status: CHECK_STATUS.WARNING, message: "Users tab reader is not configured.", critical: false };
  }
  const resolveUsers = deps.resolveUsersTab || resolveUsersTab;
  const usersTab = await resolveUsers(auth, masterSheetId, userDeps, { createIfMissing: false }).catch(() => null);
  if (!usersTab?.tabTitle) {
    return {
      status: CHECK_STATUS.WARNING,
      message: "Users tab is not readable on sampled LIVE workbook.",
      critical: false,
    };
  }
  const usersHeader = await getTabValues(auth, masterSheetId, usersTab.tabTitle, "A1:ZZ1").catch(() => null);
  if (!Array.isArray(usersHeader) || !usersHeader.length) {
    return { status: CHECK_STATUS.WARNING, message: "Users tab header row could not be read.", critical: false };
  }
  const configHeader = await getTabValues(auth, masterSheetId, "Config", "A1:ZZ1").catch(() => null);
  if (!Array.isArray(configHeader) || !configHeader.length) {
    return { status: CHECK_STATUS.WARNING, message: "Config tab is not readable on sampled LIVE workbook.", critical: false };
  }
  return {
    status: CHECK_STATUS.PASS,
    message: "Sampled LIVE workbook metadata, Users tab, and Config tab are readable.",
  };
}

async function runConfigurationCheck(deps) {
  const evaluation =
    typeof deps.evaluateProductionEnvironment === "function"
      ? deps.evaluateProductionEnvironment()
      : { blockingIssues: [], warnings: [] };
  const writable =
    typeof deps.sessionStoreWritable === "function"
      ? deps.sessionStoreWritable()
      : directoryWritable(deps.sessionDir).ok;
  const uploadDir = trim(deps.uploadDir || path.join(deps.sessionDir || "", "uploads"));
  const tempDir = trim(deps.tempDir || os.tmpdir());
  const cacheDir = trim(deps.sessionDir);
  const uploadOk = directoryWritable(uploadDir);
  const tempOk = directoryWritable(tempDir);
  const cacheOk = directoryWritable(cacheDir);

  if (evaluation.blockingIssues?.length) {
    return { status: CHECK_STATUS.FAIL, message: evaluation.blockingIssues[0] };
  }
  if (!writable || !cacheOk.ok) {
    return { status: CHECK_STATUS.FAIL, message: "Session/cache directory is not writable." };
  }
  if (!uploadOk.ok) {
    return { status: CHECK_STATUS.FAIL, message: "Upload directory is not writable." };
  }
  if (!tempOk.ok) {
    return { status: CHECK_STATUS.WARNING, message: "Temp directory is not writable.", critical: false };
  }
  if (evaluation.warnings?.length) {
    return { status: CHECK_STATUS.WARNING, message: evaluation.warnings[0], critical: false };
  }
  return { status: CHECK_STATUS.PASS, message: "Required environment and writable paths verified." };
}

async function runBackgroundJobsCheck(deps) {
  const processorRunning =
    typeof deps.isBackgroundProcessorRunning === "function" ? deps.isBackgroundProcessorRunning() : false;
  const notificationReady =
    typeof deps.isNotificationServiceReady === "function" ? deps.isNotificationServiceReady() : false;
  if (!processorRunning) {
    return {
      status: CHECK_STATUS.WARNING,
      message: "Background job processor is not running.",
      critical: false,
    };
  }
  if (!notificationReady) {
    return {
      status: CHECK_STATUS.WARNING,
      message: "Notification/email reminder service is not initialised or SMTP is disabled.",
      critical: false,
    };
  }
  return { status: CHECK_STATUS.PASS, message: "Background services are running." };
}

async function runCacheCheck(deps) {
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
      return { status: CHECK_STATUS.FAIL, message: `Cache file not readable/writable: ${path.basename(filePath)}` };
    }
  }
  return { status: CHECK_STATUS.PASS, message: "Cache stores are initialised and writable." };
}

async function runApiCheck(deps) {
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
}

const CHECK_RUNNERS = {
  google: (deps, ctx, options) => runGoogleCheck(deps, ctx, options),
  registry: (deps, ctx) => runRegistryCheck(deps, ctx),
  authIndex: (deps, ctx) => runAuthIndexCheck(deps, ctx),
  workbook: (deps, ctx) => runWorkbookCheck(deps, ctx),
  configuration: (deps) => runConfigurationCheck(deps),
  backgroundJobs: (deps) => runBackgroundJobsCheck(deps),
  cache: (deps) => runCacheCheck(deps),
  api: (deps) => runApiCheck(deps),
};

async function runChecksForKeys(keys, deps, options = {}) {
  const ctx = options.context || { registryMap: options.registryMap || new Map() };
  const phase = options.phase || "critical";
  const checkTimeoutMs = Number(deps.checkTimeoutMs) || DEFAULT_CHECK_TIMEOUT_MS;
  const checks = [];
  for (const key of keys) {
    const runner = CHECK_RUNNERS[key];
    if (!runner) {
      continue;
    }
    const checkOptions = {
      phase,
      timeoutMs: checkTimeoutMs,
      critical: !DEFERRED_READINESS_CHECK_KEYS.includes(key),
    };
    checks.push(await timedCheck(key, () => runner(deps, ctx, { phase }), checkOptions));
  }
  return { checks, context: ctx };
}

export async function runCriticalBootChecks(deps = {}) {
  const startedAt = nowMs();
  const budgetMs = Number(deps.criticalBudgetMs) || DEFAULT_CRITICAL_BUDGET_MS;
  const { checks, context } = await withTimeout(
    runChecksForKeys(CRITICAL_BOOT_CHECK_KEYS, deps, { phase: "critical" }),
    budgetMs,
    "Critical startup verification",
  ).catch((error) => ({
    checks: [
      makeCheckResult(
        "configuration",
        CHECK_STATUS.FAIL,
        error instanceof Error ? error.message : String(error),
        nowMs() - startedAt,
        { phase: "critical" },
      ),
    ],
    context: { registryMap: new Map() },
  }));
  const result = finalizeResult(checks, startedAt, { phase: "critical" });
  result.registryMap = context.registryMap;
  return result;
}

export async function runDeferredReadinessChecks(deps = {}, options = {}) {
  const startedAt = nowMs();
  const context = { registryMap: options.registryMap || deps.registryMap || new Map() };
  const { checks } = await runChecksForKeys(DEFERRED_READINESS_CHECK_KEYS, deps, {
    phase: "deferred",
    context,
  });
  return finalizeResult(checks, startedAt, { phase: "deferred", bootBlocked: false });
}

export async function runStartupHealthChecks(deps = {}) {
  const startedAt = nowMs();
  const critical = await runCriticalBootChecks(deps);
  const deferred = await runDeferredReadinessChecks(deps, { registryMap: critical.registryMap });
  const checks = [...critical.checks, ...deferred.checks];
  const status = deriveOverallStatus(
    checks.map((check) => ({
      ...check,
      critical: CRITICAL_BOOT_CHECK_KEYS.includes(
        STARTUP_CHECK_KEYS.find((key) => STARTUP_CHECK_LABELS[key] === check.name) || "",
      ),
    })),
  );
  const failedCheck = checks.find((check) => check.status === CHECK_STATUS.FAIL);
  return {
    status,
    phase: "all",
    bootBlocked: critical.bootBlocked,
    startedAt,
    completedAt: nowMs(),
    durationMs: nowMs() - startedAt,
    checks: serializeChecks(checks),
    failedDependency: failedCheck?.name,
    failureReason: failedCheck?.message,
    remediation: failedCheck ? remediationForCheck(failedCheck.key || "", failedCheck.message) : undefined,
  };
}

function remediationForCheck(key, message = "") {
  const table = {
    google: "Reconnect Google OAuth on the API host (npm run google:connect) and verify refresh token storage under BERT_SESSIONS_DIR.",
    registry: "Repair the Companies registry sheet — remove duplicate IDs and ensure LIVE rows have folder and workbook IDs.",
    authIndex: "Rebuild the auth index after fixing Users tab duplicates.",
    workbook: "Verify Google access to the company master workbook and required tabs (Users, Config).",
    configuration: "Fix production environment variables and ensure BERT_SESSIONS_DIR is mounted writable.",
    backgroundJobs: "Restart the API service and confirm background job processor starts with the server.",
    cache: "Ensure BERT_SESSIONS_DIR is writable and JSON cache files are not corrupted.",
    api: "Redeploy the API — session middleware and route installers failed initialisation checks.",
  };
  return table[key] || message || "Inspect API startup logs for the failed dependency.";
}

export function formatStartupVerificationReport(result = {}, options = {}) {
  const keys =
    options.phase === "critical"
      ? CRITICAL_BOOT_CHECK_KEYS
      : options.phase === "deferred"
        ? DEFERRED_READINESS_CHECK_KEYS
        : STARTUP_CHECK_KEYS;
  const lines = [
    "==============================",
    options.phase === "critical"
      ? "BERT Critical Boot Verification"
      : options.phase === "deferred"
        ? "BERT Deferred Readiness Verification"
        : "BERT Startup Verification",
    "==============================",
    "",
  ];
  for (const key of keys) {
    const check = (result.checks || []).find((row) => row.name === STARTUP_CHECK_LABELS[key]);
    lines.push(`${STARTUP_CHECK_LABELS[key].padEnd(20)} ${check?.status || CHECK_STATUS.FAIL}`);
  }
  lines.push("");
  lines.push(`Overall: ${result.status || OVERALL_STATUS.FAILED}`);
  if (result.bootBlocked || result.status === OVERALL_STATUS.FAILED) {
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
    acceptingTraffic: meta.acceptingTraffic,
    bootPhase: meta.bootPhase,
    checks: Array.isArray(result.checks) ? result.checks : [],
  };
}

export function mergeStartupSnapshots(critical = {}, deferred = {}) {
  const checks = [...(critical.checks || []), ...(deferred.checks || [])];
  return {
    status: deriveOverallStatus(
      checks.map((check) => {
        const key = Object.entries(STARTUP_CHECK_LABELS).find(([, label]) => label === check.name)?.[0];
        return { ...check, critical: CRITICAL_BOOT_CHECK_KEYS.includes(key || "") };
      }),
    ),
    startedAt: critical.startedAt || deferred.startedAt,
    completedAt: deferred.completedAt || critical.completedAt,
    durationMs: Number(critical.durationMs || 0) + Number(deferred.durationMs || 0),
    checks,
    critical,
    deferred,
  };
}

export function createStartupHealthService(deps = {}) {
  let snapshot = null;
  let readiness = {
    phase: "booting",
    acceptingTraffic: false,
    status: OVERALL_STATUS.FAILED,
    critical: null,
    deferred: null,
  };

  return {
    getSnapshot: () => snapshot,
    getReadiness: () => readiness,
    isAcceptingTraffic: () => readiness.acceptingTraffic === true,

    async runCriticalBootChecks(overrideDeps = {}) {
      const critical = await runCriticalBootChecks({ ...deps, ...overrideDeps });
      readiness.critical = critical;
      readiness.status = critical.status;
      readiness.phase = critical.bootBlocked ? "failed" : "booting";
      readiness.acceptingTraffic = false;
      snapshot = mergeStartupSnapshots(critical, readiness.deferred || { checks: [] });
      return critical;
    },

    async runDeferredReadinessChecks(overrideDeps = {}) {
      const registryMap = readiness.critical?.registryMap || overrideDeps.registryMap;
      const deferred = await runDeferredReadinessChecks(
        { ...deps, ...overrideDeps, registryMap },
        { registryMap },
      );
      readiness.deferred = deferred;
      snapshot = mergeStartupSnapshots(readiness.critical || { checks: [] }, deferred);
      return deferred;
    },

    markReady(finalStatus = OVERALL_STATUS.HEALTHY) {
      readiness.phase = "ready";
      readiness.acceptingTraffic = finalStatus !== OVERALL_STATUS.FAILED;
      readiness.status = finalStatus;
      if (snapshot) {
        snapshot.status = finalStatus;
      }
    },

    async runChecks(overrideDeps = {}) {
      const critical = await this.runCriticalBootChecks(overrideDeps);
      if (critical.bootBlocked) {
        return snapshot;
      }
      await this.runDeferredReadinessChecks(overrideDeps);
      this.markReady(snapshot?.status || OVERALL_STATUS.HEALTHY);
      return snapshot;
    },
  };
}
