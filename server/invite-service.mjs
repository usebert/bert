/**
 * inviteService — folder-first company context; Users tab write only on acceptance.
 * Invites live in the server invite store (not Users tab rows on create).
 */
import {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  canRevokeInvite,
  canViewInvite,
  COMPANY_USER_INVITE_TYPE,
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "../shared/company-invite-permissions.mjs";
import { assertCompanyInviteReady } from "./company-invite-readiness.mjs";
import { resolveCompanyUserInviteTokenAccess } from "./invite-routes.mjs";
import {
  defaultAccessLevelForRole,
  findCompanyUsersTabRow,
  normalizeUserStatus,
  readCompanyUsersTabRecord,
  sanitizeUserRecordForClient,
} from "./company-users.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { sanitizeCompanyFolderId } from "../shared/google-drive-id.mjs";
import { inviteAccessLevelForRole } from "../shared/schedule-assignees.mjs";
import {
  authenticateCompanyUserLogin,
  hashPassword,
  rebuildAuthIndexFromUsersTab,
  verifyUserPasswordFromUsersTab,
} from "./user-auth-service.mjs";

export {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  canRevokeInvite,
  canViewInvite,
  COMPANY_USER_INVITE_TYPE,
  isCompanyInviteActor,
  isGodmodeInviteSession,
};

const LIGHT_RESOLVE_OPTS = {
  ensureTabsSync: false,
  ensureStructure: false,
  createIfMissing: false,
  skipFolderPlacementCheck: true,
  preferFolderResolution: true,
};

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function resolverDeps(deps = {}) {
  if (typeof deps.getCompanyResolverDeps === "function") {
    return deps.getCompanyResolverDeps();
  }
  return deps;
}

function resolveFolderContextFn(deps = {}) {
  return typeof deps.resolveCompanyFromFolder === "function"
    ? deps.resolveCompanyFromFolder
    : resolveCompanyFromFolder;
}

export async function assertCompanyLiveForInvite(auth, deps, companyId, context = {}) {
  return assertCompanyInviteReady(auth, deps, companyId, context);
}

export function resolveCompanyUserInviteAccess(record, tokenId) {
  return resolveCompanyUserInviteTokenAccess(record, tokenId, {
    expectedType: COMPANY_USER_INVITE_TYPE,
  });
}

/** True when an existing company-user invite token can be resent as-is (pending, not expired). */
export function isCompanyUserInviteActiveForResend(record) {
  if (!record || record.kind !== "company_user") {
    return false;
  }
  if (record.consumedAt) {
    return false;
  }
  return Date.now() <= Number(record.expiresAt || 0);
}

export { isCompanyUserInviteActiveForResend as canResendCompanyUserInvite };

export function buildAuditorInviteBody(companyId, body = {}, registryRecord = null) {
  const id = String(companyId || "").trim();
  return {
    ...body,
    role: String(body.role || "Auditor").trim() || "Auditor",
    companyId: id,
    companyFolderId: String(body.companyFolderId || registryRecord?.rootFolderId || id).trim(),
    masterSheetId: String(body.masterSheetId || registryRecord?.masterSheetId || "").trim(),
    companyName: String(body.companyName || registryRecord?.companyName || "").trim(),
  };
}

/** inviteService API — build token payload for createInvite (no Users tab write on create). */
export function buildCompanyUserInvitePayload(input = {}) {
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  return {
    kind: "company_user",
    inviteType: "COMPANY_USER",
    status: "PENDING",
    email: String(input.email || "").trim().toLowerCase(),
    role: String(input.role || "Auditor").trim() || "Auditor",
    accessLevel: String(input.accessLevel || "").trim(),
    companyAreas: String(input.companyAreas || "").trim(),
    invitedBy: String(input.invitedBy || "").trim(),
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId: String(input.masterSheetId || "").trim(),
    companyName: String(input.companyName || "").trim(),
  };
}

/** inviteService API — createInvite stores token only; routes pass deps.createInviteRecord. */
export function createInvite(deps, input = {}) {
  if (typeof deps?.createInviteRecord !== "function") {
    throw new Error("createInviteRecord dependency is required.");
  }
  const payload = buildCompanyUserInvitePayload(input);
  return deps.createInviteRecord(payload);
}

/** Pending company-user invites only — not active Users tab members. */
export function isPendingCompanyUserInvite(record = {}) {
  if (!record || record.kind !== "company_user") {
    return false;
  }
  if (record.consumedAt) {
    return false;
  }
  const status = String(record.status || "PENDING").trim().toUpperCase();
  return status === "PENDING";
}

export function sanitizeCompanyUserInviteForClient(entry = {}) {
  const record = entry.record || entry;
  const id = String(entry.id || entry.tokenId || "").trim();
  return {
    id,
    tokenId: id,
    inviteType: COMPANY_USER_INVITE_TYPE,
    kind: "company_user",
    email: record.email || "",
    role: record.role || "",
    invitedBy: record.invitedBy || "",
    companyId: record.companyId || record.companyFolderId || "",
    companyFolderId: record.companyFolderId || record.companyId || "",
    companyName: record.companyName || "",
    masterSheetId: record.masterSheetId || "",
    status: isPendingCompanyUserInvite(record) ? "PENDING" : record.status || "PENDING",
    pending: isPendingCompanyUserInvite(record),
    createdAt: record.createdAt || null,
    expiresAt: record.expiresAt || null,
    consumedAt: record.consumedAt || null,
  };
}

export function listPendingCompanyUserInvites(records = []) {
  return records
    .filter((entry) => isPendingCompanyUserInvite(entry.record || entry))
    .map((entry) => sanitizeCompanyUserInviteForClient(entry));
}

/**
 * Folder-first company context for invite create/accept — no setup, health, or registry repair.
 */
export async function resolveInviteCompanyContext(auth, deps = {}, invite = {}) {
  const companyFolderId = sanitizeCompanyFolderId(invite.companyFolderId || invite.companyId || "");
  if (!auth) {
    return {
      ok: false,
      reason: "google_not_connected",
      httpStatus: 503,
      code: "google_not_connected",
      message: "Connect Google Workspace before continuing.",
    };
  }
  if (!companyFolderId) {
    return {
      ok: false,
      reason: "company_folder_missing",
      httpStatus: 409,
      code: "INVITE_COMPANY_LINK_MISSING",
      message: "This invite is missing a company folder link.",
    };
  }

  const resolveFn = resolveFolderContextFn(deps);
  const resolved = await resolveFn(auth, resolverDeps(deps), companyFolderId, LIGHT_RESOLVE_OPTS);
  if (!resolved?.ok || !resolved.masterSheetId) {
    return {
      ok: false,
      reason: resolved?.reasonCode || "company_context_failed",
      httpStatus: 409,
      code: resolved?.reasonCode || "INVITE_COMPANY_LINK_MISSING",
      message:
        resolved?.userMessage ||
        "The company workbook for this invite could not be resolved. Ask your administrator to send a new invite.",
      resolved,
    };
  }

  return {
    ok: true,
    companyContext: {
      masterSheetId: resolved.masterSheetId,
      companyFolderId: resolved.companyFolderId,
      companyId: resolved.companyId || resolved.companyFolderId,
      companyName: String(resolved.companyName || invite.companyName || "").trim(),
    },
    resolved,
  };
}

function resolveInviteUserDeps(deps) {
  if (typeof deps?.getCompanyUsersDeps === "function") {
    return deps.getCompanyUsersDeps();
  }
  return deps || {};
}

/**
 * Invite acceptance — validate context, write ACTIVE Users tab row by header, verify read-back, rebuild auth index.
 */
export async function completeCompanyUserInviteAcceptance(auth, invite, formData = {}, deps = {}) {
  const email = safeLower(invite?.email);
  const role = String(invite?.role || "").trim();
  const fullName = String(formData.fullName || formData.name || "").trim();
  const password = String(formData.password || "");
  const confirmPassword = String(formData.confirmPassword || "");

  if (!email || !role || !fullName || password.length < 8) {
    return { ok: false, reason: "missing_fields", httpStatus: 400 };
  }
  if (confirmPassword && confirmPassword !== password) {
    return { ok: false, reason: "password_mismatch", httpStatus: 400 };
  }

  const contextResult = await resolveInviteCompanyContext(auth, deps, invite);
  if (!contextResult.ok) {
    return contextResult;
  }

  const companyContext = contextResult.companyContext;
  const userDeps = resolveInviteUserDeps(deps);
  const writeByHeaders = userDeps.writeUsersTabRecordByHeaders;
  if (typeof writeByHeaders !== "function") {
    return { ok: false, reason: "write_helper_missing", httpStatus: 503 };
  }

  const existing = await findCompanyUsersTabRow(auth, companyContext.masterSheetId, email, userDeps).catch(
    () => null,
  );
  const createdAt =
    String(existing?.createdAt || invite?.createdAt || invite?.sentAt || "").trim() ||
    new Date().toISOString();
  const userId =
    String(existing?.userId || "").trim() ||
    `app-${email.replace(/[^a-z0-9]+/gi, "-")}-${role.toLowerCase()}`;
  const accessLevel =
    String(invite?.accessLevel || "").trim() ||
    defaultAccessLevelForRole(role) ||
    inviteAccessLevelForRole(role);
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);

  const writeResult = await writeByHeaders(
    auth,
    companyContext.masterSheetId,
    {
      "User ID": userId,
      Email: email,
      Name: fullName,
      Role: role,
      AccessLevel: accessLevel,
      CompanyAreas: String(invite?.companyAreas || "").trim(),
      Company: companyContext.companyName,
      CompanyId: companyContext.companyFolderId,
      CompanyFolderId: companyContext.companyFolderId,
      Status: "ACTIVE",
      PasswordHash: passwordHash,
      PasswordUpdatedAt: now,
      CreatedAt: createdAt,
      UpdatedAt: now,
      InvitedAt: createdAt,
      "Created By": String(invite?.invitedBy || "").trim(),
      "Sync Status": "Synced",
    },
    userDeps,
    { companyContext, validate: false },
  );

  if (!writeResult?.ok) {
    return {
      ok: false,
      reason: writeResult?.reason || "write_failed",
      httpStatus: 500,
      code: "USER_ACCOUNT_CREATE_FAILED",
      message: "We couldn't finish creating your account. Please try again.",
    };
  }

  const verifyResult = await verifyUserPasswordFromUsersTab(
    auth,
    companyContext,
    email,
    password,
    userDeps,
  );
  if (!verifyResult.ok || !verifyResult.verifyOk) {
    return {
      ok: false,
      reason: verifyResult.reason || "verify_read_back_failed",
      httpStatus: 500,
      code: "USER_ACCOUNT_CREATE_FAILED",
      message: "We couldn't finish creating your account. Please try again.",
    };
  }

  const rec =
    verifyResult.row ||
    (await readCompanyUsersTabRecord(auth, companyContext.masterSheetId, email, userDeps).catch(() => null));
  if (!rec || normalizeUserStatus(rec.status) !== "ACTIVE") {
    return {
      ok: false,
      reason: "inactive",
      httpStatus: 500,
      code: "USER_ACCOUNT_CREATE_FAILED",
      message: "We couldn't finish creating your account. Please try again.",
    };
  }

  if (deps.authIndex) {
    void rebuildAuthIndexFromUsersTab(auth, deps, companyContext, deps.authIndex, email).catch((error) => {
      console.warn("[invite] deferred auth index rebuild failed", error);
    });
  }

  return {
    ok: true,
    companyContext,
    user: sanitizeUserRecordForClient(rec),
    accessLevel,
    loginProbe: async () =>
      authenticateCompanyUserLogin(auth, deps, {
        email,
        password,
        masterSheetId: companyContext.masterSheetId,
        companyFolderId: companyContext.companyFolderId,
      }),
  };
}

/** inviteService API — write Users tab row before marking invite consumed. */
export async function completeInvite(invite, formData, deps, auth) {
  return completeCompanyUserInviteAcceptance(auth, invite, formData, deps);
}
