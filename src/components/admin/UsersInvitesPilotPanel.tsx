import { useMemo, useState, type ComponentType } from "react";
import type { Role } from "../../permissions";
import {
  COMPANY_INVITES_LOADING_MESSAGE,
  COMPANY_INVITES_USER_MESSAGE,
} from "../../services/companyInviteListService";
import {
  COMPANY_MEMBERS_LOADING_MESSAGE,
  COMPANY_MEMBERS_USER_MESSAGE,
} from "../../services/companyUserService";
import { canShowCompanyMembersDiagnostics } from "../../utils/debugUiVisibility";
import { canShowTechnicalUi } from "../../utils/uxDeclutter";
import { CompanyMembersDiagnosticsPanel } from "../CompanyMembersDiagnosticsPanel";
import {
  canCreateCompanyInvite,
  canRevokeInvite,
  canViewInvite,
  COMPANY_USER_INVITE_TYPE,
  INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE,
  INVITE_MANAGE_AUDITOR_ONLY_MESSAGE,
  INVITE_ROLE_FORBIDDEN_MESSAGE,
  isCompanyInviteActor,
  isGodmodeInviteSession,
} from "../../utils/companyWorkspaceInvite";
import { DangerActionButton } from "../DangerActionButton";
import { ActiveUserCard } from "./ActiveUserCard";
import { EmptyPanel, MiniMetric, SectionHeader } from "../dashboard/DashboardPrimitives";
import { canManageCompanyMembers } from "../../permissions";
import { canArchiveCompanyMember } from "../../utils/archivePermissions";
import type { CompanyMember } from "../../services/companyUserService";
import type { StructureEntity } from "../../services/companyStructureService";
import { InviteStatusLegend } from "../InviteStatusLegend";
import { WhatHappensNextPanel } from "../WhatHappensNextPanel";
import { CompanyStructurePanel } from "./CompanyStructurePanel";
import { SitesAreasPanel } from "./SitesAreasPanel";
import type { AdminScreenProps, CompanyUserInviteEmailResult, UserInvite } from "../../types/adminScreenProps";
import { COMPANY_NO_LONGER_AVAILABLE_MESSAGE } from "../../utils/companyFolderContext";
import {
  formatInviteStatusLabel,
  formatUserRoleLabel,
  getInviteStatusHelp,
  inviteStatusBadgeClass,
  isLegacyInviteRowId,
  isStaleOrIncompleteInviteStatus,
} from "../../utils/inviteStatusDisplay";
import { accessScopeFromPersonRecord, resolveStructureNames } from "../../utils/companyStructureAccess";

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const USER_INVITE_NEXT_STEPS = [
  "They check email (and junk folder) for the setup message.",
  "They open the link and choose a name and password.",
  "They sign in to BERT when setup is complete.",
];

const ROLE_HELPER: Record<string, string> = {
  Admin: "Full company workspace control — users, sites, templates, and settings.",
  Manager: "Manage checks, actions, and work scoped to assigned sites.",
  Auditor: "Complete assigned checks and submit evidence from the field.",
};

type InviteView = "inviteUsers" | "pendingInvites" | "sentInvites";
type CompanyView = "companyStructure" | "people";
type PeopleCompanyTopView = "landing" | "inviteArea" | "company";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toTitleStatus(value: string): string {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "Unknown";
  if (normalized === "ACTIVE") return "Active";
  if (normalized === "INACTIVE") return "Inactive";
  return normalized.slice(0, 1) + normalized.slice(1).toLowerCase();
}

function summarizeMemberAccess(
  member: CompanyMember,
  catalogs: {
    sites: StructureEntity[];
    departments: StructureEntity[];
    areas: StructureEntity[];
  },
): string {
  const scope = accessScopeFromPersonRecord(member as unknown as Record<string, unknown>);
  const resolved = resolveStructureNames(scope, catalogs);
  if (resolved.allSites && resolved.allDepartments && resolved.allAreas) {
    return "All company access";
  }
  const pickOne = (label: string, list: string[], all: boolean) => {
    if (all) return "";
    if (list.length === 0) return "";
    if (list.length === 1) return `${label}: ${list[0]}`;
    if (list.length === 2 && label === "Site") return `Sites: ${list.join(", ")}`;
    return `${list.length} ${label.toLowerCase()}${list.length === 1 ? "" : "s"}`;
  };
  const siteOne = pickOne("Site", resolved.siteNames, resolved.allSites);
  const deptOne = pickOne("Department", resolved.departmentNames, resolved.allDepartments);
  const areaOne = pickOne("Area", resolved.areaNames, resolved.allAreas);
  const parts = [siteOne, deptOne, areaOne].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "All company access";
}

function isActiveCompanyUserInvite(invite: { status: string; loginReady?: boolean }) {
  return invite.status === "Active" || invite.loginReady === true;
}

