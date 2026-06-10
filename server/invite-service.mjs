/**
 * Company-user invite create/complete helpers — token before email, permissions at route layer.
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
