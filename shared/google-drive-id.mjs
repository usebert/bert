/** Google Drive resource id validation — shared by API routes and client contract scripts. */

export const GOOGLE_DRIVE_RESOURCE_ID_MIN_LENGTH = 25;
export const GOOGLE_DRIVE_RESOURCE_ID_MAX_LENGTH = 50;
/** Live Companies folder ids in this product are 33+ chars (shorter ids are almost always typos). */
export const GOOGLE_COMPANY_FOLDER_ID_MIN_LENGTH = 33;
export const GOOGLE_SPREADSHEET_ID_LENGTH = 44;

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function extractGoogleDriveResourceId(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const directIdMatch = trimmed.match(/^[A-Za-z0-9_-]{20,}$/);
  if (directIdMatch) {
    return directIdMatch[0];
  }

  const pathMatch = trimmed.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return folderMatch[1];
  }

  const queryMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  return trimmed;
}

export function isValidGoogleDriveResourceId(value) {
  const id = String(value ?? "").trim();
  if (!id || !DRIVE_ID_PATTERN.test(id)) {
    return false;
  }
  return id.length >= GOOGLE_DRIVE_RESOURCE_ID_MIN_LENGTH && id.length <= GOOGLE_DRIVE_RESOURCE_ID_MAX_LENGTH;
}

export function isValidGoogleSpreadsheetId(value) {
  const id = String(value ?? "").trim();
  return DRIVE_ID_PATTERN.test(id) && id.length === GOOGLE_SPREADSHEET_ID_LENGTH;
}

export function isValidCompanyFolderId(value) {
  const id = String(value ?? "").trim();
  if (!id || !DRIVE_ID_PATTERN.test(id)) {
    return false;
  }
  return id.length >= GOOGLE_COMPANY_FOLDER_ID_MIN_LENGTH && id.length <= GOOGLE_DRIVE_RESOURCE_ID_MAX_LENGTH;
}

export function sanitizeGoogleDriveResourceId(input) {
  const extracted = extractGoogleDriveResourceId(input);
  return isValidGoogleDriveResourceId(extracted) ? extracted : "";
}

export function sanitizeCompanyFolderId(input) {
  const extracted = extractGoogleDriveResourceId(input);
  return isValidCompanyFolderId(extracted) ? extracted : "";
}

export function sanitizeGoogleSpreadsheetId(input) {
  const extracted = extractGoogleDriveResourceId(input);
  return isValidGoogleSpreadsheetId(extracted) ? extracted : "";
}

export function validateCompanyDriveIds(input = {}) {
  const companyFolderId = sanitizeCompanyFolderId(input.companyFolderId);
  const masterSheetId = sanitizeGoogleSpreadsheetId(input.masterSheetId);
  if (!companyFolderId || !masterSheetId) {
    return null;
  }
  return { companyFolderId, masterSheetId };
}
