/**
 * Safe Google OAuth / Sheets diagnostics — never logs secrets, tokens, or hashes.
 */
import { google } from "googleapis";

export const GOOGLE_AUTH_MODE = "oauth2_refresh_token";

/**
 * Classify a Google API / OAuth error without exposing tokens.
 * @param {unknown} error
 */
export function classifyGoogleAuthError(error) {
  const err = error && typeof error === "object" ? error : {};
  const response = err.response || {};
  const data = response.data || {};
  const message = String(err.message || data.error_description || data.error || error || "").trim();
  const code = String(data.error || err.code || response.status || "").trim();
  const status = Number(response.status || err.status || 0) || undefined;
  const lower = message.toLowerCase();
  const codeLower = code.toLowerCase();

  let reason = "unknown_google_error";
  if (codeLower === "invalid_grant" || lower.includes("invalid_grant")) {
    reason = "invalid_grant";
  } else if (codeLower === "unauthorized_client" || lower.includes("unauthorized_client")) {
    reason = "unauthorized_client";
  } else if (status === 401 || codeLower === "401" || lower.includes("invalid_client")) {
    reason = "invalid_client_or_unauthorized";
  } else if (status === 403 || lower.includes("insufficient") || lower.includes("permission")) {
    reason = "permission_denied";
  } else if (status === 404 || lower.includes("not found")) {
    reason = "not_found";
  } else if (status === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    reason = "quota_or_rate_limit";
  } else if (lower.includes("enotfound") || lower.includes("econnreset") || lower.includes("etimedout")) {
    reason = "network_error";
  }

  return {
    reason,
    googleErrorCode: code || undefined,
    httpStatus: status,
    message: message.slice(0, 240) || undefined,
  };
}

function envPresence(value) {
  const raw = value == null ? "" : String(value);
  const trimmed = raw.trim();
  return {
    set: trimmed.length > 0,
    length: trimmed.length,
    hasLeadingOrTrailingWhitespace: raw.length > 0 && raw !== trimmed,
    hasEmbeddedNewline: /[\r\n]/.test(raw),
  };
}

/**
 * Credential-path snapshot for startup / health — no secret values.
 * @param {{
 *   requiredEnv?: Record<string, string>,
 *   oauthStore?: { sessionsDirConfigured?: boolean, sessionDir?: string, tokenPath?: string, hasTokens?: () => boolean, readSession?: Function },
 *   processEnv?: NodeJS.ProcessEnv,
 * }} input
 */
