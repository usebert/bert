/** Frontend mirror of shared/company-folder-context.mjs */

export const COMPANY_CONTEXT_STATUS_USABLE = "USABLE";

export const COMPANY_READY_INVITE_MESSAGE = "Company is ready. You can now invite users.";

export function cleanCompanyNameFromFolder(folderName = ""): string {
  const raw = String(folderName || "").trim();
  if (!raw) {
    return "";
  }
  const withoutSuffix = raw.replace(/\s*-\s*BERT Folder Structure\s*$/i, "").trim();
  return withoutSuffix || raw;
}

export function isCompanyWorkspaceUsable(context: {
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
  archived?: boolean;
  status?: string;
  usable?: boolean;
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
  return true;
}
