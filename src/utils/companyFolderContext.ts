/** Frontend mirror of shared/company-folder-context.mjs */

export const COMPANY_CONTEXT_STATUS_USABLE = "USABLE";

export const COMPANY_READY_INVITE_MESSAGE = "Company is ready. You can now invite users.";

export const FOLDER_NOT_IN_COMPANIES_ROOT_MESSAGE =
  "This company is not set up in BERT. Contact your administrator.";

export const COMPANY_CONTEXT_INVALID = "COMPANY_CONTEXT_INVALID";

export const COMPANY_NO_LONGER_AVAILABLE_MESSAGE =
  "This company workspace is no longer available. Contact your administrator.";

export function cleanCompanyNameFromFolder(folderName = ""): string {
  const raw = String(folderName || "").trim();
  if (!raw) {
    return "";
  }
  const withoutSuffix = raw.replace(/\s*-\s*BERT Folder Structure\s*$/i, "").trim();
  return withoutSuffix || raw;
}

export const FOLDER_NOT_IN_COMPANIES_ROOT = "FOLDER_NOT_IN_COMPANIES_ROOT";

export function isCompanyFolderLinkValid(context: { folderPlacementOk?: boolean } | null | undefined): boolean {
  return context?.folderPlacementOk !== false;
}

export function isCompanyWorkspaceUsable(context: {
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
  archived?: boolean;
  status?: string;
  usable?: boolean;
  folderPlacementOk?: boolean;
} = {}): boolean {
  const companyId = String(context.companyId || context.companyFolderId || "").trim();
  const masterSheetId = String(context.masterSheetId || "").trim();
  if (!companyId || !masterSheetId) {
    return false;
  }
  if (context.archived === true) {
    return false;
  }
  const status = String(context.status || "").trim().toUpperCase();
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
