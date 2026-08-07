/**
 * Production smoke verification users — stable IDs, markers, and permission matrix.
 */
import { parseRoleForClient } from "./schedule-assignees.mjs";

export const PRODUCTION_VERIFICATION_USER_EMAIL_DOMAIN = "usebert.co.uk";
export const PRODUCTION_VERIFICATION_USER_EMAIL_LOCAL_PREFIX = "bert.demo+smoke-user-";
export const PRODUCTION_VERIFICATION_USER_USERNAME_PREFIX = "bert.smoke.user.";
export const PRODUCTION_VERIFICATION_USER_ID_PREFIX = "bert-smoke-user-";
export const PRODUCTION_VERIFICATION_USER_SOURCE = "production-users-permissions-workflow";
export const PRODUCTION_VERIFICATION_USER_MARKER = "verification";
export const PRODUCTION_VERIFICATION_USER_CREATED_BY = "BERT production-verify users";
export const PRODUCTION_VERIFICATION_USER_CLEANED_STATUS = "DELETED";

export const STORED_ROLE_DISPLAY = {
  Admin: "Admin",
  "Company Admin": "Admin",
  Manager: "Manager",
  Auditor: "Auditor",
  User: "User",
  Master: "BERT Platform Owner",
};

export const CUSTOMER_ROLE_SLUGS = ["manager", "auditor", "admin"];

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

export function buildVerificationUserRoleSlug(role = "manager") {
  return normalize(role).replace(/[^a-z0-9]+/g, "-");
}

export function buildProductionVerificationUserEmail(runId = Date.now(), role = "manager") {
  const slug = buildVerificationUserRoleSlug(role);
  return `${PRODUCTION_VERIFICATION_USER_EMAIL_LOCAL_PREFIX}${slug}-${runId}@${PRODUCTION_VERIFICATION_USER_EMAIL_DOMAIN}`.toLowerCase();
}

export function buildProductionVerificationUsername(runId = Date.now(), role = "manager") {
  const slug = buildVerificationUserRoleSlug(role);
  return `${PRODUCTION_VERIFICATION_USER_USERNAME_PREFIX}${slug}.${runId}`;
}

export function buildProductionVerificationUserId(runId = Date.now(), role = "manager") {
  const slug = buildVerificationUserRoleSlug(role);
  return `${PRODUCTION_VERIFICATION_USER_ID_PREFIX}${runId}-${slug}`;
}

export function isVerificationUserEmail(email = "") {
  const normalized = normalize(email);
  return (
    normalized.startsWith(PRODUCTION_VERIFICATION_USER_EMAIL_LOCAL_PREFIX) &&
    normalized.endsWith(`@${PRODUCTION_VERIFICATION_USER_EMAIL_DOMAIN}`)
  );
}

export function isVerificationUsername(username = "") {
  return normalize(username).startsWith(PRODUCTION_VERIFICATION_USER_USERNAME_PREFIX);
}

export function isVerificationUserId(userId = "") {
  return trim(userId).startsWith(PRODUCTION_VERIFICATION_USER_ID_PREFIX);
}

export function isVerificationUserRecord(record = {}) {
  const email = normalize(record.email || record.Email);
  const username = normalize(record.username || record.Username);
  const userId = trim(record.userId || record["User ID"] || record.user_id);
  const createdBy = normalize(record.createdBy || record["Created By"]);
  const name = normalize(record.name || record.Name);
  return (
    isVerificationUserEmail(email) ||
    isVerificationUsername(username) ||
    isVerificationUserId(userId) ||
    createdBy.includes(normalize(PRODUCTION_VERIFICATION_USER_SOURCE)) ||
    createdBy.includes(normalize(PRODUCTION_VERIFICATION_USER_CREATED_BY)) ||
    name.includes(PRODUCTION_VERIFICATION_USER_MARKER)
  );
}

export function isActiveVerificationUserRecord(record = {}) {
  if (!isVerificationUserRecord(record)) {
    return false;
  }
  const status = normalize(record.status || record.Status || "active");
  return status !== "deleted" && status !== "removed" && status !== PRODUCTION_VERIFICATION_USER_CLEANED_STATUS.toLowerCase();
}

