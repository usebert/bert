/** Explicit invite / setup flow identifiers — do not infer from button labels. */

export const INVITE_FLOW_COMPANY_ONBOARDING = "COMPANY_ONBOARDING" as const;
export const INVITE_FLOW_COMPANY_USER = "COMPANY_USER" as const;

/** In-app Godmode company workspace setup (not a public invite URL flow). */
export const GODMODE_COMPANY_SETUP_FLOW = "GODMODE_COMPANY_SETUP" as const;

export type InviteFlowType = typeof INVITE_FLOW_COMPANY_ONBOARDING | typeof INVITE_FLOW_COMPANY_USER;

export const INVITE_FLOW_API_QUERY: Record<InviteFlowType, string> = {
  [INVITE_FLOW_COMPANY_ONBOARDING]: "COMPANY_ONBOARDING",
  [INVITE_FLOW_COMPANY_USER]: "COMPANY_USER",
};
