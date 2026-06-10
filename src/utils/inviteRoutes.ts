/** Path-based invite routes — COMPANY_ONBOARDING and COMPANY_USER only. */

export type InviteFlowType = "COMPANY_ONBOARDING" | "COMPANY_USER";

export type ParsedInviteRoute =
  | { flow: "COMPANY_ONBOARDING"; token: string }
  | { flow: "COMPANY_USER"; token: string }
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

/** Resolve flow from token shape when path and token disagree (mis-linked emails). */
export function resolveInviteFlowFromToken(token: string, pathFlow: InviteFlowType): InviteFlowType {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return pathFlow;
  }
  if (isCompanyUserInviteToken(trimmed)) {
    return "COMPANY_USER";
  }
  if (isCompanyOnboardingInviteToken(trimmed)) {
    return "COMPANY_ONBOARDING";
  }
  return pathFlow;
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
    if (!token) {
      return { flow: "invalid" };
    }
    return { flow: resolveInviteFlowFromToken(token, "COMPANY_ONBOARDING"), token };
  }

  const userMatch = pathname.match(COMPANY_USER_PATH_RE);
  if (userMatch?.[1]) {
    const token = decodeURIComponent(userMatch[1]).trim();
    if (!token) {
      return { flow: "invalid" };
    }
    return { flow: resolveInviteFlowFromToken(token, "COMPANY_USER"), token };
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
  const path = flow === "COMPANY_ONBOARDING" ? companyOnboardingPath(token) : companyUserInvitePath(token);
  window.history.replaceState({}, "", path);
}
