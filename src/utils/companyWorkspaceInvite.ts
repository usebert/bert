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

export const INVITE_ROLE_FORBIDDEN_MESSAGE = "You do not have permission to invite users.";

export const INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE =
  "Your account is not linked to a company.";

export const FORBIDDEN_INVITE_ROLE_MESSAGE = "You can only invite Auditors for your company.";

export const INVITE_MANAGE_AUDITOR_ONLY_MESSAGE =
  "You can only manage Auditor invites for your company.";

export const COMPANY_USER_INVITE_TYPE = "COMPANY_USER";

export const INVITE_COMPANY_MISMATCH_MESSAGE =
  "Your account is not linked to this company workspace.";

export const COMPANY_NOT_LIVE_INVITE_MESSAGE =
  "Link a company folder and workbook before inviting users.";

export const INVITE_SENT_USER_MESSAGE = "Invite sent.";

export const INVITE_PARTIAL_SUCCESS_USER_MESSAGE =
  "Invite link created, but email could not be sent. Copy and send the link manually.";

export const INVITE_EMAIL_UNAVAILABLE_COMPANY_MESSAGE =
  "Invite could not be sent right now. Ask BERT Admin to check platform email/Google setup.";

export const INVITE_GOOGLE_UNAVAILABLE_GODMODE_MESSAGE =
  "Google Workspace connection is required before sending company user invites.";

export type CompanyInviteSession = {
  role?: string;
  accessLevel?: string;
};

export type CompanyInviteTarget = {
  status?: string;
  registryStatus?: string;
};

export const COMPANY_REGISTRY_STATUS_LIVE = "Live";

export function getCanonicalCompanyStatus(company: CompanyInviteTarget = {}): string {
  const raw = String(company.status || company.registryStatus || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.toLowerCase() === "live") {
    return COMPANY_REGISTRY_STATUS_LIVE;
  }
  return raw;
}

export function isGodmodeInviteSession(session: CompanyInviteSession & { kind?: string } = {}): boolean {
  if (session.kind === "master") {
    return true;
  }
  return String(session.role || "").trim() === "Master";
}

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

export function isCompanyManagerInviteRole(session: CompanyInviteSession = {}): boolean {
  return String(session.role || "").trim() === "Manager";
}

export function isCompanyInviteActor(session: CompanyInviteSession = {}): boolean {
  return isCompanyAdminInviteRole(session) || isCompanyManagerInviteRole(session);
}

/** Canonical Companies registry status — only explicit Live allows company-user invites. */
export function isCompanyRegistryLive(company: CompanyInviteTarget = {}): boolean {
  return getCanonicalCompanyStatus(company) === COMPANY_REGISTRY_STATUS_LIVE;
}

/** Company-scoped user invites: Company Admin or Manager (registry LIVE is not required). */
export function canInviteCompanyUsers(session: CompanyInviteSession, company: CompanyInviteTarget): boolean {
  void company;
  return isCompanyInviteActor(session);
}

function sessionCompanyId(session: CompanyInviteSession & { companyId?: string; companyFolderId?: string } = {}) {
  return String(session.companyId || session.companyFolderId || "").trim();
}

function inviteCompanyId(invite: {
  companyId?: string;
  companyFolderId?: string;
} = {}) {
  return String(invite.companyId || invite.companyFolderId || "").trim();
}

export function isAuditorInviteRole(role = ""): boolean {
  return String(role || "").trim() === "Auditor";
}

export function canCreateCompanyInvite(
  session: CompanyInviteSession & { kind?: string; companyId?: string; companyFolderId?: string },
  targetCompanyId = "",
  targetRole = "",
): boolean {
  if (isGodmodeInviteSession(session)) {
    return true;
  }
  if (!isCompanyInviteActor(session)) {
    return false;
  }
  if (!isAuditorInviteRole(targetRole)) {
    return false;
  }
  const companyId = String(targetCompanyId || "").trim();
  if (!companyId) {
    return false;
  }
  return sessionCompanyId(session) === companyId;
}

export function canViewInvite(
  session: CompanyInviteSession & { kind?: string; companyId?: string; companyFolderId?: string },
  invite: {
    kind?: string;
    inviteType?: string;
    type?: string;
    role?: string;
    companyId?: string;
    companyFolderId?: string;
  } = {},
): boolean {
  if (isGodmodeInviteSession(session)) {
    return true;
  }
  if (!isCompanyInviteActor(session)) {
    return false;
  }
  const inviteType = String(invite.inviteType || invite.type || "").trim();
  if (inviteType && inviteType !== COMPANY_USER_INVITE_TYPE) {
    return false;
  }
  if (invite.kind && invite.kind !== "company_user") {
    return false;
  }
  if (!isAuditorInviteRole(invite.role)) {
    return false;
  }
  const companyId = inviteCompanyId(invite);
  if (!companyId) {
    return false;
  }
  return sessionCompanyId(session) === companyId;
}

export function canRevokeInvite(
  session: CompanyInviteSession & { kind?: string; companyId?: string; companyFolderId?: string },
  invite: {
    kind?: string;
    inviteType?: string;
    type?: string;
    role?: string;
    companyId?: string;
    companyFolderId?: string;
  } = {},
): boolean {
  return canViewInvite(session, invite);
}

/** Godmode (Master): invite when the company master sheet has a writable Users tab — bypasses LIVE. */
export function isCompanyUsersTabWritable(input: {
  companySheetSync?: { sheetId?: string };
  workspaceValidation?: { tabs?: Record<string, boolean>; missingTabs?: string[] } | null;
}): boolean {
  const sheetId = String(input.companySheetSync?.sheetId || "").trim();
  if (!sheetId) {
    return false;
  }
  const validation = input.workspaceValidation;
  if (validation?.tabs?.Users === true) {
    return true;
  }
  if ((validation?.missingTabs || []).includes("Users")) {
    return false;
  }
  if (validation?.tabs?.Users === false) {
    return false;
  }
  return true;
}

export const GODMODE_USERS_TAB_NOT_READY_MESSAGE =
  "The company master sheet Users tab is not ready yet. Run Repair / complete setup first.";

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
