/** Path-based invite routes — COMPANY_ONBOARDING and COMPANY_USER only. */

import {
  INVITE_FLOW_COMPANY_ONBOARDING,
  INVITE_FLOW_COMPANY_USER,
  type InviteFlowType,
} from "./inviteFlowTypes";

export type { InviteFlowType };
export { INVITE_FLOW_COMPANY_ONBOARDING, INVITE_FLOW_COMPANY_USER, GODMODE_COMPANY_SETUP_FLOW } from "./inviteFlowTypes";

export type ParsedInviteRoute =
  | { flow: typeof INVITE_FLOW_COMPANY_ONBOARDING; token: string }
  | { flow: typeof INVITE_FLOW_COMPANY_USER; token: string }
  | { flow: "legacy_company_onboarding"; token: string }
  | { flow: "legacy_company_user"; token: string }
  | { flow: "invalid" };

const COMPANY_ONBOARDING_PATH_RE = /^\/onboarding\/company\/([^/]+)\/?$/i;
const COMPANY_USER_PATH_RE = /^\/invite\/company-user\/([^/]+)\/?$/i;
/** 48-char hex — company-user invite token (no dot). */
const COMPANY_USER_TOKEN_RE = /^[a-f0-9]{48}$/i;

export function isCompanyUserInviteToken(token: string): boolean {
  return COMPANY_USER_TOKEN_RE.test(String(token || "").trim());
}

export function isCompanyOnboardingInviteToken(token: string): boolean {
  return String(token || "").trim().includes(".");
}

/**
 * Legacy query-param links only — pick canonical path when old URLs omit route prefix.
 * Canonical paths (/onboarding/company/, /invite/company-user/) are authoritative and must not be overridden.
 */
export function resolveLegacyInviteFlow(token: string, hintedFlow: InviteFlowType): InviteFlowType {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return hintedFlow;
  }
  if (isCompanyUserInviteToken(trimmed)) {
    return INVITE_FLOW_COMPANY_USER;
  }
  if (isCompanyOnboardingInviteToken(trimmed)) {
    return INVITE_FLOW_COMPANY_ONBOARDING;
  }
  return hintedFlow;
}

export function companyOnboardingPath(token: string): string {
  return `/onboarding/company/${encodeURIComponent(token)}`;
}

export function companyUserInvitePath(token: string): string {
  return `/invite/company-user/${encodeURIComponent(token)}`;
}

/** Parse pathname + search for invite flows; legacy query params are surfaced for redirect. */
export function parseInviteRoute(location?: Pick<Location, "pathname" | "search">): ParsedInviteRoute {
  const pathname = String(location?.pathname || (typeof window !== "undefined" ? window.location.pathname : "")).trim();
  const search = String(location?.search || (typeof window !== "undefined" ? window.location.search : ""));

  const onboardingMatch = pathname.match(COMPANY_ONBOARDING_PATH_RE);
  if (onboardingMatch?.[1]) {
    const token = decodeURIComponent(onboardingMatch[1]).trim();
    return token ? { flow: INVITE_FLOW_COMPANY_ONBOARDING, token } : { flow: "invalid" };
  }

  const userMatch = pathname.match(COMPANY_USER_PATH_RE);
  if (userMatch?.[1]) {
    const token = decodeURIComponent(userMatch[1]).trim();
    return token ? { flow: INVITE_FLOW_COMPANY_USER, token } : { flow: "invalid" };
  }

  try {
    const params = new URLSearchParams(search);
    const legacyOnboarding = params.get("company-onboarding")?.trim();
    if (legacyOnboarding) {
      return { flow: "legacy_company_onboarding", token: legacyOnboarding };
    }
    const legacyInvite = params.get("invite")?.trim();
    if (legacyInvite) {
      return { flow: "legacy_company_user", token: legacyInvite };
    }
  } catch {
    /* ignore */
  }

  return { flow: "invalid" };
}

/** Replace URL with canonical path route (drops legacy query params). */
export function redirectToInvitePath(flow: InviteFlowType, token: string): void {
  const path = flow === INVITE_FLOW_COMPANY_ONBOARDING ? companyOnboardingPath(token) : companyUserInvitePath(token);
  window.history.replaceState({}, "", path);
}
