import type { Role } from "../permissions";
import {
  canAccessAuditCentre,
  canAccessCompanyOnboardingNav,
  canAccessFormsChecksNav,
  canAccessMasterTemplatesNav,
  canAccessPlatformDiagnosticsNav,
  canAccessPilotSetup,
  canAccessPilotCompanies,
  canAccessSchedules,
  canAccessTabletKioskNav,
  canAccessTeamNav,
  canAccessUsersInvitesNav,
  canAccessWorkspaceNav,
  canRoleAccessNavItem,
} from "../permissions";
import type { NavItemId, RoutedScreen } from "../types/navigation";
import { navItems } from "./navItems";
import { MOBILE_BOTTOM_NAV_IDS } from "./navStructure";

export type RoleNavBucket = "master" | "companyAdmin" | "manager" | "auditor";

export type AdminPilotFocus = "companies" | "onboarding" | "users" | "invites";

export type PresentedNavItem = {
  id: NavItemId;
  label: string;
  icon: string;
  /** When set, AdminScreen scrolls/focuses this pilot area. */
  adminPilotFocus?: AdminPilotFocus;
};

const MASTER_NAV: PresentedNavItem[] = [
  { id: "godmodeHome", label: "Godmode", icon: "dashboard" },
  { id: "setup", label: "Platform Setup", icon: "spark" },
  { id: "companies", label: "Companies", icon: "clipboard", adminPilotFocus: "companies" },
  { id: "onboarding", label: "Company Onboarding", icon: "spark", adminPilotFocus: "companies" },
  { id: "users", label: "People", icon: "user", adminPilotFocus: "users" },
  { id: "schedules", label: "Templates", icon: "clock" },
  { id: "auditCentre", label: "Audit Centre", icon: "clipboard" },
  { id: "briefings", label: "Briefings", icon: "note" },
  { id: "loler", label: "LOLER", icon: "checklist" },
  { id: "calendar", label: "Calendar", icon: "clock" },
  { id: "documentControl", label: "Document Control", icon: "note" },
  { id: "results", label: "Results", icon: "checklist" },
  { id: "reports", label: "Reports / Diagnostics", icon: "chart" },
  { id: "sync", label: "Sync Centre", icon: "sync" },
  { id: "archive", label: "Archive", icon: "clipboard" },
  { id: "account", label: "Account", icon: "user" },
  { id: "setupInitial", label: "Tablet / Kiosk", icon: "shield" },
];

/** Product flow: Dashboard → People → Scheduling → Complete Work → Actions/NCRs → Reports */
const COMPANY_ADMIN_NAV: PresentedNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "users", label: "People", icon: "user", adminPilotFocus: "users" },
  { id: "schedules", label: "Schedules", icon: "clock" },
  { id: "auditCentre", label: "Audit Centre", icon: "clipboard" },
  { id: "briefings", label: "Briefings", icon: "note" },
  { id: "results", label: "Results", icon: "checklist" },
  { id: "actions", label: "Actions", icon: "warningTriangle" },
  { id: "incidents", label: "Incidents", icon: "warningTriangle" },
  { id: "nonConformance", label: "NCRs", icon: "checklist" },
  { id: "loler", label: "LOLER", icon: "checklist" },
  { id: "calendar", label: "Calendar", icon: "clock" },
  { id: "documentControl", label: "Document Control", icon: "note" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "sync", label: "Sync Centre", icon: "sync" },
  { id: "archive", label: "Archive", icon: "clipboard" },
  { id: "account", label: "Account", icon: "user" },
];

const MANAGER_NAV: PresentedNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "invites", label: "People", icon: "user", adminPilotFocus: "invites" },
  { id: "schedules", label: "Schedules", icon: "clock" },
  { id: "auditCentre", label: "Audit Centre", icon: "clipboard" },
  { id: "briefings", label: "Briefings", icon: "note" },
  { id: "results", label: "Results", icon: "checklist" },
  { id: "actions", label: "Actions", icon: "warningTriangle" },
  { id: "incidents", label: "Incidents", icon: "warningTriangle" },
  { id: "nonConformance", label: "NCRs", icon: "checklist" },
  { id: "loler", label: "LOLER", icon: "checklist" },
  { id: "calendar", label: "Calendar", icon: "clock" },
  { id: "documentControl", label: "Document Control", icon: "note" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "sync", label: "Sync Centre", icon: "sync" },
  { id: "archive", label: "Archive", icon: "clipboard" },
  { id: "account", label: "Account", icon: "user" },
];

const AUDITOR_NAV: PresentedNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "auditCentre", label: "Audit Centre", icon: "clipboard" },
  { id: "briefings", label: "Briefings", icon: "note" },
  { id: "incidents", label: "Incidents", icon: "warningTriangle" },
  { id: "loler", label: "LOLER", icon: "checklist" },
  { id: "calendar", label: "Calendar", icon: "clock" },
  { id: "documentControl", label: "Document Control", icon: "note" },
  { id: "sync", label: "Sync Centre", icon: "sync" },
  { id: "account", label: "Account", icon: "user" },
];

