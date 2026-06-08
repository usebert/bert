/** Strip numeric prefixes so "99 Archive" matches archive containers. */
export function normalizeWorkspaceFolderLabel(name = ""): string {
  return String(name || "")
    .toLowerCase()
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isArchiveOrNonLiveWorkspaceName(name: string | undefined): boolean {
  const normalized = normalizeWorkspaceFolderLabel(name || "");
  return normalized === "archive" || normalized === "archived";
}

export const LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE =
  "Select a live company workspace before inviting users.";

export const GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE =
  "Select a live company workspace first.";

export const INVITE_ROLE_FORBIDDEN_MESSAGE = "Only Company Admins can invite users.";

export const INVITE_COMPANY_MISMATCH_MESSAGE =
  "Your account is not linked to this company workspace.";

export const COMPANY_NOT_LIVE_INVITE_MESSAGE =
  "This company is not live yet. Finish company onboarding before inviting users.";

export type CompanyInviteSession = {
  role?: string;
  accessLevel?: string;
};

export type CompanyInviteTarget = {
  status?: string;
  registryStatus?: string;
};

export function isCompanyAdminInviteRole(session: CompanyInviteSession = {}): boolean {
  const role = String(session.role || "").trim();
  const accessLevel = String(session.accessLevel || "")
    .trim()
    .toLowerCase();
  if (role === "Admin") {
    return true;
  }
  return accessLevel === "admin" || accessLevel === "company admin" || accessLevel === "full";
}

/** Canonical Companies registry status — only explicit Live allows company-user invites. */
export function isCompanyRegistryLive(company: CompanyInviteTarget = {}): boolean {
  const status = String(company.status || company.registryStatus || "")
    .trim()
    .toLowerCase();
  return status === "live";
}

/** Company-scoped user invites: Company Admin + registry LIVE only (not Master/Godmode). */
export function canInviteCompanyUsers(session: CompanyInviteSession, company: CompanyInviteTarget): boolean {
  return isCompanyAdminInviteRole(session) && isCompanyRegistryLive(company);
}

export const FIRST_ADMIN_REQUIRES_ONBOARDING_MESSAGE =
  "The first company administrator is created during company onboarding. Ask your platform owner to send a company onboarding invite.";

export function assertLiveCompanyWorkspaceForInvite(input: {
  selectedFolder: { name: string } | null | undefined;
  masterSheetId: string;
}): { ok: true } | { ok: false; message: string } {
  const sheetId = String(input.masterSheetId || "").trim();
  const folder = input.selectedFolder;
  if (!folder || !sheetId) {
    return { ok: false, message: LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE };
  }
  if (isArchiveOrNonLiveWorkspaceName(folder.name)) {
    return { ok: false, message: LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE };
  }
  return { ok: true };
}
