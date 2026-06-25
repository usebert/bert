/**
 * TODO(remove): Temporary safe Users-tab diagnostic helpers for Dovecote login investigation.
 * Never expose PasswordHash, passwords, tokens, or other secrets.
 */
import { rowsToRecords } from "./workbook-service.mjs";
import { resolveUsersTab } from "./users-tab-reader.mjs";
import { collectUsersTabLoginDiagnostics } from "./company-users.mjs";
import {
  normalizeUsersTabRowObject,
  pickUsersTabLoginEmail,
  rowEmailCandidates,
  USERS_TAB_LOGIN_EMAIL_ALIASES,
  normalizeLoginEmailValue,
} from "./users-tab-schema.mjs";

export const DOVECOTE_USERS_TAB_TARGET_EMAILS = ["7oakcottages@gmail.com", "dovecotestudio@icloud.com"];

export const SAFE_USERS_TAB_ROW_HEADERS = [
  "Name",
  "Email",
  "UserEmail",
  "Username",
  "User",
  "Login",
  "Role",
  "Status",
  "Full Name",
  "full name",
];

const SECRET_HEADER_PATTERN = /password|token|secret|hash/i;

export function isUsersTabDiagnosticsEnabled() {
  return String(process.env.ENABLE_USERS_TAB_DIAGNOSTICS || "").trim().toLowerCase() === "true";
}

export function usersTabDiagnosticsSecretConfigured() {
  return Boolean(String(process.env.BERT_DIAGNOSTICS_SECRET || "").trim());
}

export function isSecretUsersTabHeader(header) {
  return SECRET_HEADER_PATTERN.test(String(header || ""));
}

export function pickSafeUsersTabRowFields(record, headers) {
  const source = record && typeof record === "object" ? record : {};
  const available = new Set((headers || []).map((h) => String(h || "").trim()).filter(Boolean));
  const out = {};
  for (const key of SAFE_USERS_TAB_ROW_HEADERS) {
    if (!available.has(key) && source[key] === undefined) {
      continue;
    }
    if (isSecretUsersTabHeader(key)) {
      continue;
    }
    const value = source[key];
    if (value !== undefined && String(value).trim() !== "") {
      out[key] = String(value).trim();
    }
  }
  return out;
}

export function scanUsersTabRowsForEmails(headers, dataRows, targets) {
  const normalizedTargets = (targets || []).map((email) => normalizeLoginEmailValue(email));
  const byEmail = new Map((targets || []).map((email) => [email, []]));
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const row = dataRows[rowIndex];
    for (let col = 0; col < headers.length; col += 1) {
      const header = String(headers[col] || "").trim();
      if (!header || isSecretUsersTabHeader(header)) {
        continue;
      }
      const cell = normalizeLoginEmailValue(row[col]);
      if (!cell) {
        continue;
      }
      for (let i = 0; i < normalizedTargets.length; i += 1) {
        if (cell === normalizedTargets[i] || cell.replace(/\s+/g, "") === normalizedTargets[i]) {
          const email = targets[i];
          byEmail.get(email)?.push({
            row: rowIndex + 1,
            column: header,
            value: String(row[col] || "").trim(),
          });
        }
      }
    }
  }
  return (targets || []).map((email) => ({
    email,
    found: (byEmail.get(email) || []).length > 0,
    hits: byEmail.get(email) || [],
  }));
}

export function recommendUsersTabLoginField(record, headers) {
  const normalized = normalizeUsersTabRowObject(record);
  const loginEmail = pickUsersTabLoginEmail(normalized);
  const candidates = rowEmailCandidates(normalized);
  const aliasPresent = USERS_TAB_LOGIN_EMAIL_ALIASES.filter((alias) =>
    (headers || []).some((h) => String(h).trim() === alias),
  );
  return {
    loginField: loginEmail ? "Email (via pickUsersTabLoginEmail)" : "none resolved",
    loginValue: loginEmail || "",
    rowEmailCandidates: candidates,
    loginAliasColumnsPresent: aliasPresent,
    canonicalEmailHeaderPresent: (headers || []).includes("Email"),
    useThisValueToLogIn: loginEmail || "",
    note:
      loginEmail && loginEmail !== normalizeLoginEmailValue(loginEmail)
        ? "Sheet login email differs from normalized target"
        : loginEmail
          ? "Use the Email column value shown above"
          : "No valid login email resolved — check shifted/legacy row layout",
  };
}

