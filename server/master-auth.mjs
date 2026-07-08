/**
 * BERT platform Master (internal operator) auth — server-only.
 * Operators live in `master-operators.json` under the session dir with scrypt password hashes.
 * Not bundled into the Vite client; safe for production APK when demo login is off.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSessionCookieOptions } from "./session-cookie-options.mjs";
import { normalizePlatformOwnerEmail } from "../shared/platform-owner.mjs";
import { buildMasterSessionApiResponse, buildMasterSessionPayload, performMasterLogin } from "./auth-service.mjs";

const STORE_FILENAME = "master-operators.json";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER_SESSION_COOKIE = "bert_master_session";
const MASTER_SESSION_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.MASTER_SESSION_TTL_MS || String(7 * 24 * 60 * 60 * 1000)),
);

function storePath(sessionDir) {
  return path.join(sessionDir, STORE_FILENAME);
}

export function masterOperatorsFilePath(sessionDir) {
  return storePath(sessionDir);
}

export function readMasterStore(sessionDir) {
  const p = storePath(sessionDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return { version: 1, operators: [] };
    }
    if (!Array.isArray(data.operators)) {
      return { version: 1, operators: [] };
    }
    return { version: 1, operators: data.operators };
  } catch {
    return { version: 1, operators: [] };
  }
}

export function writeMasterStore(sessionDir, store) {
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  fs.writeFileSync(storePath(sessionDir), JSON.stringify(store, null, 2), "utf8");
}

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(plain), salt, 64, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(plain, stored) {
  const s = String(stored || "");
  if (!s.startsWith("scrypt$")) {
    return false;
  }
  const parts = s.split("$");
  if (parts.length !== 3) {
    return false;
  }
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  try {
    const key = crypto.scryptSync(String(plain), salt, expected.length, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

function normalizeEmail(email) {
  return normalizePlatformOwnerEmail(email);
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * @param {string} sessionDir
 * @param {string} identity Email or display username (name field)
 * @returns {{ operator: object; matchedBy: "email" | "username" } | null}
 */
export function findOperatorByIdentity(sessionDir, identity) {
  const raw = String(identity || "").trim();
  if (!raw) {
    return null;
  }
  const store = readMasterStore(sessionDir);
  const emailKey = normalizeEmail(raw);
  if (emailKey.includes("@")) {
    const byEmail = store.operators.find((o) => normalizeEmail(o.email) === emailKey);
    if (byEmail) {
      return { operator: byEmail, matchedBy: "email" };
    }
  }
  const nameKey = normalizeName(raw);
  const byName = store.operators.find((o) => normalizeName(o.name) === nameKey);
  if (byName) {
    return { operator: byName, matchedBy: "username" };
  }
  if (!raw.includes("@")) {
    const byEmailLocal = store.operators.find((o) => {
      const opEmail = normalizeEmail(o.email);
      const local = opEmail.split("@")[0];
      return local === nameKey;
    });
    if (byEmailLocal) {
      return { operator: byEmailLocal, matchedBy: "email" };
    }
  }
  return null;
}

/**
 * Upsert operator (used by seed script / tools). Password is hashed; never stored plain.
 * @param {{ sessionDir: string; email: string; name: string; password: string }} input
 */
export function upsertMasterOperator(input) {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) {
    throw new Error("Master operator email must look like an email address.");
  }
  const name = String(input.name || "").trim() || email;
  const store = readMasterStore(input.sessionDir);
  const next = store.operators.filter((o) => normalizeEmail(o.email) !== email);
  next.push({
    email,
    name,
    passwordHash: hashPassword(input.password),
    createdAt: Date.now(),
  });
  writeMasterStore(input.sessionDir, { version: 1, operators: next });
  return { email, name };
}

function validatePassword(password) {
  const p = String(password || "");
  if (!p) {
    return "Password is required.";
  }
  if (p.length < 12) {
    return "Password must be at least 12 characters.";
  }
  return null;
}

function isSeedBodyEmpty(body) {
  if (!body || typeof body !== "object") {
    return true;
  }
  const keys = Object.keys(body).filter((k) => body[k] !== undefined && body[k] !== null && body[k] !== "");
  return keys.length === 0;
}

