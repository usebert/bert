/**
 * Map English nav catalog labels / ids to Stage 1 i18n keys.
 * Internal English labels used by permission checks stay unchanged.
 */
import type { TFunction } from "i18next";

const LABEL_TO_KEY: Record<string, string> = {
  Dashboard: "nav.dashboard",
  Home: "nav.dashboard",
  Godmode: "nav.godmode",
  "Platform Setup": "nav.platformSetup",
  Companies: "nav.companies",
  "Company Onboarding": "nav.companyOnboarding",
  People: "nav.people",
  Users: "nav.users",
  Invites: "nav.invites",
  Settings: "nav.settings",
  "Audit Centre": "nav.auditCentre",
  Audits: "nav.audits",
  Results: "nav.results",
  "Google Forms": "nav.googleForms",
  Actions: "nav.actions",
  NCRs: "nav.nonConformance",
  Incidents: "nav.incidents",
  LOLER: "nav.loler",
  Calendar: "nav.calendar",
  Documents: "nav.documents",
  "Document Control": "nav.documentControl",
  Briefings: "nav.briefings",
  Schedules: "nav.schedules",
  Templates: "nav.templates",
  Reports: "nav.reports",
  "Reports / Diagnostics": "nav.reportsDiagnostics",
  "Upload & training": "nav.documentTraining",
  "Quality & Safety Hub": "nav.qmsReadiness",
  "Sync Centre": "nav.syncCentre",
  "Sync / Offline Uploads": "nav.syncCentre",
  Archive: "nav.archive",
  "Admin tools": "nav.adminTools",
  Onboarding: "nav.onboarding",
  Reminders: "nav.reminders",
  Account: "nav.account",
  "Tablet / Kiosk": "nav.tabletKiosk",
  More: "common.more",
  "Log out": "common.logOut",
  Incident: "nav.mobileIncident",
};

const ID_FALLBACK_KEY: Partial<Record<string, string>> = {
  dashboard: "nav.dashboard",
  godmodeHome: "nav.godmode",
  setup: "nav.platformSetup",
  companies: "nav.companies",
  onboarding: "nav.companyOnboarding",
  users: "nav.people",
  invites: "nav.people",
  settings: "nav.settings",
  auditCentre: "nav.auditCentre",
  audits: "nav.audits",
  results: "nav.results",
  googleForms: "nav.googleForms",
  actions: "nav.actions",
  nonConformance: "nav.nonConformance",
  incidents: "nav.incidents",
  loler: "nav.loler",
  calendar: "nav.calendar",
  documents: "nav.documents",
  documentControl: "nav.documentControl",
  briefings: "nav.briefings",
  schedules: "nav.schedules",
  reports: "nav.reports",
  documentTraining: "nav.documentTraining",
  qmsReadiness: "nav.qmsReadiness",
  sync: "nav.syncCentre",
  archive: "nav.archive",
  admin: "nav.adminTools",
  emailReminders: "nav.reminders",
  account: "nav.account",
  setupInitial: "nav.tabletKiosk",
};

export function translateNavLabel(
  t: TFunction,
  item: { id?: string; label: string },
  options?: { syncBadgeCount?: number },
): string {
  if (item.id === "sync") {
    const base = t("nav.syncCentre");
    const count = options?.syncBadgeCount ?? 0;
    return count > 0 ? `${base} (${count})` : base;
  }
  if (item.id === "auditCentre" && item.label === "Audits") {
    return t("nav.mobileAudits");
  }
  if (item.id === "incidents" && item.label === "Incident") {
    return t("nav.mobileIncident");
  }
  const fromLabel = LABEL_TO_KEY[item.label];
  if (fromLabel) {
    return t(fromLabel);
  }
  const fromId = item.id ? ID_FALLBACK_KEY[item.id] : undefined;
  if (fromId) {
    return t(fromId);
  }
  return item.label;
}