const MORE_BY_BUCKET: Record<RoleNavBucket, NavItemId[]> = {
  master: ["qmsReadiness", "emailReminders"],
  companyAdmin: [],
  manager: [],
  auditor: [],
};

/** Sidebar nav id for Complete Work / My Checks (Forms & checks page). */
export const COMPLETE_WORK_NAV_SCREEN_ID = "audits" as const satisfies NavItemId;

/** Internal routes grouped under Audit Centre in the sidebar. */
export const AUDIT_CENTRE_CHILD_SCREEN_IDS = [
  "audits",
  "googleForms",
  "auditBuilder",
  "auditTemplateEdit",
] as const satisfies readonly NavItemId[];

/** True when Audit Centre should appear selected in the shell nav. */
export function isAuditCentreNavActive(screen: RoutedScreen): boolean {
  return (
    screen === "auditCentre" ||
    screen === "complete" ||
    AUDIT_CENTRE_CHILD_SCREEN_IDS.includes(screen as (typeof AUDIT_CENTRE_CHILD_SCREEN_IDS)[number])
  );
}

/** True when the routed shell is showing the Complete Work assigned-checks list. */
export function isCompleteWorkListScreen(screen: RoutedScreen): boolean {
  return screen === COMPLETE_WORK_NAV_SCREEN_ID;
}

/** Dashboard Things To Do — lightweight assigned-checks preview only. */
export function shouldLoadDashboardAssignedChecksPreview(screen: RoutedScreen, role?: Role): boolean {
  if (screen !== "dashboard") {
    return false;
  }
  return role === "Admin" || role === "Manager" || role === "Auditor";
}

/** Complete Work / My Checks — full assigned-checks list. */
export function shouldLoadFullAssignedChecksScreen(screen: RoutedScreen, role?: Role): boolean {
  if (isCompleteWorkListScreen(screen)) {
    return true;
  }
  return role === "Master" && screen === "godmodeHome";
}

/** Screens that should load GET /api/me/assigned-checks (session-scoped; no client company id). */
export function shouldLoadAssignedChecksScreen(screen: RoutedScreen, role?: Role): boolean {
  return shouldLoadDashboardAssignedChecksPreview(screen, role) || shouldLoadFullAssignedChecksScreen(screen, role);
}

/** Dashboard To Do — lightweight briefing actions preview only. */
export function shouldLoadDashboardBriefingsPreview(screen: RoutedScreen, _role?: Role): boolean {
  return screen === "dashboard";
}

/** Briefings screen — full mine/tracker/send data. */
export function shouldLoadBriefingsScreen(screen: RoutedScreen): boolean {
  return screen === "briefings";
}

/** Screens that should load GET …/schedule-assignees (scheduler UI + action assignee picker). */
export function shouldLoadScheduleAssigneesScreen(screen: RoutedScreen): boolean {
  return screen === "schedules" || screen === "actions";
}

/** Screens that should load GET …/results (Results UI and Reports). */
export function shouldLoadCompanyResultsScreen(screen: RoutedScreen): boolean {
  return screen === "results" || screen === "reports";
}

/** Schedules page enriches last-completed from company results. */
export function shouldLoadSchedulesResultsEnrichment(screen: RoutedScreen): boolean {
  return screen === "schedules";
}

/** Screens that should load GET …/users (company members list). */
export function shouldLoadCompanyMembersScreen(screen: RoutedScreen): boolean {
  return screen === "users" || screen === "invites" || screen === "admin" || screen === "incidents" || screen === "reports";
}

/** Screens that should load GET …/archive. */
export function shouldLoadArchiveScreen(screen: RoutedScreen): boolean {
  return screen === "archive";
}

/** Screens that should load GET …/google-forms. */
export function shouldLoadGoogleFormsScreen(screen: RoutedScreen): boolean {
  return screen === "googleForms";
}

export function getRoleNavBucket(role: Role): RoleNavBucket {
  if (role === "Master") return "master";
  if (role === "Admin") return "companyAdmin";
  if (role === "Manager") return "manager";
  return "auditor";
}

function bucketNavTemplate(role: Role): PresentedNavItem[] {
  const bucket = getRoleNavBucket(role);
  if (bucket === "master") return MASTER_NAV;
  if (bucket === "companyAdmin") return COMPANY_ADMIN_NAV;
  if (bucket === "manager") return MANAGER_NAV;
  return AUDITOR_NAV;
}

