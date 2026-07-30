#!/usr/bin/env node
/**
 * Unit tests for production auth health verifier (mocked HTTP — no production calls).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANY_SESSION_COOKIE,
  PROBE_INVALID_PASSWORD,
  runProductionAuthHealthChecks,
} from "./lib/production-auth-health-core.mjs";

const baseConfig = {
  username: "mr.important",
  password: "secret-password",
  companyFolderId: "folder-abc",
  masterSheetId: "sheet-xyz",
  expectedEmail: "bert.demo+mr.important@usebert.co.uk",
  expectedRole: "Admin",
};

function successLoginJson(overrides = {}) {
  return {
    ok: true,
    user: {
      email: baseConfig.expectedEmail,
      role: baseConfig.expectedRole,
      companyFolderId: baseConfig.companyFolderId,
    },
    company: {
      companyFolderId: baseConfig.companyFolderId,
      companyName: "Dovecote Demo",
      live: true,
      registryStatus: "Live",
    },
    masterSheetId: baseConfig.masterSheetId,
    ...overrides,
  };
}

function createHappyTransport(options = {}) {
  const cookies = new Map();
  let loggedOut = false;
  let invalidPasswordAttempts = 0;

  const request = async (method, path, body) => {
    if (method === "GET" && path === "/api/health") {
      return {
        status: 200,
        json: {
          ok: true,
          version: "2026.07.01",
          gitSha: "abc123def456",
          shortSha: "abc123d",
          googleOAuthConnected: true,
        },
      };
    }
    if (method === "GET" && path.startsWith("/api/google/auth-health")) {
      if (options.authHealth) {
        return options.authHealth();
      }
      return {
        status: 200,
        json: {
          ok: true,
          sheetsProbe: { ok: true, spreadsheetId: baseConfig.masterSheetId },
        },
      };
    }
    if (method === "POST" && path === "/api/auth/company/login") {
      if (options.probeLogin) {
        const probeResult = options.probeLogin(body);
        if (probeResult) {
          return probeResult;
        }
      }
      if (body?.password === PROBE_INVALID_PASSWORD) {
        invalidPasswordAttempts += 1;
        if (options.invalidPasswordAccepts && invalidPasswordAttempts > 1) {
          return { status: 200, json: { ok: true, user: { email: baseConfig.expectedEmail } } };
        }
        return {
          status: 401,
          json: { ok: false, blocker: "invalid_credentials", code: "INVALID_CREDENTIALS" },
        };
      }
      if (body?.password !== baseConfig.password) {
        return {
          status: 401,
          json: { ok: false, blocker: "invalid_credentials", code: "INVALID_CREDENTIALS" },
        };
      }
      loggedOut = false;
      if (options.issueCookie !== false) {
        cookies.set(COMPANY_SESSION_COOKIE, "signed-session-token");
      }
      return { status: 200, json: successLoginJson(options.loginJson) };
    }
    if (method === "GET" && path === "/api/auth/company/session") {
      if (options.sessionResponse) {
        return options.sessionResponse({ cookies, loggedOut });
      }
      if (options.sessionValidAfterLogout && loggedOut) {
        return {
          status: 200,
          json: {
            ok: true,
            user: { email: baseConfig.expectedEmail, role: baseConfig.expectedRole },
            company: { companyFolderId: baseConfig.companyFolderId },
          },
        };
      }
      if (!cookies.has(COMPANY_SESSION_COOKIE) || (loggedOut && options.postLogoutRejects !== false)) {
        return { status: 401, json: { ok: false, error: "No company session." } };
      }
      if (options.sessionOk === false) {
        return { status: 401, json: { ok: false, error: "Session rejected." } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          user: { email: baseConfig.expectedEmail, role: baseConfig.expectedRole },
          company: { companyFolderId: baseConfig.companyFolderId, companyName: "Dovecote Demo" },
        },
      };
    }
    if (method === "POST" && path === "/api/auth/company/logout") {
      if (options.logoutResponse) {
        return options.logoutResponse();
      }
      if (options.logoutClears !== false) {
        cookies.delete(COMPANY_SESSION_COOKIE);
        loggedOut = true;
      }
      return { status: 200, json: { ok: true } };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return {
    request,
    getCookies: () => Object.fromEntries(cookies.entries()),
    clearCookies: () => {
      cookies.clear();
      loggedOut = false;
    },
  };
}

test("all checks pass", async () => {
  const result = await runProductionAuthHealthChecks(baseConfig, createHappyTransport());
  assert.equal(result.ok, true);
  assert.equal(result.checks.productionLogin.status, "PASS");
  assert.equal(result.apiSha, "abc123def456");
});

test("health endpoint unavailable", async () => {
  const transport = {
    request: async (method, path) => {
      if (method === "GET" && path === "/api/health") {
        return { status: 503, json: { ok: false } };
      }
      throw new Error("should not continue");
    },
  };
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "apiHealth");
});

test("Google invalid_grant on workbook probe", async () => {
  const transport = createHappyTransport({
    authHealth: () => ({
      status: 503,
      json: { ok: false, sheetsProbe: { ok: false, reason: "invalid_grant" } },
    }),
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "googleWorkbookAccess");
});

test("company not LIVE", async () => {
  const transport = createHappyTransport({
    probeLogin: (body) => {
      if (body.password === PROBE_INVALID_PASSWORD) {
        return {
          status: 409,
          json: { ok: false, blocker: "company_not_live", companyContextValid: false },
        };
      }
      return null;
    },
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "companyRegistry");
});

test("Users tab unavailable", async () => {
  const transport = createHappyTransport({
    probeLogin: (body) => {
      if (body.password === PROBE_INVALID_PASSWORD) {
        return {
          status: 503,
          json: { ok: false, blocker: "google_not_connected" },
        };
      }
      return null;
    },
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "usersTab");
});

test("username not found", async () => {
  const transport = createHappyTransport({
    probeLogin: (body) => {
      if (body.password === PROBE_INVALID_PASSWORD) {
        return { status: 404, json: { ok: false, blocker: "user_not_found", code: "USER_NOT_FOUND" } };
      }
      return null;
    },
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "usernameResolution");
});

test("duplicate username", async () => {
  const transport = createHappyTransport({
    probeLogin: (body) => {
      if (body.password === PROBE_INVALID_PASSWORD) {
        return {
          status: 409,
          json: { ok: false, blocker: "ambiguous_users_tab_rows" },
        };
      }
      return null;
    },
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "usernameResolution");
});

test("inactive account", async () => {
  const transport = createHappyTransport({
    probeLogin: (body) => {
      if (body.password === PROBE_INVALID_PASSWORD) {
        return { status: 403, json: { ok: false, blocker: "inactive" } };
      }
      return null;
    },
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "usernameResolution");
});

test("blank CompanyFolderId on successful login", async () => {
  const transport = createHappyTransport({
    loginJson: {
      user: { email: baseConfig.expectedEmail, role: baseConfig.expectedRole },
      company: { companyFolderId: "", companyName: "Dovecote Demo" },
    },
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "productionLogin");
});

test("wrong password accepted", async () => {
  const transport = createHappyTransport({ invalidPasswordAccepts: true });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "invalidPasswordRejected");
});

test("login succeeds without session cookie", async () => {
  const transport = createHappyTransport({ issueCookie: false });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "productionLogin");
});

test("authenticated session fails", async () => {
  const transport = createHappyTransport({ sessionOk: false });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "sessionPersistence");
});

test("logout fails", async () => {
  const transport = createHappyTransport({
    logoutResponse: () => ({ status: 500, json: { ok: false, error: "logout failed" } }),
  });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "logout");
});

test("session still valid after logout", async () => {
  const transport = createHappyTransport({ sessionValidAfterLogout: true });
  const result = await runProductionAuthHealthChecks(baseConfig, transport);
  assert.equal(result.ok, false);
  assert.equal(result.failedKey, "postLogoutRejection");
});
