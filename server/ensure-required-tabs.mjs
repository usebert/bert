/**
 * Fast, idempotent ensure-required-tabs for Godmode company setup.
 * Uses minimal spreadsheets.get metadata + one batchUpdate for missing tabs.
 */
import { COMPANY_FOLDERS_TAB } from "./company-folder-structure.mjs";
import { GOOGLE_FORM_TEMPLATES_TAB } from "./google-form-templates.mjs";

export const SETUP_REQUIRED_TABS = [
  "Config",
  "Users",
  "Sites",
  "Departments",
  "Areas",
  "AuditTemplates",
  "AreaAudits",
  "UserAuditAccess",
  "Schedules",
  "AuditResults",
  "AuditFindings",
  "Actions",
  "Evidence",
  "Reports",
  COMPANY_FOLDERS_TAB,
  GOOGLE_FORM_TEMPLATES_TAB,
  "SyncLog",
  "Documents",
  "DocumentAcknowledgements",
  "DocumentFolders",
  "DocumentRevisions",
  "DocumentReviews",
  "DocumentSettings",
  "Briefings",
  "BriefingRecipients",
  "NCRs",
  "Invites",
];

export const DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS = 90_000;

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

export function findMissingRequiredTabs(existingTitles, requiredTabs = SETUP_REQUIRED_TABS) {
  const existingLower = new Set((existingTitles || []).map((title) => safeLower(title)));
  return requiredTabs.filter((tab) => !existingLower.has(safeLower(tab)));
}

export function buildAddSheetBatchRequests(missingTabs) {
  return missingTabs.map((title) => ({
    addSheet: { properties: { title } },
  }));
}

export function classifyGoogleSheetsAccessError(error, mimeType = "") {
  if (mimeType && mimeType !== SPREADSHEET_MIME) {
    if (mimeType === FOLDER_MIME) {
      const invalid = new Error("Master sheet ID refers to a folder, not a spreadsheet.");
      invalid.code = "MASTER_SHEET_ID_INVALID";
      return invalid;
    }
    const invalid = new Error(`Master sheet ID is not a spreadsheet (mimeType=${mimeType}).`);
    invalid.code = "MASTER_SHEET_ID_INVALID";
    return invalid;
  }

  const status = Number(error?.code || error?.response?.status || 0);
  const message = String(error?.message || error || "").toLowerCase();

  if (status === 403 || message.includes("permission") || message.includes("forbidden")) {
    const denied = new Error("Google account lacks permission to access the company master sheet.");
    denied.code = "GOOGLE_PERMISSION_DENIED";
    return denied;
  }

  if (status === 404 || message.includes("not found") || message.includes("unable to parse range")) {
    const unavailable = new Error("Company master sheet is invalid or inaccessible.");
    unavailable.code = "MASTER_SHEET_UNAVAILABLE";
    return unavailable;
  }

  return error instanceof Error ? error : new Error(String(error || "Google Sheets request failed."));
}

export function withOperationTimeout(promise, operation, timeoutMs = DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Google operation timed out (${operation}).`);
      error.code = "GOOGLE_TIMEOUT";
      error.operation = operation;
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function validateSpreadsheetId(auth, google, spreadsheetId) {
  if (!spreadsheetId) {
    const error = new Error("Master sheet ID is required.");
    error.code = "MASTER_SHEET_UNAVAILABLE";
    throw error;
  }

  if (!google?.drive) {
    return;
  }

  try {
    const drive = google.drive({ version: "v3", auth });
    const meta = await drive.files.get({
      fileId: spreadsheetId,
      supportsAllDrives: true,
      fields: "id,mimeType",
    });
    const mimeType = String(meta.data?.mimeType || "");
    const classified = classifyGoogleSheetsAccessError(null, mimeType);
    if (classified?.code === "MASTER_SHEET_ID_INVALID") {
      throw classified;
    }
  } catch (error) {
    if (error?.code === "MASTER_SHEET_ID_INVALID") {
      throw error;
    }
    const classified = classifyGoogleSheetsAccessError(error);
    if (classified?.code === "MASTER_SHEET_UNAVAILABLE" || classified?.code === "GOOGLE_PERMISSION_DENIED") {
      throw classified;
    }
  }
}

async function getSpreadsheetTabTitles(auth, google, spreadsheetId, withSheetsQuotaRetry) {
  const sheets = google.sheets({ version: "v4", auth });
  const request = () =>
    sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
      fields: "spreadsheetId,sheets.properties.sheetId,sheets.properties.title",
    });
  const response = withSheetsQuotaRetry ? await withSheetsQuotaRetry(request) : await request();
  const titles =
    response.data.sheets?.map((sheet) => String(sheet.properties?.title || "").trim()).filter(Boolean) || [];
  return { spreadsheetId: response.data.spreadsheetId || spreadsheetId, titles };
}

/**
 * Ensure setup-required tabs exist. Metadata-only read; batch create missing tabs.
 */
export async function ensureRequiredTabs(auth, deps, spreadsheetId, options = {}) {
  const startedAt = Date.now();
  const {
    google,
    withSheetsQuotaRetry,
    requiredTabs = SETUP_REQUIRED_TABS,
    timeoutMs = DEFAULT_GOOGLE_OPERATION_TIMEOUT_MS,
  } = deps;
  const sheetId = String(spreadsheetId || options.spreadsheetId || "").trim();

  await validateSpreadsheetId(auth, google, sheetId);

  let titles = [];
  try {
    const metadata = await withOperationTimeout(
      getSpreadsheetTabTitles(auth, google, sheetId, withSheetsQuotaRetry),
      "get_spreadsheet_metadata",
      timeoutMs,
    );
    titles = metadata.titles;
  } catch (error) {
    throw classifyGoogleSheetsAccessError(error);
  }

  const missing = findMissingRequiredTabs(titles, requiredTabs);
  const existingTabCount = titles.length;
  let batchUpdateCount = 0;
  let tabsAdded = [];

  if (missing.length === 0) {
    const durationMs = Date.now() - startedAt;
    console.log("[ensure-required-tabs] complete", {
      spreadsheetId: sheetId,
      existingTabCount,
      missing: [],
      batchUpdateCount: 0,
      durationMs,
    });
    return { ok: true, spreadsheetId: sheetId, existingTabCount, missing: [], tabsAdded: [], batchUpdateCount: 0, durationMs };
  }

  const requests = buildAddSheetBatchRequests(missing);
  batchUpdateCount = requests.length;
  const sheets = google.sheets({ version: "v4", auth });
  try {
    await withOperationTimeout(
      withSheetsQuotaRetry
        ? withSheetsQuotaRetry(() =>
            sheets.spreadsheets.batchUpdate({
              spreadsheetId: sheetId,
              requestBody: { requests },
            }),
          )
        : sheets.spreadsheets.batchUpdate({
            spreadsheetId: sheetId,
            requestBody: { requests },
          }),
      "batch_create_missing_tabs",
      timeoutMs,
    );
    tabsAdded = [...missing];
  } catch (error) {
    throw classifyGoogleSheetsAccessError(error);
  }

  const durationMs = Date.now() - startedAt;
  console.log("[ensure-required-tabs] complete", {
    spreadsheetId: sheetId,
    existingTabCount,
    missing,
    batchUpdateCount,
    durationMs,
  });

  return {
    ok: true,
    spreadsheetId: sheetId,
    existingTabCount,
    missing,
    tabsAdded,
    batchUpdateCount,
    durationMs,
  };
}
