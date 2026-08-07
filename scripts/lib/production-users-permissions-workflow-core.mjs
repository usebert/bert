#!/usr/bin/env node
/**
 * Production Users & Permissions workflow checks.
 */
import crypto from "node:crypto";
import {
  buildProductionVerificationUserEmail,
  buildProductionVerificationUserId,
  canonicalStoredRole,
  canonicalUserStatus,
  countUserBaselines,
  discoverRolesFromUsers,
  displayRoleForStoredRole,
  expectedPermissionForRole,
  isActiveVerificationUserRecord,
  isPersistedInactiveStatus,
  isPersistedActiveStatus,
  isVerificationUserEmail,
  isVerificationUserRecord,
  PRODUCTION_VERIFICATION_USER_SOURCE,
  ROLE_PERMISSION_MATRIX,
} from "../../shared/production-verification-user.mjs";
import { assertNoPasswordHash } from "./live-http-client.mjs";
import {
  buildLoginBody,
  createFetchTransport,
  loadSmokeConfig,
  maskEmail,
  performProductionSmokeLogin,
} from "./production-auth-health-core.mjs";
import {
  createWorkflowDiagnostics,
  formatSafeRequestUrl,
  isStageTimeoutError,
  wrapTransportWithTimeouts,
} from "./production-workflow-diagnostics.mjs";
import {
  isTransientNetworkError,
  isTransientWorkflowFailure,
  requestWithTransientRetries,
} from "./production-risk-assessment-transient-retry.mjs";

export { performProductionSmokeLogin, maskEmail };

export const USERS_PERMISSIONS_VERIFIER_BUDGET_MS = 20 * 60 * 1000;

export const DEFAULT_USERS_PERMISSIONS_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  usersApi: 60_000,
  roleDiscovery: 30_000,
  baseline: 60_000,
  staleCleanup: 120_000,
  createManager: 120_000,
  managerReadback: 60_000,
  createAuditor: 120_000,
  auditorReadback: 60_000,
  editUser: 60_000,
  duplicateProtection: 60_000,
  managerLogin: 90_000,
  managerPermissions: 60_000,
  auditorLogin: 90_000,
  auditorPermissions: 60_000,
  adminPermissions: 60_000,
  forbiddenOperations: 60_000,
  roleChange: 60_000,
  sessionRefresh: 60_000,
  disableUser: 60_000,
  disabledLoginRejection: 60_000,
  reEnableUser: 60_000,
  companyScope: 60_000,
  crossCompanyIsolation: 60_000,
  dashboardNavigation: 60_000,
  cleanup: 120_000,
};

export const CHECK_KEYS = [
  "authentication",
  "usersApi",
  "roleDiscovery",
  "baseline",
  "staleCleanup",
  "createManager",
  "managerReadback",
  "createAuditor",
  "auditorReadback",
  "editUser",
  "duplicateProtection",
  "managerLogin",
  "managerPermissions",
  "auditorLogin",
  "auditorPermissions",
  "adminPermissions",
  "forbiddenOperations",
  "roleChange",
  "sessionRefresh",
  "disableUser",
  "disabledLoginRejection",
  "reEnableUser",
  "companyScope",
  "crossCompanyIsolation",
  "dashboardNavigation",
  "cleanup",
];

export const CHECK_LABELS = {
  authentication: "Authentication",
  usersApi: "Users API",
  roleDiscovery: "Role Discovery",
  baseline: "Baseline",
  staleCleanup: "Stale Cleanup",
  createManager: "Create Manager",
  managerReadback: "Manager Readback",
  createAuditor: "Create Auditor",
  auditorReadback: "Auditor Readback",
  editUser: "Edit User",
  duplicateProtection: "Duplicate Protection",
  managerLogin: "Manager Login",
  managerPermissions: "Manager Permissions",
  auditorLogin: "Auditor Login",
  auditorPermissions: "Auditor Permissions",
  adminPermissions: "Admin Permissions",
  forbiddenOperations: "Forbidden Operations",
  roleChange: "Role Change",
  sessionRefresh: "Session Refresh",
  disableUser: "Disable User",
  disabledLoginRejection: "Disabled Login Rejection",
  reEnableUser: "Re-enable User",
  companyScope: "Company Scope",
  crossCompanyIsolation: "Cross-Company Isolation",
  dashboardNavigation: "Dashboard / Navigation",
  cleanup: "Cleanup",
};

const MUTATION_CHECK_KEYS = new Set(
  CHECK_KEYS.filter((key) => !["authentication", "usersApi", "roleDiscovery", "baseline"].includes(key)),
);

const REPORT_LABEL_WIDTH = 33;
const CROSS_COMPANY_PROBE_FOLDER_ID = "bert-smoke-cross-company-denied";

function trim(value) {
  return String(value ?? "").trim();
}

function withMasterSheet(path, masterSheetId) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}masterSheetId=${encodeURIComponent(trim(masterSheetId))}`;
}

function usersPath(companyFolderId, masterSheetId) {
  return withMasterSheet(`/api/companies/${encodeURIComponent(companyFolderId)}/users`, masterSheetId);
}

/** Post-mutation Users list read — cache-bust so pre-mutation Role Discovery snapshot cannot apply. */
function usersPathFresh(companyFolderId, masterSheetId) {
  const base = usersPath(companyFolderId, masterSheetId);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}_fresh=${Date.now()}`;
}

function userPatchPath(companyFolderId, email, masterSheetId) {
  return withMasterSheet(
    `/api/companies/${encodeURIComponent(companyFolderId)}/users/${encodeURIComponent(email)}`,
    masterSheetId,
  );
}

function buildVerificationUserPassword(runId) {
  const digest = crypto.createHash("sha256").update(`bert-smoke-user-password-${runId}`).digest("base64url");
  return `${digest.slice(0, 18)}Aa1!`;
}

export function loadUsersPermissionsWorkflowConfig(env = process.env) {
  const base = loadSmokeConfig(env);
  const allowUserMutation =
    trim(env.BERT_SMOKE_ALLOW_USER_MUTATION).toLowerCase() === "1" ||
    trim(env.BERT_SMOKE_ALLOW_USER_MUTATION).toLowerCase() === "true";
  return {
    ...base,
    allowUserMutation,
    managerUsername: trim(env.BERT_SMOKE_MANAGER_USERNAME),
    managerPassword: trim(env.BERT_SMOKE_MANAGER_PASSWORD),
    managerExpectedEmail: trim(env.BERT_SMOKE_MANAGER_EXPECTED_EMAIL).toLowerCase(),
    auditorUsername: trim(env.BERT_SMOKE_AUDITOR_USERNAME),
    auditorPassword: trim(env.BERT_SMOKE_AUDITOR_PASSWORD),
    auditorExpectedEmail: trim(env.BERT_SMOKE_AUDITOR_EXPECTED_EMAIL).toLowerCase(),
    hasManagerCredentials: Boolean(trim(env.BERT_SMOKE_MANAGER_USERNAME) && trim(env.BERT_SMOKE_MANAGER_PASSWORD)),
    hasAuditorCredentials: Boolean(trim(env.BERT_SMOKE_AUDITOR_USERNAME) && trim(env.BERT_SMOKE_AUDITOR_PASSWORD)),
    totalBudgetMs: USERS_PERMISSIONS_VERIFIER_BUDGET_MS,
  };
}

/** Safe structured diagnostics for Role Discovery (no customer emails/names). */
export function logRoleDiscoveryDiagnostic(log, input = {}) {
  log(
    `[user-permissions:role-discovery] ${JSON.stringify({
      stage: trim(input.stage) || undefined,
      safeRoute: trim(input.safeRoute) || undefined,
      durationMs: input.durationMs ?? undefined,
      totalMs: input.totalMs ?? undefined,
      userCount: input.userCount ?? undefined,
      roleCount: input.roleCount ?? undefined,
      reusedUsersSnapshot: input.reusedUsersSnapshot ?? undefined,
      httpStatus: input.httpStatus ?? undefined,
      subStage: trim(input.subStage) || undefined,
    })}`,
  );
}