function UserInviteListRow({
  invite,
  onResendInvite,
  onDeleteInvite,
  onRemoveCompanyUser,
  slatePrimaryCtaInteract,
  canRevoke = true,
}: {
  invite: UserInvite;
  onResendInvite: (invite: UserInvite) => void;
  onDeleteInvite: (invite: UserInvite) => void;
  onRemoveCompanyUser: (invite: UserInvite) => void;
  slatePrimaryCtaInteract: string;
  canRevoke?: boolean;
}) {
  const [copyLinkDone, setCopyLinkDone] = useState(false);
  const active = isActiveCompanyUserInvite(invite);
  const staleOrIncomplete =
    isStaleOrIncompleteInviteStatus(invite.status) || isLegacyInviteRowId(invite.id);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{invite.email}</p>
        <p className="mt-1 truncate text-xs text-slate-500">
          Sent by {invite.invitedBy} • {invite.sentAt}
          {invite.senderEmail ? ` • From ${invite.senderEmail}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {formatUserRoleLabel(invite.role)}
          </span>
          <span className={inviteStatusBadgeClass(invite.status)} title={getInviteStatusHelp(invite.status)}>
            {formatInviteStatusLabel(invite.status)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {invite.appOnboardingUrl ? (
          <>
            <a
              href={invite.appOnboardingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 no-underline"
            >
              Open link
            </a>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyTextToClipboard(invite.appOnboardingUrl || "");
                if (ok) {
                  setCopyLinkDone(true);
                  setTimeout(() => setCopyLinkDone(false), 2000);
                }
              }}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
            >
              {copyLinkDone ? "Copied" : "Copy link"}
            </button>
          </>
        ) : null}
        {invite.mailtoUrl ? (
          <a
            href={invite.mailtoUrl}
            className={`inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white no-underline ${slatePrimaryCtaInteract}`}
          >
            Open email
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => onResendInvite(invite)}
          title={staleOrIncomplete ? "Send a fresh invite link" : "Resend invite email"}
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
        >
          {staleOrIncomplete ? "Send fresh invite" : "Resend"}
        </button>
        {active ? (
          <DangerActionButton
            type="button"
            onClick={() => onRemoveCompanyUser(invite)}
            title="Remove this user from the company Users tab and UserAuth so they can no longer sign in"
            className="rounded-xl px-3 py-2 text-xs"
          >
            Remove user
          </DangerActionButton>
        ) : canRevoke ? (
          <DangerActionButton
            type="button"
            onClick={() => onDeleteInvite(invite)}
            title={staleOrIncomplete ? "Revoke stale or incomplete invite" : "Revoke invite link"}
            className="rounded-xl px-3 py-2 text-xs"
          >
            {staleOrIncomplete ? "Revoke" : "Delete"}
          </DangerActionButton>
        ) : null}
      </div>
    </div>
  );
}

type HealthSyncProps = Pick<
  AdminScreenProps,
  | "notificationsEnabled"
  | "companySheetSync"
  | "workspaceValidation"
  | "workspaceValidationLoading"
  | "syncState"
  | "selectedFolder"
  | "folderInspection"
  | "onRequestNotifications"
  | "onValidateWorkspace"
  | "onRepairWorkspace"
  | "slatePrimaryCtaInteract"
>;

function WorkspaceHealthSections({
  notificationsEnabled,
  companySheetSync,
  workspaceValidation,
  workspaceValidationLoading,
  syncState,
  selectedFolder,
  folderInspection,
  onRequestNotifications,
  onValidateWorkspace,
  onRepairWorkspace,
  slatePrimaryCtaInteract,
}: HealthSyncProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <SectionHeader
          icon="spark"
          eyebrow="Live delivery"
          title="Live delivery controls"
          subtitle="Enable browser alerts and keep the company workspace ready for live notifications."
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {notificationsEnabled ? "Browser alerts on" : "Browser alerts off"}
          </span>
          <button
            type="button"
            onClick={onRequestNotifications}
            className={`h-11 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
          >
            Enable browser notifications
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          User invites email the in-app invite link when SMTP is configured. If sending fails, copy the invite link or
          draft from the invite result panel above the list.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <SectionHeader
            icon="chart"
            eyebrow="Data sync"
            title="Company sheet sync"
            subtitle="What has been pulled from the company master sheet and whether live sync is healthy."
          />
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {companySheetSync ? "Synced" : "Waiting"}
          </span>
        </div>
        {companySheetSync ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{companySheetSync.sheetName}</p>
              <p className="mt-1 text-xs text-slate-500">Last synced {companySheetSync.lastSyncedAt}</p>
              <p className="mt-2 text-xs text-slate-500">{companySheetSync.tabs.join(", ")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniMetric label="Users tab rows" value={String(companySheetSync.usersCount)} />
              <MiniMetric label="Schedule rows" value={String(companySheetSync.schedulesCount)} />
              <MiniMetric label="Onboarding rows" value={String(companySheetSync.onboardingCount)} />
              <MiniMetric label="Action rows" value={String(companySheetSync.actionsCount)} />
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <EmptyPanel
              title="Company sheet not synced yet"
              text="Link a company folder with a master sheet, then populate the workspace so row counts can show here."
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <SectionHeader
            icon="shield"
            eyebrow="Workspace health"
            title="Check workspace"
            subtitle="Tabs, sheet format, and linked folders before you rely on this workspace in the field."
          />
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {workspaceValidation?.ok ? "Healthy" : "Check needed"}
          </span>
        </div>
        {workspaceValidation ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Sheet format</p>
              <p className="mt-1 text-sm text-slate-500">
                On sheet: {workspaceValidation.schemaVersion || "none"} • this app expects{" "}
                {workspaceValidation.currentSchemaVersion}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["01 Company Setup", workspaceValidation.folders.setupFolder],
                  ["02 Audit Forms", workspaceValidation.folders.auditFormsFolder],
                  ["03 Company Records", workspaceValidation.folders.recordsFolder],
                  ["04 Evidence", workspaceValidation.folders.evidenceFolder],
                  ["05 Exports", workspaceValidation.folders.exportsFolder],
                  ["06 Management Notes", workspaceValidation.folders.managementNotesFolder],
                ] as const
              ).map(([label, ok]) => (
                <div
                  key={label}
                  className={[
                    "rounded-xl border px-3 py-2 text-sm font-semibold",
                    ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800",
                  ].join(" ")}
                >
                  {label}: {ok ? "Ready" : "Missing"}
                </div>
              ))}
            </div>
            {(workspaceValidation.repairableIssues?.length ?? 0) > 0 && !workspaceValidation.ok ? (
              <p className="text-sm text-amber-800">
                Some folders or sheet items need repair. Use Fix workspace to add missing ISO folders safely.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-3">
            <EmptyPanel title="No workspace check yet" text="After folders are linked, run Check workspace." />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onValidateWorkspace}
            className={`h-11 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white ${slatePrimaryCtaInteract}`}
          >
            {workspaceValidationLoading ? "Checking…" : "Check workspace"}
          </button>
          <button type="button" onClick={onRepairWorkspace} className="h-11 rounded-2xl bg-blue-50 px-5 text-sm font-semibold text-blue-800">
            Fix workspace
          </button>
        </div>
      </section>

      {syncState === "Synced" && selectedFolder ? (
        <section className="rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50 to-white p-4 shadow-sm">
          <SectionHeader
            icon="check"
            eyebrow="Go live"
            title={`${selectedFolder.name} is live`}
            subtitle="This workspace has been linked, checked, and populated from Google Drive."
          />
          <p className="mt-2 text-sm text-slate-600">
            {folderInspection?.auditForms.length ?? 0} audit forms • {companySheetSync?.usersCount ?? 0} users •{" "}
            {companySheetSync?.schedulesCount ?? 0} schedules
          </p>
        </section>
      ) : null}
    </div>
  );
}

export type UsersInvitesPilotPanelProps = Pick<
  AdminScreenProps,
  | "currentUser"
  | "inviteEmailInput"
  | "inviteRoleInput"
  | "invitedUsers"
  | "pendingInvitesLoading"
  | "pendingInvitesLoadError"
  | "reportUsers"
  | "activeCompanyMembers"
  | "activeMembersLoading"
  | "activeMembersLoadError"
  | "activeMembersLoadErrorDetail"
  | "activeMembersLoadReasonCode"
  | "activeMembersLoadFailedStep"
  | "activeMembersLoadDiagnostics"
  | "activeMembersWarning"
  | "sites"
  | "selectedSiteId"
  | "areaRestrictionsEnabled"
  | "areaSyncLoading"
  | "areaSyncError"
  | "userSiteAssignments"
  | "googleConnected"
  | "onEnableAreaRestrictions"
  | "onDisableAreaRestrictions"
  | "onRenameArea"
  | "onReactivateArea"
  | "creatableRoles"
  | "companyUserInviteEmailResult"
  | "companyUserInviteEmailSending"
  | "notificationsEnabled"
  | "companySheetSync"
  | "workspaceValidation"
  | "workspaceValidationLoading"
  | "syncState"
  | "selectedFolder"
  | "folderInspection"
  | "onInviteEmailChange"
  | "onInviteRoleChange"
  | "onInviteUser"
  | "onDismissCompanyUserInviteEmailResult"
  | "onResendInvite"
  | "onDeleteInvite"
  | "onRemoveCompanyUser"
  | "onUpdateCompanyMember"
  | "onDeactivateCompanyMember"
  | "onResyncUsers"
  | "onSelectSite"
  | "onAddSite"
  | "onArchiveSite"
  | "onToggleUserSiteAssignment"
  | "onRequestNotifications"
  | "onValidateWorkspace"
  | "onRepairWorkspace"
  | "masterCompanyContextBlocked"
  | "masterCompanyContextMessage"
  | "companyContextBlocked"
  | "companyContextBlockedMessage"
  | "inviteWorkspaceBanner"
  | "slatePrimaryCtaInteract"
> & {
  godModeFirstUserInvite: boolean;
  workspaceSetupComplete: boolean;
  companyRegistryStatus?: string;
  companyFolderId?: string;
  companyName?: string;
  masterSheetId?: string;
  pilotEditableInput: string;
  pilotLightSurface: string;
  pilotLightNested: string;
  CompanyUserInviteEmailResultPanel: ComponentType<{
    result: CompanyUserInviteEmailResult;
    onDismiss: () => void;
    slatePrimaryCtaInteract: string;
  }>;
  companyMemberEditing?: boolean;
  archiveOffline?: boolean;
  onArchivedCompanyMember?: (member: CompanyMember) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
};

export function UsersInvitesPilotPanel({
  currentUser,
  inviteEmailInput,
  inviteRoleInput,
  invitedUsers,
  pendingInvitesLoading = false,
  pendingInvitesLoadError,
  reportUsers,
  activeCompanyMembers = [],
  activeMembersLoading = false,
  activeMembersLoadError,
  activeMembersLoadErrorDetail,
  activeMembersLoadReasonCode,
  activeMembersLoadFailedStep,
  activeMembersLoadDiagnostics,
  activeMembersWarning,
  sites,
  selectedSiteId,
  areaRestrictionsEnabled,
  areaSyncLoading,
  areaSyncError,
  googleConnected,
  userSiteAssignments,
  creatableRoles,
  companyUserInviteEmailResult,
  companyUserInviteEmailSending,
  godModeFirstUserInvite,
  workspaceSetupComplete,
  companyRegistryStatus = "",
  companyFolderId = "",
  companyName = "",
  masterSheetId = "",
  pilotEditableInput,
  pilotLightSurface,
  pilotLightNested,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteUser,
  onDismissCompanyUserInviteEmailResult,
  onResendInvite,
  onDeleteInvite,
  onRemoveCompanyUser,
  onUpdateCompanyMember,
  onDeactivateCompanyMember,
  onResyncUsers,
  companyMemberEditing = false,
  archiveOffline = false,
  onArchivedCompanyMember,
  onArchiveError,
  onArchiveSuccess,
  onSelectSite,
  onAddSite,
  onArchiveSite,
  onEnableAreaRestrictions,
  onDisableAreaRestrictions,
  onRenameArea,
  onReactivateArea,
  onToggleUserSiteAssignment,
  masterCompanyContextBlocked = false,
  masterCompanyContextMessage = "",
  companyContextBlocked = false,
  companyContextBlockedMessage = "",
  inviteWorkspaceBanner = "",
  CompanyUserInviteEmailResultPanel,
  slatePrimaryCtaInteract,
  companySheetSync,
  workspaceValidation,
  ...healthProps
}: UsersInvitesPilotPanelProps) {
  const [showHealthSync, setShowHealthSync] = useState(false);
  const [topView, setTopView] = useState<PeopleCompanyTopView>("landing");
  const [inviteView, setInviteView] = useState<InviteView>("inviteUsers");
  const [companyView, setCompanyView] = useState<CompanyView>("people");
  const [pendingInviteSearch, setPendingInviteSearch] = useState("");
  const [pendingInviteStatusFilter, setPendingInviteStatusFilter] = useState("All");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleRoleFilter, setPeopleRoleFilter] = useState("All");
  const [peopleStatusFilter, setPeopleStatusFilter] = useState("All");
  const [peopleSiteFilter, setPeopleSiteFilter] = useState("All");
  const [peopleDepartmentFilter, setPeopleDepartmentFilter] = useState("All");
  const [peopleAreaFilter, setPeopleAreaFilter] = useState("All");
  const [structureCatalog, setStructureCatalog] = useState<{
    sites: StructureEntity[];
    departments: StructureEntity[];
    areas: StructureEntity[];
  }>({ sites: [], departments: [], areas: [] });
  const isMasterActor = currentUser.role === "Master";
  const resolvedCompanyId = String(companyFolderId || "").trim();
  const resolvedMasterSheetId = String(masterSheetId || "").trim();
  const resolvedCompanyName = String(companyName || "").trim();
  const hasCompanyContext = Boolean(resolvedCompanyId && resolvedCompanyName);
  const invitePermissionSession = {
    kind: isMasterActor ? "master" : "company",
    role: currentUser.role,
    accessLevel: currentUser.accessLevel,
    companyId: resolvedCompanyId,
    companyFolderId: resolvedCompanyId,
  } as const;
  const isCompanyInviteActorRole = isCompanyInviteActor({
    role: currentUser.role,
    accessLevel: currentUser.accessLevel,
  });
  const hasInvitePermission =
    isGodmodeInviteSession(invitePermissionSession) ||
    canCreateCompanyInvite(invitePermissionSession, resolvedCompanyId, inviteRoleInput);
  const showMembersDiagnostics = canShowCompanyMembersDiagnostics(currentUser.role);
  const showInviteForm = hasInvitePermission && (isMasterActor || isCompanyInviteActorRole) && !companyContextBlocked;
  const inviteFormEnabled = hasCompanyContext && hasInvitePermission && !companyContextBlocked;
  const inviteBlockedMessage = companyContextBlocked
    ? companyContextBlockedMessage || COMPANY_NO_LONGER_AVAILABLE_MESSAGE
    : !hasCompanyContext
    ? INVITE_COMPANY_CONTEXT_REQUIRED_MESSAGE
    : INVITE_ROLE_FORBIDDEN_MESSAGE;
  const inviteRecordScope = (invite: UserInvite) => ({
    kind: "company_user" as const,
    inviteType: COMPANY_USER_INVITE_TYPE,
    role: invite.role,
    companyId: invite.companyFolderId || resolvedCompanyId,
    companyFolderId: invite.companyFolderId || resolvedCompanyId,
  });
  const canManageInvite = (invite: UserInvite) => canRevokeInvite(invitePermissionSession, inviteRecordScope(invite));
  const canSeeInvite = (invite: UserInvite) => canViewInvite(invitePermissionSession, inviteRecordScope(invite));
  const pendingInvites = useMemo(() => {
    const pending: UserInvite[] = [];
    for (const invite of invitedUsers) {
      if (!canSeeInvite(invite)) {
        continue;
      }
      if (!isActiveCompanyUserInvite(invite)) {
        pending.push(invite);
      }
    }
    return pending;
  }, [invitedUsers, companyFolderId, currentUser.role, currentUser.accessLevel]);
  const pendingInviteStatuses = useMemo(
    () => ["All", ...Array.from(new Set(pendingInvites.map((invite) => formatInviteStatusLabel(invite.status)))).sort((a, b) => a.localeCompare(b))],
    [pendingInvites],
  );
  const filteredPendingInvites = useMemo(() => {
    const query = normalizeText(pendingInviteSearch);
    return pendingInvites.filter((invite) => {
      const statusLabel = formatInviteStatusLabel(invite.status);
      if (pendingInviteStatusFilter !== "All" && statusLabel !== pendingInviteStatusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        normalizeText(invite.email).includes(query) ||
        normalizeText(invite.invitedBy).includes(query) ||
        normalizeText(invite.senderEmail || "").includes(query)
      );
    });
  }, [pendingInvites, pendingInviteSearch, pendingInviteStatusFilter]);

  const activeMembers = useMemo(() => {
    const seen = new Set<string>();
    const members: CompanyMember[] = [];
    for (const member of activeCompanyMembers) {
      const email = member.email.trim().toLowerCase();
      if (!email || seen.has(email)) {
        continue;
      }
      seen.add(email);
      members.push({
        ...member,
        name: member.name || member.email.split("@")[0] || member.email,
      });
    }
    return members;
  }, [activeCompanyMembers]);
  const peopleRoleOptions = useMemo(
    () => ["All", ...Array.from(new Set(activeMembers.map((member) => formatUserRoleLabel(member.role)))).sort((a, b) => a.localeCompare(b))],
    [activeMembers],
  );
  const peopleStatusOptions = useMemo(
    () => ["All", ...Array.from(new Set(activeMembers.map((member) => toTitleStatus(member.status)))).sort((a, b) => a.localeCompare(b))],
    [activeMembers],
  );
  const peopleSiteOptions = useMemo(
    () => ["All", ...structureCatalog.sites.filter((item) => item.active !== false).map((item) => item.name)],
    [structureCatalog.sites],
  );
  const peopleDepartmentOptions = useMemo(
    () => ["All", ...structureCatalog.departments.filter((item) => item.active !== false).map((item) => item.name)],
    [structureCatalog.departments],
  );
  const peopleAreaOptions = useMemo(
    () => ["All", ...structureCatalog.areas.filter((item) => item.active !== false).map((item) => item.name)],
    [structureCatalog.areas],
  );
  const filteredActiveMembers = useMemo(() => {
    const query = normalizeText(peopleSearch);
    return activeMembers.filter((member) => {
      const roleLabel = formatUserRoleLabel(member.role);
      const statusLabel = toTitleStatus(member.status);
      const scope = accessScopeFromPersonRecord(member as unknown as Record<string, unknown>);
      const resolved = resolveStructureNames(scope, structureCatalog);
      const matchesSite = peopleSiteFilter === "All" || resolved.allSites || resolved.siteNames.includes(peopleSiteFilter);
      const matchesDepartment =
        peopleDepartmentFilter === "All" ||
        resolved.allDepartments ||
        resolved.departmentNames.includes(peopleDepartmentFilter);
      const matchesArea = peopleAreaFilter === "All" || resolved.allAreas || resolved.areaNames.includes(peopleAreaFilter);
      if (peopleRoleFilter !== "All" && roleLabel !== peopleRoleFilter) return false;
      if (peopleStatusFilter !== "All" && statusLabel !== peopleStatusFilter) return false;
      if (!matchesSite || !matchesDepartment || !matchesArea) return false;
      if (!query) return true;
      return normalizeText(member.name).includes(query) || normalizeText(member.email).includes(query);
    });
  }, [
    activeMembers,
    peopleSearch,
    peopleRoleFilter,
    peopleStatusFilter,
    peopleSiteFilter,
    peopleDepartmentFilter,
    peopleAreaFilter,
    structureCatalog,
  ]);

  return (
    <div id="admin-user-management" className="space-y-4">
      <section className={pilotLightSurface}>
        <SectionHeader
          icon="user"
          eyebrow="People & Company"
          title="People & Company"
          subtitle="Manage invites, people, and company structure."
        />
      </section>

      {topView === "landing" ? (
        <section className={pilotLightSurface}>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setTopView("inviteArea")}
              className="min-h-[6.5rem] rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left"
            >
              <p className="text-lg font-semibold text-slate-900">INVITE AREA</p>
              <p className="mt-1 text-sm text-slate-600">Manage new invites and pending invitations.</p>
            </button>
            <button
              type="button"
              onClick={() => setTopView("company")}
              className="min-h-[6.5rem] rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left"
            >
              <p className="text-lg font-semibold text-slate-900">COMPANY</p>
              <p className="mt-1 text-sm text-slate-600">Manage company structure and people.</p>
            </button>
          </div>
        </section>
      ) : null}

      {topView !== "landing" ? (
        <section className={pilotLightSurface}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700">
              {topView === "inviteArea"
                ? "People & Company > Invite Area"
                : "People & Company > Company"}
            </p>
            <button
              type="button"
              onClick={() => setTopView("landing")}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
          </div>
        </section>
      ) : null}

      {topView === "inviteArea" ? (
        <section className={pilotLightSurface}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Invite Area</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["inviteUsers", "Invite users", "Send a new user invite."],
                ["pendingInvites", "Pending invites", "View invites that are waiting to be accepted."],
                ["sentInvites", "Sent Invites", "View historical invite activity."],
              ] as Array<[InviteView, string, string]>
            ).map(([viewKey, title, description]) => (
              <button
                key={viewKey}
                type="button"
                onClick={() => setInviteView(viewKey)}
                className={[
                  "min-h-[5.5rem] rounded-2xl border px-4 py-3 text-left",
                  inviteView === viewKey
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-900",
                ].join(" ")}
              >
                <p className="text-base font-semibold">{title}</p>
                <p className={`mt-1 text-xs ${inviteView === viewKey ? "text-slate-200" : "text-slate-500"}`}>
                  {description}
                </p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {topView === "inviteArea" && inviteView === "inviteUsers" ? (
      <section className={pilotLightSurface}>
        <SectionHeader
          icon="user"
          eyebrow="Invite"
          title="Invite user"
          subtitle="Send a secure setup link by email. The recipient completes name and password before they can sign in."
        />
        {inviteWorkspaceBanner ? (
          <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-950">
            {inviteWorkspaceBanner}
          </p>
        ) : null}
        {!showInviteForm ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {companyContextBlocked
              ? companyContextBlockedMessage || COMPANY_NO_LONGER_AVAILABLE_MESSAGE
              : INVITE_ROLE_FORBIDDEN_MESSAGE}
          </p>
        ) : (
          <div className={`mt-4 ${pilotLightNested}`}>
            {!inviteFormEnabled ? (
              <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
                {inviteBlockedMessage}
              </p>
            ) : null}
            <label htmlFor="pilot-invite-email" className="mb-1 block text-sm font-semibold text-slate-900">
              Email
            </label>
            <input
              id="pilot-invite-email"
              value={inviteEmailInput}
              onChange={(event) => onInviteEmailChange(event.target.value)}
              placeholder="name@company.com"
              className={pilotEditableInput}
            />
            <label htmlFor="pilot-invite-role" className="mb-1 mt-3 block text-sm font-semibold text-slate-900">
              Role
            </label>
            <select
              id="pilot-invite-role"
              value={inviteRoleInput}
              onChange={(event) => onInviteRoleChange(event.target.value as Role)}
              className={pilotEditableInput}
            >
              {creatableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              {ROLE_HELPER[inviteRoleInput] || "They receive an email with a secure setup link."}
            </p>
            {isCompanyInviteActorRole && !isMasterActor ? (
              <p className="mt-2 text-xs font-medium text-slate-600">{INVITE_MANAGE_AUDITOR_ONLY_MESSAGE}</p>
            ) : null}
            <button
              type="button"
              onClick={onInviteUser}
              disabled={
                companyUserInviteEmailSending ||
                masterCompanyContextBlocked ||
                !inviteFormEnabled
              }
              title={
                masterCompanyContextBlocked
                  ? masterCompanyContextMessage
                  : !inviteFormEnabled
                    ? inviteBlockedMessage
                    : undefined
              }
              className={`mt-4 h-12 w-full rounded-2xl bg-slate-900 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${slatePrimaryCtaInteract}`}
            >
              {companyUserInviteEmailSending ? "Sending…" : "Send invite"}
            </button>
            {companyUserInviteEmailResult ? (
              <>
                <CompanyUserInviteEmailResultPanel
                  result={companyUserInviteEmailResult}
                  onDismiss={onDismissCompanyUserInviteEmailResult}
                  slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                />
                <WhatHappensNextPanel steps={USER_INVITE_NEXT_STEPS} className="mt-3 border-sky-100 bg-sky-50/50" />
              </>
            ) : null}
          </div>
        )}
      </section>
      ) : null}

      {topView === "inviteArea" && inviteView === "pendingInvites" ? (
      <section className={pilotLightSurface}>
        <SectionHeader
          icon="spark"
          eyebrow="Pending"
          title="Pending invites"
          subtitle="People who have been invited but have not finished setup yet."
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={pendingInviteSearch}
            onChange={(event) => setPendingInviteSearch(event.target.value)}
            placeholder="Search pending invites by email"
            className={pilotEditableInput}
          />
          <select
            value={pendingInviteStatusFilter}
            onChange={(event) => setPendingInviteStatusFilter(event.target.value)}
            className={pilotEditableInput}
          >
            {pendingInviteStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        {pendingInvitesLoadError && !pendingInvitesLoading ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm font-semibold text-rose-900">Could not load pending invites</p>
            <p className="mt-1 text-sm text-rose-800">{pendingInvitesLoadError || COMPANY_INVITES_USER_MESSAGE}</p>
          </div>
        ) : null}
        {pendingInvitesLoading && filteredPendingInvites.length === 0 ? (
          <div className="mt-3">
            <EmptyPanel title={COMPANY_INVITES_LOADING_MESSAGE} text="Checking for invites that have not finished setup yet." />
          </div>
        ) : !pendingInvitesLoadError && filteredPendingInvites.length === 0 ? (
          <div className="mt-3">
            <EmptyPanel title="No pending invites" text="No pending invites match your search or filter." />
          </div>
        ) : filteredPendingInvites.length === 0 ? null : (
          <div className="mt-3 space-y-2">
            {filteredPendingInvites.map((invite) => (
              <UserInviteListRow
                key={invite.id}
                invite={invite}
                onResendInvite={onResendInvite}
                onDeleteInvite={onDeleteInvite}
                onRemoveCompanyUser={onRemoveCompanyUser}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                canRevoke={canManageInvite(invite)}
              />
            ))}
          </div>
        )}
      </section>
      ) : null}

      {topView === "inviteArea" && inviteView === "sentInvites" ? (
        <section className={pilotLightSurface}>
          <SectionHeader
            icon="spark"
            eyebrow="Sent"
            title="Sent Invites"
            subtitle="Previously sent invite history."
          />
          <div className="mt-3">
            <EmptyPanel title="Sent Invites" text="Sent invite history is not available yet." />
          </div>
        </section>
      ) : null}

      {topView === "company" ? (
        <section className={pilotLightSurface}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Company</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["companyStructure", "Company structure", "Manage sites, departments, and areas."],
                ["people", "People", "View and edit company people and access."],
              ] as Array<[CompanyView, string, string]>
            ).map(([viewKey, title, description]) => (
              <button
                key={viewKey}
                type="button"
                onClick={() => setCompanyView(viewKey)}
                className={[
                  "min-h-[5.5rem] rounded-2xl border px-4 py-3 text-left",
                  companyView === viewKey
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-900",
                ].join(" ")}
              >
                <p className="text-base font-semibold">{title}</p>
                <p className={`mt-1 text-xs ${companyView === viewKey ? "text-slate-200" : "text-slate-500"}`}>
                  {description}
                </p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {topView === "company" && companyView === "companyStructure" && resolvedCompanyId && resolvedMasterSheetId ? (
        <CompanyStructurePanel
          currentUserRole={currentUser.role}
          companyFolderId={resolvedCompanyId}
          masterSheetId={resolvedMasterSheetId}
          surfaceClass={pilotLightSurface}
          nestedClass={pilotLightNested}
          onStructureChange={setStructureCatalog}
        />
      ) : null}

      {topView === "company" && companyView === "people" ? (
      <section className={pilotLightSurface}>
        <SectionHeader
          icon="user"
          eyebrow="Company"
          title="Company people"
          subtitle="Everyone with a profile in this company — active or inactive."
        />
        <div className="mt-3 space-y-2">
          <input
            value={peopleSearch}
            onChange={(event) => setPeopleSearch(event.target.value)}
            placeholder="Search people by name or email"
            className={pilotEditableInput}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select value={peopleRoleFilter} onChange={(event) => setPeopleRoleFilter(event.target.value)} className={pilotEditableInput}>
              {peopleRoleOptions.map((option) => <option key={option} value={option}>{option === "All" ? "Role: All" : option}</option>)}
            </select>
            <select value={peopleStatusFilter} onChange={(event) => setPeopleStatusFilter(event.target.value)} className={pilotEditableInput}>
              {peopleStatusOptions.map((option) => <option key={option} value={option}>{option === "All" ? "Status: All" : option}</option>)}
            </select>
            <select value={peopleSiteFilter} onChange={(event) => setPeopleSiteFilter(event.target.value)} className={pilotEditableInput}>
              {peopleSiteOptions.map((option) => <option key={option} value={option}>{option === "All" ? "Site: All" : option}</option>)}
            </select>
            <select value={peopleDepartmentFilter} onChange={(event) => setPeopleDepartmentFilter(event.target.value)} className={pilotEditableInput}>
              {peopleDepartmentOptions.map((option) => <option key={option} value={option}>{option === "All" ? "Department: All" : option}</option>)}
            </select>
            <select value={peopleAreaFilter} onChange={(event) => setPeopleAreaFilter(event.target.value)} className={pilotEditableInput}>
              {peopleAreaOptions.map((option) => <option key={option} value={option}>{option === "All" ? "Area: All" : option}</option>)}
            </select>
          </div>
        </div>
        {activeMembersLoadError && !activeMembersLoading ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-sm font-semibold text-rose-900">Could not load company people</p>
            <p className="mt-1 text-sm text-rose-800">
              {activeMembersLoadError || COMPANY_MEMBERS_USER_MESSAGE}
            </p>
            {showMembersDiagnostics && (activeMembersLoadReasonCode || activeMembersLoadFailedStep) ? (
              <p className="mt-1 text-xs text-rose-700">
                {[activeMembersLoadReasonCode, activeMembersLoadFailedStep && `step: ${activeMembersLoadFailedStep}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {showMembersDiagnostics ? (
              <>
                <p className="mt-2 text-xs text-rose-900">
                  Fix the workbook connection above, then re-sync users.
                </p>
                {activeMembersLoadErrorDetail ? (
                  <p className="mt-2 text-xs text-rose-900">{activeMembersLoadErrorDetail}</p>
                ) : null}
                <CompanyMembersDiagnosticsPanel
                  reasonCode={activeMembersLoadReasonCode}
                  failedStep={activeMembersLoadFailedStep}
                  diagnostics={activeMembersLoadDiagnostics}
                  detail={activeMembersLoadErrorDetail}
                  defaultOpen={Boolean(activeMembersLoadReasonCode || activeMembersLoadFailedStep)}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {activeMembersWarning && showMembersDiagnostics ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {activeMembersWarning}
          </p>
        ) : null}
        {activeMembersLoading && filteredActiveMembers.length === 0 ? (
          <div className="mt-3">
            <EmptyPanel title={COMPANY_MEMBERS_LOADING_MESSAGE} text="Loading company people from your workspace." />
          </div>
        ) : !activeMembersLoadError && filteredActiveMembers.length === 0 ? (
          <div className="mt-3">
            <EmptyPanel
              title="No matching people"
              text="No people match your search or selected filters."
            />
          </div>
        ) : filteredActiveMembers.length === 0 ? null : (
          <div className="mt-3 space-y-2">
            {filteredActiveMembers.map((member) => {
              const accessSummary = summarizeMemberAccess(member, structureCatalog);
              return (
                <div key={member.email} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="grid gap-1 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">{member.name || member.email}</p>
                    <p>{member.email}</p>
                    <p>Role: {formatUserRoleLabel(member.role)}</p>
                    <p>Status: {toTitleStatus(member.status)}</p>
                    <p>Access: {accessSummary}</p>
                  </div>
                  <ActiveUserCard
                    member={member}
                    currentUserRole={currentUser.role}
                    currentUserEmail={currentUser.username}
                    companyFolderId={resolvedCompanyId}
                    masterSheetId={resolvedMasterSheetId}
                    structureCatalog={structureCatalog}
                    editing={companyMemberEditing}
                    slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                    onEdit={(target, input) => onUpdateCompanyMember(target, input)}
                    onDeactivate={onDeactivateCompanyMember}
                    canArchive={canArchiveCompanyMember(
                      member,
                      currentUser.username,
                      activeCompanyMembers,
                      currentUser.role,
                    )}
                    archiveCompanyFolderId={resolvedCompanyId}
                    archiveMasterSheetId={resolvedMasterSheetId}
                    archiveOffline={archiveOffline}
                    onArchivedUser={onArchivedCompanyMember}
                    onArchiveError={onArchiveError}
                    onArchiveSuccess={onArchiveSuccess}
                    onAccessUpdated={() => onResyncUsers()}
                    onRemove={
                      canManageCompanyMembers(currentUser.role)
                        ? (target) =>
                            onRemoveCompanyUser({
                              id: `active-${target.email}`,
                              email: target.email,
                              role: target.role as Role,
                              status: "Active",
                              invitedBy: currentUser.name,
                              sentAt: "",
                            })
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
        {canShowTechnicalUi(currentUser.role) ? (
          <button
            type="button"
            onClick={onResyncUsers}
            className="mt-3 h-11 w-full rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-700"
          >
            Re-sync company people
          </button>
        ) : null}
      </section>
      ) : null}

      {topView === "company" && companyView === "companyStructure" ? (
        <SitesAreasPanel
          currentUserRole={currentUser.role}
          sites={sites}
          areaRestrictionsEnabled={areaRestrictionsEnabled}
          areaSyncLoading={areaSyncLoading}
          areaSyncError={areaSyncError}
          googleConnected={googleConnected}
          selectedSiteId={selectedSiteId}
          userSiteAssignments={userSiteAssignments}
          reportUsers={reportUsers}
          showSiteContext={false}
          showUserAssignment={false}
          variant="light"
          surfaceClass={pilotLightSurface}
          nestedClass={pilotLightNested}
          onEnableAreaRestrictions={onEnableAreaRestrictions}
          onDisableAreaRestrictions={onDisableAreaRestrictions}
          onAddArea={onAddSite}
          onRenameArea={onRenameArea}
          onArchiveArea={onArchiveSite}
          onReactivateArea={onReactivateArea}
          onSelectSite={onSelectSite}
          onToggleUserSiteAssignment={onToggleUserSiteAssignment}
        />
      ) : null}

      {topView === "company" ? (
      <details className={pilotLightSurface}>
        <summary className="cursor-pointer px-1 py-2 text-sm font-semibold text-slate-900">Invite status guide (advanced)</summary>
        <div className="mt-2 border-t border-slate-100 pt-3">
          <InviteStatusLegend />
        </div>
      </details>
      ) : null}

      {topView === "company" ? (
      <section className={pilotLightSurface}>
        <button
          type="button"
          onClick={() => setShowHealthSync((open) => !open)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <SectionHeader
            icon="sync"
            eyebrow="Advanced"
            title="Health & sync"
            subtitle="Live delivery, company sheet sync, and workspace validation."
          />
          <span className="shrink-0 text-sm font-semibold text-slate-600">{showHealthSync ? "Hide" : "Show"}</span>
        </button>
        {showHealthSync ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <WorkspaceHealthSections
              {...healthProps}
              companySheetSync={companySheetSync}
              workspaceValidation={workspaceValidation}
              slatePrimaryCtaInteract={slatePrimaryCtaInteract}
            />
          </div>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}