function canPresentNavItem(role: Role, item: PresentedNavItem): boolean {
  if (item.id === "setupInitial" && item.label === "Tablet / Kiosk") {
    return canAccessTabletKioskNav(role);
  }
  if (item.id === "settings" && item.label === "Tablet / Kiosk") {
    return role === "Admin" || role === "Manager";
  }
  if (item.id === "setup") return canAccessPilotSetup(role);
  if (item.id === "companies") return canAccessPilotCompanies(role);
  if (item.id === "onboarding") return canAccessCompanyOnboardingNav(role);
  if (item.id === "users") return canAccessUsersInvitesNav(role);
  if (item.id === "invites") {
    if (item.label === "Team" || item.label === "People" || item.label === "Users & Invites") return canAccessTeamNav(role);
    return canAccessUsersInvitesNav(role);
  }
  if (item.id === "admin") return canAccessWorkspaceNav(role);
  if (item.id === "schedules" && item.label === "Templates") return canAccessMasterTemplatesNav(role);
  if (item.id === "schedules" && item.label === "Schedules") {
    return canAccessSchedules(role);
  }
  if (item.id === "reports" && item.label.includes("Diagnostics")) return canAccessPlatformDiagnosticsNav(role);
  if (item.id === "auditCentre") return canAccessAuditCentre(role);
  if (
    item.id === "audits" &&
    (item.label === "Checks" ||
      item.label === "Complete Work" ||
      item.label === "Forms & Checks" ||
      item.label === "My Checks")
  ) {
    return canAccessFormsChecksNav(role) || role === "Auditor";
  }
  return canRoleAccessNavItem(role, item.id);
}

/** Primary sidebar / tablet nav for the signed-in role (labels + order). */
export function getPresentedNavForRole(role: Role): PresentedNavItem[] {
  return bucketNavTemplate(role).filter((item) => canPresentNavItem(role, item));
}

export function getMoreNavIdsForRole(role: Role): NavItemId[] {
  const bucket = getRoleNavBucket(role);
  const primaryIds = new Set(getPresentedNavForRole(role).map((item) => item.id));
  return MORE_BY_BUCKET[bucket].filter((id) => !primaryIds.has(id) && canRoleAccessNavItem(role, id));
}

export type MobileNavEntry = {
  id: NavItemId | "__more__" | "__logout__";
  label: string;
  icon: string;
};

/** Short labels for field-role mobile bottom bar (fits narrow tab slots). */
const MOBILE_FIELD_NAV_LABELS: Partial<Record<NavItemId, string>> = {
  auditCentre: "Audits",
  incidents: "Incident",
};

function buildFieldRoleMobileBottomNav(role: Role, primary: PresentedNavItem[]): MobileNavEntry[] {
  const tabs = MOBILE_BOTTOM_NAV_IDS.filter((id) => id !== "more").flatMap((id) => {
    if (!canRoleAccessNavItem(role, id)) {
      return [];
    }
    const fromPrimary = primary.find((entry) => entry.id === id);
    const fromCatalog = navItems.find((entry) => entry.id === id);
    const label = MOBILE_FIELD_NAV_LABELS[id] ?? fromPrimary?.label ?? fromCatalog?.label ?? id;
    const icon = fromPrimary?.icon ?? fromCatalog?.icon ?? "dashboard";
    return [{ id, label, icon }];
  });
  return [
    ...tabs,
    { id: "__more__", label: "More", icon: "grid" },
    { id: "__logout__", label: "Log out", icon: "logOut" },
  ];
}

export function getMobileBottomNavForRole(role: Role): MobileNavEntry[] {
  const primary = getPresentedNavForRole(role);
  const bucket = getRoleNavBucket(role);
  if (bucket === "master") {
    const tabIds: NavItemId[] = ["godmodeHome", "setup", "companies", "users"];
    const tabs = tabIds.flatMap((id) => {
      const item = primary.find((entry) => entry.id === id);
      return item ? [{ id: item.id, label: item.label, icon: item.icon }] : [];
    });
    return [
      ...tabs,
      { id: "__more__", label: "More", icon: "grid" },
      { id: "__logout__", label: "Log out", icon: "logOut" },
    ];
  }
  return buildFieldRoleMobileBottomNav(role, primary);
}

export function resolveAdminPilotFocus(screen: NavItemId): AdminPilotFocus | undefined {
  if (screen === "companies") return "companies";
  if (screen === "onboarding") return "onboarding";
  if (screen === "users" || screen === "invites") return "users";
  return undefined;
}

/** Master screens that can run without an active company workspace. */
const MASTER_PLATFORM_GLOBAL_SCREENS: NavItemId[] = ["dashboard", "godmodeHome", "setup", "setupInitial", "reports", "onboarding"];

/** Company workspace required — excludes platform setup, diagnostics, and Godmode home. */
const MASTER_COMPANY_SCOPED_SCREENS: NavItemId[] = [
  "companies",
  "users",
  "invites",
  "admin",
  "schedules",
  "auditCentre",
  "googleForms",
  "results",
  "qmsReadiness",
  "loler",
  "calendar",
  "documentControl",
];

/** Master Godmode screens that require an active live company workspace context. */
export function isMasterCompanyScopedScreen(screen: NavItemId): boolean {
  return MASTER_COMPANY_SCOPED_SCREENS.includes(screen);
}

export function isPlatformSetupScreen(screen: NavItemId): boolean {
  return screen === "setup" || screen === "setupInitial";
}

export function isGodmodeLandingScreen(screen: NavItemId): boolean {
  return screen === "godmodeHome";
}

export function isMasterCompanyContextExemptScreen(screen: NavItemId): boolean {
  return MASTER_PLATFORM_GLOBAL_SCREENS.includes(screen);
}
