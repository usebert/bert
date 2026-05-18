/**
 * Central role and navigation access rules for bert.
 * All boolean rules live here; App.tsx imports and uses these helpers only.
 */

import type { NavItemId, RoutedScreen } from "./types/navigation";

export type Role = "Master" | "Admin" | "Manager" | "Auditor";

export type { NavItemId, RoutedScreen };

export type HomeScreen = Extract<NavItemId, "dashboard" | "onboarding">;

export interface RoleTaskPermissions {
  canManageUsers: boolean;
  canManageSchedules: boolean;
  canManageTemplates: boolean;
  canAssignActions: boolean;
  canVerifyActions: boolean;
  canExportReports: boolean;
  canRepairWorkspace: boolean;
  canViewAllReports: boolean;
}

export function canAccessAdmin(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Control (admin) workspace tab — company Admin only; platform owner (Master) uses Onboarding only. */
export function canAccessControlScreen(role: Role) {
  return role === "Admin";
}

export function getHomeScreenForRole(role: Role): HomeScreen {
  if (role === "Master") {
    return "onboarding";
  }
  return "dashboard";
}

export function canAccessSchedules(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Policy / training document upload, distribution, and acknowledgment tracking. */
export function canAccessDocumentTraining(role: Role) {
  return role === "Admin" || role === "Manager";
}

/** Master or Admin may use the in-app onboarding workspace tab (folder linking, user invites). */
export function canAccessAdminOnboardingWorkspace(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Dedicated Onboarding menu — company Admin and platform owner (Master) setup. */
export function canAccessOnboardingNav(role: Role) {
  return role === "Admin" || role === "Master";
}

export function canAccessReports(role: Role) {
  return role !== "Auditor";
}

export function canAccessActions(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function canAccessCompletedNcrReports(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canAccessAuditsCentre(role: Role) {
  return role !== "Auditor";
}

export function canSubmitIncidents(_role: Role) {
  return true;
}

export function canInvestigateIncidents(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canEditLegalName(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Personal email reminders — any signed-in role. */
export function canAccessEmailReminders(_role: Role) {
  return true;
}

export function canRoleAccessNavItem(role: Role, itemId: NavItemId) {
  if (role === "Master") {
    return itemId === "onboarding" || itemId === "account" || itemId === "emailReminders";
  }
  if (itemId === "emailReminders") return canAccessEmailReminders(role);
  if (itemId === "admin") return canAccessControlScreen(role);
  if (itemId === "onboarding") return canAccessOnboardingNav(role);
  if (itemId === "schedules") return canAccessSchedules(role);
  if (itemId === "documentTraining") return canAccessDocumentTraining(role);
  if (itemId === "reports") return canAccessReports(role);
  if (itemId === "incidents") return canSubmitIncidents(role);
  if (itemId === "actions" || itemId === "nonConformance") return canAccessActions(role);
  if (itemId === "audits") return canAccessAuditsCentre(role);
  return true;
}

export function getRolePermissions(role: Role): RoleTaskPermissions {
  return {
    canManageUsers: role === "Master" || role === "Admin",
    canManageSchedules: role === "Master" || role === "Admin" || role === "Manager",
    canManageTemplates: role === "Master" || role === "Admin",
    canAssignActions: role === "Master" || role === "Admin" || role === "Manager",
    canVerifyActions: role === "Master" || role === "Admin" || role === "Manager",
    canExportReports: role !== "Auditor",
    canRepairWorkspace: role === "Master",
    canViewAllReports: role !== "Auditor",
  };
}

/** Dashboard tab — matches `canRoleAccessNavItem(role, "dashboard")`. */
export function canViewDashboard(role: Role) {
  return canRoleAccessNavItem(role, "dashboard");
}

/** Full Audit centre (traffic board, access matrix) — same as `canAccessAuditsCentre`. */
export function canViewAudits(role: Role) {
  return canAccessAuditsCentre(role);
}

/** Admin-side audit setup / management — same gate as full Audit centre (excludes Auditor-only field flow). */
export function canCreateAudit(role: Role) {
  return canAccessAuditsCentre(role);
}

/** Admin-side audit management — same gate as `canCreateAudit`. */
export function canEditAudit(role: Role) {
  return canAccessAuditsCentre(role);
}

export function canCompleteAuditAsAuditor(role: Role) {
  return role === "Auditor";
}

/** Manager/Admin completion & sign-off path — non-Auditor roles only. */
export function canSubmitAuditForReview(role: Role) {
  return canAccessAuditsCentre(role);
}

export function canViewActions(role: Role) {
  return canAccessActions(role);
}

export function canCreateAction(role: Role) {
  return getRolePermissions(role).canAssignActions;
}

export function canEditAction(role: Role) {
  return getRolePermissions(role).canAssignActions;
}

export function canVerifyAction(role: Role) {
  return getRolePermissions(role).canVerifyActions;
}

export function canViewNcr(role: Role) {
  return canAccessActions(role);
}

export function canCreateNcr(role: Role) {
  return canAccessActions(role);
}

export function canEditNcr(role: Role) {
  return canAccessActions(role);
}

export function canCloseNcr(role: Role) {
  return canAccessActions(role);
}

export function canViewIncidents(role: Role) {
  return canRoleAccessNavItem(role, "incidents");
}

export function canCreateIncident(_role: Role) {
  return canSubmitIncidents(_role);
}

/** Singular alias — delegates to `canInvestigateIncidents` (same rules). */
export function canInvestigateIncident(role: Role) {
  return canInvestigateIncidents(role);
}

export function canViewSchedules(role: Role) {
  return canAccessSchedules(role);
}

export function canManageSchedules(role: Role) {
  return getRolePermissions(role).canManageSchedules;
}

export function canViewReports(role: Role) {
  return canAccessReports(role);
}

export function canExportReports(role: Role) {
  return getRolePermissions(role).canExportReports;
}

export function canViewSyncCentre(role: Role) {
  return canRoleAccessNavItem(role, "sync");
}

/** Matches Sync Centre UI: retry is available to anyone who can reach the screen via nav rules. */
export function canRetrySyncItem(role: Role) {
  return canViewSyncCentre(role);
}

/** Company Control workspace tab — Admin only. */
export function canViewControl(role: Role) {
  return canAccessControlScreen(role);
}

export function canRepairWorkspace(role: Role) {
  return getRolePermissions(role).canRepairWorkspace;
}

/** Company user invites (Admin/Master) plus Manager’s scoped invites. */
export function canInviteUsers(role: Role) {
  return canAccessAdmin(role) || role === "Manager";
}

/** Local-only demo payloads — Admin block or Master block in onboarding. */
export function canLoadDemoData(role: Role) {
  return role === "Admin" || role === "Master";
}

export function canViewAccount(role: Role) {
  return canRoleAccessNavItem(role, "account");
}

export function getRoleDisplayName(role: Role) {
  return role === "Master" ? "Platform owner" : role;
}

export function getCreatableRoles(role: Role): Role[] {
  if (role === "Master" || role === "Admin") {
    return ["Admin", "Manager", "Auditor"];
  }
  if (role === "Manager") {
    return ["Manager", "Auditor"];
  }
  return [];
}