export function buildUsersTabDiagnosticReportFromRows({
  masterSheetId = "",
  resolved = {},
  rows = [],
  dataSource = "unknown",
  targetEmails = DOVECOTE_USERS_TAB_TARGET_EMAILS,
}) {
  const headers = (rows[0] || []).map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim()));
  const records = rowsToRecords(rows).map((row) => normalizeUsersTabRowObject(row));
  const safeRows = records.map((record, index) => ({
    row: index + 1,
    fields: pickSafeUsersTabRowFields(record, headers),
  }));
  const targetEmailScan = scanUsersTabRowsForEmails(headers, dataRows, targetEmails);
  const loginRecommendations = targetEmails.map((email) => {
    const record =
      records.find((rec) => rowEmailCandidates(rec).includes(email)) ||
      records.find((rec) => normalizeLoginEmailValue(pickUsersTabLoginEmail(rec)) === normalizeLoginEmailValue(email));
    if (!record) {
      return {
        email,
        found: false,
        useThisValueToLogIn: email,
        note: "Expected email not present in tab — login will return user_not_found until row exists with valid Email header",
      };
    }
    const login = recommendUsersTabLoginField(record, headers);
    return {
      email,
      found: true,
      ...login,
    };
  });
  return {
    ok: true,
    masterSheetId: String(masterSheetId || "").trim(),
    tabTitle: String(resolved?.tabTitle || "Users").trim() || "Users",
    matchKind: resolved?.matchKind || null,
    dataSource,
    headerCount: headers.length,
    rowCount: dataRows.length,
    headers,
    rows: safeRows,
    targetEmailScan,
    loginRecommendations,
  };
}

export async function readLiveUsersTabDiagnosticReport(auth, masterSheetId, deps, options = {}) {
  const sheetId = String(masterSheetId || "").trim();
  if (!auth || !sheetId) {
    return { ok: false, error: "missing_context" };
  }
  const resolved = await resolveUsersTab(auth, sheetId, deps, { createIfMissing: false });
  const rows = await deps.getTabValues(auth, sheetId, resolved.tabTitle);
  const report = buildUsersTabDiagnosticReportFromRows({
    masterSheetId: sheetId,
    resolved,
    rows,
    dataSource: options.dataSource || "live-google-sheets",
    targetEmails: options.targetEmails || DOVECOTE_USERS_TAB_TARGET_EMAILS,
  });
  const serverDiagnostics = [];
  for (const email of options.targetEmails || DOVECOTE_USERS_TAB_TARGET_EMAILS) {
    const diag = await collectUsersTabLoginDiagnostics(auth, sheetId, email, deps).catch(() => null);
    if (diag) {
      serverDiagnostics.push({
        email,
        targetEmailExists: diag.targetEmailExists,
        targetEmailInEmailLikeColumns: diag.targetEmailInEmailLikeColumns,
        usersTabRowCount: diag.usersTabRowCount,
        emailLikeHeaders: diag.emailLikeHeaders,
      });
    }
  }
  return {
    ...report,
    serverLoginDiagnostics: serverDiagnostics,
  };
}

/** Compact scan for server-only login failure logs — no secrets. */
export function summarizeUsersTabEmailScanForLoginLog(rows, email) {
  const headers = (rows[0] || []).map((cell) => String(cell || "").trim());
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim()));
  const scan = scanUsersTabRowsForEmails(headers, dataRows, [email]);
  return {
    rowCount: dataRows.length,
    headers,
    targetEmailScan: scan[0] || { email, found: false, hits: [] },
  };
}

export function assertUsersTabDiagnosticPayloadSafe(payload) {
  const serialized = JSON.stringify(payload || {});
  if (/"passwordHash"\s*:\s*"[^"]+"/i.test(serialized)) {
    return false;
  }
  if (/scrypt\$/.test(serialized)) {
    return false;
  }
  if (/"password"\s*:\s*"[^"]+"/i.test(serialized)) {
    return false;
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  for (const row of rows) {
    const fields = row?.fields && typeof row.fields === "object" ? row.fields : {};
    for (const [key, value] of Object.entries(fields)) {
      if (isSecretUsersTabHeader(key)) {
        return false;
      }
      if (/scrypt\$|password/i.test(String(value || ""))) {
        return false;
      }
    }
  }
  return true;
}