export function buildGoogleCredentialDiagnostics(input = {}) {
  const env = input.requiredEnv || {};
  const processEnv = input.processEnv || process.env;
  const store = input.oauthStore || {};
  const session = typeof store.readSession === "function" ? store.readSession({ migrate: false }) : null;
  const tokens = session?.tokens && typeof session.tokens === "object" ? session.tokens : null;

  // Inspect raw process env for whitespace/newline corruption; requiredEnv may already be trimmed.
  const clientId = envPresence(processEnv.GOOGLE_CLIENT_ID);
  const clientSecret = envPresence(processEnv.GOOGLE_CLIENT_SECRET);
  const redirectUri = envPresence(processEnv.GOOGLE_REDIRECT_URI);
  const sharedDriveId = envPresence(processEnv.GOOGLE_SHARED_DRIVE_ID || env.GOOGLE_SHARED_DRIVE_ID);
  const sessionsDir = envPresence(processEnv.BERT_SESSIONS_DIR);

  const expiryDate = Number(tokens?.expiry_date || 0) || null;
  const refreshExpiresIn = Number(tokens?.refresh_token_expires_in || 0) || null;

  return {
    authMode: GOOGLE_AUTH_MODE,
    serviceAccountConfigured: Boolean(
      String(processEnv.GOOGLE_APPLICATION_CREDENTIALS || "").trim() ||
        String(processEnv.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim(),
    ),
    selectedCredentialPath: "oauth2_file_refresh_token",
    env: {
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: {
        set: clientSecret.set,
        // Never expose secret length in production logs? Length alone is OK and helps detect corruption.
        length: clientSecret.length,
        hasLeadingOrTrailingWhitespace: clientSecret.hasLeadingOrTrailingWhitespace,
        hasEmbeddedNewline: clientSecret.hasEmbeddedNewline,
      },
      GOOGLE_REDIRECT_URI: {
        set: redirectUri.set,
        hasLeadingOrTrailingWhitespace: redirectUri.hasLeadingOrTrailingWhitespace,
        hasEmbeddedNewline: redirectUri.hasEmbeddedNewline,
      },
      GOOGLE_SHARED_DRIVE_ID: {
        set: sharedDriveId.set,
        hasLeadingOrTrailingWhitespace: sharedDriveId.hasLeadingOrTrailingWhitespace,
      },
      BERT_SESSIONS_DIR: {
        set: sessionsDir.set,
        configuredOnStore: Boolean(store.sessionsDirConfigured),
      },
    },
    tokenStore: {
      sessionsDirConfigured: Boolean(store.sessionsDirConfigured),
      tokenFilePresent: Boolean(typeof store.hasTokens === "function" ? store.hasTokens() : tokens),
      hasAccessToken: Boolean(tokens?.access_token),
      hasRefreshToken: Boolean(tokens?.refresh_token),
      tokenType: tokens?.token_type ? String(tokens.token_type) : undefined,
      accessTokenExpired: expiryDate ? Date.now() >= expiryDate : undefined,
      hasRefreshTokenExpiresIn: refreshExpiresIn != null && refreshExpiresIn > 0,
      profileEmailSet: Boolean(String(session?.profile?.email || "").trim()),
    },
    warnings: buildCredentialWarnings({ clientId, clientSecret, redirectUri, sessionsDir, tokens }),
  };
}

function buildCredentialWarnings({ clientId, clientSecret, redirectUri, sessionsDir, tokens }) {
  const warnings = [];
  if (clientSecret.hasLeadingOrTrailingWhitespace || clientSecret.hasEmbeddedNewline) {
    warnings.push(
      "GOOGLE_CLIENT_SECRET has leading/trailing whitespace or an embedded newline — a common Render/env paste issue that causes Google invalid_grant on refresh.",
    );
  }
  if (clientId.hasLeadingOrTrailingWhitespace || clientId.hasEmbeddedNewline) {
    warnings.push("GOOGLE_CLIENT_ID has whitespace/newline corruption.");
  }
  if (redirectUri.hasLeadingOrTrailingWhitespace || redirectUri.hasEmbeddedNewline) {
    warnings.push("GOOGLE_REDIRECT_URI has whitespace/newline corruption.");
  }
  if (!sessionsDir.set) {
    warnings.push(
      "BERT_SESSIONS_DIR is unset — OAuth refresh tokens may live on ephemeral disk and be lost or replaced on redeploy.",
    );
  }
  if (!tokens?.refresh_token) {
    warnings.push("Stored Google session has no refresh_token — Sheets access will fail after access_token expiry until Google is reconnected.");
  }
  return warnings;
}

/**
 * Probe Sheets metadata for a workbook. Forces a live Google round-trip (may refresh tokens).
 * @param {import('google-auth-library').OAuth2Client | null} auth
 * @param {string} spreadsheetId
 * @param {{ google?: typeof google, withSheetsQuotaRetry?: Function }} [deps]
 */
export async function probeGoogleSheetsWorkbookMetadata(auth, spreadsheetId, deps = {}) {
  const sheetId = String(spreadsheetId || "").trim();
  if (!auth) {
    return {
      ok: false,
      reason: "google_oauth_not_connected",
      message: "No Google OAuth client is available (missing stored tokens).",
    };
  }
  if (!sheetId) {
    return {
      ok: false,
      reason: "missing_spreadsheet_id",
      message: "No workbook id provided for the Sheets health probe.",
    };
  }

  const googleApi = deps.google || google;
  const sheets = googleApi.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "spreadsheetId,properties.title",
    });

  try {
    const response = deps.withSheetsQuotaRetry
      ? await deps.withSheetsQuotaRetry(request)
      : await request();
    return {
      ok: true,
      reason: "ok",
      spreadsheetId: String(response?.data?.spreadsheetId || sheetId),
      titlePresent: Boolean(String(response?.data?.properties?.title || "").trim()),
    };
  } catch (error) {
    const classified = classifyGoogleAuthError(error);
    return {
      ok: false,
      spreadsheetId: sheetId,
      ...classified,
    };
  }
}
