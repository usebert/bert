/**
 * Password reset tokens — server-only file store. Raw tokens never persisted; only SHA-256 hashes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findOperatorByIdentity,
  hashPassword,
  readMasterStore,
  writeMasterStore,
} from "./master-auth.mjs";

const STORE_FILENAME = "password-reset-tokens.json";
const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_SUCCESS_MESSAGE =
  "If this account exists, password reset instructions will be sent.";
const SMTP_UNAVAILABLE_COMPANY_MESSAGE =
  "Password reset email is not available yet. Please contact your platform administrator.";
const SMTP_UNAVAILABLE_MASTER_MESSAGE =
  "Platform owner password reset must be completed by the platform operator.";

function storePath(sessionDir) {
  return path.join(sessionDir, STORE_FILENAME);
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function hashValue(value, pepper = "") {
  return crypto
    .createHash("sha256")
    .update(String(pepper || ""))
    .update(String(value || ""))
    .digest("hex");
}

function hashEmail(email, pepper) {
  return hashValue(normalizeEmail(email), pepper);
}

function hashIp(ip, pepper) {
  return hashValue(String(ip || "unknown"), pepper);
}

function hashToken(rawToken, pepper) {
  return hashValue(String(rawToken || ""), pepper);
}

function readTokenStore(sessionDir) {
  const p = storePath(sessionDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tokens)) {
      return { version: 1, tokens: [] };
    }
    return { version: 1, tokens: parsed.tokens };
  } catch {
    return { version: 1, tokens: [] };
  }
}

function writeTokenStore(sessionDir, store) {
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  fs.writeFileSync(storePath(sessionDir), JSON.stringify(store, null, 2), "utf8");
}

function pruneExpiredTokens(tokens, now = Date.now()) {
  return tokens.filter((t) => {
    if (t.status === "used") {
      return now - Number(t.usedAt || t.createdAt || 0) < 7 * 24 * 60 * 60 * 1000;
    }
    return Number(t.expiresAt || 0) > now - 24 * 60 * 60 * 1000;
  });
}

function createKeyedWindowLimiter({ windowMs, max }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    return b.count > max;
  };
}

function validateCompanyPassword(password) {
  const p = String(password || "");
  if (!p) {
    return "Password is required.";
  }
  if (p.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

function validateMasterPassword(password) {
  const p = String(password || "");
  if (!p) {
    return "Password is required.";
  }
  if (p.length < 12) {
    return "Password must be at least 12 characters.";
  }
  return null;
}

function buildPasswordResetUrl(frontendUrl, tokenId, rawToken) {
  const base = String(frontendUrl || "").replace(/\/$/, "");
  const url = new URL(base || "http://127.0.0.1:5173");
  url.searchParams.set("reset", tokenId);
  url.searchParams.set("code", rawToken);
  return url.toString();
}

async function sendPasswordResetEmail(deps, { toEmail, resetUrl }) {
  const transporter = deps.createSmtpTransport();
  const brand = deps.appBrandName || "BERT";
  const from = deps.getFromAddress();
  const textBody = [
    `You requested a password reset for ${brand}.`,
    "",
    "Open this link to choose a new password (valid for 30 minutes, single use):",
    resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
  const htmlBody = `
    <p>You requested a password reset for <strong>${brand}</strong>.</p>
    <p><a href="${resetUrl}">Choose a new password</a></p>
    <p>This link is valid for 30 minutes and can only be used once.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;
  await transporter.sendMail({
    from,
    to: toEmail,
    subject: `${brand} password reset`,
    text: textBody,
    html: htmlBody,
  });
}

function resolveAccountScope(sessionDir, email, findMasterSheetIdsForCompanyLoginEmail, getConfig, getAuthedClient) {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm.includes("@")) {
    return { scope: "unknown", masterSheetId: "" };
  }
  const masterMatch = findOperatorByIdentity(sessionDir, emailNorm);
  if (masterMatch?.operator) {
    return { scope: "master", masterSheetId: "", email: emailNorm };
  }
  const sheetIds = findMasterSheetIdsForCompanyLoginEmail(emailNorm);
  if (sheetIds.length === 0) {
    return { scope: "unknown", masterSheetId: "" };
  }
  return { scope: "company", masterSheetId: sheetIds[0], email: emailNorm, sheetIds };
}

async function companyUserAuthExists(auth, masterSheetId, email, getConfig) {
  if (!auth || !masterSheetId) {
    return false;
  }
  try {
    const cfg = await getConfig(auth, masterSheetId);
    const key = `UserAuth.${normalizeEmail(email)}`;
    return Boolean(cfg[key] && String(cfg[key]).trim());
  } catch {
    return false;
  }
}

function invalidatePendingForEmail(store, emailHash, exceptTokenId = "") {
  const now = Date.now();
  for (const token of store.tokens) {
    if (token.tokenId === exceptTokenId) {
      continue;
    }
    if (token.emailHash !== emailHash) {
      continue;
    }
    if (token.status === "pending" && Number(token.expiresAt) > now) {
      token.status = "invalidated";
    }
  }
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function installPasswordResetRoutes(app, deps) {
  const {
    sessionDir,
    emailConfigured,
    createSmtpTransport,
    getFromAddress,
    getFrontendUrl,
    appBrandName,
    hashPepper,
    findMasterSheetIdsForCompanyLoginEmail,
    getAuthedClient,
    getConfig,
    updateConfig,
    envConfigured,
    isProdRuntime = () => process.env.NODE_ENV === "production",
  } = deps;

  const ipRateLimit = createKeyedWindowLimiter({
    windowMs: 60 * 60 * 1000,
    max: isProdRuntime() ? 20 : 100,
  });
  const emailRateLimit = createKeyedWindowLimiter({
    windowMs: 60 * 60 * 1000,
    max: isProdRuntime() ? 5 : 30,
  });

  app.post("/api/auth/password-reset/request", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const ipKey = `pwreset:ip:${hashIp(ip, hashPepper)}`;
      const emailKey = email ? `pwreset:email:${hashEmail(email, hashPepper)}` : "";

      if (emailKey && emailRateLimit(emailKey)) {
        return res.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
      }
      if (ipRateLimit(ipKey)) {
        return res.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
      }

      if (!email || !email.includes("@")) {
        return res.status(400).json({ ok: false, error: "A valid email address is required." });
      }

      const smtpReady = emailConfigured();
      const account = resolveAccountScope(
        sessionDir,
        email,
        findMasterSheetIdsForCompanyLoginEmail,
        getConfig,
        getAuthedClient,
      );

      if (!smtpReady) {
        if (account.scope === "master") {
          return res.json({ ok: true, message: SMTP_UNAVAILABLE_MASTER_MESSAGE, smtpConfigured: false });
        }
        return res.json({ ok: true, message: SMTP_UNAVAILABLE_COMPANY_MESSAGE, smtpConfigured: false });
      }

      let shouldSend = false;
      let userScope = "";
      let companyId = "";

      if (account.scope === "master") {
        shouldSend = true;
        userScope = "master";
        companyId = "";
      } else if (account.scope === "company") {
        const auth = getAuthedClient?.();
        let foundSheetId = "";
        const candidates = account.sheetIds || (account.masterSheetId ? [account.masterSheetId] : []);
        if (auth && envConfigured?.()) {
          for (const sheetId of candidates) {
            if (await companyUserAuthExists(auth, sheetId, email, getConfig)) {
              foundSheetId = sheetId;
              break;
            }
          }
        } else if (candidates.length > 0) {
          foundSheetId = candidates[0];
        }
        if (foundSheetId) {
          shouldSend = true;
          userScope = "company";
          companyId = foundSheetId;
        }
      }

      if (shouldSend) {
        const tokenId = crypto.randomBytes(16).toString("hex");
        const rawToken = crypto.randomBytes(32).toString("hex");
        const now = Date.now();
        const store = readTokenStore(sessionDir);
        store.tokens = pruneExpiredTokens(store.tokens, now);
        const emailHash = hashEmail(email, hashPepper);
        invalidatePendingForEmail(store, emailHash, tokenId);
        store.tokens.push({
          tokenId,
          emailHash,
          userScope,
          companyId,
          tokenHash: hashToken(rawToken, hashPepper),
          expiresAt: now + RESET_TTL_MS,
          usedAt: null,
          createdAt: now,
          requestIpHash: hashIp(ip, hashPepper),
          status: "pending",
        });
        writeTokenStore(sessionDir, store);

        const resetUrl = buildPasswordResetUrl(getFrontendUrl(), tokenId, rawToken);
        try {
          await sendPasswordResetEmail(
            { createSmtpTransport, getFromAddress, appBrandName },
            { toEmail: email, resetUrl },
          );
          console.log(`[password-reset] email queued scope=${userScope} token=${tokenId.slice(0, 8)}`);
        } catch (err) {
          console.error("[password-reset] email failed:", err instanceof Error ? err.message : err);
        }
      }

      return res.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE, smtpConfigured: true });
    } catch (error) {
      console.error("[password-reset] request failed:", error);
      return res.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
    }
  });

  app.post("/api/auth/password-reset/confirm", async (req, res) => {
    try {
      const tokenId = String(req.body?.tokenId || req.body?.reset || "").trim();
      const rawToken = String(req.body?.code || req.body?.token || "").trim();
      const password = String(req.body?.password || "");
      const confirmPassword = String(req.body?.confirmPassword || "");

      if (!tokenId || !rawToken) {
        return res.status(400).json({ ok: false, error: "Reset link is invalid or incomplete." });
      }

      const store = readTokenStore(sessionDir);
      const now = Date.now();
      const record = store.tokens.find((t) => t.tokenId === tokenId);
      if (!record || record.status !== "pending") {
        return res.status(400).json({ ok: false, error: "This reset link is invalid or has already been used." });
      }
      if (Number(record.expiresAt) <= now) {
        record.status = "expired";
        writeTokenStore(sessionDir, store);
        return res.status(400).json({ ok: false, error: "This reset link has expired. Request a new one from the sign-in screen." });
      }
      const expectedHash = hashToken(rawToken, hashPepper);
      const hashBuf = Buffer.from(record.tokenHash, "hex");
      const gotBuf = Buffer.from(expectedHash, "hex");
      if (hashBuf.length !== gotBuf.length || !crypto.timingSafeEqual(hashBuf, gotBuf)) {
        return res.status(400).json({ ok: false, error: "This reset link is invalid or has already been used." });
      }

      if (confirmPassword && confirmPassword !== password) {
        return res.status(400).json({ ok: false, error: "Password confirmation does not match." });
      }

      if (record.userScope === "company") {
        if (!envConfigured?.()) {
          return res.status(503).json({ ok: false, error: "Password reset is not available right now. Try again later." });
        }
        const auth = getAuthedClient?.();
        if (!auth) {
          return res.status(401).json({
            ok: false,
            error:
              "Password reset is not available because Google Workspace is not connected on the server. Ask your administrator to reconnect Google, then try again.",
          });
        }
        const pwErr = validateCompanyPassword(password);
        if (pwErr) {
          return res.status(400).json({ ok: false, error: pwErr });
        }
        const masterSheetId = String(record.companyId || "").trim();
        if (!masterSheetId) {
          return res.status(400).json({ ok: false, error: "This reset link is invalid or has already been used." });
        }
        const cfg = await getConfig(auth, masterSheetId);
        const emailKey = Object.keys(cfg).find(
          (k) => k.toLowerCase().startsWith("userauth.") && hashEmail(k.slice("UserAuth.".length), hashPepper) === record.emailHash,
        );
        if (!emailKey) {
          return res.status(400).json({ ok: false, error: "This reset link is invalid or has already been used." });
        }
        await updateConfig(auth, masterSheetId, { ...cfg, [emailKey]: hashPassword(password) });
      } else if (record.userScope === "master") {
        const pwErr = validateMasterPassword(password);
        if (pwErr) {
          return res.status(400).json({ ok: false, error: pwErr });
        }
        const masterStore = readMasterStore(sessionDir);
        const op = masterStore.operators.find((o) => hashEmail(o.email, hashPepper) === record.emailHash);
        if (!op) {
          return res.status(400).json({ ok: false, error: "This reset link is invalid or has already been used." });
        }
        op.passwordHash = hashPassword(password);
        writeMasterStore(sessionDir, masterStore);
      } else {
        return res.status(400).json({ ok: false, error: "This reset link is invalid or has already been used." });
      }

      record.status = "used";
      record.usedAt = now;
      invalidatePendingForEmail(store, record.emailHash);
      writeTokenStore(sessionDir, store);

      console.log(`[password-reset] completed scope=${record.userScope} token=${tokenId.slice(0, 8)}`);
      return res.json({ ok: true, message: "Your password has been updated. You can sign in now." });
    } catch (error) {
      console.error("[password-reset] confirm failed:", error);
      return res.status(500).json({ ok: false, error: "Unable to reset password. Try again or contact your administrator." });
    }
  });
}

export {
  GENERIC_SUCCESS_MESSAGE,
  SMTP_UNAVAILABLE_COMPANY_MESSAGE,
  SMTP_UNAVAILABLE_MASTER_MESSAGE,
  storePath as passwordResetStorePath,
};
