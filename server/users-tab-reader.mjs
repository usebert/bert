/**
 * Company workbook Users tab resolution and reads — legacy tab names, header repair, error surfacing.
 */
import { classifyGoogleSheetsAccessError } from "./ensure-required-tabs.mjs";
import { ensureTabColumns, getTabValues as workbookGetTabValues, readTabRecords, rowsToRecords, writeTabRecords } from "./workbook-service.mjs";
import { readUsersTabValuesWithCache, invalidateUsersTabCache } from "./users-tab-cache.mjs";
import { USERS_TAB, USERS_TAB_COLUMNS, USERS_TAB_MINIMUM_HEADERS } from "./users-tab-constants.mjs";
import {
  isShiftedLegacyUsersRow,
  isValidCompanyUserEmail,
  normalizeRoleForSheetRepair,
  normalizeUserStatus,
  normalizeUsersTabRowObject,
  remapShiftedLegacyUsersRow,
  sanitizeUsersTabRecords,
  backfillRowCompanyFields,
  pickRowCompanyName,
} from "./users-tab-schema.mjs";

export const USERS_TAB_CANONICAL = "Users";

/** Legacy workbook tab titles that hold company user rows. */
export const USERS_TAB_LEGACY_NAMES = ["CompanyUsers", "User", "Login", "Company Login"];

export { USERS_TAB, USERS_TAB_MINIMUM_HEADERS } from "./users-tab-constants.mjs";

const USERS_TAB_ENSURE_HEADERS = [...new Set([...USERS_TAB_MINIMUM_HEADERS, ...USERS_TAB_COLUMNS])];

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function looksLikeStandaloneEmail(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw.includes("@") && raw.length > 3 && !/\s/.test(raw);
}

/** Clear polluted Name/Status cells that embed emails (cross-workbook login collision on older builds). */
function sanitizePollutedUsersTabDisplayFields(repaired = {}, options = {}) {
  const next = { ...repaired };
  const name = String(next.Name || "").trim();
  const status = String(next.Status || "").trim();
  const email = String(next.Email || "").trim().toLowerCase();
  let changed = false;

  if (looksLikeStandaloneEmail(name) && name !== email) {
    next.Name = options.archivedNameLabel || "ARCHIVED_POLLUTED_ROW";
    next.Status = "INACTIVE";
    changed = true;
  } else if (/\(was\s+[^)]+@[^)]+\)/i.test(name)) {
    next.Name = options.archivedNameLabel || "ARCHIVED_POLLUTED_ROW";
    next.Status = "INACTIVE";
    changed = true;
  }

  const statusNorm = normalizeUserStatus(status);
  if (
    status &&
    !["ACTIVE", "INACTIVE", "INVITED", "DELETED", "REMOVED"].includes(statusNorm) &&
    (looksLikeStandaloneEmail(status) || /admin|manager|auditor|hall|thomas/i.test(status))
  ) {
    next.Status = "INACTIVE";
    changed = true;
  }

  return { repaired: next, changed };
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
    missing.reasonCode = "USERS_TAB_READ_FAILED";
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

  const { google, withSheetsQuotaRetry } = deps;
  if (!google?.sheets) {
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
    const columnResult = await ensureTabColumns(auth, deps, sheetId, tabTitle, USERS_TAB_ENSURE_HEADERS);
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
    const schemaError = classifyUsersTabReadError(error);
    schemaError.code = "USERS_TAB_SCHEMA_FAILED";
    schemaError.reasonCode = "USERS_TAB_SCHEMA_FAILED";
    throw schemaError;
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

  const tabTitle = resolved.tabTitle || USERS_TAB;
  const sheetId = resolved.spreadsheetId || spreadsheetId;

  try {
    await ensureTabColumns(auth, deps, sheetId, tabTitle, USERS_TAB_ENSURE_HEADERS);
    const rawValues =
      typeof deps.getTabValues === "function"
        ? await deps.getTabValues(auth, sheetId, tabTitle)
        : await readUsersTabValuesWithCache(auth, sheetId, tabTitle, () =>
            workbookGetTabValues(auth, deps, sheetId, tabTitle),
          );
    const records = sanitizeUsersTabRecords(
      rowsToRecords(rawValues).map((row) => normalizeUsersTabRowObject(row)),
    );
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
  const { google, withSheetsQuotaRetry } = deps;
  const tabTitle = resolved.tabTitle || USERS_TAB_CANONICAL;
  const ensureHeaders = [...new Set([...USERS_TAB_MINIMUM_HEADERS, ...USERS_TAB_COLUMNS])];
  try {
    await ensureTabColumns(auth, deps, spreadsheetId, tabTitle, ensureHeaders);
  } catch (error) {
    const schemaError = classifyUsersTabReadError(error);
    schemaError.code = "USERS_TAB_SCHEMA_FAILED";
    schemaError.reasonCode = "USERS_TAB_SCHEMA_FAILED";
    throw schemaError;
  }

  const readResult = await readTabRecords(auth, deps, spreadsheetId, tabTitle, {
    expectedHeaders: ensureHeaders,
  });
  const rows = [
    ensureHeaders,
    ...(readResult.records || []).map((record) => ensureHeaders.map((header) => String(record[header] ?? "").trim())),
  ];
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
  let pollutedRowsSanitized = 0;
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
    let repaired = {
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
      ...backfillRowCompanyFields(remapped, options.companyContext || {}),
    };
    // Preserve raw Status values that are neither canonical nor normalized ACTIVE blank, then sanitize pollution.
    if (!["ACTIVE", "INACTIVE", "INVITED", "DELETED", "REMOVED"].includes(String(repaired.Status || "").toUpperCase())) {
      repaired.Status = String(remapped.Status || rawObj.Status || repaired.Status || "").trim() || repaired.Status;
    }
    const sanitized = sanitizePollutedUsersTabDisplayFields(repaired, {
      archivedNameLabel: `ARCHIVED_POLLUTED_ROW_${i}`,
    });
    repaired = sanitized.repaired;
    if (shifted || sanitized.changed) {
      rowsRepaired += 1;
    }
    if (sanitized.changed) {
      pollutedRowsSanitized += 1;
    }
    if (email && isValidCompanyUserEmail(email)) {
      usersRecovered += 1;
    }
    if (passwordHash) {
      passwordHashesPreserved += 1;
    }
    nextRows.push(canonicalHeaders.map((header) => String(repaired[header] ?? remapped[header] ?? rawObj[header] ?? "").trim()));
  }

  if (rowsRepaired > 0 || pollutedRowsSanitized > 0 || canonicalHeaders.length !== existingHeaders.length) {
    const dataRows = nextRows.slice(1).map((row) =>
      canonicalHeaders.reduce((accumulator, header, index) => {
        accumulator[header] = String(row[index] ?? "").trim();
        return accumulator;
      }, {}),
    );
    await writeTabRecords(auth, deps, spreadsheetId, tabTitle, canonicalHeaders, dataRows);
    invalidateUsersTabCache(spreadsheetId, { source: "repairUsersTabSchema" });
  }

  let companyMigration = null;
  if (typeof deps.migrateUsersTabCompanyColumns === "function" && options.companyContext) {
    companyMigration = await deps
      .migrateUsersTabCompanyColumns(auth, spreadsheetId, options.companyContext, deps)
      .catch(() => null);
  }

  return {
    ok: true,
    rowsScanned,
    rowsRepaired,
    pollutedRowsSanitized,
    usersRecovered,
    passwordHashesPreserved,
    tabTitle,
    headers: canonicalHeaders,
    addedHeaders: resolved.addedHeaders || [],
    companyMigration,
  };
}