/** Build a reusable Users API snapshot for pre-mutation stages (Role Discovery, Baseline). */
export function buildUsersListSnapshot(listResponse = {}) {
  const users = Array.isArray(listResponse.json?.users) ? listResponse.json.users : [];
  return {
    status: Number(listResponse.status) || 0,
    ok: listResponse.json?.ok === true,
    users,
    userCount: users.length,
    fetchedAt: Date.now(),
  };
}

/**
 * Derive canonical/display roles from an in-memory Users list — no network I/O.
 * Merges discovered Users-tab roles with ROLE_PERMISSION_MATRIX keys for matrix coverage.
 */
export function runRoleDiscoveryChecks(users = []) {
  const startedAt = Date.now();
  const discoveredRoles = discoverRolesFromUsers(users);
  const canonical = new Set([
    ...discoveredRoles.map((item) => item.canonicalRole),
    ...Object.keys(ROLE_PERMISSION_MATRIX),
  ]);
  const ok = canonical.has("Admin") && canonical.has("Manager") && canonical.has("Auditor");
  return {
    ok,
    discoveredRoles,
    roleDiscovery: [...canonical].map((role) => ({
      canonicalRole: role,
      displayRole: displayRoleForStoredRole(role),
    })),
    userCount: users.length,
    roleCount: discoveredRoles.length,
    durationMs: Date.now() - startedAt,
  };
}

export function logUserPermissionsTiming(log, input = {}) {
  log(
    `[user-permissions:timing] ${JSON.stringify({
      operation: input.operation || "user-permissions",
      stage: input.stage || "",
      userId: input.userId || "",
      role: input.role || "",
      companyFolderId: input.companyFolderId || "",
      httpStatus: input.httpStatus ?? 0,
      durationMs: input.durationMs ?? 0,
      totalMs: input.totalMs ?? 0,
    })}`,
  );
}

/** Safe structured diagnostics for Manager→Auditor role-change probes (no secrets). */
export function logRoleChangeDiagnostic(log, phase, input = {}) {
  const payload = {
    phase: trim(phase),
    method: trim(input.method) || undefined,
    route: trim(input.route) || undefined,
    targetEmail: input.targetEmail ? maskEmail(input.targetEmail) : undefined,
    targetUserId: trim(input.targetUserId) || undefined,
    requestedRole: trim(input.requestedRole) || undefined,
    actorRole: trim(input.actorRole) || undefined,
    httpStatus: input.httpStatus ?? undefined,
    responseCode: trim(input.responseCode) || undefined,
    responseMessage: trim(input.responseMessage) || undefined,
    readbackRole: trim(input.readbackRole) || undefined,
    durationMs: input.durationMs ?? undefined,
    ok: input.ok ?? undefined,
    blocker: trim(input.blocker) || undefined,
    cacheInvalidated: input.cacheInvalidated ?? undefined,
    authIndexUpdated: input.authIndexUpdated ?? undefined,
  };
  log(`[user-permissions:role-change] ${JSON.stringify(payload)}`);
}

/** Safe structured diagnostics for disable/re-enable status probes (no secrets). */
export function logDisableUserDiagnostic(log, phase, input = {}) {
  const payload = {
    phase: trim(phase),
    method: trim(input.method) || undefined,
    safeRoute: trim(input.safeRoute) || undefined,
    targetUserId: trim(input.targetUserId) || undefined,
    requestedStatus: trim(input.requestedStatus) || undefined,
    patchHttpStatus: input.patchHttpStatus ?? undefined,
    patchResponseStatus: trim(input.patchResponseStatus) || undefined,
    workbookStatus: trim(input.workbookStatus) || undefined,
    readbackStatus: trim(input.readbackStatus) || undefined,
    authIndexStatus: trim(input.authIndexStatus) || undefined,
    durationMs: input.durationMs ?? undefined,
    ok: input.ok ?? undefined,
    reusedUsersSnapshot: input.reusedUsersSnapshot === true ? true : undefined,
  };
  log(`[user-permissions:disable-user] ${JSON.stringify(payload)}`);
}

/**
 * Re-establish the smoke Admin session after Manager/Auditor probes.
 * Prefer verifyAdminTransportSession() with isolated admin/manager/auditor transports.
 */
export async function ensureAdminSmokeSession(config, transport, log = () => {}) {
  const started = Date.now();
  logRoleChangeDiagnostic(log, "admin_relogin_start", {
    method: "POST",
    route: "/api/auth/company/login",
  });
  const relogin = await performProductionSmokeLogin(config, transport);
  if (!relogin.ok) {
    logRoleChangeDiagnostic(log, "admin_relogin_failed", {
      httpStatus: relogin.httpStatus,
      responseMessage: relogin.failureReason,
      durationMs: Date.now() - started,
      ok: false,
    });
    return relogin;
  }
  const session = await transport.request("GET", "/api/auth/company/session");
  assertNoPasswordHash(session.json, "admin session after relogin");
  const sessionRole = canonicalStoredRole(session.json?.user?.role);
  if (session.status !== 200 || session.json?.ok !== true || sessionRole !== "Admin") {
    const failure = {
      ok: false,
      failureReason: `Admin session was not established after re-login (HTTP ${session.status}, role=${sessionRole || "(blank)"}).`,
      remediation: "Inspect company session cookies and Admin role on the Users tab.",
      httpStatus: session.status,
      responseBody: session.json,
    };
    logRoleChangeDiagnostic(log, "admin_session_rejected", {
      httpStatus: session.status,
      actorRole: sessionRole,
      responseMessage: failure.failureReason,
      durationMs: Date.now() - started,
      ok: false,
    });
    return failure;
  }
  logRoleChangeDiagnostic(log, "admin_relogin_ok", {
    actorRole: sessionRole,
    durationMs: Date.now() - started,
    ok: true,
  });
  return relogin;
}

/** Safe structured diagnostics for identity transport switching (no cookie values). */
export function logSessionSwitchDiagnostic(log, input = {}) {
  log(
    `[user-permissions:session-switch] ${JSON.stringify({
      stage: trim(input.stage) || undefined,
      fromRole: trim(input.fromRole) || undefined,
      toRole: trim(input.toRole) || undefined,
      loginHttpStatus: input.loginHttpStatus ?? undefined,
      sessionHttpStatus: input.sessionHttpStatus ?? undefined,
      companyContextValid: input.companyContextValid ?? undefined,
      reasonCode: trim(input.reasonCode) || undefined,
      durationMs: input.durationMs ?? undefined,
      transportIsolated: input.transportIsolated ?? undefined,
      cookieJarNames: Array.isArray(input.cookieJarNames) ? input.cookieJarNames : undefined,
      ok: input.ok ?? undefined,
    })}`,
  );
}

/** Confirm the dedicated Admin transport still holds a valid Admin session (no re-login). */
export async function verifyAdminTransportSession(adminTransport, log = () => {}, stage = "verify_admin_transport") {
  const started = Date.now();
  const cookieJarNames = adminTransport.getCookies ? Object.keys(adminTransport.getCookies()) : [];
  const session = await adminTransport.request("GET", "/api/auth/company/session");
  assertNoPasswordHash(session.json, "admin transport session");
  const sessionRole = canonicalStoredRole(session.json?.user?.role);
  const ok = session.status === 200 && session.json?.ok === true && sessionRole === "Admin";
  logSessionSwitchDiagnostic(log, {
    stage,
    fromRole: "Admin",
    toRole: sessionRole || "(blank)",
    loginHttpStatus: 0,
    sessionHttpStatus: session.status,
    companyContextValid: session.json?.companyContextValid,
    reasonCode: trim(session.json?.code || session.json?.reasonCode || session.json?.blocker),
    durationMs: Date.now() - started,
    transportIsolated: true,
    cookieJarNames,
    ok,
  });
  if (!ok) {
    return {
      ok: false,
      failureReason: `Admin transport session was not accepted (HTTP ${session.status}, role=${sessionRole || "(blank)"}).`,
      remediation: "Inspect isolated admin transport cookies and GET /api/auth/company/session validation.",
      httpStatus: session.status,
      responseBody: session.json,
      reasonCode: trim(session.json?.code || session.json?.reasonCode || session.json?.blocker),
    };
  }
  return { ok: true, role: sessionRole, httpStatus: session.status };
}

