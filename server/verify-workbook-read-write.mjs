/**
 * Lightweight workbook read/write verification for Godmode company setup.
 * Metadata-only spreadsheets.get + single SyncLog ping write — no full workbook reads.
 */
import {
  classifyGoogleSheetsAccessError,
  withOperationTimeout,
  DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
} from "./ensure-required-tabs.mjs";

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Verify spreadsheet read (metadata) and write (SyncLog ping) access.
 * @returns {Promise<{ ok: boolean, readOk: boolean, writeOk: boolean, usersTabPresent: boolean, usersTabWritable: boolean, tabCount: number }>}
 */
export async function verifyWorkbookReadWrite(auth, deps, spreadsheetId, options = {}) {
  const {
    google,
    withSheetsQuotaRetry,
    timeoutMs = DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
    pingWrite = true,
  } = { ...deps, ...options };
  const sheetId = String(spreadsheetId || options.spreadsheetId || "").trim();
  if (!sheetId) {
    const error = new Error("Master sheet ID is required.");
    error.code = "MASTER_SHEET_UNAVAILABLE";
    throw error;
  }
  if (!google?.sheets) {
    const error = new Error("Google Sheets client is not configured.");
    error.code = "SETUP_STEP_FAILED";
    throw error;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const getMetadata = () =>
    sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      includeGridData: false,
      fields: "spreadsheetId,sheets.properties.title",
    });

  let response;
  try {
    response = await withOperationTimeout(
      withSheetsQuotaRetry ? withSheetsQuotaRetry(getMetadata) : getMetadata(),
      "get_spreadsheet_metadata",
      timeoutMs,
    );
  } catch (error) {
    throw classifyGoogleSheetsAccessError(error);
  }

  const titles =
    response.data.sheets?.map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean) || [];
  const usersTabPresent = titles.some((title) => safeLower(title) === "users");

  let writeOk = false;
  if (pingWrite) {
    const pingRow = [`setup_verify_${new Date().toISOString()}`, "setup_verify", new Date().toISOString()];
    const appendPing = () =>
      sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: "SyncLog!A1",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [pingRow] },
      });
    try {
      await withOperationTimeout(
        withSheetsQuotaRetry ? withSheetsQuotaRetry(appendPing) : appendPing(),
        "write_sync_log_ping",
        timeoutMs,
      );
      writeOk = true;
    } catch (error) {
      throw classifyGoogleSheetsAccessError(error);
    }
  }

  const readOk = Boolean(response.data.spreadsheetId || sheetId);
  return {
    ok: readOk && (!pingWrite || writeOk),
    readOk,
    writeOk: pingWrite ? writeOk : true,
    usersTabPresent,
    usersTabWritable: usersTabPresent && (!pingWrite || writeOk),
    tabCount: titles.length,
  };
}
