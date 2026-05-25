/** Helper copy shown at the top of major shell areas (by section key). */
export const SECTION_INTROS = {
  platformSetup:
    "BERT-wide setup for Google, Drive, email, and diagnostics.",
  workspace: "Settings and details for this company only.",
  usersInvites: "Invite, resend, remove, or review users for this company.",
  companyOnboarding: "Send onboarding forms and create company workspaces from responses.",
  formsChecks: "Manage and complete company forms, checks, and audits.",
  reports: "Export compliance packs and review shared report inbox for this workspace.",
  tabletKiosk: "Prepare BERT for locked-down tablet use.",
  diagnostics: "Platform health, readiness, and technical diagnostics.",
  team: "People in your company workspace and invite status.",
  auditorToday: "Your assigned work and site context for today.",
  auditorChecks: "Checks and audits assigned to you.",
  auditorSubmit: "Report issues and submit evidence from the field.",
  auditorHistory: "Recently completed work and sync status.",
} as const;

export type SectionIntroKey = keyof typeof SECTION_INTROS;
