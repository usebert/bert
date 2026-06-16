/**
 * Company folder = source of truth. Folder + workbook resolves to USABLE context.
 */

export const COMPANY_CONTEXT_STATUS_USABLE = "USABLE";

export const COMPANY_CONTEXT_INVALID = "COMPANY_CONTEXT_INVALID";

export const COMPANY_NO_LONGER_AVAILABLE_MESSAGE =
  "This company workspace is no longer available. Contact your administrator.";

export const BERT_FOLDER_STRUCTURE_SUFFIX = " - BERT Folder Structure";

export const COMPANY_READY_INVITE_MESSAGE = "Company is ready. You can now invite users.";

function trim(value) {
  return String(value ?? "").trim();
}

/** Strip BERT Folder Structure suffix from Drive folder names. */
export function cleanCompanyNameFromFolder(folderName = "") {
  const raw = trim(folderName);
  if (!raw) {
    return "";
  }
  const withoutSuffix = raw.replace(/\s*-\s*BERT Folder Structure\s*$/i, "").trim();
  return withoutSuffix || raw;
}

/** True when folder id + master workbook id are present and not archived. */
export function isCompanyWorkspaceUsable(context = {}) {
  const companyId = trim(context.companyId || context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  if (!companyId || !masterSheetId) {
    return false;
  }
  if (context.archived === true) {
    return false;
  }
  const status = trim(context.status).toUpperCase();
  if (status === "ARCHIVED" || status === "DISCONNECTED") {
    return false;
  }
  if (context.usable === false) {
    return false;
  }
  if (context.folderPlacementOk === false) {
    return false;
  }
  return true;
}

export function resolveCompanyContextStatus(context = {}) {
  return isCompanyWorkspaceUsable(context) ? COMPANY_CONTEXT_STATUS_USABLE : "";
}
