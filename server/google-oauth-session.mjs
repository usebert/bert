/**
 * Persistent Google OAuth tokens for the API server's workspace identity.
 * Stored under BERT_SESSIONS_DIR (Render persistent disk in production).
 */
import fs from "node:fs";
import path from "node:path";

const TOKEN_BASENAME = "google-oauth-token.json";
const LEGACY_TOKEN_BASENAME = "google-session.json";

/**
 * @param {{ rootDir: string; sessionsDirEnv?: string }} options
 */
export function createGoogleOAuthSessionStore(options) {
  const rootDir = options.rootDir;
  const sessionsDirEnv = String(options.sessionsDirEnv || "").trim();
  const sessionsDirConfigured = Boolean(sessionsDirEnv);
  const sessionDir = sessionsDirConfigured
    ? path.isAbsolute(sessionsDirEnv)
      ? path.normalize(sessionsDirEnv)
      : path.resolve(rootDir, sessionsDirEnv)
    : path.join(rootDir, ".sessions");

  const tokenPath = path.join(sessionDir, TOKEN_BASENAME);
  const legacyTokenPath = path.join(sessionDir, LEGACY_TOKEN_BASENAME);
  const cwdLegacyTokenPath = path.join(rootDir, ".sessions", LEGACY_TOKEN_BASENAME);

  function ensureSessionDir() {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
  }

  function tokenFileExists() {
    return fs.existsSync(tokenPath);
  }

  /**
   * Safe diagnostic log — never logs token contents.
   * @param {string} context
   */
  function logStorageState(context) {
    const session = readSession({ migrate: false });
    console.log(`[google-oauth] ${context}`, {
      sessionsDir: sessionDir,
      sessionsDirConfigured,
      tokenPath,
      tokenFileExists: fs.existsSync(tokenPath),
      legacyTokenFileExists: fs.existsSync(legacyTokenPath),
      cwdLegacyTokenFileExists: fs.existsSync(cwdLegacyTokenPath),
      tokenLoaded: Boolean(session?.tokens),
    });
  }

  /**
   * @param {{ migrate?: boolean }} [opts]
   */
  function readSession(opts = {}) {
    const migrate = opts.migrate !== false;
    ensureSessionDir();

    const candidates = [
      { filePath: tokenPath, label: "canonical" },
      { filePath: legacyTokenPath, label: "legacy" },
      { filePath: cwdLegacyTokenPath, label: "cwd-legacy" },
    ];

    for (const { filePath, label } of candidates) {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const payload = JSON.parse(raw);
        if (!payload?.tokens) {
          continue;
        }
        if (migrate && filePath !== tokenPath) {
          writeSession(payload);
          console.log(`[google-oauth] migrated token from ${label} store to canonical path`);
        }
        return payload;
      } catch (error) {
        console.warn("[google-oauth] unable to read token file", {
          label,
          message: error instanceof Error ? error.message : "read failed",
        });
      }
    }

    return null;
  }

  /**
   * @param {Record<string, unknown>} payload
   */
  function writeSession(payload) {
    ensureSessionDir();
    const body = {
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    const tmpPath = `${tokenPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(body, null, 2), "utf8");
    fs.renameSync(tmpPath, tokenPath);

    if (fs.existsSync(legacyTokenPath) && legacyTokenPath !== tokenPath) {
      try {
        fs.unlinkSync(legacyTokenPath);
      } catch {
        /* ignore */
      }
    }
  }

  function clearSession() {
    for (const filePath of [tokenPath, legacyTokenPath]) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  function hasTokens() {
    return Boolean(readSession({ migrate: false })?.tokens);
  }

  return {
    sessionDir,
    tokenPath,
    sessionsDirConfigured,
    ensureSessionDir,
    readSession,
    writeSession,
    clearSession,
    hasTokens,
    logStorageState,
  };
}
