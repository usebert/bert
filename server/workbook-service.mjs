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

export async function ensureTabColumns(auth, deps, spreadsheetId, tabName, expectedHeaders) {
  await ensureTabExists(auth, deps, spreadsheetId, tabName, null);

  const { google, withSheetsQuotaRetry } = deps;
  const lower = deps.safeLower || safeLower;
  const sheets = google.sheets({ version: "v4", auth });
  const rows = await getTabValues(auth, deps, spreadsheetId, tabName);
  const existingHeaders = rows[0] || [];
  const missing = expectedHeaders.filter(
    (header) => !existingHeaders.some((existing) => lower(existing) === lower(header)),
  );

  if (rows.length === 0) {
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

  const nextHeaders = [...existingHeaders, ...missing];
  const remainingRows = rows.slice(1).map((row) => {
    const padded = [...row];
    while (padded.length < nextHeaders.length) {
      padded.push("");
    }
    return padded;
  });

  const clearRequest = () =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tabName}!A:ZZ`,
    });
  const updateRequest = () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [nextHeaders, ...remainingRows] },
    });

  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(clearRequest);
    await withSheetsQuotaRetry(updateRequest);
  } else {
    await clearRequest();
    await updateRequest();
  }

  return { addedColumns: missing, headers: nextHeaders };
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

  const values = await getTabValues(auth, deps, sheetId, tab, options.range);
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
) {
  const sheetId = trim(masterSheetId);
  const tab = trim(tabName);
  const matchKey = trim(matchHeader);
  const want = trim(matchValue).toLowerCase();
  if (!sheetId || !tab || !matchKey || !want) {
    throw new Error("masterSheetId, tabName, matchHeader, and matchValue are required.");
  }

  const readResult = await readTabRecords(auth, deps, sheetId, tab);
  const lower = deps.safeLower || safeLower;
  const records = readResult.records || [];
  const hasMatch = records.some((record) => {
    const cell = trim(
      Object.entries(record).find(([key]) => lower(key) === lower(matchKey))?.[1] ?? "",
    ).toLowerCase();
    return cell === want;
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
  const matchColIndex = headers.findIndex((header) => lower(header) === lower(matchKey));
  if (matchColIndex < 0) {
    throw new Error(`Match header "${matchKey}" not found on tab "${tab}".`);
  }
  for (let i = 1; i < values.length; i += 1) {
    const cell = String(values[i][matchColIndex] || "").trim().toLowerCase();
    if (cell === want) {
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
