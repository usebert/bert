import type { RoutedScreen } from "../types/navigation";

/** One-paragraph contextual help for major workspaces. */
export const CONTEXTUAL_HELP: Partial<Record<RoutedScreen | "login", string>> = {
  login: "Sign in with your company username to access checks, actions and documents assigned to you.",
  dashboard: "See what needs attention today, track progress and jump to the most important work.",
  auditCentre: "Create inspections, assign auditors and monitor completion.",
  audits: "Create inspections, assign auditors and monitor completion.",
  actions: "Track corrective actions from audits and incidents.",
  documents: "Browse your company document library and reference files.",
  documentControl: "Manage controlled documents, revisions and approvals.",
  incidents: "Report incidents, investigate events and track follow-up actions.",
  nonConformance: "Record non-conformances, assign owners and verify closure.",
  loler: "Manage inspections and statutory equipment.",
  reports: "Review compliance performance and export reports for your team.",
  users: "Invite colleagues, manage roles and keep your team up to date.",
  invites: "Invite colleagues, manage roles and keep your team up to date.",
  briefings: "Distribute company communications and collect signatures.",
  schedules: "Plan recurring checks and assign auditors to each schedule.",
  companies: "Manage sites and areas so work is scoped to the right locations.",
  sync: "Review queued uploads, retry failed items and confirm everything is synced.",
  admin: "Configure company settings, integrations and workspace options.",
  onboarding: "Complete company setup steps so your team can start using BERT.",
  calendar: "See upcoming checks, deadlines and scheduled work in one calendar.",
  archive: "Browse archived records when you need historical reference.",
  account: "Review your profile, role and sign-in details.",
};

export function getContextualHelp(screen: string): string | undefined {
  return CONTEXTUAL_HELP[screen as keyof typeof CONTEXTUAL_HELP];
}
