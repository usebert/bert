/**
 * Unified invite token validation (GET /api/invites/:token) — no provisioning or Drive/Sheets health.
 */
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";
import {
  COMPANY_ONBOARDING_INVITE_TYPE,
  MAIN_NEED_OPTIONS,
  createInviteStoreApi,
  parseCompanyOnboardingUrlToken,
  resolveCompanyOnboardingInviteAccess,
} from "./company-onboarding.mjs";

export const COMPANY_USER_INVITE_TYPE = "COMPANY_USER";

const COMPANY_USER_TOKEN_RE = /^[a-f0-9]{48}$/i;

export function detectInviteTokenFormat(tokenParam) {
  const trimmed = String(tokenParam || "").trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes(".")) {
    return COMPANY_ONBOARDING_INVITE_TYPE;
  }
  if (COMPANY_USER_TOKEN_RE.test(trimmed)) {
    return COMPANY_USER_INVITE_TYPE;
  }
  return null;
}

function publicCompanyOnboardingInvite(record) {
  return {
    status: record.status,
    statusLabel: record.statusLabel || record.status,
    contactEmail: record.contactEmail || "",
    adminEmailDefault: record.contactEmail || "",
    provisionalCompanyName: record.provisionalCompanyName || "",
    provisionStatus: record.provisionStatus,
    provisionError: record.provisionError,
    canRetrySetup: record.status === "setup_failed" || record.provisionStatus === "failed",
  };
}

/** Token, type, expiry only — no master sheet / folder checks. */
export function resolveCompanyUserInviteTokenAccess(record, tokenId, { expectedType } = {}) {
  if (!tokenId || !COMPANY_USER_TOKEN_RE.test(tokenId)) {
    return { ok: false, httpStatus: 400, code: "INVITE_INVALID", error: "Invalid invite link." };
  }
  if (!record) {
    return { ok: false, httpStatus: 404, code: "INVITE_INVALID", error: "This invite link is not valid." };
  }
  if (record.kind === "new_company") {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVITE_WRONG_TYPE",
      error: "This link is not a company user invite. Use company onboarding instead.",
    };
  }
  if (record.kind !== "company_user") {
    return { ok: false, httpStatus: 400, code: "INVITE_WRONG_TYPE", error: "This link is not a company user invite." };
  }
  if (expectedType === COMPANY_ONBOARDING_INVITE_TYPE) {
    return { ok: false, httpStatus: 400, code: "INVITE_WRONG_TYPE", error: "This link is not a company onboarding invite." };
  }
  const email = String(record.email || "").trim().toLowerCase();
  if (isPlatformOwnerEmail(email, process.env)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "INVITE_INVALID",
      error: "The platform owner account cannot be used for invite flows.",
    };
  }
  if (record.consumedAt) {
    const status = record.provisionStatus || "succeeded";
    if (status === "failed") {
      return { ok: true, record, setupIncomplete: true, canRetrySetup: true };
    }
    return {
      ok: false,
      httpStatus: 410,
      code: "INVITE_ALREADY_USED",
      error: "This invite has already been used.",
    };
  }
  if (Date.now() > record.expiresAt) {
    return { ok: false, httpStatus: 410, code: "INVITE_EXPIRED", error: "This invite has expired." };
  }
  return { ok: true, record };
}

export function createGetInviteHandler(deps) {
  const { sessionDir, getInviteRecord } = deps;

  const onboardingStorePath = `${sessionDir}/company-onboarding-invites.json`;
  const onboardingStore = createInviteStoreApi(onboardingStorePath);

  return async function handleGetInvite(req, res) {
    const tokenParam = String(req.params.token || req.params.tokenId || "").trim();
    const expectedType = String(req.query?.expectedType || req.query?.type || "").trim();

    const format = detectInviteTokenFormat(tokenParam);
    if (!format) {
      return res.status(400).json({ ok: false, code: "INVITE_INVALID", error: "Invalid invite link." });
    }

    if (expectedType && expectedType !== format) {
      return res.status(400).json({
        ok: false,
        code: "INVITE_WRONG_TYPE",
        error: "This invite type does not match this page.",
      });
    }

    if (format === COMPANY_ONBOARDING_INVITE_TYPE) {
      const parsed = parseCompanyOnboardingUrlToken(tokenParam);
      const record = parsed ? onboardingStore.getInvite(parsed.inviteId) : null;
      const access = resolveCompanyOnboardingInviteAccess(record, parsed);
      if (!access.ok) {
        return res.status(access.httpStatus).json({
          ok: false,
          code: access.code,
          error: access.error,
        });
      }
      if (String(access.record.contactEmail || "").trim() && isPlatformOwnerEmail(access.record.contactEmail, process.env)) {
        return res.status(400).json({
          ok: false,
          code: "INVITE_INVALID",
          error: "The platform owner account cannot be used for company onboarding.",
        });
      }
      if (String(access.record.status || "").toLowerCase() === "invited") {
        onboardingStore.patchInvite(parsed.inviteId, { status: "started", startedAt: Date.now() });
      }
      return res.json({
        ok: true,
        type: COMPANY_ONBOARDING_INVITE_TYPE,
        invite: {
          ...publicCompanyOnboardingInvite(access.record),
          mainNeedOptions: MAIN_NEED_OPTIONS,
        },
      });
    }

    const recordRaw = getInviteRecord(tokenParam);
    const access = resolveCompanyUserInviteTokenAccess(recordRaw, tokenParam, { expectedType });
    if (!access.ok) {
      return res.status(access.httpStatus).json({
        ok: false,
        code: access.code,
        error: access.error,
      });
    }
    const record = access.record;
    return res.json({
      ok: true,
      type: COMPANY_USER_INVITE_TYPE,
      email: record.email,
      role: record.role,
      invitedBy: record.invitedBy || "",
      companyName: record.companyName || "",
      setupIncomplete: Boolean(access.setupIncomplete),
      canRetrySetup: access.canRetrySetup !== false,
    });
  };
}
