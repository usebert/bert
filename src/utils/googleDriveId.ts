/** Google Drive resource id validation — client mirror of shared/google-drive-id.mjs */

export const GOOGLE_DRIVE_RESOURCE_ID_MIN_LENGTH = 25;
export const GOOGLE_DRIVE_RESOURCE_ID_MAX_LENGTH = 50;
export const GOOGLE_COMPANY_FOLDER_ID_MIN_LENGTH = 33;
export const GOOGLE_SPREADSHEET_ID_LENGTH = 44;

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function extractGoogleDriveResourceId(input: string): string {
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

export function isValidGoogleDriveResourceId(value: string | null | undefined): boolean {
  const id = String(value ?? "").trim();
  if (!id || !DRIVE_ID_PATTERN.test(id)) {
    return false;
  }
  return id.length >= GOOGLE_DRIVE_RESOURCE_ID_MIN_LENGTH && id.length <= GOOGLE_DRIVE_RESOURCE_ID_MAX_LENGTH;
}

export function isValidGoogleSpreadsheetId(value: string | null | undefined): boolean {
  const id = String(value ?? "").trim();
  return DRIVE_ID_PATTERN.test(id) && id.length === GOOGLE_SPREADSHEET_ID_LENGTH;
}

export function isValidCompanyFolderId(value: string | null | undefined): boolean {
  const id = String(value ?? "").trim();
  if (!id || !DRIVE_ID_PATTERN.test(id)) {
    return false;
  }
  return id.length >= GOOGLE_COMPANY_FOLDER_ID_MIN_LENGTH && id.length <= GOOGLE_DRIVE_RESOURCE_ID_MAX_LENGTH;
}

export function sanitizeGoogleDriveResourceId(input: string | null | undefined): string {
  const extracted = extractGoogleDriveResourceId(String(input ?? ""));
  return isValidGoogleDriveResourceId(extracted) ? extracted : "";
}

export function sanitizeCompanyFolderId(input: string | null | undefined): string {
  const extracted = extractGoogleDriveResourceId(String(input ?? ""));
  return isValidCompanyFolderId(extracted) ? extracted : "";
}

export function sanitizeGoogleSpreadsheetId(input: string | null | undefined): string {
  const extracted = extractGoogleDriveResourceId(String(input ?? ""));
  return isValidGoogleSpreadsheetId(extracted) ? extracted : "";
}

export type ValidatedCompanyDriveIds = {
  companyFolderId: string;
  masterSheetId: string;
};

/** Both ids must pass format checks — rejects OCR/typo ids stored in localStorage. */
export function validateCompanyDriveIds(input: {
  companyFolderId?: string | null;
  masterSheetId?: string | null;
}): ValidatedCompanyDriveIds | null {
  const companyFolderId = sanitizeCompanyFolderId(input.companyFolderId);
  const masterSheetId = sanitizeGoogleSpreadsheetId(input.masterSheetId);
  if (!companyFolderId || !masterSheetId) {
    return null;
  }
  return { companyFolderId, masterSheetId };
}
