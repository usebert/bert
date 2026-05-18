/**
 * Safe setup status for platform operators (booleans only — no secrets).
 */
import { readMasterStore } from "./master-auth.mjs";

const MASTER_SESSION_COOKIE = "bert_master_session";

function parseJsonCookie(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readMasterSession(req) {
  const master = parseJsonCookie(req.signedCookies?.[MASTER_SESSION_COOKIE]);
  if (master?.v === 1 && master.email) {
    return { email: String(master.email).toLowerCase(), role: "Master" };
  }
  return null;
}

function requireMasterSession(req, res, next) {
  if (!readMasterSession(req)) {
    return res.status(401).json({ ok: false, error: "Master sign-in required." });
  }
  return next();
}

/**
 * @param {import("express").Express} app
 * @param {{
 *   sessionDir: string;
 *   getReadinessPayload: () => object;
 *   getHealthPayload: () => object;
 *   emailConfigured: () => boolean;
 *   hasGoogleSession: () => boolean;
 *   googleEnvConfigured: () => boolean;
 * }} deps
 */
export function installSetupStatusRoutes(app, deps) {
  const { sessionDir, getReadinessPayload, getHealthPayload, emailConfigured, hasGoogleSession, googleEnvConfigured } =
    deps;

  app.get("/api/setup/status", requireMasterSession, (_req, res) => {
    const readiness = getReadinessPayload();
    const health = getHealthPayload();
    const store = readMasterStore(sessionDir);
    const masterConfigured = store.operators.length > 0;
    const googleConfigured = Boolean(readiness.googleConfigured);
    const googleConnected = hasGoogleSession();
    const sharedDriveConfigured = Boolean(health.sharedDriveConfigured);
    const sessionStoreWritable = Boolean(readiness.checks?.sessionStoreWritable);
    const smtpConfigured = emailConfigured();

    const readyForPilot =
      masterConfigured &&
      googleConfigured &&
      googleConnected &&
      sharedDriveConfigured &&
      sessionStoreWritable &&
      smtpConfigured;

    return res.json({
      ok: true,
      masterConfigured,
      googleConfigured,
      googleConnected,
      sharedDriveConfigured,
      sessionStoreWritable,
      smtpConfigured,
      readyForPilot,
      googleEnvConfigured: googleEnvConfigured(),
    });
  });
}
