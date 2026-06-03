import { isArchiveOrNonLiveWorkspaceName } from "./companyWorkspaceInvite";

export type CompanyWorkspaceStatusLabel =
  | "Draft"
  | "Provisioning"
  | "Incomplete"
  | "Live"
  | "Failed"
  | "Archived";

export function workspaceStatusBadgeClass(status: CompanyWorkspaceStatusLabel): string {
  switch (status) {
    case "Live":
      return "bg-emerald-100 text-emerald-800";
    case "Provisioning":
      return "bg-sky-100 text-sky-800";
    case "Incomplete":
      return "bg-amber-100 text-amber-900";
    case "Failed":
      return "bg-rose-100 text-rose-800";
    case "Archived":
      return "bg-slate-200 text-slate-700";
    case "Draft":
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function resolveCompanyWorkspaceStatus(input: {
  folderName: string;
  masterSheetId?: string;
  isSelected?: boolean;
  syncState?: string;
  isProvisioning?: boolean;
  setupFailed?: boolean;
  onboardingVerified?: boolean;
  responseSheetVerified?: boolean;
}): CompanyWorkspaceStatusLabel {
  if (isArchiveOrNonLiveWorkspaceName(input.folderName)) {
    return "Archived";
  }
  if (input.setupFailed) {
    return "Failed";
  }
  if (input.isProvisioning) {
    return "Provisioning";
  }
  const masterSheetId = String(input.masterSheetId || "").trim();
  const isLive =
    Boolean(input.isSelected) &&
    input.syncState === "Synced" &&
    Boolean(masterSheetId);
  if (isLive) {
    return "Live";
  }
  if (masterSheetId) {
    if (input.onboardingVerified && input.responseSheetVerified) {
      return "Incomplete";
    }
    return "Incomplete";
  }
  return "Draft";
}
