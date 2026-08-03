/**
 * workbookService — header-based reads/writes on company workbook tabs.
 * All tab I/O uses column header names, not positional indexes.
 */
import {
  ensureRequiredTabs as ensureRequiredTabsCore,
  findMissingRequiredTabs,
  SETUP_REQUIRED_TABS,
} from "./ensure-required-tabs.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value = "") {
  return trim(value).toLowerCase();
}

function sheetEndColumnLetter(columnCount) {
  const count = Math.max(Number(columnCount) || 1, 1);
  if (count <= 26) {
    return String.fromCharCode(64 + count);
  }
  let remaining = count;
  let letters = "";
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

export function rowsToRecords(values) {
  const rows = values || [];
  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0].map((value, index) => String(value || `Column ${index + 1}`).trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) =>
      headers.reduce((accumulator, header, index) => {
        accumulator[header] = String(row[index] || "").trim();
        return accumulator;
      }, {}),
    );
}

function ensureSheetTab(workbook, tabName, lower = safeLower) {
  return workbook.data.sheets?.some((sheet) => lower(sheet.properties?.title) === lower(tabName));
}

async function getWorkbook(auth, deps, spreadsheetId) {
  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties(title),sheets(properties(sheetId,title))",
    });
  return withSheetsQuotaRetry ? withSheetsQuotaRetry(request) : request();
}

