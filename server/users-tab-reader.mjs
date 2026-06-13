/**
 * Company workbook Users tab resolution and reads — legacy tab names, header repair, error surfacing.
 */
import { classifyGoogleSheetsAccessError } from "./ensure-required-tabs.mjs";
import { USERS_TAB, USERS_TAB_COLUMNS, USERS_TAB_MINIMUM_HEADERS } from "./users-tab-constants.mjs";
import {
  isShiftedLegacyUsersRow,
  isValidCompanyUserEmail,
  normalizeRoleForSheetRepair,
  normalizeUserStatus,
  normalizeUsersTabRowObject,
  remapShiftedLegacyUsersRow,
  sanitizeUsersTabRecords,
} from "./users-tab-schema.mjs";

export const USERS_TAB_CANONICAL = "Users";

/** Legacy workbook tab titles that hold company user rows. */
export const USERS_TAB_LEGACY_NAMES = ["CompanyUsers", "User", "Login", "Company Login"];

export { USERS_TAB, USERS_TAB_MINIMUM_HEADERS } from "./users-tab-constants.mjs";

const USERS_TAB_ENSURE_HEADERS = [...new Set([...USERS_TAB_MINIMUM_HEADERS, ...USERS_TAB_COLUMNS])];

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function rowsToRecords(values) {
  const rows = Array.isArray(values) ? values : [];
  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0].map((value, index) => String(value || `Column ${index + 1}`).trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => {
      const raw = headers.reduce((accumulator, header, index) => {
        accumulator[header] = String(row[index] || "").trim();
        return accumulator;
      }, {});
      return normalizeUsersTabRowObject(raw);
    });
}

function extractGoogleError(error) {
  const apiError = error?.response?.data?.error;
  if (!apiError || typeof apiError !== "object") {
    return undefined;
  }
  return {
    code: apiError.code,
    message: apiError.message,
    status: apiError.status,
    errors: apiError.errors,
  };
}

export function findUsersTabTitle(titles) {
  const list = (Array.isArray(titles) ? titles : []).map((title) => String(title || "").trim()).filter(Boolean);
  const exact = list.find((title) => title === USERS_TAB_CANONICAL);
  if (exact) {
    return { tabTitle: exact, matchKind: "exact" };
  }
  const caseInsensitive = list.find((title) => safeLower(title) === "users");
  if (caseInsensitive) {
    return { tabTitle: caseInsensitive, matchKind: "case_insensitive" };
  }
  for (const legacy of USERS_TAB_LEGACY_NAMES) {
    const found = list.find((title) => safeLower(title) === safeLower(legacy));
    if (found) {
      return { tabTitle: found, matchKind: "legacy", legacyName: found };
    }
  }
  return null;
}

export function classifyUsersTabReadError(error) {
  const googleError = extractGoogleError(error);
  const upstreamStatus = Number(error?.response?.status || error?.status || googleError?.code || 0);
  const message = String(error?.message || googleError?.message || error || "").trim();
  const lower = message.toLowerCase();
  const code = String(error?.code || googleError?.status || "").trim();

  if (
    code === "GOOGLE_SHEETS_PERMISSION_DENIED" ||
    code === "GOOGLE_PERMISSION_DENIED" ||
    upstreamStatus === 403 ||
    lower.includes("permission") ||
    lower.includes("forbidden")
  ) {
    const denied = new Error(message || "Google account lacks permission to read the company Users tab.");
    denied.code = "GOOGLE_SHEETS_PERMISSION_DENIED";
    denied.reasonCode = "GOOGLE_SHEETS_PERMISSION_DENIED";
    denied.upstreamStatus = upstreamStatus || 403;
    denied.upstreamMessage = message;
    denied.googleError = googleError;
    return denied;
  }

  if (code === "USERS_TAB_MISSING" || lower.includes("users tab is missing")) {
    const missing = new Error(message || "Users tab is missing from the company workbook.");
    missing.code = "USERS_TAB_MISSING";
    missing.reasonCode = "USERS_TAB_MISSING";
    missing.upstreamStatus = upstreamStatus || undefined;
    missing.upstreamMessage = message;
    missing.googleError = googleError;
    return missing;
  }

  const classified = classifyGoogleSheetsAccessError(error);
  if (classified?.code === "GOOGLE_PERMISSION_DENIED") {
    classified.code = "GOOGLE_SHEETS_PERMISSION_DENIED";
    classified.reasonCode = "GOOGLE_SHEETS_PERMISSION_DENIED";
    classified.googleError = googleError;
    return classified;
  }
  if (classified?.code === "MASTER_SHEET_UNAVAILABLE") {
    classified.reasonCode = "USERS_TAB_READ_FAILED";
    classified.googleError = googleError;
    return classified;
  }

  const failed = error instanceof Error ? new Error(message || error.message) : new Error(message || "Users tab read failed.");
  failed.code = code || "USERS_TAB_READ_FAILED";
  failed.reasonCode = "USERS_TAB_READ_FAILED";
  failed.upstreamStatus = upstreamStatus || undefined;
  failed.upstreamMessage = message;
  failed.googleError = googleError;
  return failed;
}

