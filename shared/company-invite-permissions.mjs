/** Shared company-user invite permission rules (server + verify scripts). */

export const INVITE_ROLE_FORBIDDEN_MESSAGE = "Only Company Admins can invite users.";

export const COMPANY_NOT_LIVE_INVITE_MESSAGE =
  "This company is not live yet. Finish company onboarding before inviting users.";

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

/** Canonical Companies registry status — only explicit Live allows company-user invites. */
export function isCompanyRegistryLive(company = {}) {
  return getCanonicalCompanyStatus(company) === COMPANY_REGISTRY_STATUS_LIVE;
}

/** Company-scoped user invites: Company Admin + registry LIVE only (not Master/Godmode). */
export function canInviteCompanyUsers(session = {}, company = {}) {
  return isCompanyAdminInviteRole(session) && isCompanyRegistryLive(company);
}
