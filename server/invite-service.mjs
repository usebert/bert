/**
 * Company-user invite create/complete helpers — token before email, permissions at route layer.
 * Users tab write happens only on completeInvite (before success response).
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
import { resolveCompanyById } from "./company-registry-service.mjs";
import { resolveCompanyUserInviteTokenAccess } from "./invite-routes.mjs";
import { completeInviteToUserRow } from "./company-user-sheet-flow.mjs";

export {
  canCreateCompanyInvite,
  canInviteCompanyUsers,
  canRevokeInvite,
  canViewInvite,
  COMPANY_USER_INVITE_TYPE,
  isCompanyInviteActor,
  isGodmodeInviteSession,
};

export async function assertCompanyLiveForInvite(auth, deps, companyId, context = {}) {
  return assertCompanyInviteReady(auth, deps, companyId, context);
}

export function resolveCompanyUserInviteAccess(record, tokenId) {
  return resolveCompanyUserInviteTokenAccess(record, tokenId, {
    expectedType: COMPANY_USER_INVITE_TYPE,
  });
}

/**
 * Prepare body for auditor invite on a company — role fixed to Auditor for company actors.
 */
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

/** Create invite — token is always created; email failure never blocks token. */
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

/** inviteService API — write Users tab row before marking invite consumed. */
export { completeInviteToUserRow as completeInvite };
