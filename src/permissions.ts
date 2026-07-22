/**
 * Central role and navigation access rules for bert.
 * All boolean rules live here; App.tsx imports and uses these helpers only.
 */

import type { NavItemId, RoutedScreen } from "./types/navigation";

export type Role = "Master" | "Admin" | "Manager" | "Auditor";

export type { NavItemId, RoutedScreen };

export type HomeScreen = "dashboard" | "godmodeHome";

export interface RoleTaskPermissions {
  canManageUsers: boolean;
  canManageSchedules: boolean;
  canManageTemplates: boolean;
  canAssignActions: boolean;
  canVerifyActions: boolean;
  canExportReports: boolean;
  canRepairWorkspace: boolean;
  canRepairCompanyFolderStructure: boolean;
  canViewAllReports: boolean;
}

export function canAccessAdmin(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Company sites/areas setup — platform owner any company; company Admin own workspace only (UI scope). */
export function canManageAreas(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Control (admin) workspace tab — company Admin only; platform owner (Master) uses Onboarding only. */
export function canAccessControlScreen(role: Role) {
  return role === "Admin";
}

export function getHomeScreenForRole(role: Role): HomeScreen {
  return role === "Master" ? "godmodeHome" : "dashboard";
}

/** Platform operator / setup roles use the simplified paid-pilot menu. */
export function usesPilotOperatorNav(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Platform Setup nav and screen — Master (Godmode) only; not company Admin/Manager/Auditor. */
export function canAccessPilotSetup(role: Role) {
  return role === "Master";
}

/** All companies list — platform owner only (company Admin uses Workspace). */
export function canAccessPilotCompanies(role: Role) {
  return role === "Master";
}

export function canAccessPilotUsers(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Sidebar “People” / users & invites (company scope). */
export function canAccessUsersInvitesNav(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Company workspace settings (Control tab). */
export function canAccessWorkspaceNav(role: Role) {
  return role === "Admin";
}

/** Send onboarding forms / provision new company workspaces. */
export function canAccessCompanyOnboardingNav(role: Role) {
  return role === "Master";
}

/** Forms, checks, and audits hub. */
export function canAccessFormsChecksNav(role: Role) {
  return role === "Admin" || role === "Manager";
}

/** Unified Audit Centre sidebar — build, complete, forms, and results entry. */
export function canAccessAuditCentre(role: Role) {
  return (
    canAccessGoogleForms(role) ||
    canAccessFormsChecksNav(role) ||
    canAccessAuditsCentre(role) ||
    role === "Auditor"
  );
}

/** Master schedule / template tooling. */
export function canAccessMasterTemplatesNav(role: Role) {
  return role === "Master";
}

/** Platform diagnostics and readiness (not routine company reports). */
export function canAccessPlatformDiagnosticsNav(role: Role) {
  return role === "Master";
}

/** Tablet kiosk controls (Godmode on native; settings help on web). */
export function canAccessTabletKioskNav(role: Role) {
  return role === "Master";
}

/** Manager team / invites view. */
export function canAccessTeamNav(role: Role) {
  return role === "Manager";
}

export function canAccessPilotInvites(role: Role) {
  return canInviteUsers(role);
}

export function canAccessPilotSettings(role: Role) {
  return usesPilotOperatorNav(role) || role === "Manager";
}

/** Protected Initial Setup (Godmode page) — platform Master only. */
export function canAccessGodmodeInitialSetup(role: Role) {
  return role === "Master";
}

/** Company live schedule management in a linked workspace. */
export function canAccessSchedules(role: Role) {
  return role === "Admin" || role === "Manager";
}

/** Schedules screen — company schedules or Master template tooling (see nav rules). */
export function canAccessSchedulesScreen(role: Role) {
  return canRoleAccessNavItem(role, "schedules");
}

/** Policy / training document upload, distribution, and acknowledgment tracking. */
export function canAccessDocumentTraining(role: Role) {
  return role === "Admin" || role === "Manager";
}

/** Briefings — all signed-in company roles may view assigned briefings. */
export function canAccessBriefings(_role: Role) {
  return true;
}

/** Send briefings and open tracker — managers and admins (plus Master). */
export function canManageBriefings(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Full QMS readiness hub (registers, management review pack). */
export function canAccessQmsReadinessFull(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Operational QMS summary and links — no admin registers. */
export function canAccessQmsReadinessSummary(role: Role) {
  return role === "Manager";
}

/** QMS Readiness nav — hidden from Auditor. */
export function canAccessQmsReadinessNav(role: Role) {
  return canAccessQmsReadinessFull(role) || canAccessQmsReadinessSummary(role);
}

/** Master or Admin may use the in-app onboarding workspace tab (folder linking, user invites). */
export function canAccessAdminOnboardingWorkspace(role: Role) {
  return role === "Master" || role === "Admin";
}

/** In-app onboarding workspace tools (folder linking inside Workspace). */
export function canAccessOnboardingNav(role: Role) {
  return role === "Admin" || role === "Master";
}

export function canAccessResults(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canAccessGoogleForms(role: Role) {
  return role === "Master" || role === "Admin";
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
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canSubmitIncidents(_role: Role) {
  return true;
}

/** LOLER equipment compliance — all roles may view (Auditor sees assigned equipment only). */
export function canAccessLoler(_role: Role) {
  return true;
}

export function canAccessHealthSafetyOverview(role: Role) {
  return role === "Master" || canSubmitIncidents(role);
}

export function canAccessCoshh(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function canManageCoshh(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canAccessRiddor(role: Role) {
  return role === "Master" || canInvestigateIncidents(role) || role === "Auditor";
}

export function canManageRiddor(role: Role) {
  return role === "Master" || canInvestigateIncidents(role);
}

export function canAccessRiskAssessments(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function canCreateRiskAssessments(role: Role) {
  return canAccessRiskAssessments(role);
}

export function canEditRiskAssessments(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

export function canSubmitRiskAssessments(role: Role) {
  return canEditRiskAssessments(role);
}

export function canApproveRiskAssessments(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canReviewRiskAssessments(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canArchiveRiskAssessments(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Add / edit / assign / archive LOLER equipment — Master, Admin, Manager. */
export function canManageLoler(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Calendar events & reminders — all roles may view (Auditor sees assigned items only). */
export function canAccessCalendar(_role: Role) {
  return true;
}

/** Create / edit / archive calendar items — Master, Admin, Manager. */
export function canManageCalendar(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Document Control — all signed-in company roles may view (Auditor sees current only). */
export function canAccessDocumentControl(_role: Role) {
  return true;
}

/** Controlled Documents (ISO 9001) — all authenticated roles may open the module. */
export function canAccessDocuments(_role: Role) {
  return true;
}

/** Create / register controlled ISO documents — Master, Admin, Manager. */
export function canManageDocuments(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Create / revise / archive controlled documents — Master, Admin, Manager. */
export function canManageDocumentControl(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Approve / reject document revisions — Master, Admin, Manager. */
export function canApproveDocumentControl(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canInvestigateIncidents(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export { canReassignIncident, isEligibleIncidentReassignTarget } from "./utils/incidentAssignment";

export function canEditLegalName(role: Role) {
  return role === "Master" || role === "Admin";
}

/** Personal email reminders — any signed-in role. */
export function canAccessEmailReminders(_role: Role) {
  return true;
}

export function canAccessArchiveNav(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canRoleAccessNavItem(role: Role, itemId: NavItemId) {
  if (itemId === "setup") return canAccessPilotSetup(role);
  if (itemId === "setupInitial") return canAccessGodmodeInitialSetup(role);
  if (itemId === "companies") return canAccessPilotCompanies(role);
  if (itemId === "onboarding") return canAccessCompanyOnboardingNav(role);
  if (itemId === "users") return canAccessUsersInvitesNav(role);
  if (itemId === "invites") return canAccessPilotInvites(role) || canAccessTeamNav(role);
  if (itemId === "admin") return canAccessWorkspaceNav(role);
  if (itemId === "settings") return canAccessPilotSettings(role);
  if (itemId === "dashboard") return true;
  if (itemId === "godmodeHome") return role === "Master";
  if (itemId === "account") return true;
  if (itemId === "emailReminders") return canAccessEmailReminders(role);
  if (itemId === "schedules") {
    return canAccessMasterTemplatesNav(role) || canAccessSchedules(role);
  }
  if (itemId === "documentTraining") return canAccessDocumentTraining(role);
  if (itemId === "briefings") return canAccessBriefings(role);
  if (itemId === "qmsReadiness") return canAccessQmsReadinessNav(role);
  if (itemId === "reports") return canAccessReports(role) || canAccessPlatformDiagnosticsNav(role);
  if (itemId === "results") return canAccessResults(role);
  if (itemId === "auditCentre") return canAccessAuditCentre(role);
  if (itemId === "googleForms") return canAccessGoogleForms(role);
  if (itemId === "incidents") return canSubmitIncidents(role);
  if (itemId === "healthSafety") return canAccessHealthSafetyOverview(role);
  if (itemId === "healthSafetyCoshh") return canAccessCoshh(role);
  if (itemId === "healthSafetyRiddor") return canAccessRiddor(role);
  if (itemId === "riskAssessments") return canAccessRiskAssessments(role);
  if (itemId === "loler") return canAccessLoler(role);
  if (itemId === "calendar") return canAccessCalendar(role);
  if (itemId === "documentControl") return canAccessDocumentControl(role);
  if (itemId === "documents") return canAccessDocuments(role);
  if (itemId === "actions" || itemId === "nonConformance") return canAccessActions(role);
  if (itemId === "audits") return canAccessAuditsCentre(role) || canAccessFormsChecksNav(role) || role === "Auditor";
  if (itemId === "sync") {
    return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
  }
  if (itemId === "archive") return canAccessArchiveNav(role);
  return false;
}

export function getRolePermissions(role: Role): RoleTaskPermissions {
  return {
    canManageUsers: role === "Master" || role === "Admin",
    canManageSchedules: role === "Master" || role === "Admin" || role === "Manager",
    canManageTemplates: role === "Master" || role === "Admin" || role === "Manager",
    canAssignActions: role === "Master" || role === "Admin" || role === "Manager",
    canVerifyActions: role === "Master" || role === "Admin" || role === "Manager",
    canExportReports: role !== "Auditor",
    canRepairWorkspace: role === "Master",
    canRepairCompanyFolderStructure: role === "Master" || role === "Admin",
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

/** Live operational dashboard — Admin and Manager home only; never Auditor. */
export function shouldRenderLiveOperationalDashboard(role: Role) {
  return role === "Admin" || role === "Manager";
}

/** Any assignable company role may complete a check they are scheduled on. */
export function canCompleteAssignedCheck(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager" || role === "Auditor";
}

/** Assigned-check completion UI (My Checks list + wizard) for schedulable roles. */
export function usesAssignedChecksCompletionFlow(role: Role) {
  return canCompleteAssignedCheck(role);
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
  return canAccessSchedulesScreen(role);
}

export function canManageSchedules(role: Role) {
  return getRolePermissions(role).canManageSchedules;
}

export function canManageTemplates(role: Role) {
  return getRolePermissions(role).canManageTemplates;
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

export function canRepairCompanyFolderStructure(role: Role) {
  return getRolePermissions(role).canRepairCompanyFolderStructure;
}

/** Manager invites require explicit env flag on server and client (reserved for future use). */
export function managerInvitesEnabled() {
  return String(import.meta.env.VITE_ENABLE_MANAGER_INVITES || "").trim().toLowerCase() === "true";
}

/** Who may open invite workspace resolution — Master (Godmode), Company Admin, or Manager. */
export function canInviteUsers(role: Role) {
  return role === "Master" || role === "Admin" || role === "Manager";
}

/** Local-only demo payloads — Admin block or Master block in onboarding. */
export function canLoadDemoData(role: Role) {
  return role === "Admin" || role === "Master";
}

export function canViewAccount(role: Role) {
  return canRoleAccessNavItem(role, "account");
}

export function getRoleDisplayName(role: Role) {
  if (role === "Master") return "BERT Platform Owner";
  return role;
}

export function getCreatableRoles(role: Role): Role[] {
  if (role === "Master") {
    return ["Admin", "Manager", "Auditor"];
  }
  if (role === "Admin" || role === "Manager") {
    return ["Auditor"];
  }
  return [];
}

/** Company Admin or platform Master may edit active users on the Users tab. */
export function canManageCompanyMembers(role: Role): boolean {
  return role === "Master" || role === "Admin";
}

export type EditableCompanyMemberRole = "Admin" | "Manager" | "Auditor" | "User";

export function getEditableCompanyMemberRoles(role: Role): EditableCompanyMemberRole[] {
  if (canManageCompanyMembers(role)) {
    return ["Admin", "Manager", "Auditor", "User"];
  }
  return [];
}