export function redactSafeResponseBody(value) {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  const clone = JSON.parse(JSON.stringify(value));
  assertNoPasswordHash(clone);
  return clone;
}

function findUserByEmail(users, email) {
  const target = trim(email).toLowerCase();
  return (Array.isArray(users) ? users : []).find((item) => trim(item.email).toLowerCase() === target);
}

function isForbiddenStatus(status) {
  return status === 401 || status === 403 || status === 404 || status === 409;
}

export async function attemptUsersPermissionsWorkflowCleanup(request, workflowContext) {
  const results = [];
  for (const email of workflowContext.createdUserEmails) {
    if (!isVerificationUserEmail(email)) {
      continue;
    }
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/users/${encodeURIComponent(email)}/verification-cleanup`,
      {
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      },
    );
    results.push({ email, status: cleanup.status, ok: cleanup.json?.ok === true });
  }
  const staleCleanup = await request(
    "POST",
    `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/users/verification-cleanup`,
    {
      companyFolderId: workflowContext.companyFolderId,
      masterSheetId: workflowContext.masterSheetId,
      runId: workflowContext.runId,
    },
  );
  return { userCleanup: { results }, staleCleanup };
}

async function createVerificationUser(request, workflowContext, role) {
  const email = buildProductionVerificationUserEmail(workflowContext.runId, role);
  const userId = buildProductionVerificationUserId(workflowContext.runId, role);
  const path = `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/users/verification-create`;
  const retried = await requestWithTransientRetries(request, "POST", path, {
    companyFolderId: workflowContext.companyFolderId,
    masterSheetId: workflowContext.masterSheetId,
    email,
    userId,
    role,
    name: `BERT Verification ${role}`,
    password: workflowContext.verificationUserPassword,
    runId: workflowContext.runId,
    source: PRODUCTION_VERIFICATION_USER_SOURCE,
  });
  const response = retried.response;
  if (response?.status === 200 && response?.json?.ok === true) {
    return { ok: true, email, userId, role, response, idempotent: response.json?.idempotent === true };
  }
  if (isTransientWorkflowFailure(response)) {
    const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    const found = findUserByEmail(list.json?.users, email);
    if (found) {
      return { ok: true, email, userId, role, response: list, recovered: true };
    }
  }
  return { ok: false, email, userId, role, response };
}

async function loginWithCredentials(transport, config, credentials, log = () => {}, switchContext = {}) {
  const started = Date.now();
  const fromRole = trim(switchContext.fromRole) || "cleared";
  const targetRole = trim(switchContext.toRole) || "unknown";
  if (transport.clearCookies) {
    transport.clearCookies();
  }
  const login = await transport.request("POST", "/api/auth/company/login", buildLoginBody(credentials));
  assertNoPasswordHash(login.json, "role login");
  logSessionSwitchDiagnostic(log, {
    stage: trim(switchContext.stage) || "login",
    fromRole,
    toRole: targetRole,
    loginHttpStatus: login.status,
    sessionHttpStatus: 0,
    reasonCode: trim(login.json?.code || login.json?.reasonCode || login.json?.blocker),
    durationMs: Date.now() - started,
    transportIsolated: switchContext.transportIsolated !== false,
    cookieJarNames: transport.getCookies ? Object.keys(transport.getCookies()) : undefined,
    ok: login.status === 200 && login.json?.ok === true,
  });
  if (login.status !== 200 || login.json?.ok !== true) {
    return {
      ok: false,
      failureReason: `Login rejected (HTTP ${login.status}).`,
      httpStatus: login.status,
      responseBody: login.json,
      reasonCode: trim(login.json?.code || login.json?.reasonCode || login.json?.blocker),
    };
  }
  const session = await transport.request("GET", "/api/auth/company/session");
  assertNoPasswordHash(session.json, "role session");
  const sessionRole = canonicalStoredRole(session.json?.user?.role);
  logSessionSwitchDiagnostic(log, {
    stage: `${trim(switchContext.stage) || "login"}_session`,
    fromRole,
    toRole: sessionRole || targetRole,
    loginHttpStatus: login.status,
    sessionHttpStatus: session.status,
    companyContextValid: session.json?.companyContextValid,
    reasonCode: trim(session.json?.code || session.json?.reasonCode || session.json?.blocker),
    durationMs: Date.now() - started,
    transportIsolated: switchContext.transportIsolated !== false,
    cookieJarNames: transport.getCookies ? Object.keys(transport.getCookies()) : undefined,
    ok: session.status === 200 && session.json?.ok === true,
  });
  if (session.status !== 200 || session.json?.ok !== true) {
    return {
      ok: false,
      failureReason: `Session rejected (HTTP ${session.status}).`,
      httpStatus: session.status,
      responseBody: session.json,
      reasonCode: trim(session.json?.code || session.json?.reasonCode || session.json?.blocker),
    };
  }
  return {
    ok: true,
    role: sessionRole,
    email: trim(session.json?.user?.email).toLowerCase(),
    companyFolderId: trim(
      session.json?.company?.companyFolderId || session.json?.user?.companyFolderId || credentials.companyFolderId,
    ),
    session,
  };
}

export function formatUsersPermissionsWorkflowReport(result) {
  const lines = [
    "==========================================",
    "BERT Production Users & Permissions Workflow",
    "==========================================",
    "",
  ];
  for (const key of CHECK_KEYS) {
    const check = result.checks[key] || { status: "FAIL" };
    const status = check.status === "SKIP" ? "SKIP" : check.status || "FAIL";
    lines.push(`${CHECK_LABELS[key].padEnd(REPORT_LABEL_WIDTH)} ${status}`);
  }
  lines.push("");
  if (result.apiVersion) lines.push(`API Version: ${result.apiVersion}`);
  if (result.apiSha) lines.push(`API SHA: ${result.apiSha}`);
  if (result.appSha) lines.push(`App SHA: ${result.appSha}`);
  if (result.adminEmail) lines.push(`Admin: ${maskEmail(result.adminEmail)}`);
  if (result.managerEmail) lines.push(`Manager: ${maskEmail(result.managerEmail)}`);
  if (result.auditorEmail) lines.push(`Auditor: ${maskEmail(result.auditorEmail)}`);
  if (result.runId) lines.push(`Run ID: bert-smoke-user-${result.runId}`);
  if (result.durationMs) lines.push(`Duration: ${result.durationMs}ms`);
  if (result.performance && Object.keys(result.performance).length > 0) {
    lines.push("");
    lines.push("Performance:");
    for (const [key, value] of Object.entries(result.performance)) {
      lines.push(`  ${key}: ${value}`);
    }
  }
  lines.push("");
  if (result.ok) {
    lines.push("RESULT");
    lines.push("READY FOR CUSTOMERS");
  } else {
    lines.push("RESULT");
    lines.push("FAILED");
    lines.push("");
    lines.push("Failed stage:");
    lines.push(result.failedStage || CHECK_LABELS[result.failedKey] || "Unknown");
    lines.push("");
    if (result.failureReason) lines.push(result.failureReason);
    if (result.remediation) {
      lines.push("");
      lines.push("Remediation:");
      lines.push(result.remediation);
    }
  }
  return lines.join("\n");
}

export async function runProductionUsersPermissionsWorkflowChecks(config, transport, options = {}) {
  const startedAt = Date.now();
  const runId = options.runId ?? Date.now();
  let currentStageKey = "authentication";
  const logStage = options.logStage || ((line) => console.log(line));
  const diagnostics = createWorkflowDiagnostics({
    log: logStage,
    prefix: "[users-permissions]",
    stageLabels: CHECK_LABELS,
    startedAt,
    totalBudgetMs: Number(config.totalBudgetMs) || USERS_PERMISSIONS_VERIFIER_BUDGET_MS,
    stageTimeouts: DEFAULT_USERS_PERMISSIONS_STAGE_TIMEOUTS_MS,
  });
  const timedTransport = wrapTransportWithTimeouts(transport, {
    apiBase: config.apiBase,
    getStageKey: () => currentStageKey,
    getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
  });
  const createRoleTransportRaw =
    typeof options.createTransport === "function"
      ? options.createTransport
      : () => createFetchTransport(config.apiBase, config.appOrigin, config.timeoutMs);
  const wrapRoleTransport = (rawTransport) =>
    wrapTransportWithTimeouts(rawTransport, {
      apiBase: config.apiBase,
      getStageKey: () => currentStageKey,
      getTimeout: (stageKey) => diagnostics.getStageTimeout(stageKey),
    });
  const adminTransport = timedTransport;
  const managerTransport = wrapRoleTransport(createRoleTransportRaw());
  const auditorTransport = wrapRoleTransport(createRoleTransportRaw());
  const adminRequest = adminTransport.request.bind(adminTransport);
  const managerRequest = managerTransport.request.bind(managerTransport);
  const auditorRequest = auditorTransport.request.bind(auditorTransport);
  const request = adminRequest;
  const workflowContext = {
    companyFolderId: "",
    masterSheetId: "",
    runId,
    adminEmail: config.expectedEmail || "",
    managerEmail: "",
    auditorEmail: "",
    managerUserId: "",
    auditorUserId: "",
    verificationUserPassword: buildVerificationUserPassword(runId),
    createdUserEmails: [],
    discoveredRoles: [],
    baselineCounts: null,
    usersListSnapshot: null,
    sessionRoleBeforeRefresh: "",
    sessionRoleAfterRefresh: "",
    disabledEmail: "",
  };
  let mustRunCleanup = false;
  const performance = {};
  const result = {
    ok: false,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PENDING" }])),
    runId,
    adminEmail: config.expectedEmail || "",
    durationMs: 0,
    performance,
    architecture: {
      usersTab: "Users workbook tab",
      listRoute: "GET /api/companies/:companyFolderId/users",
      patchRoute: "PATCH /api/companies/:companyFolderId/users/:email",
      verificationCreate: "POST /api/companies/:companyFolderId/users/verification-create",
      verificationCleanup: "POST /api/companies/:companyFolderId/users/verification-cleanup",
      permissionMatrix: ROLE_PERMISSION_MATRIX,
    },
  };

  if (typeof options.registerInterruptCleanup === "function") {
    options.registerInterruptCleanup(async () => attemptUsersPermissionsWorkflowCleanup(request, workflowContext));
  }

  const pass = (key) => {
    result.checks[key] = { status: "PASS" };
  };
  const skip = (key, reason = "SKIPPED") => {
    result.checks[key] = { status: "SKIP", reason };
  };
  const fail = (key, reason, remediation = "", httpStatus = 0, responseBody = null, extra = {}) => {
    result.failedKey = key;
    result.failedStage = CHECK_LABELS[key];
    result.failureReason = reason;
    result.remediation = remediation;
    result.httpStatus = httpStatus || undefined;
    result.safeResponseBody = responseBody ? redactSafeResponseBody(responseBody) : undefined;
    result.checks[key] = { status: "FAIL" };
    Object.assign(result, extra);
    if (!mustRunCleanup || key === "cleanup") {
      for (const checkKey of CHECK_KEYS) {
        if (result.checks[checkKey].status === "PENDING") {
          result.checks[checkKey] = { status: "SKIP" };
        }
      }
    }
    result.durationMs = Date.now() - startedAt;
    return result;
  };

  async function runStage(stageKey, fn) {
    currentStageKey = stageKey;
    diagnostics.beginStage(stageKey, CHECK_LABELS[stageKey]);
    const stageStarted = Date.now();
    try {
      const earlyExit = await fn();
      const failed = Boolean(earlyExit?.failedKey);
      diagnostics.endStage(stageKey, failed ? "FAIL" : earlyExit?.skipped ? "SKIP" : "PASS", Date.now() - stageStarted);
      logUserPermissionsTiming(logStage, {
        operation: "stage",
        stage: stageKey,
        companyFolderId: workflowContext.companyFolderId,
        durationMs: Date.now() - stageStarted,
        totalMs: Date.now() - startedAt,
      });
      return earlyExit;
    } catch (error) {
      diagnostics.endStage(stageKey, "FAIL", Date.now() - stageStarted);
      if (isStageTimeoutError(error)) {
        return fail(stageKey, error.message, "Retry when production user APIs are faster.");
      }
      if (isTransientNetworkError(error)) {
        return fail(stageKey, error.message, "Inspect network connectivity to production API.");
      }
      return fail(stageKey, error instanceof Error ? error.message : String(error), "Inspect server logs.");
    }
  }

  const authFail = await runStage("authentication", async () => {
    const health = await request("GET", "/api/health");
    if (health.status !== 200 || health.json?.ok !== true) {
      return fail("authentication", `API health returned HTTP ${health.status}.`, "Wait for API readiness.", health.status, health.json);
    }
    result.apiVersion = trim(health.json?.version);
    result.apiSha = trim(health.json?.gitSha || health.json?.sha);
    result.shortSha = trim(health.json?.shortSha);
    const login = await performProductionSmokeLogin(config, adminTransport);
    if (!login.ok) {
      return fail(
        "authentication",
        login.failureReason || "Production login failed.",
        login.remediation || "Inspect smoke credentials.",
        login.httpStatus,
        login.responseBody,
      );
    }
    const adminRole = canonicalStoredRole(login.role || login.user?.role || config.expectedRole);
    if (adminRole !== "Admin") {
      return fail(
        "authentication",
        `Smoke account is not Admin (got ${adminRole || "(blank)"}).`,
        "Use the Dovecote Admin smoke account.",
        login.httpStatus,
        login.responseBody,
      );
    }
    workflowContext.companyFolderId = trim(login.companyFolderId || config.companyFolderId);
    workflowContext.masterSheetId = trim(login.masterSheetId || config.masterSheetId);
    workflowContext.adminEmail = trim(login.accountEmail || config.expectedEmail);
    result.adminEmail = workflowContext.adminEmail;
    pass("authentication");
    return null;
  });
  if (authFail) return authFail;

  const usersApiFail = await runStage("usersApi", async () => {
    const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    assertNoPasswordHash(list.json, "users list");
    if (list.status !== 200 || list.json?.ok !== true || !Array.isArray(list.json?.users)) {
      return fail("usersApi", "Users API failed.", "Inspect GET /api/companies/:id/users.", list.status, list.json);
    }
    workflowContext.usersListSnapshot = buildUsersListSnapshot(list);
    pass("usersApi");
    return null;
  });
  if (usersApiFail) return usersApiFail;

  const roleDiscoveryFail = await runStage("roleDiscovery", async () => {
    const stageStarted = Date.now();
    const safeRoute = formatSafeRequestUrl(config.apiBase, usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
    const snapshot = workflowContext.usersListSnapshot;
    if (!snapshot || snapshot.status !== 200 || !snapshot.ok || !Array.isArray(snapshot.users)) {
      return fail(
        "roleDiscovery",
        "Users list snapshot missing from Users API stage.",
        "Inspect Users API caching before Role Discovery.",
      );
    }

    logRoleDiscoveryDiagnostic(logStage, {
      stage: "roleDiscovery",
      subStage: "reuse_users_snapshot",
      safeRoute,
      durationMs: 0,
      totalMs: Date.now() - stageStarted,
      userCount: snapshot.userCount,
      roleCount: 0,
      reusedUsersSnapshot: true,
      httpStatus: snapshot.status,
    });

    const deriveStarted = Date.now();
    const discovery = runRoleDiscoveryChecks(snapshot.users);
    logRoleDiscoveryDiagnostic(logStage, {
      stage: "roleDiscovery",
      subStage: "derive_roles",
      safeRoute,
      durationMs: Date.now() - deriveStarted,
      totalMs: Date.now() - stageStarted,
      userCount: discovery.userCount,
      roleCount: discovery.roleCount,
      reusedUsersSnapshot: true,
      httpStatus: snapshot.status,
    });

    if (!discovery.ok) {
      logRoleDiscoveryDiagnostic(logStage, {
        stage: "roleDiscovery",
        subStage: "validate_matrix",
        safeRoute,
        durationMs: Date.now() - deriveStarted,
        totalMs: Date.now() - stageStarted,
        userCount: discovery.userCount,
        roleCount: discovery.roleCount,
        reusedUsersSnapshot: true,
        httpStatus: snapshot.status,
      });
      return fail("roleDiscovery", "Expected customer roles were not discoverable.", "Inspect Users tab roles and permission matrix.");
    }

    logRoleDiscoveryDiagnostic(logStage, {
      stage: "roleDiscovery",
      subStage: "validate_matrix",
      safeRoute,
      durationMs: 0,
      totalMs: Date.now() - stageStarted,
      userCount: discovery.userCount,
      roleCount: discovery.roleDiscovery.length,
      reusedUsersSnapshot: true,
      httpStatus: snapshot.status,
    });

    workflowContext.discoveredRoles = discovery.discoveredRoles;
    result.roleDiscovery = discovery.roleDiscovery;
    pass("roleDiscovery");
    return null;
  });
  if (roleDiscoveryFail) return roleDiscoveryFail;

  const baselineFail = await runStage("baseline", async () => {
    const snapshot = workflowContext.usersListSnapshot;
    if (!snapshot || !Array.isArray(snapshot.users)) {
      return fail("baseline", "Users list snapshot missing for baseline.", "Inspect Users API caching before Baseline.");
    }
    workflowContext.baselineCounts = countUserBaselines(snapshot.users);
    pass("baseline");
    return null;
  });
  if (baselineFail) return baselineFail;

  if (!config.allowUserMutation) {
    for (const key of MUTATION_CHECK_KEYS) {
      skip(key, "BERT_SMOKE_ALLOW_USER_MUTATION is not set.");
    }
    result.mutationSkipped = true;
    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const staleFail = await runStage("staleCleanup", async () => {
    const cleanup = await request(
      "POST",
      `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/users/verification-cleanup`,
      { companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId, runId },
    );
    if (cleanup.status !== 200 || cleanup.json?.ok !== true) {
      return fail("staleCleanup", "Verification user cleanup failed.", "Inspect users verification-cleanup route.", cleanup.status, cleanup.json);
    }
    pass("staleCleanup");
    return null;
  });
  if (staleFail) return staleFail;

  try {
    const createManagerFail = await runStage("createManager", async () => {
      const started = Date.now();
      const created = await createVerificationUser(request, workflowContext, "Manager");
      if (!created.ok) {
        return fail("createManager", "Verification Manager could not be created.", "Inspect users verification-create.", created.response?.status, created.response?.json);
      }
      workflowContext.managerEmail = created.email;
      workflowContext.managerUserId = created.userId;
      workflowContext.createdUserEmails.push(created.email);
      mustRunCleanup = true;
      performance.createManagerMs = `${Date.now() - started}ms`;
      pass("createManager");
      return null;
    });
    if (createManagerFail) return createManagerFail;

    const managerReadbackFail = await runStage("managerReadback", async () => {
      const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const found = findUserByEmail(list.json?.users, workflowContext.managerEmail);
      if (!found || canonicalStoredRole(found.role) !== "Manager") {
        return fail("managerReadback", "Verification Manager not found with Manager role.", "Inspect Users tab readback.");
      }
      if (!isVerificationUserRecord(found)) {
        return fail("managerReadback", "Verification Manager is not marked as verification.", "Inspect verification markers.");
      }
      pass("managerReadback");
      return null;
    });
    if (managerReadbackFail) return managerReadbackFail;

    const createAuditorFail = await runStage("createAuditor", async () => {
      const created = await createVerificationUser(request, workflowContext, "Auditor");
      if (!created.ok) {
        return fail("createAuditor", "Verification Auditor could not be created.", "Inspect users verification-create.", created.response?.status, created.response?.json);
      }
      workflowContext.auditorEmail = created.email;
      workflowContext.auditorUserId = created.userId;
      workflowContext.createdUserEmails.push(created.email);
      result.auditorEmail = workflowContext.auditorEmail;
      pass("createAuditor");
      return null;
    });
    if (createAuditorFail) return createAuditorFail;

    const auditorReadbackFail = await runStage("auditorReadback", async () => {
      const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const found = findUserByEmail(list.json?.users, workflowContext.auditorEmail);
      if (!found || canonicalStoredRole(found.role) !== "Auditor") {
        return fail("auditorReadback", "Verification Auditor not found with Auditor role.", "Inspect Users tab readback.");
      }
      pass("auditorReadback");
      return null;
    });
    if (auditorReadbackFail) return auditorReadbackFail;

    const editUserFail = await runStage("editUser", async () => {
      const patch = await request(
        "PATCH",
        userPatchPath(workflowContext.companyFolderId, workflowContext.managerEmail, workflowContext.masterSheetId),
        { name: "BERT Verification Manager Updated", companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId },
      );
      assertNoPasswordHash(patch.json, "edit user");
      if (patch.status !== 200 || patch.json?.ok !== true) {
        return fail("editUser", "Could not edit verification user.", "Inspect PATCH users route.", patch.status, patch.json);
      }
      const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const found = findUserByEmail(list.json?.users, workflowContext.managerEmail);
      if (!found || trim(found.name) !== "BERT Verification Manager Updated") {
        return fail("editUser", "Edited verification user name did not persist.", "Inspect Users tab patch.");
      }
      if (canonicalStoredRole(found.role) !== "Manager") {
        return fail("editUser", "Edit changed verification user role unexpectedly.", "Inspect PATCH role preservation.");
      }
      pass("editUser");
      return null;
    });
    if (editUserFail) return editUserFail;

    const duplicateFail = await runStage("duplicateProtection", async () => {
      const created = await createVerificationUser(request, workflowContext, "Manager");
      if (!created.ok) {
        return fail("duplicateProtection", "Duplicate verification user recovery failed.", "Inspect idempotent user creation.");
      }
      const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const matches = (list.json?.users || []).filter(
        (item) => trim(item.email).toLowerCase() === workflowContext.managerEmail.toLowerCase(),
      );
      if (matches.length !== 1) {
        return fail("duplicateProtection", "Duplicate verification users were created.", "Inspect stable verification user IDs.");
      }
      pass("duplicateProtection");
      return null;
    });
    if (duplicateFail) return duplicateFail;

    const managerLoginFail = await runStage("managerLogin", async () => {
      const login = await loginWithCredentials(
        managerTransport,
        config,
        {
          username: workflowContext.managerEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "manager_login", fromRole: "none", toRole: "Manager", transportIsolated: true },
      );
      if (!login.ok) {
        return fail("managerLogin", login.failureReason || "Manager login failed.", "Inspect verification Manager credentials.", login.httpStatus, login.responseBody);
      }
      if (login.role !== "Manager") {
        return fail("managerLogin", `Manager session role mismatch (got ${login.role}).`, "Inspect role mapping.");
      }
      workflowContext.sessionRoleBeforeRefresh = login.role;
      result.managerEmail = workflowContext.managerEmail;
      pass("managerLogin");
      return null;
    });
    if (managerLoginFail) return managerLoginFail;

    const managerPermissionsFail = await runStage("managerPermissions", async () => {
      const list = await managerRequest("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      if (list.status !== 200 || list.json?.ok !== true) {
        return fail("managerPermissions", "Manager could not list users.", "Inspect Manager list permission.", list.status, list.json);
      }
      const dashboard = await managerRequest(
        "GET",
        withMasterSheet(
          `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/dashboard/live`,
          workflowContext.masterSheetId,
        ),
      );
      if (dashboard.status !== 200 || dashboard.json?.ok !== true) {
        return fail("managerPermissions", "Manager could not access dashboard.", "Inspect Manager dashboard permission.", dashboard.status, dashboard.json);
      }
      if (!expectedPermissionForRole("Manager", "canListUsers")) {
        return fail("managerPermissions", "Permission matrix misconfigured for Manager list.", "Fix ROLE_PERMISSION_MATRIX.");
      }
      pass("managerPermissions");
      return null;
    });
    if (managerPermissionsFail) return managerPermissionsFail;

    const auditorLoginFail = await runStage("auditorLogin", async () => {
      const login = await loginWithCredentials(
        auditorTransport,
        config,
        {
          username: workflowContext.auditorEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "auditor_login", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      if (!login.ok) {
        return fail("auditorLogin", login.failureReason || "Auditor login failed.", "Inspect verification Auditor credentials.", login.httpStatus, login.responseBody);
      }
      if (login.role !== "Auditor") {
        return fail("auditorLogin", `Auditor session role mismatch (got ${login.role}).`, "Inspect role mapping.");
      }
      pass("auditorLogin");
      return null;
    });
    if (auditorLoginFail) return auditorLoginFail;

    const auditorPermissionsFail = await runStage("auditorPermissions", async () => {
      const assigned = await auditorRequest("GET", "/api/me/assigned-checks");
      if (assigned.status !== 200 || assigned.json?.ok !== true) {
        return fail("auditorPermissions", "Auditor could not access assigned checks.", "Inspect Auditor read permissions.", assigned.status, assigned.json);
      }
      pass("auditorPermissions");
      return null;
    });
    if (auditorPermissionsFail) return auditorPermissionsFail;

    const adminPermissionsFail = await runStage("adminPermissions", async () => {
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "admin_permissions");
      if (!adminSession.ok) {
        return fail(
          "adminPermissions",
          adminSession.failureReason || "Admin transport session was not valid.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const patchProbe = await adminRequest(
        "PATCH",
        userPatchPath(workflowContext.companyFolderId, workflowContext.auditorEmail, workflowContext.masterSheetId),
        { name: "BERT Verification Auditor", companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId },
      );
      if (patchProbe.status !== 200 || patchProbe.json?.ok !== true) {
        return fail("adminPermissions", "Admin could not patch verification user.", "Inspect Admin user-management permissions.", patchProbe.status, patchProbe.json);
      }
      pass("adminPermissions");
      return null;
    });
    if (adminPermissionsFail) return adminPermissionsFail;

    const forbiddenFail = await runStage("forbiddenOperations", async () => {
      const managerLogin = await loginWithCredentials(
        managerTransport,
        config,
        {
          username: workflowContext.managerEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "forbidden_manager_login", fromRole: "none", toRole: "Manager", transportIsolated: true },
      );
      if (!managerLogin.ok) {
        return fail("forbiddenOperations", "Could not authenticate Manager for forbidden probe.", "Inspect Manager login.");
      }
      const managerPatch = await managerRequest(
        "PATCH",
        userPatchPath(workflowContext.companyFolderId, workflowContext.auditorEmail, workflowContext.masterSheetId),
        { role: "Admin", companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId },
      );
      if (!isForbiddenStatus(managerPatch.status)) {
        return fail("forbiddenOperations", "Manager user patch was not forbidden.", "Inspect requireWorkspaceAdminActor.", managerPatch.status, managerPatch.json);
      }
      const auditorLogin = await loginWithCredentials(
        auditorTransport,
        config,
        {
          username: workflowContext.auditorEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "forbidden_auditor_login", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      if (!auditorLogin.ok) {
        return fail("forbiddenOperations", "Could not authenticate Auditor for forbidden probe.", "Inspect Auditor login.");
      }
      const auditorPatch = await auditorRequest(
        "PATCH",
        userPatchPath(workflowContext.companyFolderId, workflowContext.managerEmail, workflowContext.masterSheetId),
        { role: "Admin", companyFolderId: workflowContext.companyFolderId, masterSheetId: workflowContext.masterSheetId },
      );
      if (!isForbiddenStatus(auditorPatch.status)) {
        return fail("forbiddenOperations", "Auditor self-promotion was not forbidden.", "Inspect user-management guards.", auditorPatch.status, auditorPatch.json);
      }
      const auditorCreate = await auditorRequest(
        "POST",
        `/api/companies/${encodeURIComponent(workflowContext.companyFolderId)}/users/verification-create`,
        {
          email: buildProductionVerificationUserEmail(runId + 99, "admin"),
          role: "Admin",
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
      );
      if (!isForbiddenStatus(auditorCreate.status)) {
        return fail("forbiddenOperations", "Auditor verification-create was not forbidden.", "Inspect verification-create admin gate.", auditorCreate.status, auditorCreate.json);
      }
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "forbidden_operations_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "forbiddenOperations",
          `Admin transport was invalidated after forbidden probes. ${adminSession.failureReason || ""}`.trim(),
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      pass("forbiddenOperations");
      return null;
    });
    if (forbiddenFail) return forbiddenFail;

    const roleChangeFail = await runStage("roleChange", async () => {
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "role_change_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "roleChange",
          adminSession.failureReason || "Admin transport session was not valid before role change.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const patchPath = userPatchPath(
        workflowContext.companyFolderId,
        workflowContext.managerEmail,
        workflowContext.masterSheetId,
      );
      const requestedRole = "Auditor";
      logRoleChangeDiagnostic(logStage, "patch_start", {
        method: "PATCH",
        route: patchPath.split("?")[0],
        targetEmail: workflowContext.managerEmail,
        targetUserId: workflowContext.managerUserId,
        requestedRole,
        actorRole: "Admin",
      });
      const patchStarted = Date.now();
      const patch = await request("PATCH", patchPath, {
        role: requestedRole,
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      });
      assertNoPasswordHash(patch.json, "role change patch");
      logRoleChangeDiagnostic(logStage, "patch_response", {
        method: "PATCH",
        route: patchPath.split("?")[0],
        targetEmail: workflowContext.managerEmail,
        requestedRole,
        httpStatus: patch.status,
        responseCode: trim(patch.json?.code || patch.json?.blocker),
        responseMessage: trim(patch.json?.error || patch.json?.message),
        durationMs: Date.now() - patchStarted,
        ok: patch.status === 200 && patch.json?.ok === true,
        blocker: trim(patch.json?.blocker),
      });
      if (patch.status !== 200 || patch.json?.ok !== true) {
        return fail("roleChange", "Admin could not change verification Manager role.", "Inspect PATCH role updates.", patch.status, patch.json);
      }
      const readbackStarted = Date.now();
      const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const found = findUserByEmail(list.json?.users, workflowContext.managerEmail);
      const readbackRole = canonicalStoredRole(found?.role);
      logRoleChangeDiagnostic(logStage, "readback", {
        targetEmail: workflowContext.managerEmail,
        readbackRole,
        durationMs: Date.now() - readbackStarted,
        ok: readbackRole === requestedRole,
      });
      logRoleChangeDiagnostic(logStage, "final_assertion", {
        targetEmail: workflowContext.managerEmail,
        requestedRole,
        readbackRole,
        ok: readbackRole === requestedRole,
      });
      if (readbackRole !== requestedRole) {
        return fail("roleChange", "Role change did not persist.", "Inspect Users tab role column.");
      }
      pass("roleChange");
      return null;
    });
    if (roleChangeFail) return roleChangeFail;

    const sessionRefreshFail = await runStage("sessionRefresh", async () => {
      const managerSession = await loginWithCredentials(
        managerTransport,
        config,
        {
          username: workflowContext.managerEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "session_refresh_manager", fromRole: "none", toRole: "Manager", transportIsolated: true },
      );
      if (!managerSession.ok) {
        return fail("sessionRefresh", "Could not establish Manager session for refresh probe.", "Inspect login.");
      }
      workflowContext.sessionRoleAfterRefresh = managerSession.role;
      const relogin = await loginWithCredentials(
        managerTransport,
        config,
        {
          username: workflowContext.managerEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "session_refresh_relogin", fromRole: "Manager", toRole: "Auditor", transportIsolated: true },
      );
      if (!relogin.ok || relogin.role !== "Auditor") {
        return fail("sessionRefresh", "Post-role-change login did not reflect Auditor role.", "Inspect auth index/session role resolution.", relogin.httpStatus, relogin.responseBody);
      }
      result.sessionRefreshBehavior = "Session role updates after fresh login; existing cookie may retain prior role until re-login.";
      pass("sessionRefresh");
      return null;
    });
    if (sessionRefreshFail) return sessionRefreshFail;

    const disableUserFail = await runStage("disableUser", async () => {
      const stageStarted = Date.now();
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "disable_user_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "disableUser",
          adminSession.failureReason || "Admin transport session was not valid before disable.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      workflowContext.disabledEmail = workflowContext.auditorEmail;
      const patchRoute = userPatchPath(
        workflowContext.companyFolderId,
        workflowContext.disabledEmail,
        workflowContext.masterSheetId,
      );
      const safeRoute = formatSafeRequestUrl(config.apiBase, patchRoute);
      const targetUserId = buildProductionVerificationUserId(workflowContext.runId, "Auditor");
      const requestedStatus = "inactive";
      logDisableUserDiagnostic(logStage, "patch_start", {
        method: "PATCH",
        safeRoute,
        targetUserId,
        requestedStatus,
      });
      const patch = await request("PATCH", patchRoute, {
        status: requestedStatus,
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      });
      const patchResponseStatus = canonicalUserStatus(patch.json?.user?.status);
      const workbookStatus = patchResponseStatus;
      logDisableUserDiagnostic(logStage, "patch_complete", {
        method: "PATCH",
        safeRoute,
        targetUserId,
        requestedStatus,
        patchHttpStatus: patch.status,
        patchResponseStatus,
        workbookStatus,
        durationMs: Date.now() - stageStarted,
        ok: patch.status === 200 && patch.json?.ok === true,
      });
      if (patch.status !== 200 || patch.json?.ok !== true) {
        return fail("disableUser", "Could not disable verification user.", "Inspect PATCH status inactive.", patch.status, patch.json);
      }
      const listRoute = usersPathFresh(workflowContext.companyFolderId, workflowContext.masterSheetId);
      const listSafeRoute = formatSafeRequestUrl(config.apiBase, listRoute);
      const list = await request("GET", listRoute);
      const found = findUserByEmail(list.json?.users, workflowContext.disabledEmail);
      const readbackStatus = canonicalUserStatus(found?.status);
      const loginProbe = await loginWithCredentials(
        wrapRoleTransport(createRoleTransportRaw()),
        config,
        {
          username: workflowContext.disabledEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "disable_user_auth_probe", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      const authIndexStatus =
        loginProbe.ok === false && (loginProbe.responseBody?.blocker === "inactive" || loginProbe.httpStatus === 403)
          ? "INACTIVE"
          : loginProbe.ok
            ? "ACTIVE"
            : "";
      logDisableUserDiagnostic(logStage, "readback", {
        method: "GET",
        safeRoute: listSafeRoute,
        targetUserId,
        requestedStatus,
        patchHttpStatus: patch.status,
        patchResponseStatus,
        workbookStatus,
        readbackStatus,
        authIndexStatus,
        reusedUsersSnapshot: false,
        durationMs: Date.now() - stageStarted,
        ok: isPersistedInactiveStatus(readbackStatus),
      });
      if (!found || !isPersistedInactiveStatus(found.status)) {
        return fail(
          "disableUser",
          "Disabled status did not persist.",
          "Inspect Users tab status and GET /users listable profile filter.",
          list.status,
          { patchResponseStatus, readbackStatus, workbookStatus, authIndexStatus },
        );
      }
      if (!isPersistedInactiveStatus(patchResponseStatus)) {
        return fail(
          "disableUser",
          "PATCH response did not return inactive status.",
          "Inspect updateCompanyUserRecord status normalisation.",
          patch.status,
          patch.json,
        );
      }
      pass("disableUser");
      return null;
    });
    if (disableUserFail) return disableUserFail;

    const disabledLoginFail = await runStage("disabledLoginRejection", async () => {
      const login = await loginWithCredentials(
        wrapRoleTransport(createRoleTransportRaw()),
        config,
        {
          username: workflowContext.disabledEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "disabled_login_rejection", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      if (login.ok) {
        return fail("disabledLoginRejection", "Disabled verification user login succeeded.", "Inspect inactive login rejection.");
      }
      if (login.httpStatus !== 403 && login.responseBody?.blocker !== "inactive") {
        return fail(
          "disabledLoginRejection",
          `Disabled login rejection was not explicit (HTTP ${login.httpStatus}).`,
          "Inspect auth-service inactive blocker.",
          login.httpStatus,
          login.responseBody,
        );
      }
      pass("disabledLoginRejection");
      return null;
    });
    if (disabledLoginFail) return disabledLoginFail;

    const reEnableFail = await runStage("reEnableUser", async () => {
      const stageStarted = Date.now();
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "re_enable_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "reEnableUser",
          adminSession.failureReason || "Admin transport session was not valid before re-enable.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const patchRoute = userPatchPath(
        workflowContext.companyFolderId,
        workflowContext.disabledEmail,
        workflowContext.masterSheetId,
      );
      const targetUserId = buildProductionVerificationUserId(workflowContext.runId, "Auditor");
      const patch = await request("PATCH", patchRoute, {
        status: "active",
        companyFolderId: workflowContext.companyFolderId,
        masterSheetId: workflowContext.masterSheetId,
      });
      const patchResponseStatus = canonicalUserStatus(patch.json?.user?.status);
      if (patch.status !== 200 || patch.json?.ok !== true) {
        return fail("reEnableUser", "Could not re-enable verification user.", "Inspect PATCH status active.", patch.status, patch.json);
      }
      const list = await request("GET", usersPathFresh(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const found = findUserByEmail(list.json?.users, workflowContext.disabledEmail);
      const readbackStatus = canonicalUserStatus(found?.status);
      logDisableUserDiagnostic(logStage, "re_enable_readback", {
        method: "GET",
        targetUserId,
        requestedStatus: "active",
        patchHttpStatus: patch.status,
        patchResponseStatus,
        workbookStatus: patchResponseStatus,
        readbackStatus,
        reusedUsersSnapshot: false,
        durationMs: Date.now() - stageStarted,
        ok: isPersistedActiveStatus(readbackStatus),
      });
      if (!found || !isPersistedActiveStatus(found.status)) {
        return fail(
          "reEnableUser",
          "Re-enabled status did not persist.",
          "Inspect Users tab status and GET /users listable profile filter.",
          list.status,
          { patchResponseStatus, readbackStatus },
        );
      }
      const login = await loginWithCredentials(
        auditorTransport,
        config,
        {
          username: workflowContext.disabledEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "re_enable_auditor_login", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      if (!login.ok || login.role !== "Auditor") {
        return fail("reEnableUser", "Re-enabled verification user could not log in.", "Inspect reactivation flow.", login.httpStatus, login.responseBody);
      }
      pass("reEnableUser");
      return null;
    });
    if (reEnableFail) return reEnableFail;

    const companyScopeFail = await runStage("companyScope", async () => {
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "company_scope_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "companyScope",
          adminSession.failureReason || "Admin transport session was not valid for company scope probe.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const mismatch = await adminRequest(
        "PATCH",
        userPatchPath(workflowContext.companyFolderId, workflowContext.auditorEmail, "invalid-master-sheet-id"),
        { name: "Scope Probe", companyFolderId: workflowContext.companyFolderId, masterSheetId: "invalid-master-sheet-id" },
      );
      if (mismatch.status === 200 && mismatch.json?.ok === true) {
        return fail("companyScope", "masterSheetId mismatch was accepted.", "Inspect company session scoping.");
      }
      const folderMismatch = await adminRequest(
        "GET",
        usersPath("invalid-company-folder-id", workflowContext.masterSheetId),
      );
      if (folderMismatch.status === 200 && Array.isArray(folderMismatch.json?.users) && folderMismatch.json.users.length > 0) {
        return fail("companyScope", "Invalid company folder returned users.", "Inspect users list company scoping.");
      }
      pass("companyScope");
      return null;
    });
    if (companyScopeFail) return companyScopeFail;

    const crossCompanyFail = await runStage("crossCompanyIsolation", async () => {
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "cross_company_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "crossCompanyIsolation",
          adminSession.failureReason || "Admin transport session was not valid for cross-company probe.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const list = await adminRequest("GET", usersPath(CROSS_COMPANY_PROBE_FOLDER_ID, workflowContext.masterSheetId));
      if (list.status === 200 && Array.isArray(list.json?.users) && list.json.users.some((item) => !isVerificationUserRecord(item))) {
        return fail("crossCompanyIsolation", "Cross-company users list leaked operational users.", "Inspect company profile isolation.");
      }
      const patch = await adminRequest(
        "PATCH",
        userPatchPath(CROSS_COMPANY_PROBE_FOLDER_ID, workflowContext.auditorEmail, workflowContext.masterSheetId),
        { name: "Cross-company probe", companyFolderId: CROSS_COMPANY_PROBE_FOLDER_ID, masterSheetId: workflowContext.masterSheetId },
      );
      if (patch.status === 200 && patch.json?.ok === true) {
        return fail("crossCompanyIsolation", "Cross-company user mutation succeeded.", "Inspect company mismatch guards.");
      }
      pass("crossCompanyIsolation");
      return null;
    });
    if (crossCompanyFail) return crossCompanyFail;

    const dashboardFail = await runStage("dashboardNavigation", async () => {
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "dashboard_navigation_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "dashboardNavigation",
          adminSession.failureReason || "Admin transport session was not valid for navigation probe.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const adminRole = adminSession.role;
      if (adminRole !== "Admin") {
        return fail("dashboardNavigation", "Admin session role missing for navigation probe.", "Inspect session payload.");
      }
      if (!expectedPermissionForRole(adminRole, "canAccessWorkspaceSettings")) {
        return fail("dashboardNavigation", "Admin permission matrix missing workspace settings.", "Fix ROLE_PERMISSION_MATRIX.");
      }
      const changedManagerLogin = await loginWithCredentials(
        managerTransport,
        config,
        {
          username: workflowContext.managerEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "dashboard_manager_login", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      if (!changedManagerLogin.ok || changedManagerLogin.role !== "Auditor") {
        return fail("dashboardNavigation", "Post-role-change verification user should present as Auditor.", "Inspect role change persistence.");
      }
      if (expectedPermissionForRole(changedManagerLogin.role, "canManageSchedules")) {
        return fail("dashboardNavigation", "Auditor incorrectly has Manager schedule permissions.", "Inspect permissions matrix.");
      }
      const auditorLogin = await loginWithCredentials(
        auditorTransport,
        config,
        {
          username: workflowContext.auditorEmail,
          password: workflowContext.verificationUserPassword,
          companyFolderId: workflowContext.companyFolderId,
          masterSheetId: workflowContext.masterSheetId,
        },
        logStage,
        { stage: "dashboard_auditor_login", fromRole: "none", toRole: "Auditor", transportIsolated: true },
      );
      if (!auditorLogin.ok || expectedPermissionForRole(auditorLogin.role, "canPatchUsers")) {
        return fail("dashboardNavigation", "Auditor navigation permissions inconsistent.", "Inspect permissions matrix.");
      }
      pass("dashboardNavigation");
      return null;
    });
    if (dashboardFail) return dashboardFail;

    const cleanupFail = await runStage("cleanup", async () => {
      const adminSession = await verifyAdminTransportSession(adminTransport, logStage, "cleanup_admin_transport");
      if (!adminSession.ok) {
        return fail(
          "cleanup",
          adminSession.failureReason || "Admin transport session was not valid for cleanup.",
          adminSession.remediation || "Inspect isolated admin transport session.",
          adminSession.httpStatus,
          adminSession.responseBody,
        );
      }
      const cleanup = await attemptUsersPermissionsWorkflowCleanup(adminRequest, workflowContext);
      const userFailed = cleanup.userCleanup.results.some((item) => !item.ok);
      const staleFailed = cleanup.staleCleanup.status !== 200 || cleanup.staleCleanup.json?.ok !== true;
      if (userFailed || staleFailed) {
        return fail("cleanup", "Verification user cleanup failed.", "Inspect users verification-cleanup routes.");
      }
      const list = await request("GET", usersPath(workflowContext.companyFolderId, workflowContext.masterSheetId));
      const active = (list.json?.users || []).filter((item) => isActiveVerificationUserRecord(item));
      if (active.length > 0) {
        return fail("cleanup", "Active verification users remain after cleanup.", "Re-run stale cleanup.");
      }
      pass("cleanup");
      return null;
    });
    if (cleanupFail) return cleanupFail;

    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    result.managerEmail = workflowContext.managerEmail;
    result.auditorEmail = workflowContext.auditorEmail;
    return result;
  } finally {
    if (mustRunCleanup && result.checks.cleanup?.status !== "PASS") {
      try {
        await verifyAdminTransportSession(adminTransport, logStage, "interrupt_cleanup_admin_transport").catch(() => null);
        const cleanup = await attemptUsersPermissionsWorkflowCleanup(adminRequest, workflowContext);
        const userFailed = cleanup.userCleanup.results.some((item) => !item.ok);
        const staleFailed = cleanup.staleCleanup.status !== 200 || cleanup.staleCleanup.json?.ok !== true;
        result.cleanupResult = cleanup;
        result.checks.cleanup = {
          status: userFailed || staleFailed ? "FAIL" : "PASS",
          reason: userFailed || staleFailed ? "Best-effort cleanup after workflow failure did not complete." : "Best-effort cleanup after workflow failure.",
        };
      } catch (error) {
        result.checks.cleanup = {
          status: "FAIL",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      for (const checkKey of CHECK_KEYS) {
        if (result.checks[checkKey].status === "PENDING") {
          result.checks[checkKey] = { status: "SKIP" };
        }
      }
    }
  }
}