export async function getTabValues(auth, deps, spreadsheetId, tabName, range = "A1:ZZ5000") {
  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const request = () =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!${range}`,
      });
    const response = withSheetsQuotaRetry ? await withSheetsQuotaRetry(request) : await request();
    return response.data.values || [];
  } catch {
    return [];
  }
}

/** Merge AuditResults summary ranges (A:H + L:ZZ), skipping heavy JSON columns I–K. */
export function mergeSummaryValueRanges(valueRanges = []) {
  const primary = valueRanges[0]?.values || valueRanges[0] || [];
  const secondary = valueRanges[1]?.values || valueRanges[1] || [];
  if (!primary.length) {
    return secondary.length ? secondary : [];
  }
  if (!secondary.length) {
    return primary;
  }
  const merged = [];
  const maxLen = Math.max(primary.length, secondary.length);
  for (let i = 0; i < maxLen; i += 1) {
    merged.push([...(primary[i] || []), ...(secondary[i] || [])]);
  }
  return merged;
}

export async function getTabValuesSummary(auth, deps, spreadsheetId, tabName, rowLimit = 5000) {
  const tab = trim(tabName);
  const maxRow = Math.max(Number(rowLimit) || 5000, 1);
  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const ranges = [`${tab}!A1:H${maxRow}`, `${tab}!L1:ZZ${maxRow}`];
  try {
    const request = () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });
    const response = withSheetsQuotaRetry ? await withSheetsQuotaRetry(request) : await request();
    return mergeSummaryValueRanges(response.data.valueRanges || []);
  } catch {
    return [];
  }
}

export async function ensureTabExists(auth, deps, spreadsheetId, tabName, existingWorkbook = null) {
  const { google, withSheetsQuotaRetry } = deps;
  const lower = deps.safeLower || safeLower;
  let workbook = existingWorkbook ?? (await getWorkbook(auth, deps, spreadsheetId));
  if (ensureSheetTab(workbook, tabName, lower)) {
    return { added: false, workbook };
  }

  const sheets = google.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(request);
  } else {
    await request();
  }

  workbook = await getWorkbook(auth, deps, spreadsheetId);
  return { added: true, workbook };
}

function headerRangeForColumnCount(columnCount) {
  const count = Math.max(Number(columnCount) || 1, 1);
  return `A1:${sheetEndColumnLetter(count)}1`;
}

export async function ensureTabColumns(auth, deps, spreadsheetId, tabName, expectedHeaders) {
  await ensureTabExists(auth, deps, spreadsheetId, tabName, null);

  const { google, withSheetsQuotaRetry } = deps;
  const lower = deps.safeLower || safeLower;
  const sheets = google.sheets({ version: "v4", auth });
  const headerRange =
    Array.isArray(expectedHeaders) && expectedHeaders.length > 0
      ? headerRangeForColumnCount(expectedHeaders.length)
      : "A1:ZZ1";
  const headerRows = await getTabValues(auth, deps, spreadsheetId, tabName, headerRange);
  const existingHeaders = headerRows[0] || [];
  const missing = expectedHeaders.filter(
    (header) => !existingHeaders.some((existing) => lower(existing) === lower(header)),
  );

  if (headerRows.length === 0) {
    const request = () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [expectedHeaders] },
      });
    if (withSheetsQuotaRetry) {
      await withSheetsQuotaRetry(request);
    } else {
      await request();
    }
    return { addedColumns: [...expectedHeaders], headers: expectedHeaders };
  }

  if (missing.length === 0) {
    return { addedColumns: [], headers: existingHeaders };
  }

  const currentHeaders = existingHeaders;
  const stillMissing = expectedHeaders.filter(
    (header) => !currentHeaders.some((existing) => lower(existing) === lower(header)),
  );
  if (stillMissing.length === 0) {
    return { addedColumns: [], headers: currentHeaders };
  }

  const nextHeaders = [...currentHeaders, ...stillMissing];
  const lastCol = sheetEndColumnLetter(nextHeaders.length);
  const updateRequest = () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1:${lastCol}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [nextHeaders] },
    });

  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(updateRequest);
  } else {
    await updateRequest();
  }

  return { addedColumns: stillMissing, headers: nextHeaders };
}

/** @deprecated Prefer ensureTabColumns — alias for server.mjs backward compatibility. */
export async function ensureColumns(auth, deps, spreadsheetId, tabName, expectedHeaders) {
  return ensureTabColumns(auth, deps, spreadsheetId, tabName, expectedHeaders);
}

export async function listTabTitles(auth, deps, masterSheetId) {
  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.get({
      spreadsheetId: masterSheetId,
      includeGridData: false,
      fields: "sheets.properties.title",
    });
  const meta = withSheetsQuotaRetry ? await withSheetsQuotaRetry(request) : await request();
  return meta.data.sheets?.map((sheet) => trim(sheet.properties?.title)).filter(Boolean) || [];
}

export async function ensureRequiredTabs(auth, deps, masterSheetId, options = {}) {
  return ensureRequiredTabsCore(auth, deps, masterSheetId, options);
}

export { findMissingRequiredTabs, SETUP_REQUIRED_TABS };

export async function readTabRecords(auth, deps, masterSheetId, tabName, options = {}) {
  const sheetId = trim(masterSheetId);
  const tab = trim(tabName);
  if (!sheetId || !tab) {
    throw new Error("masterSheetId and tabName are required.");
  }

  const expectedHeaders = options.expectedHeaders;
  if (Array.isArray(expectedHeaders) && expectedHeaders.length > 0) {
    await ensureTabColumns(auth, deps, sheetId, tab, expectedHeaders);
  }

  const values = options.summaryOnly
    ? await getTabValuesSummary(auth, deps, sheetId, tab, options.rowLimit)
    : await getTabValues(auth, deps, sheetId, tab, options.range);
  const records = rowsToRecords(values);
  return {
    ok: true,
    records,
    rowCount: records.length,
    tabName: tab,
    masterSheetId: sheetId,
  };
}

export async function writeTabRecords(auth, deps, masterSheetId, tabName, columns, dataRows) {
  const sheetId = trim(masterSheetId);
  const tab = trim(tabName);
  if (!sheetId || !tab) {
    throw new Error("masterSheetId and tabName are required.");
  }

  await ensureTabColumns(auth, deps, sheetId, tab, columns);

  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const rows = [columns, ...dataRows.map((row) => columns.map((header) => String(row[header] ?? "").trim()))];
  const rowCount = Math.max(rows.length, 2);
  const lastCol = sheetEndColumnLetter(columns.length);

  const request = () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A1:${lastCol}${rowCount}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(request);
  } else {
    await request();
  }

  return { ok: true, rowCount: dataRows.length, tabName: tab, masterSheetId: sheetId };
}

export async function patchTabRowByHeader(
  auth,
  deps,
  masterSheetId,
  tabName,
  matchHeader,
  matchValue,
  updates = {},
  options = {},
) {
  const sheetId = trim(masterSheetId);
  const tab = trim(tabName);
  const matchKey = trim(matchHeader);
  const want = trim(matchValue);
  if (!sheetId || !tab || !matchKey || !want) {
    throw new Error("masterSheetId, tabName, matchHeader, and matchValue are required.");
  }

  const compareValues =
    typeof options.compareValues === "function"
      ? options.compareValues
      : (left, right) => trim(left).toLowerCase() === trim(right).toLowerCase();
  const headerAliases = [matchKey, ...(Array.isArray(options.matchHeaderAliases) ? options.matchHeaderAliases : [])]
    .map((entry) => trim(entry))
    .filter(Boolean);
  const normalizeHeader = (value) => trim(value).toLowerCase().replace(/\s+/g, "");
  const headerMatches = (header) =>
    headerAliases.some(
      (alias) =>
        safeLower(header) === safeLower(alias) || normalizeHeader(header) === normalizeHeader(alias),
    );

  const readResult = await readTabRecords(auth, deps, sheetId, tab);
  const lower = deps.safeLower || safeLower;
  const records = readResult.records || [];
  const hasMatch = records.some((record) => {
    const entry = Object.entries(record).find(([key]) => headerMatches(key));
    const cell = trim(entry?.[1] ?? "");
    return compareValues(cell, want);
  });
  if (!hasMatch) {
    throw new Error(`No row found where ${matchKey}=${matchValue}.`);
  }

  const values = await getTabValues(auth, deps, sheetId, tab);
  if (!values.length) {
    throw new Error(`Tab "${tab}" is empty or missing.`);
  }

  const headers = values[0].map((value, index) => String(value || `Column ${index + 1}`).trim());
  let rowIndex = -1;
  const matchColIndex = headers.findIndex((header) => headerMatches(header));
  if (matchColIndex < 0) {
    throw new Error(`Match header "${matchKey}" not found on tab "${tab}".`);
  }
  for (let i = 1; i < values.length; i += 1) {
    const cell = String(values[i][matchColIndex] || "").trim();
    if (compareValues(cell, want)) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) {
    throw new Error(`No row found where ${matchKey}=${matchValue}.`);
  }

  const row = [...values[rowIndex]];
  while (row.length < headers.length) {
    row.push("");
  }

  for (const [key, value] of Object.entries(updates)) {
    const colIndex = headers.findIndex((header) => lower(header) === lower(key));
    if (colIndex >= 0) {
      row[colIndex] = String(value ?? "").trim();
    }
  }

  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const sheetRow = rowIndex + 1;
  const lastCol = sheetEndColumnLetter(headers.length);
  const request = () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A${sheetRow}:${lastCol}${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(request);
  } else {
    await request();
  }

  return { ok: true, rowIndex: sheetRow, tabName: tab, masterSheetId: sheetId };
}

/** Patch multiple rows after a single tab read — one values.batchUpdate call. */
export async function batchPatchTabRowsByHeader(
  auth,
  deps,
  masterSheetId,
  tabName,
  matchHeader,
  rowPatches = [],
  options = {},
) {
  const sheetId = trim(masterSheetId);
  const tab = trim(tabName);
  const matchKey = trim(matchHeader);
  const patches = Array.isArray(rowPatches) ? rowPatches.filter((entry) => trim(entry?.matchValue)) : [];
  if (!sheetId || !tab || !matchKey || patches.length === 0) {
    return { ok: true, patched: 0, tabName: tab, masterSheetId: sheetId };
  }

  const compareValues =
    typeof options.compareValues === "function"
      ? options.compareValues
      : (left, right) => trim(left).toLowerCase() === trim(right).toLowerCase();
  const headerAliases = [matchKey, ...(Array.isArray(options.matchHeaderAliases) ? options.matchHeaderAliases : [])]
    .map((entry) => trim(entry))
    .filter(Boolean);
  const normalizeHeader = (value) => trim(value).toLowerCase().replace(/\s+/g, "");
  const headerMatches = (header) =>
    headerAliases.some(
      (alias) =>
        safeLower(header) === safeLower(alias) || normalizeHeader(header) === normalizeHeader(alias),
    );

  const values = await getTabValues(auth, deps, sheetId, tab);
  if (!values.length) {
    throw new Error(`Tab "${tab}" is empty or missing.`);
  }

  const headers = values[0].map((value, index) => String(value || `Column ${index + 1}`).trim());
  const matchColIndex = headers.findIndex((header) => headerMatches(header));
  if (matchColIndex < 0) {
    throw new Error(`Match header "${matchKey}" not found on tab "${tab}".`);
  }

  const lower = deps.safeLower || safeLower;
  const data = [];
  for (const patch of patches) {
    const want = trim(patch.matchValue);
    let rowIndex = -1;
    for (let i = 1; i < values.length; i += 1) {
      const cell = String(values[i][matchColIndex] || "").trim();
      if (compareValues(cell, want)) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex < 0) continue;
    const row = [...values[rowIndex]];
    while (row.length < headers.length) row.push("");
    for (const [key, value] of Object.entries(patch.updates || {})) {
      const colIndex = headers.findIndex((header) => lower(header) === lower(key));
      if (colIndex >= 0) row[colIndex] = String(value ?? "").trim();
    }
    values[rowIndex] = row;
    const sheetRow = rowIndex + 1;
    const lastCol = sheetEndColumnLetter(headers.length);
    data.push({
      range: `${tab}!A${sheetRow}:${lastCol}${sheetRow}`,
      values: [row],
    });
  }

  if (!data.length) {
    return { ok: true, patched: 0, tabName: tab, masterSheetId: sheetId };
  }

  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data,
      },
    });

  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(request);
  } else {
    await request();
  }

  return { ok: true, patched: data.length, tabName: tab, masterSheetId: sheetId };
}

export function mapRowObjectToHeaders(headers, rowObject) {
  const lower = safeLower;
  return headers.map((header) => {
    const direct = rowObject?.[header];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return String(direct).trim();
    }
    const match = Object.entries(rowObject || {}).find(([key]) => lower(key) === lower(header));
    return String(match?.[1] ?? "").trim();
  });
}

export function analyzeTabHeaderAlignment(expectedHeaders = [], liveHeaders = []) {
  const lower = safeLower;
  const live = (liveHeaders || []).map((header) => trim(header)).filter(Boolean);
  const expected = (expectedHeaders || []).map((header) => trim(header)).filter(Boolean);
  const missing = expected.filter((header) => !live.some((entry) => lower(entry) === lower(header)));
  const duplicates = live.filter(
    (header, index) => live.findIndex((entry) => lower(entry) === lower(header)) !== index,
  );
  const extra = live.filter((header) => !expected.some((entry) => lower(entry) === lower(header)));
  return {
    missing,
    duplicates,
    extra,
    liveHeaders: live,
    expectedHeaders: expected,
  };
}

function normalizeLiveHeaderRow(headerRow = [], fallbackHeaders = []) {
  const headers = (headerRow || []).map((header) => trim(header));
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }
  if (headers.length === 0 && fallbackHeaders.length > 0) {
    return [...fallbackHeaders];
  }
  return headers;
}

function normalizeAppendTabRowsArgs(expectedHeaders, rowObjects) {
  if (
    Array.isArray(expectedHeaders) &&
    expectedHeaders.length > 0 &&
    expectedHeaders.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) &&
    rowObjects &&
    typeof rowObjects === "object" &&
    !Array.isArray(rowObjects) &&
    Array.isArray(rowObjects.expectedHeaders)
  ) {
    return {
      columns: rowObjects.expectedHeaders,
      rows: expectedHeaders,
      legacyCall: true,
    };
  }
  return {
    columns: Array.isArray(expectedHeaders) ? expectedHeaders : [],
    rows: Array.isArray(rowObjects) ? rowObjects.filter((row) => row && typeof row === "object") : [],
    legacyCall: false,
  };
}

export function rangeWithinTab(updatedRange = "", tabName = "") {
  const raw = trim(updatedRange);
  if (!raw) {
    return "";
  }
  const bang = raw.indexOf("!");
  const range = bang >= 0 ? raw.slice(bang + 1) : raw;
  const tabPrefix = trim(tabName);
  if (tabPrefix && range.startsWith("'")) {
    const closing = range.indexOf("'!");
    if (closing >= 0) {
      return range.slice(closing + 2);
    }
  }
  return range;
}

export async function readTabValueRange(auth, deps, masterSheetId, tabName, a1Range) {
  const values = await getTabValues(auth, deps, masterSheetId, tabName, a1Range);
  return values || [];
}

function recordFromHeaderRow(headers, rowValues = []) {
  return headers.reduce((accumulator, header, index) => {
    accumulator[header] = trim(rowValues[index]);
    return accumulator;
  }, {});
}

/** Append rows to a tab — ensures columns, uses live sheet header positions. */
export async function appendTabRows(auth, deps, masterSheetId, tabName, expectedHeaders, rowObjects = []) {
  const sheetId = trim(masterSheetId);
  const tab = trim(tabName);
  const normalized = normalizeAppendTabRowsArgs(expectedHeaders, rowObjects);
  const columns = normalized.columns;
  const rows = normalized.rows;
  if (!sheetId || !tab) {
    throw new Error("masterSheetId and tabName are required.");
  }
  if (rows.length === 0) {
    return { ok: true, written: 0, skipped: 0, tabName: tab, masterSheetId: sheetId };
  }

  if (columns.length > 0) {
    await ensureTabColumns(auth, deps, sheetId, tab, columns);
  }

  const headerRange =
    columns.length > 0 ? headerRangeForColumnCount(Math.max(columns.length, 1)) : "A1:ZZ1";
  const headerValues = await getTabValues(auth, deps, sheetId, tab, headerRange);
  const sheetHeaders = normalizeLiveHeaderRow(headerValues[0], columns);
  if (sheetHeaders.length === 0) {
    throw new Error(`Tab "${tab}" has no headers.`);
  }
  const headerAlignment = analyzeTabHeaderAlignment(columns, sheetHeaders);

  const { google, withSheetsQuotaRetry } = deps;
  const sheets = google.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: rows.map((row) => mapRowObjectToHeaders(sheetHeaders, row)),
      },
    });

  const response = withSheetsQuotaRetry ? await withSheetsQuotaRetry(request) : await request();
  const updates = response?.data?.updates || {};
  const updatedRows = Number(updates.updatedRows) || 0;
  if (updatedRows <= 0) {
    throw new Error(`appendTabRows wrote zero rows to ${tab} (${sheetId}).`);
  }

  return {
    ok: true,
    written: updatedRows,
    skipped: 0,
    tabName: tab,
    masterSheetId: sheetId,
    updatedRange: trim(updates.updatedRange),
    updatedRows,
    updatedColumns: Number(updates.updatedColumns) || 0,
    tableRange: trim(updates.tableRange),
    sheetHeaders,
    headerAlignment,
    legacyCall: normalized.legacyCall,
  };
}

export async function readAppendedRowByRange(auth, deps, masterSheetId, tabName, appendResult, matchHeader, matchValue) {
  const rangePart = rangeWithinTab(appendResult?.updatedRange, tabName);
  const headers = appendResult?.sheetHeaders || [];
  if (!rangePart || headers.length === 0) {
    return null;
  }
  const values = await readTabValueRange(auth, deps, masterSheetId, tabName, rangePart);
  const rowValues = values[0] || [];
  if (!rowValues.some((cell) => trim(cell))) {
    return null;
  }
  const record = recordFromHeaderRow(headers, rowValues);
  const lower = safeLower;
  const matchKey =
    headers.find((header) => lower(header) === lower(matchHeader)) ||
    Object.keys(record).find((header) => lower(header) === lower(matchHeader));
  if (!matchKey || trim(record[matchKey]) !== trim(matchValue)) {
    return null;
  }
  return record;
}
