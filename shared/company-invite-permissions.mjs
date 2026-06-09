/** Shared company-user invite permission rules (server + verify scripts). */

export const INVITE_ROLE_FORBIDDEN_MESSAGE = "You do not have permission to invite users.";

export const FORBIDDEN_INVITE_ROLE_MESSAGE = "You can only invite Auditors for your company.";

export const INVITE_MANAGE_AUDITOR_ONLY_MESSAGE =
  "You can only manage Auditor invites for your company.";

export const COMPANY_NOT_LIVE_INVITE_MESSAGE =
  "This company is not live yet. Finish company onboarding before inviting users.";

export const COMPANY_USER_INVITE_TYPE = "COMPANY_USER";

/** Canonical persisted value in the Companies registry Status column. */
export const COMPANY_REGISTRY_STATUS_LIVE = "Live";

export function getCanonicalCompanyStatus(company = {}) {
  const raw = String(company.status || company.registryStatus || "")
    .trim();
  if (!raw) {
    return "";
  }
  if (raw.toLowerCase() === "live") {
    return COMPANY_REGISTRY_STATUS_LIVE;
  }
  return raw;
}

export function isGodmodeInviteSession(session = {}) {
  if (session.kind === "master") {
    return true;
  }
  return String(session.role || "").trim() === "Master";
}

export function isCompanyAdminInviteRole(session = {}) {
  const role = String(session.role || "").trim();
  const accessLevel = String(session.accessLevel || "")
    .trim()
    .toLowerCase();
  if (role === "Admin") {
    return true;
  }
  return accessLevel === "admin" || accessLevel === "company admin" || accessLevel === "full";
}

export function isCompanyManagerInviteRole(session = {}) {
  return String(session.role || "").trim() === "Manager";
}

export function isCompanyInviteActor(session = {}) {
  return isCompanyAdminInviteRole(session) || isCompanyManagerInviteRole(session);
}

/** Canonical Companies registry status — only explicit Live allows company-user invites. */
export function isCompanyRegistryLive(company = {}) {
  return getCanonicalCompanyStatus(company) === COMPANY_REGISTRY_STATUS_LIVE;
}

/** Company-scoped user invites: Company Admin or Manager + registry LIVE (not Master/Godmode). */
export function canInviteCompanyUsers(session = {}, company = {}) {
  return isCompanyInviteActor(session) && isCompanyRegistryLive(company);
}

function sessionCompanyId(session = {}) {
  return String(session.companyId || session.companyFolderId || "").trim();
}

function inviteCompanyId(invite = {}) {
  return String(invite.companyId || invite.companyFolderId || "").trim();
}

export function isAuditorInviteRole(role = "") {
  return String(role || "").trim() === "Auditor";
}

export function canCreateCompanyInvite(session = {}, targetCompanyId = "", targetRole = "") {
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

export function canViewInvite(session = {}, invite = {}) {
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

export function canRevokeInvite(session = {}, invite = {}) {
  return canViewInvite(session, invite);
}