/**
 * HTTP seed/reset for Master operator (POST /api/tools/seed-master).
 * @param {{ sessionDir: string; body?: Record<string, unknown>; env?: NodeJS.ProcessEnv }} input
 */
export function handleSeedMasterRequest(input) {
  const { sessionDir, body = {}, env = process.env } = input;
  const store = readMasterStore(sessionDir);
  const masterConfigured = store.operators.length > 0;

  const legacyConfirm = body.confirm === true;
  const reset = body.reset === true;
  const useEnvDefaults = isSeedBodyEmpty(body);

  let email = "";
  let username = "";
  let password = "";

  if (useEnvDefaults) {
    email = normalizeEmail(env.BERT_INITIAL_MASTER_EMAIL);
    username = String(env.BERT_INITIAL_MASTER_USERNAME || "").trim();
    password = String(env.BERT_INITIAL_MASTER_PASSWORD || "");
    if (!email || !password) {
      return {
        status: 400,
        body: {
          ok: false,
          error:
            "Set BERT_INITIAL_MASTER_EMAIL and BERT_INITIAL_MASTER_PASSWORD on the API host, or POST explicit credentials with reset:true.",
        },
      };
    }
    if (masterConfigured) {
      const existing = store.operators[0];
      return {
        status: 200,
        body: {
          ok: true,
          masterConfigured: true,
          email: existing.email,
          username: existing.name,
          reset: false,
        },
      };
    }
  } else if (legacyConfirm) {
    email = normalizeEmail(body.email);
    username = String(body.name || body.username || "").trim();
    password = String(body.password || "");
    if (!email.includes("@")) {
      return { status: 400, body: { ok: false, error: "A valid email is required." } };
    }
    if (!username) {
      return { status: 400, body: { ok: false, error: "Name is required." } };
    }
    const pwErr = validatePassword(password);
    if (pwErr) {
      return { status: 400, body: { ok: false, error: pwErr } };
    }
  } else {
    email = normalizeEmail(body.email);
    username = String(body.username || body.name || "").trim();
    password = String(body.password || "");
    if (!email.includes("@")) {
      return { status: 400, body: { ok: false, error: "A valid email is required." } };
    }
    const pwErr = validatePassword(password);
    if (pwErr) {
      return { status: 400, body: { ok: false, error: pwErr } };
    }
    if (masterConfigured && !reset) {
      const existing =
        store.operators.find((o) => normalizeEmail(o.email) === email) || store.operators[0];
      return {
        status: 200,
        body: {
          ok: true,
          masterConfigured: true,
          email: existing.email,
          username: existing.name,
          reset: false,
        },
      };
    }
    if (masterConfigured && reset && !password) {
      return { status: 400, body: { ok: false, error: "Password is required when reset is true." } };
    }
    if (!masterConfigured && !password) {
      return { status: 400, body: { ok: false, error: "Password is required." } };
    }
  }

  const pwErr = validatePassword(password);
  if (pwErr) {
    return { status: 400, body: { ok: false, error: pwErr } };
  }

  const displayName = username || email;
  const result = upsertMasterOperator({ sessionDir, email, name: displayName, password });
  return {
    status: 200,
    body: {
      ok: true,
      masterConfigured: true,
      email: result.email,
      username: result.name,
      reset: legacyConfirm || reset || !masterConfigured,
    },
  };
}

/**
 * @param {import('express').Express} app
 * @param {{ sessionDir: string }} opts
 */
