import type { RoutedScreen } from "../types/navigation";
import { getNavDisplayLabel } from "../config/navPresentation";
import type { PresentedNavItem } from "../config/roleNavigation";

const PAGE_TITLES: Partial<Record<RoutedScreen, string>> = {
  dashboard: "Home",
  godmodeHome: "Home",
  auditCentre: "Audits",
  audits: "Audits",
  actions: "Actions",
  schedules: "Schedule",
  briefings: "Briefings",
  incidents: "Incidents",
  nonConformance: "NCRs",
  documents: "Document Library",
  documentControl: "Documents",
  documentDetail: "Document",
  healthSafety: "Health & Safety",
  healthSafetyCoshh: "COSHH",
  healthSafetyRiddor: "RIDDOR",
  loler: "Equipment",
  reports: "Reports",
  sync: "Sync Centre",
  users: "People",
  invites: "People",
  admin: "Administration",
  companies: "Sites and Areas",
  onboarding: "Company Setup",
  setup: "Administration",
  setupInitial: "Tablet / Kiosk",
  account: "Account",
  results: "Results",
  calendar: "Calendar",
  archive: "Archive",
  complete: "Audit",
  auditBuilder: "Audit builder",
  auditTemplateEdit: "Audit template",
  emailReminders: "Email reminders",
  documentTraining: "Document training",
  qmsReadiness: "QMS readiness",
  uiFoundation: "UI foundation",
};

export function getPageTitle(screen: RoutedScreen, options?: { setupOnlyShell?: boolean }): string {
  if (options?.setupOnlyShell) {
    return "Workspace setup";
  }
  return PAGE_TITLES[screen] ?? "bert";
}

export function getPageTitleFromNavItem(item: PresentedNavItem): string {
  return getNavDisplayLabel(item);
}
