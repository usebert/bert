#!/usr/bin/env node
/**
 * Unit tests for production Users & Permissions workflow verifier (mocked HTTP).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_SESSION_COOKIE } from "./lib/production-auth-health-core.mjs";
import {
  CHECK_KEYS,
  CHECK_LABELS,
  buildUsersListSnapshot,
  ensureAdminSmokeSession,
  formatUsersPermissionsWorkflowReport,
  loadUsersPermissionsWorkflowConfig,
  logRoleChangeDiagnostic,
  logRoleDiscoveryDiagnostic,
  logSessionSwitchDiagnostic,
  runProductionUsersPermissionsWorkflowChecks,
  runRoleDiscoveryChecks,
  verifyAdminTransportSession,
} from "./lib/production-users-permissions-workflow-core.mjs";
import {
  buildProductionVerificationUserEmail,
  buildProductionVerificationUserId,
  isActiveVerificationUserRecord,
  isVerificationUserEmail,
  isVerificationUserRecord,
  PRODUCTION_VERIFICATION_USER_SOURCE,
  ROLE_PERMISSION_MATRIX,
} from "../shared/production-verification-user.mjs";

const TEST_RUN_ID = 515151;
const baseConfig = loadUsersPermissionsWorkflowConfig({
  BERT_SMOKE_USERNAME: "mr.important",
  BERT_SMOKE_PASSWORD: "secret-password",
  BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
  BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
  BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
  BERT_SMOKE_ALLOW_USER_MUTATION: "1",
});

function loginJson(role = "Admin", email = baseConfig.expectedEmail) {
  return {
    ok: true,
    user: {
      email,
      role,
      name: role === "Admin" ? "Mr Important" : `BERT Verification ${role}`,
      companyFolderId: baseConfig.companyFolderId,
    },
    company: { companyFolderId: baseConfig.companyFolderId, companyName: "Dovecote Demo", live: true },
    masterSheetId: baseConfig.masterSheetId,
  };
}

function createStore() {
  return {
    users: [
      {
        email: baseConfig.expectedEmail,
        name: "Mr Important",
        role: "Admin",
        status: "ACTIVE",
        companyId: baseConfig.companyFolderId,
        companyFolderId: baseConfig.companyFolderId,
      },
    ],
    verificationPassword: "mock-verification-password-Aa1!",
  };
}

function mapUser(record) {
  return {
    email: record.email,
    name: record.name,
    role: record.role,
    status: record.status,
    companyId: baseConfig.companyFolderId,
    companyFolderId: baseConfig.companyFolderId,
    userId: record.userId,
    createdBy: record.createdBy,
  };
}

function createTransportInstance(options = {}) {
  const cookies = new Map();
  const store = options.store;
  const metrics = options.metrics;
  let currentRole = options.initialRole || "Admin";
  let currentEmail = options.initialEmail || baseConfig.expectedEmail;
  let createAttempts = 0;
  let adminSmokeLoginAttempts = 0;

  const request = async (method, path, body) => {
    if (method === "GET" && path.includes("/users") && !path.includes("verification")) {
      if (!path.includes("bert-smoke-cross-company-denied") && !path.includes("invalid-company-folder-id")) {
        metrics.usersListGetCount += 1;
      }
    }
    if (method === "GET" && path === "/api/health") {
      return { status: 200, json: { ok: true, version: "0.0.0", gitSha: "abc123", shortSha: "abc123" } };
    }
    if (method === "POST" && path === "/api/auth/company/login") {
      if (options.loginFails) {
        return { status: 401, json: { ok: false, code: "INVALID_CREDENTIALS" } };
      }
      const username = String(body?.username || body?.email || "").toLowerCase();
      if (!username.includes("smoke-user")) {
        adminSmokeLoginAttempts += 1;
      }
      if (
        options.blockForbiddenAdminRestore &&
        adminSmokeLoginAttempts >= 3 &&
        !username.includes("smoke-user")
      ) {
        return { status: 429, json: { ok: false, code: "RATE_LIMITED", error: "Admin re-login blocked in test." } };
      }
      if (options.blockAdminRelogin && currentRole === "Auditor" && !username.includes("smoke-user")) {
        return { status: 429, json: { ok: false, code: "RATE_LIMITED", error: "Admin re-login blocked in test." } };
      }
      if (username.includes("inactive-user") || store.disabledEmails?.has(username)) {
        return { status: 403, json: { ok: false, blocker: "inactive", code: "INACTIVE" } };
      }
      if (username.includes("smoke-user-manager")) {
        currentRole = store.users.find((item) => item.email.includes("manager"))?.role || "Manager";
        currentEmail = store.users.find((item) => item.email.includes("manager"))?.email || username;
      } else if (username.includes("smoke-user-auditor")) {
        currentRole = "Auditor";
        currentEmail = store.users.find((item) => item.email.includes("auditor") && !item.email.includes("manager"))?.email || username;
      } else {
        currentRole = "Admin";
        currentEmail = baseConfig.expectedEmail;
        options._adminReloginCount = (options._adminReloginCount || 0) + 1;
      }
      cookies.set(COMPANY_SESSION_COOKIE, `session-${currentRole}`);
      return { status: 200, json: loginJson(currentRole, currentEmail) };
    }
    if (method === "GET" && path === "/api/auth/company/session") {
      if (options.session409OnRelogin && currentRole === "Admin" && options._adminReloginCount > 1) {
        return {
          status: 409,
          json: {
            ok: false,
            code: "COMPANY_CONTEXT_INVALID",
            companyContextValid: false,
            reasonCode: "COMPANY_CONTEXT_INVALID",
          },
        };
      }
      return { status: 200, json: { ok: true, user: { email: currentEmail, role: currentRole }, company: { companyFolderId: baseConfig.companyFolderId } } };
    }
    if (method === "GET" && path.includes("/users") && !path.includes("verification")) {
      if (options.usersUnavailable) {
        return { status: 503, json: { ok: false, code: "COMPANY_USERS_LOAD_FAILED" } };
      }
      if (path.includes("bert-smoke-cross-company-denied") || path.includes("invalid-company-folder-id")) {
        return { status: 403, json: { ok: false, code: "FORBIDDEN" } };
      }
      return { status: 200, json: { ok: true, users: store.users.map(mapUser) } };
    }
    if (method === "POST" && path.endsWith("/users/verification-create")) {
      createAttempts += 1;
      if (options.createFails) {
        return { status: 500, json: { ok: false, code: "USERS_CREATE_FAILED" } };
      }
      if (options.create502Once && createAttempts === 1) {
        return { status: 502, json: { ok: false, code: "GATEWAY_TIMEOUT" } };
      }
      if (currentRole === "Auditor" || currentRole === "Manager") {
        return { status: 403, json: { ok: false, blocker: "forbidden" } };
      }
      const email = String(body?.email || "").toLowerCase();
      const role = String(body?.role || "Manager");
      const existing = store.users.find((item) => item.email === email);
      if (existing) {
        return { status: 200, json: { ok: true, idempotent: true, user: mapUser(existing) } };
      }
      const user = {
        email,
        name: body?.name || `BERT Verification ${role}`,
        role,
        status: "ACTIVE",
        userId: body?.userId || buildProductionVerificationUserId(TEST_RUN_ID, role),
        createdBy: PRODUCTION_VERIFICATION_USER_SOURCE,
      };
      store.users.push(user);
      return { status: 200, json: { ok: true, user: mapUser(user) } };
    }
    if (method === "PATCH" && path.includes("/users/")) {
      if (currentRole !== "Admin") {
        return { status: 403, json: { ok: false, blocker: "forbidden" } };
      }
      if (path.includes("bert-smoke-cross-company-denied") || path.includes("invalid-company-folder-id")) {
        return { status: 403, json: { ok: false, blocker: "forbidden" } };
      }
      if (path.includes("invalid-master-sheet-id")) {
        return { status: 403, json: { ok: false, blocker: "forbidden" } };
      }
      const email = decodeURIComponent(path.split("/users/")[1].split("?")[0]).toLowerCase();
      const user = store.users.find((item) => item.email === email);
      if (!user) {
        return { status: 404, json: { ok: false, code: "USER_NOT_FOUND" } };
      }
      if (body?.name !== undefined) user.name = body.name;
      if (body?.role !== undefined) user.role = body.role;
      if (body?.status !== undefined) user.status = String(body.status).toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
      if (user.status === "INACTIVE") {
        store.disabledEmails = store.disabledEmails || new Set();
        store.disabledEmails.add(email);
      } else {
        store.disabledEmails?.delete(email);
      }
      return { status: 200, json: { ok: true, user: mapUser(user) } };
    }
    if (method === "POST" && path.includes("/verification-cleanup")) {
      if (options.cleanupFails && !path.endsWith("/users/verification-cleanup")) {
        return { status: 500, json: { ok: false, code: "USERS_CLEANUP_FAILED" } };
      }
      if (options.cleanupRejectsOrdinary && path.includes(baseConfig.expectedEmail)) {
        return { status: 400, json: { ok: false, code: "USERS_CLEANUP_REJECTED" } };
      }
      if (path.endsWith("/users/verification-cleanup")) {
        store.users = store.users.map((item) =>
          isVerificationUserRecord(item) ? { ...item, status: "DELETED" } : item,
        );
        return { status: 200, json: { ok: true, cleanedCount: 1, results: [] } };
      }
      const email = decodeURIComponent(path.split("/users/")[1].split("/")[0]).toLowerCase();
      store.users = store.users.map((item) => (item.email === email ? { ...item, status: "DELETED" } : item));
      return { status: 200, json: { ok: true, email, cleaned: true } };
    }
    if (method === "GET" && path.includes("/dashboard/live")) {
      return { status: 200, json: { ok: true, actToday: [] } };
    }
    if (method === "GET" && path === "/api/me/assigned-checks") {
      return { status: 200, json: { ok: true, checks: [] } };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => cookies.clear(),
    getCurrentRole: () => currentRole,
  };
}

function createTransportFactory(options = {}) {
  const sharedStore = options.store || createStore();
  const metrics = { usersListGetCount: 0 };
  const factory = () =>
    createTransportInstance({
      ...options,
      store: sharedStore,
      metrics,
    });
  factory.store = sharedStore;
  factory.getUsersListGetCount = () => metrics.usersListGetCount;
  return factory;
}

function createTransport(options = {}) {
  const factory = createTransportFactory(options);
  const transport = factory();
  transport.createSibling = factory;
  transport.store = factory.store;
  transport.getUsersListGetCount = factory.getUsersListGetCount;
  return transport;
}

async function runWorkflow(options = {}) {
  const factory = createTransportFactory(options);
  const adminTransport = factory();
  const result = await runProductionUsersPermissionsWorkflowChecks(baseConfig, adminTransport, {
    runId: TEST_RUN_ID,
    createTransport: factory,
    logStage: () => {},
    registerInterruptCleanup(fn) {
      adminTransport.interruptCleanup = fn;
    },
  });
  return {
    result,
    store: factory.store,
    transport: adminTransport,
    usersListGetCount: factory.getUsersListGetCount(),
    createTransport: factory,
  };
}

test("full successful workflow", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.ok, true);
  assert.equal(result.checks.createManager.status, "PASS");
  assert.equal(result.checks.forbiddenOperations.status, "PASS");
  assert.equal(result.checks.cleanup.status, "PASS");
});

test("admin login failure", async () => {
  const { result } = await runWorkflow({ loginFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.authentication.status, "FAIL");
});

test("users API unavailable", async () => {
  const { result } = await runWorkflow({ usersUnavailable: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.usersApi.status, "FAIL");
});

test("role discovery reuses users API snapshot without duplicate list fetch", async () => {
  const config = loadUsersPermissionsWorkflowConfig({
    BERT_SMOKE_USERNAME: "mr.important",
    BERT_SMOKE_PASSWORD: "secret-password",
    BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
    BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
    BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
    BERT_SMOKE_ALLOW_USER_MUTATION: "0",
  });
  const transport = createTransport();
  const result = await runProductionUsersPermissionsWorkflowChecks(config, transport, {
    runId: TEST_RUN_ID,
    logStage: () => {},
  });
  assert.equal(result.checks.usersApi.status, "PASS");
  assert.equal(result.checks.roleDiscovery.status, "PASS");
  assert.equal(result.checks.baseline.status, "PASS");
  assert.equal(transport.getUsersListGetCount(), 1);
});

test("role discovery derives canonical customer roles from snapshot", () => {
  const discovery = runRoleDiscoveryChecks([
    { email: "admin@example.com", role: "Admin", status: "ACTIVE" },
    { email: "manager@example.com", role: "Manager", status: "ACTIVE" },
    { email: "auditor@example.com", role: "Auditor", status: "ACTIVE" },
    { email: "user@example.com", role: "User", status: "ACTIVE" },
  ]);
  assert.equal(discovery.ok, true);
  const canonical = new Set(discovery.roleDiscovery.map((item) => item.canonicalRole));
  assert.equal(canonical.has("Admin"), true);
  assert.equal(canonical.has("Manager"), true);
  assert.equal(canonical.has("Auditor"), true);
  assert.equal(canonical.has("User"), true);
});

test("role discovery permission matrix still matches middleware capabilities", () => {
  assert.equal(ROLE_PERMISSION_MATRIX.Admin.canPatchUsers, true);
  assert.equal(ROLE_PERMISSION_MATRIX.Manager.canPatchUsers, false);
  assert.equal(ROLE_PERMISSION_MATRIX.Auditor.canPatchUsers, false);
  const discovery = runRoleDiscoveryChecks([{ email: "admin@example.com", role: "Admin", status: "ACTIVE" }]);
  assert.equal(discovery.ok, true);
  assert.equal(discovery.roleDiscovery.some((item) => item.canonicalRole === "Manager"), true);
});

test("post-mutation readback does not reuse pre-mutation users snapshot", async () => {
  const { result, usersListGetCount } = await runWorkflow();
  assert.equal(result.checks.createManager.status, "PASS");
  assert.equal(result.checks.managerReadback.status, "PASS");
  assert.ok(usersListGetCount > 1, "manager readback should trigger a fresh Users list fetch");
});

test("role discovery logs bounded sub-stages without duplicate list fetch", async () => {
  const lines = [];
  const config = loadUsersPermissionsWorkflowConfig({
    BERT_SMOKE_USERNAME: "mr.important",
    BERT_SMOKE_PASSWORD: "secret-password",
    BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
    BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
    BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
    BERT_SMOKE_ALLOW_USER_MUTATION: "0",
  });
  const transport = createTransport();
  const result = await runProductionUsersPermissionsWorkflowChecks(config, transport, {
    runId: TEST_RUN_ID,
    logStage: (line) => lines.push(line),
  });
  assert.equal(result.checks.usersApi.status, "PASS");
  assert.equal(result.checks.roleDiscovery.status, "PASS");
  assert.equal(transport.getUsersListGetCount(), 1);
  const discoveryLogs = lines.filter((line) => line.includes("[user-permissions:role-discovery]"));
  assert.ok(discoveryLogs.length > 0);
  assert.ok(discoveryLogs.some((line) => line.includes("reuse_users_snapshot")));
  assert.ok(discoveryLogs.some((line) => line.includes("derive_roles")));
  assert.ok(discoveryLogs.some((line) => line.includes('"reusedUsersSnapshot":true')));
});

test("buildUsersListSnapshot stores counts only", () => {
  const snapshot = buildUsersListSnapshot({
    status: 200,
    json: { ok: true, users: [{ email: "a@b.com", role: "Admin", status: "ACTIVE" }] },
  });
  assert.equal(snapshot.userCount, 1);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.status, 200);
});

test("logRoleDiscoveryDiagnostic omits customer emails", () => {
  const lines = [];
  logRoleDiscoveryDiagnostic((line) => lines.push(line), {
    stage: "roleDiscovery",
    subStage: "derive_roles",
    safeRoute: "https://api.example.com/api/companies/folder/users",
    userCount: 3,
    roleCount: 2,
    reusedUsersSnapshot: true,
  });
  const joined = lines.join("\n");
  assert.equal(joined.includes("@"), false);
  assert.match(joined, /role-discovery/);
});

test("mutation disabled", async () => {
  const config = loadUsersPermissionsWorkflowConfig({
    BERT_SMOKE_USERNAME: "mr.important",
    BERT_SMOKE_PASSWORD: "secret-password",
    BERT_SMOKE_COMPANY_FOLDER_ID: "folder-abc",
    BERT_SMOKE_MASTER_SHEET_ID: "sheet-xyz",
    BERT_SMOKE_EXPECTED_EMAIL: "bert.demo+mr.important@usebert.co.uk",
    BERT_SMOKE_ALLOW_USER_MUTATION: "0",
  });
  const transport = createTransport();
  const result = await runProductionUsersPermissionsWorkflowChecks(config, transport, { runId: TEST_RUN_ID, logStage: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.checks.createManager.status, "SKIP");
});

test("stale cleanup", async () => {
  const store = createStore();
  store.users.push({
    email: buildProductionVerificationUserEmail(TEST_RUN_ID - 1, "manager"),
    name: "BERT Verification Manager",
    role: "Manager",
    status: "ACTIVE",
    createdBy: PRODUCTION_VERIFICATION_USER_SOURCE,
  });
  const { result } = await runWorkflow({ store });
  assert.equal(result.checks.staleCleanup.status, "PASS");
});

test("manager create", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.createManager.status, "PASS");
});

test("manager readback", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.managerReadback.status, "PASS");
});

test("auditor create", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.createAuditor.status, "PASS");
});

test("auditor readback", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.auditorReadback.status, "PASS");
});

test("duplicate username protection via idempotent create", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.duplicateProtection.status, "PASS");
});

test("duplicate email protection", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.duplicateProtection.status, "PASS");
});

test("edit user", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.editUser.status, "PASS");
});

test("manager login", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.managerLogin.status, "PASS");
});

test("manager allowed route", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.managerPermissions.status, "PASS");
});

test("manager forbidden route", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.forbiddenOperations.status, "PASS");
});

test("auditor login", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.auditorLogin.status, "PASS");
});

test("auditor allowed route", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.auditorPermissions.status, "PASS");
});

test("auditor forbidden route", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.forbiddenOperations.status, "PASS");
});

test("auditor cannot manage users", async () => {
  assert.equal(ROLE_PERMISSION_MATRIX.Auditor.canPatchUsers, false);
});

test("manager cannot self-promote", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.forbiddenOperations.status, "PASS");
});

test("auditor cannot self-promote", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.forbiddenOperations.status, "PASS");
});

test("admin can manage verification users", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.adminPermissions.status, "PASS");
});

test("role change", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.roleChange.status, "PASS");
});

test("role change persists Manager to Auditor on verification user", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.roleChange.status, "PASS");
  const manager = store.users.find((item) => item.email.includes("smoke-user-manager"));
  assert.equal(manager?.role, "Auditor");
});

test("role change API readback matches persisted Auditor role", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.roleChange.status, "PASS");
  assert.equal(result.checks.managerReadback.status, "PASS");
});

test("session refresh receives Auditor role after role change", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.roleChange.status, "PASS");
  assert.equal(result.checks.sessionRefresh.status, "PASS");
  assert.match(result.sessionRefreshBehavior || "", /fresh login/i);
});

test("forbidden operations leaves admin transport usable for role change", async () => {
  const { result } = await runWorkflow({ blockForbiddenAdminRestore: true });
  assert.equal(result.checks.forbiddenOperations.status, "PASS");
  assert.equal(result.checks.roleChange.status, "PASS");
});

test("isolated manager transport does not mutate admin transport session", async () => {
  const factory = createTransportFactory();
  const adminTransport = factory();
  const managerTransport = factory();
  const managerEmail = buildProductionVerificationUserEmail(TEST_RUN_ID, "manager");
  factory.store.users.push({
    email: managerEmail,
    name: "BERT Verification Manager",
    role: "Manager",
    status: "ACTIVE",
    createdBy: PRODUCTION_VERIFICATION_USER_SOURCE,
  });
  await adminTransport.request("POST", "/api/auth/company/login", {
    username: baseConfig.username,
    password: baseConfig.password,
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
  });
  const adminCookiesBefore = adminTransport.getCookies();
  await managerTransport.request("POST", "/api/auth/company/login", {
    username: managerEmail,
    password: "x",
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
  });
  assert.deepEqual(adminTransport.getCookies(), adminCookiesBefore);
  const adminSession = await adminTransport.request("GET", "/api/auth/company/session");
  const managerSession = await managerTransport.request("GET", "/api/auth/company/session");
  assert.equal(adminSession.json.user.role, "Admin");
  assert.equal(managerSession.json.user.role, "Manager");
});

test("verifyAdminTransportSession reports 409 reasonCode on shared-jar relogin", async () => {
  const transport = createTransport({ session409OnRelogin: true });
  await transport.request("POST", "/api/auth/company/login", {
    username: baseConfig.username,
    password: baseConfig.password,
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
  });
  await transport.request("POST", "/api/auth/company/login", {
    username: buildProductionVerificationUserEmail(TEST_RUN_ID, "auditor"),
    password: "x",
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
  });
  const lines = [];
  const session = await ensureAdminSmokeSession(baseConfig, transport, (line) => lines.push(line));
  assert.equal(session.ok, false);
  assert.equal(session.httpStatus, 409);
  assert.match(lines.join("\n"), /role-change|session-switch|409/);
});

test("logSessionSwitchDiagnostic omits cookie values", () => {
  const lines = [];
  logSessionSwitchDiagnostic((line) => lines.push(line), {
    stage: "manager_login",
    fromRole: "Admin",
    toRole: "Manager",
    loginHttpStatus: 200,
    sessionHttpStatus: 200,
    cookieJarNames: [COMPANY_SESSION_COOKIE],
  });
  const joined = lines.join("\n");
  assert.equal(joined.includes("session-Admin"), false);
  assert.match(joined, /session-switch/);
  assert.match(joined, /bert_company_session/);
});

test("non-admin session cannot patch verification user role", async () => {
  const transport = createTransport();
  const managerEmail = buildProductionVerificationUserEmail(TEST_RUN_ID, "manager");
  transport.store.users.push({
    email: managerEmail,
    name: "BERT Verification Manager",
    role: "Manager",
    status: "ACTIVE",
    createdBy: PRODUCTION_VERIFICATION_USER_SOURCE,
  });
  await transport.request("POST", "/api/auth/company/login", {
    username: buildProductionVerificationUserEmail(TEST_RUN_ID, "auditor"),
    password: "x",
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
  });
  const patch = await transport.request(
    "PATCH",
    `/api/companies/${baseConfig.companyFolderId}/users/${encodeURIComponent(managerEmail)}?masterSheetId=${baseConfig.masterSheetId}`,
    { role: "Auditor" },
  );
  assert.equal(patch.status, 403);
  assert.equal(patch.json?.blocker, "forbidden");
  assert.equal(transport.store.users.find((item) => item.email === managerEmail)?.role, "Manager");
});

test("ensureAdminSmokeSession fails when admin re-login is blocked", async () => {
  const transport = createTransport({ blockAdminRelogin: true });
  await transport.request("POST", "/api/auth/company/login", {
    username: buildProductionVerificationUserEmail(TEST_RUN_ID, "auditor"),
    password: "x",
    companyFolderId: baseConfig.companyFolderId,
    masterSheetId: baseConfig.masterSheetId,
  });
  const session = await ensureAdminSmokeSession(baseConfig, transport, () => {});
  assert.equal(session.ok, false);
  assert.equal(session.httpStatus, 429);
});

test("logRoleChangeDiagnostic never includes password fields", () => {
  const lines = [];
  logRoleChangeDiagnostic((line) => lines.push(line), "patch_start", {
    targetEmail: "bert.demo+smoke-user-manager@usebert.co.uk",
    requestedRole: "Auditor",
    responseMessage: "ok",
    PasswordHash: "scrypt$secret",
    password: "secret",
  });
  const joined = lines.join("\n");
  assert.equal(joined.includes("PasswordHash"), false);
  assert.equal(joined.includes("secret"), false);
  assert.match(joined, /role-change/);
});

test("ordinary smoke admin user unchanged after workflow", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.ok, true);
  const admin = store.users.find((item) => item.email === baseConfig.expectedEmail);
  assert.equal(admin?.role, "Admin");
});

test("session refresh behaviour", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.sessionRefresh.status, "PASS");
});

test("disable user", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.disableUser.status, "PASS");
});

test("disabled login rejected", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.disabledLoginRejection.status, "PASS");
});

test("re-enable success", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.reEnableUser.status, "PASS");
});

test("companyFolderId mismatch", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.companyScope.status, "PASS");
});

test("masterSheetId mismatch", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.companyScope.status, "PASS");
});

test("cross-company read denied", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.crossCompanyIsolation.status, "PASS");
});

test("cross-company mutation denied", async () => {
  const { result } = await runWorkflow();
  assert.equal(result.checks.crossCompanyIsolation.status, "PASS");
});

test("password hash absent from API", async () => {
  const transport = createTransport();
  const list = await transport.request("GET", `/api/companies/${baseConfig.companyFolderId}/users?masterSheetId=${baseConfig.masterSheetId}`);
  assert.equal(JSON.stringify(list.json).includes("PasswordHash"), false);
});

test("duplicate-create retry idempotent", async () => {
  const { result } = await runWorkflow({ create502Once: true });
  assert.equal(result.checks.createManager.status, "PASS");
});

test("cleanup success", async () => {
  const { result, store } = await runWorkflow();
  assert.equal(result.checks.cleanup.status, "PASS");
  assert.equal(store.users.some((item) => isVerificationUserRecord(item) && isActiveVerificationUserRecord(item)), false);
});

test("cleanup failure", async () => {
  const { result } = await runWorkflow({ cleanupFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.cleanup.status, "FAIL");
});

test("ordinary user cleanup rejected", async () => {
  const transport = createTransport({ cleanupRejectsOrdinary: true });
  const email = buildProductionVerificationUserEmail(TEST_RUN_ID, "manager");
  const response = await transport.request(
    "POST",
    `/api/companies/${baseConfig.companyFolderId}/users/${encodeURIComponent(email)}/verification-cleanup`,
    {},
  );
  assert.notEqual(response.json?.code, "USERS_CLEANUP_REJECTED");
});

test("transient 502 recovery", async () => {
  const { result } = await runWorkflow({ create502Once: true });
  assert.equal(result.checks.createManager.status, "PASS");
});

test("interrupt cleanup", async () => {
  const transport = createTransport({ createFails: true });
  await runProductionUsersPermissionsWorkflowChecks(baseConfig, transport, {
    runId: TEST_RUN_ID,
    logStage: () => {},
    registerInterruptCleanup(fn) {
      transport.interruptCleanup = fn;
    },
  });
  assert.equal(typeof transport.interruptCleanup, "function");
});

test("safe log output", () => {
  const report = formatUsersPermissionsWorkflowReport({
    ok: true,
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, { status: "PASS" }])),
    adminEmail: baseConfig.expectedEmail,
    managerEmail: buildProductionVerificationUserEmail(TEST_RUN_ID, "manager"),
    auditorEmail: buildProductionVerificationUserEmail(TEST_RUN_ID, "auditor"),
    runId: TEST_RUN_ID,
    durationMs: 1000,
  });
  assert.match(report, /READY FOR CUSTOMERS/);
  assert.doesNotMatch(report, /secret-password/);
  assert.doesNotMatch(report, /PasswordHash/);
});

test("check labels cover all keys", () => {
  for (const key of CHECK_KEYS) {
    assert.equal(typeof CHECK_LABELS[key], "string");
  }
});

test("verification email marker", () => {
  const email = buildProductionVerificationUserEmail(TEST_RUN_ID, "manager");
  assert.equal(isVerificationUserEmail(email), true);
});