export function installMasterAuthRoutes(app, opts) {
  const { sessionDir, rejectInvalidCompanyFolder } = opts;

  app.post("/api/auth/master/login", (req, res) => {
    const loginStarted = Date.now();
    const result = performMasterLogin(
      {
        sessionDir,
        findOperatorByIdentity,
        verifyPassword,
        upsertMasterOperator,
      },
      {
        email: req.body?.email,
        username: req.body?.username,
        password: req.body?.password,
      },
    );

    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({
        ok: false,
        error: result.error,
        code: result.code,
        reasonCode: result.reasonCode || (result.httpStatus === 401 ? "master_invalid_credentials" : "master_login_failed"),
        timingMs: result.timing,
      });
    }

    res.cookie(MASTER_SESSION_COOKIE, result.sessionPayload, getSessionCookieOptions({ maxAge: MASTER_SESSION_MS }));

    const responseStarted = Date.now();
    res.on("finish", () => {
      const responseSentMs = Date.now() - responseStarted;
      console.log(`[login] response_sent durationMs=${responseSentMs}`);
      if (result.timing) {
        result.timing.response_sent = responseSentMs;
        result.timing.total = Date.now() - loginStarted;
        console.log(`[login] total durationMs=${result.timing.total}`);
      }
    });

    return res.json({
      ...buildMasterSessionApiResponse({ email: result.email, name: result.name }),
      timingMs: result.timing,
    });
  });

  app.post("/api/auth/master/logout", (req, res) => {
    console.log("[auth] master logout");
    res.clearCookie(MASTER_SESSION_COOKIE, getSessionCookieOptions());
    return res.json({ ok: true });
  });

  app.post("/api/auth/master/company-context", async (req, res) => {
    const raw = req.signedCookies?.[MASTER_SESSION_COOKIE];
    if (!raw || typeof raw !== "string") {
      return res.status(401).json({ ok: false, error: "No Master session." });
    }
    try {
      const data = JSON.parse(raw);
      if (!data?.email || data.v !== 1) {
        return res.status(401).json({ ok: false, error: "Invalid session." });
      }
      const found = findOperatorByIdentity(sessionDir, data.email);
      const op = found?.operator;
      if (!op) {
        res.clearCookie(MASTER_SESSION_COOKIE, getSessionCookieOptions());
        return res.status(401).json({ ok: false, error: "Operator removed." });
      }

      const companyFolderId = String(req.body?.companyFolderId || req.body?.companyId || "").trim();
      const companyName = String(req.body?.companyName || req.body?.selectedCompanyName || "").trim();
      const masterSheetId = String(req.body?.masterSheetId || "").trim();
      const selectedCompanyName = companyName;

      // Folder-first Godmode picks carry masterSheetId — placement is advisory, not a session blocker.
      if (companyFolderId && !masterSheetId && typeof rejectInvalidCompanyFolder === "function") {
        const denial = await rejectInvalidCompanyFolder(companyFolderId, {
          companyFolderName: companyName,
        });
        if (denial) {
          return res.status(403).json(denial);
        }
      }

      const nextPayload = buildMasterSessionPayload({
        email: op.email,
        name: op.name,
        companyId: companyFolderId,
        companyFolderId,
        companyName,
        masterSheetId,
        selectedCompanyName,
      });
      res.cookie(MASTER_SESSION_COOKIE, nextPayload, getSessionCookieOptions({ maxAge: MASTER_SESSION_MS }));
      return res.json(
        buildMasterSessionApiResponse({
          email: op.email,
          name: op.name,
          companyId: companyFolderId,
          companyFolderId,
          companyName,
          masterSheetId,
          selectedCompanyName,
        }),
      );
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid session." });
    }
  });

  app.get("/api/auth/master/session", (req, res) => {
    const raw = req.signedCookies?.[MASTER_SESSION_COOKIE];
    if (!raw || typeof raw !== "string") {
      return res.status(401).json({ ok: false, error: "No Master session." });
    }
    try {
      const data = JSON.parse(raw);
      if (!data?.email || data.v !== 1) {
        return res.status(401).json({ ok: false, error: "Invalid session." });
      }
      const found = findOperatorByIdentity(sessionDir, data.email);
      const op = found?.operator;
      if (!op) {
        res.clearCookie(MASTER_SESSION_COOKIE, getSessionCookieOptions());
        return res.status(401).json({ ok: false, error: "Operator removed." });
      }
      return res.json(
        buildMasterSessionApiResponse({
          email: op.email,
          name: op.name,
          companyId: data.companyId,
          companyFolderId: data.companyFolderId,
          companyName: data.companyName,
          masterSheetId: data.masterSheetId,
          selectedCompanyName: data.selectedCompanyName || data.companyName,
        }),
      );
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid session." });
    }
  });
}

export { MASTER_SESSION_COOKIE, MASTER_SESSION_MS };