export function canonicalStoredRole(role = "") {
  const parsed = parseRoleForClient(role);
  return parsed || trim(role);
}

export function displayRoleForStoredRole(role = "") {
  const canonical = canonicalStoredRole(role);
  return STORED_ROLE_DISPLAY[canonical] || STORED_ROLE_DISPLAY[trim(role)] || canonical || trim(role);
}

export function countUserBaselines(users = []) {
  const list = Array.isArray(users) ? users : [];
  const verification = list.filter((item) => isVerificationUserRecord(item));
  const activeVerification = list.filter((item) => isActiveVerificationUserRecord(item));
  const active = list.filter((item) => normalize(item.status) === "active");
  const disabled = list.filter((item) => ["inactive", "disabled"].includes(normalize(item.status)));
  const managers = list.filter((item) => canonicalStoredRole(item.role) === "Manager");
  const auditors = list.filter((item) => canonicalStoredRole(item.role) === "Auditor");
  return {
    totalUsers: list.length,
    activeUsers: active.length,
    disabledUsers: disabled.length,
    managerCount: managers.length,
    auditorCount: auditors.length,
    verificationUserCount: verification.length,
    activeVerificationUserCount: activeVerification.length,
  };
}

export function buildVerificationUserCreateInput(input = {}) {
  const runId = input.runId ?? Date.now();
  const role = canonicalStoredRole(input.role || "Manager");
  const email = trim(input.email) || buildProductionVerificationUserEmail(runId, role);
  const userId = trim(input.userId) || buildProductionVerificationUserId(runId, role);
  const username = trim(input.username) || buildProductionVerificationUsername(runId, role);
  return {
    runId,
    role,
    email: email.toLowerCase(),
    userId,
    username,
    name: trim(input.name) || `BERT Verification ${role}`,
    password: trim(input.password),
    companyFolderId: trim(input.companyFolderId),
    masterSheetId: trim(input.masterSheetId),
    source: PRODUCTION_VERIFICATION_USER_SOURCE,
    marker: PRODUCTION_VERIFICATION_USER_MARKER,
    createdBy: PRODUCTION_VERIFICATION_USER_CREATED_BY,
  };
}

/**
 * Permission matrix derived from src/permissions.ts and server route guards.
 * Used by the production gate — do not weaken to pass tests.
 */
export const ROLE_PERMISSION_MATRIX = {
  Admin: {
    canListUsers: true,
    canPatchUsers: true,
    canDeleteUsers: true,
    canCreateVerificationUsers: true,
    canAccessWorkspaceSettings: true,
    canManageSchedules: true,
    canInviteUsers: true,
    canPromoteSelf: false,
  },
  Manager: {
    canListUsers: true,
    canPatchUsers: false,
    canDeleteUsers: false,
    canCreateVerificationUsers: false,
    canAccessWorkspaceSettings: false,
    canManageSchedules: true,
    canInviteUsers: true,
    canPromoteSelf: false,
  },
  Auditor: {
    canListUsers: true,
    canPatchUsers: false,
    canDeleteUsers: false,
    canCreateVerificationUsers: false,
    canAccessWorkspaceSettings: false,
    canManageSchedules: false,
    canInviteUsers: false,
    canPromoteSelf: false,
  },
};

export function expectedPermissionForRole(role = "", capability = "") {
  const canonical = canonicalStoredRole(role);
  return ROLE_PERMISSION_MATRIX[canonical]?.[capability] === true;
}

export function discoverRolesFromUsers(users = []) {
  const discovered = new Map();
  for (const user of users || []) {
    const stored = trim(user.role);
    const canonical = canonicalStoredRole(stored);
    if (!canonical) {
      continue;
    }
    discovered.set(canonical, {
      storedRole: stored || canonical,
      displayRole: displayRoleForStoredRole(stored || canonical),
      canonicalRole: canonical,
    });
  }
  return [...discovered.values()];
}
