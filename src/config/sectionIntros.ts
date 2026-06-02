/** Helper copy shown at the top of major shell areas (by section key). */
export const SECTION_INTROS = {
  platformSetup: "Connect Google, email, and tablet options for the whole platform.",
  companies: "Pick a company workspace and finish its setup.",
  workspace: "Name, folders, and settings for this company only.",
  usersInvites: "Invite people and see who has joined.",
  companyOnboarding: "Send a single-use app onboarding link; BERT provisions Drive, master sheet, and the first admin when the customer submits.",
  companiesInviteHelper:
    "To email a new company setup form, open Company Onboarding in the menu.",
  formsChecks: "Manage form and check templates. Schedules control when checks run.",
  correctiveActions: "Follow up on failed findings, add evidence, and close items.",
  reports: "Create packs and see reports shared with your team.",
  tabletKiosk: "Lock a tablet to checks-only mode for the field.",
  diagnostics: "Platform health and technical checks (Master only).",
  team: "People in your company and invite status.",
  auditorToday: "Checks assigned to you for today.",
  auditorChecks: "All checks assigned to you.",
  auditorSubmit: "Report a problem or near miss from the field.",
  auditorHistory: "Checks and reports you have already sent.",
  qmsReadiness: "Quality and safety records in one place.",
} as const;

export type SectionIntroKey = keyof typeof SECTION_INTROS;
