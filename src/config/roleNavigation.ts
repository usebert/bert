import type { Role } from "../permissions";
import {
  canAccessCompanyOnboardingNav,
  canAccessFormsChecksNav,
  canAccessMasterTemplatesNav,
  canAccessPlatformDiagnosticsNav,
  canAccessPilotSetup,
  canAccessPilotCompanies,
  canAccessTabletKioskNav,
  canAccessTeamNav,
  canAccessUsersInvitesNav,
  canAccessWorkspaceNav,
  canRoleAccessNavItem,
} from "../permissions";
import type { NavItemId } from "../types/navigation";

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
  { id: "users", label: "Users & Invites", icon: "user", adminPilotFocus: "users" },
  { id: "schedules", label: "Templates", icon: "clock" },
  { id: "reports", label: "Reports / Diagnostics", icon: "chart" },
  { id: "setupInitial", label: "Tablet / Kiosk", icon: "shield" },
];

const COMPANY_ADMIN_NAV: PresentedNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "actions", label: "Corrective Actions", icon: "warningTriangle" },
  { id: "admin", label: "Workspace", icon: "spark" },
  { id: "users", label: "Users & Invites", icon: "user", adminPilotFocus: "users" },
  { id: "audits", label: "Forms & Checks", icon: "clipboard" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "settings", label: "Tablet / Kiosk", icon: "shield" },
];

const MANAGER_NAV: PresentedNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "audits", label: "Forms & Checks", icon: "clipboard" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "invites", label: "Team", icon: "user", adminPilotFocus: "invites" },
];

const AUDITOR_NAV: PresentedNavItem[] = [
  { id: "dashboard", label: "Today", icon: "dashboard" },
  { id: "audits", label: "My Checks", icon: "clipboard" },
  { id: "incidents", label: "Submit", icon: "camera" },
  { id: "sync", label: "History", icon: "sync" },
];

const MORE_BY_BUCKET: Record<RoleNavBucket, NavItemId[]> = {
  master: ["qmsReadiness", "account", "emailReminders"],
  companyAdmin: ["qmsReadiness", "nonConformance", "incidents", "schedules", "documentTraining", "sync", "account", "emailReminders"],
  manager: ["qmsReadiness", "actions", "nonConformance", "incidents", "schedules", "documentTraining", "sync", "account", "emailReminders"],
  auditor: ["account"],
};

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
  if (item.id === "invites" && item.label === "Team") return canAccessTeamNav(role);
  if (item.id === "invites") return canAccessUsersInvitesNav(role);
  if (item.id === "admin") return canAccessWorkspaceNav(role);
  if (item.id === "schedules" && item.label === "Templates") return canAccessMasterTemplatesNav(role);
  if (item.id === "reports" && item.label.includes("Diagnostics")) return canAccessPlatformDiagnosticsNav(role);
  if (item.id === "audits" && (item.label === "Forms & Checks" || item.label === "My Checks")) {
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

export function getMobileBottomNavForRole(role: Role): MobileNavEntry[] {
  const primary = getPresentedNavForRole(role);
  const bucket = getRoleNavBucket(role);
  if (bucket === "auditor") {
    return [
      ...primary.slice(0, 4).map((item) => ({ id: item.id, label: item.label, icon: item.icon })),
      { id: "__more__", label: "More", icon: "grid" },
      { id: "__logout__", label: "Log out", icon: "logOut" },
    ];
  }
  if (bucket === "master" || bucket === "companyAdmin") {
    const tabIds: NavItemId[] =
      bucket === "master"
        ? ["godmodeHome", "setup", "companies", "users"]
        : ["dashboard", "actions", "audits", "users"];
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
  return [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    ...primary.filter((item) => item.id !== "dashboard").slice(0, 2).map((item) => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
    })),
    { id: "__more__", label: "More", icon: "grid" },
    { id: "__logout__", label: "Log out", icon: "logOut" },
  ];
}

export function resolveAdminPilotFocus(screen: NavItemId): AdminPilotFocus | undefined {
  if (screen === "companies") return "companies";
  if (screen === "onboarding") return "onboarding";
  if (screen === "users" || screen === "invites") return "users";
  return undefined;
}

/** Company workspace required — excludes platform setup, diagnostics, and Godmode home. */
const MASTER_COMPANY_SCOPED_SCREENS: NavItemId[] = [
  "companies",
  "users",
  "schedules",
  "qmsReadiness",
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