function logUsersTabReadFailure(context) {
  console.error("[users-tab-reader] read failed", context);
}

/**
 * Resolve the canonical Users tab — find legacy names, create when missing, ensure headers without deleting rows.
 */
export async function resolveUsersTab(auth, spreadsheetId, deps, options = {}) {
  const sheetId = String(spreadsheetId || "").trim();
  if (!sheetId || !auth) {
    const error = new Error("masterSheetId and Google auth are required to resolve the Users tab.");
    error.code = "USERS_TAB_READ_FAILED";
    throw error;
  }

  const { google, withSheetsQuotaRetry, ensureColumns } = deps;
  if (!google?.sheets || typeof ensureColumns !== "function") {
    const error = new Error("Users tab reader dependencies are not configured.");
    error.code = "USERS_TAB_READ_FAILED";
    throw error;
  }

  const createIfMissing = options.createIfMissing !== false;
  const sheets = google.sheets({ version: "v4", auth });

  let workbook;
  try {
    workbook = await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title))",
      }),
    );
  } catch (error) {
    logUsersTabReadFailure({
      spreadsheetId: sheetId,
      step: "get_spreadsheet_metadata",
      code: error?.code,
      message: error?.message,
      googleError: extractGoogleError(error),
    });
    throw classifyUsersTabReadError(error);
  }

  const titles =
    workbook.data.sheets?.map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean) || [];
  let match = findUsersTabTitle(titles);
  let created = false;

  if (!match) {
    if (!createIfMissing) {
      const error = new Error("Users tab is missing from the company workbook.");
      error.code = "USERS_TAB_MISSING";
      throw error;
    }
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: USERS_TAB_CANONICAL } } }],
        },
      }),
    );
    created = true;
    match = { tabTitle: USERS_TAB_CANONICAL, matchKind: "created" };
  }

  const tabTitle = match.tabTitle || USERS_TAB_CANONICAL;
  let addedHeaders = [];
  let headers = USERS_TAB_ENSURE_HEADERS;

  try {
    const columnResult = await ensureColumns(auth, sheetId, tabTitle, USERS_TAB_ENSURE_HEADERS);
    addedHeaders = columnResult.addedColumns || [];
    headers = columnResult.headers || USERS_TAB_ENSURE_HEADERS;
  } catch (error) {
    logUsersTabReadFailure({
      spreadsheetId: sheetId,
      tabTitle,
      step: "ensure_headers",
      code: error?.code,
      message: error?.message,
      googleError: extractGoogleError(error),
    });
    throw classifyUsersTabReadError(error);
  }

  return {
    ok: true,
    spreadsheetId: sheetId,
    tabTitle,
    canonicalTab: USERS_TAB_CANONICAL,
    created,
    matchKind: match.matchKind,
    legacySource: match.legacyName,
    addedHeaders,
    headers,
    availableTabs: titles,
  };
}

/**
 * Read all user rows from the resolved Users tab. Never returns PasswordHash values to callers.
 */
export async function readCompanyUsers(auth, spreadsheetId, deps, options = {}) {
  const resolved =
    options.resolved ||
    (await resolveUsersTab(auth, spreadsheetId, deps, {
      createIfMissing: options.createIfMissing !== false,
    }));

  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const tabTitle = resolved.tabTitle || USERS_TAB;

  try {
    const response = await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: resolved.spreadsheetId || spreadsheetId,
        range: `${tabTitle}!A1:ZZ5000`,
      }),
    );
    const rawValues = response.data.values || [];
    const records = sanitizeUsersTabRecords(rowsToRecords(rawValues));
    return {
      ok: true,
      records,
      tabTitle,
      resolved,
      rowCount: records.length,
    };
  } catch (error) {
    logUsersTabReadFailure({
      spreadsheetId: resolved.spreadsheetId || spreadsheetId,
      tabTitle,
      step: "values_get",
      code: error?.code,
      message: error?.message,
      googleError: extractGoogleError(error),
    });
    throw classifyUsersTabReadError(error);
  }
}

/**
 * Godmode/setup repair — create Users tab if needed, ensure headers, preserve rows, run column migration.
 */
