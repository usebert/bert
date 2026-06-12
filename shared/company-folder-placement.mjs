/**
 * Company folders must live under the canonical Live Companies parent in the workspace Drive.
 */

export const FOLDER_NOT_IN_COMPANIES_ROOT = "FOLDER_NOT_IN_COMPANIES_ROOT";

export const LIVE_COMPANIES_FOLDER_LABEL = "Live Companies";

export const FOLDER_PLACEMENT_USER_MESSAGE =
  "This company folder is not under Live Companies in Google Drive. Move it into Live Companies or re-provision the workspace.";

export const FOLDER_PLACEMENT_LOGIN_MESSAGE =
  "Your company workspace is not in the correct Google Drive location. Contact your administrator — the folder must be under Live Companies.";

function safeLower(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/** Normalize Drive folder names for Live Companies matching (01 Live Companies, etc.). */
export function normalizeLiveCompaniesFolderName(name = "") {
  return safeLower(name)
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isLiveCompaniesFolderName(name = "") {
  const normalized = normalizeLiveCompaniesFolderName(name);
  return normalized === "live companies" || normalized === "companies";
}

/** True when companyFolderId is a direct or indirect child of the Live Companies folder. */
export function isFolderUnderLiveCompanies(companyFolderId, liveCompaniesFolderId, ancestorParentIds = []) {
  const folderId = String(companyFolderId || "").trim();
  const liveId = String(liveCompaniesFolderId || "").trim();
  if (!folderId || !liveId || folderId === liveId) {
    return false;
  }
  return (ancestorParentIds || []).map((entry) => String(entry || "").trim()).includes(liveId);
}