export async function repairUsersTab(auth, spreadsheetId, deps, options = {}) {
  const schemaRepair = await repairUsersTabSchema(auth, spreadsheetId, deps, options).catch(() => null);
  const resolved = await resolveUsersTab(auth, spreadsheetId, deps, { createIfMissing: true });
  const enrichedDeps = { ...deps, usersTabTitle: resolved.tabTitle };

  let migration = schemaRepair || null;
  if (!migration && typeof deps.migrateUsersTabColumns === "function") {
    migration = await deps.migrateUsersTabColumns(auth, spreadsheetId, enrichedDeps);
  }

  const readResult = await readCompanyUsers(auth, spreadsheetId, enrichedDeps, {
    resolved,
    createIfMissing: false,
  });

  return {
    ok: true,
    spreadsheetId: resolved.spreadsheetId,
    tabTitle: resolved.tabTitle,
    created: resolved.created,
    matchKind: resolved.matchKind,
    legacySource: resolved.legacySource,
    addedHeaders: resolved.addedHeaders,
    migration,
    schemaRepair,
    rowCount: readResult.rowCount,
    users: readResult.records,
  };
}

/**
 * Repair shifted Users tab rows — remap legacy positional data onto canonical headers.
 */
export async function repairUsersTabSchema(auth, spreadsheetId, deps, options = {}) {
  const resolved = await resolveUsersTab(auth, spreadsheetId, deps, { createIfMissing: true });
  const { google, withSheetsQuotaRetry, ensureColumns, getTabValues } = deps;
  const tabTitle = resolved.tabTitle || USERS_TAB_CANONICAL;
  const ensureHeaders = [...new Set([...USERS_TAB_MINIMUM_HEADERS, ...USERS_TAB_COLUMNS])];
  await ensureColumns(auth, spreadsheetId, tabTitle, ensureHeaders);

  const rows = await getTabValues(auth, spreadsheetId, tabTitle);
  if (!rows.length) {
    return {
      ok: true,
      rowsScanned: 0,
      rowsRepaired: 0,
      usersRecovered: 0,
      passwordHashesPreserved: 0,
      addedHeaders: resolved.addedHeaders || [],
    };
  }

  const existingHeaders = rows[0].map((cell) => String(cell || "").trim());
  const canonicalHeaders = [...new Set([...existingHeaders, ...ensureHeaders])];
  let rowsScanned = 0;
  let rowsRepaired = 0;
  let usersRecovered = 0;
  let passwordHashesPreserved = 0;
  const nextRows = [canonicalHeaders];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.some((cell) => String(cell || "").trim())) {
      continue;
    }
    rowsScanned += 1;
    const rawObj = existingHeaders.reduce((accumulator, header, index) => {
      accumulator[header] = String(row[index] || "").trim();
      return accumulator;
    }, {});
    const shifted = isShiftedLegacyUsersRow(rawObj);
    const remapped = shifted ? remapShiftedLegacyUsersRow(rawObj) : { ...rawObj };
    const email = String(remapped.Email || "").trim().toLowerCase();
    const passwordHash = String(remapped.PasswordHash || "").trim();
    const createdAt = String(remapped.CreatedAt || rawObj.CreatedAt || "").trim();
    const role = normalizeRoleForSheetRepair(remapped.Role || rawObj.Role || "");
    const repaired = {
      ...remapped,
      Email: email,
      Name: String(remapped.Name || email).trim() || email,
      Role: role,
      AccessLevel: String(remapped.AccessLevel || "").trim(),
      Status: normalizeUserStatus(remapped.Status || "ACTIVE"),
      CompanyAreas: String(remapped.CompanyAreas || "").trim(),
      PasswordHash: passwordHash,
      CreatedAt: createdAt && normalizeUserStatus(createdAt) !== "ACTIVE" ? createdAt : createdAt,
      UpdatedAt: String(remapped.UpdatedAt || new Date().toISOString()).trim(),
    };
    if (shifted) {
      rowsRepaired += 1;
    }
    if (email && isValidCompanyUserEmail(email)) {
      usersRecovered += 1;
    }
    if (passwordHash) {
      passwordHashesPreserved += 1;
    }
    nextRows.push(canonicalHeaders.map((header) => String(repaired[header] ?? remapped[header] ?? rawObj[header] ?? "").trim()));
  }

  if (rowsRepaired > 0 || canonicalHeaders.length !== existingHeaders.length) {
    const sheets = google.sheets({ version: "v4", auth });
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${tabTitle}!A:ZZ`,
      }),
    );
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabTitle}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: nextRows },
      }),
    );
  }

  return {
    ok: true,
    rowsScanned,
    rowsRepaired,
    usersRecovered,
    passwordHashesPreserved,
    tabTitle,
    headers: canonicalHeaders,
    addedHeaders: resolved.addedHeaders || [],
  };
}
