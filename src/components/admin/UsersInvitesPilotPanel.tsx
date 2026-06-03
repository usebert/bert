import { useMemo, useState, type ComponentType } from "react";
import type { Role } from "../../permissions";
import { canInviteUsers, getRoleDisplayName } from "../../permissions";
import { COMPANY_NOT_LIVE_INVITE_MESSAGE } from "../../utils/companyWorkspaceInvite";
import { INVITE_ROLE_FORBIDDEN_MESSAGE } from "../../utils/companyWorkspaceInvite";
import { DangerActionButton } from "../DangerActionButton";
import { EmptyPanel, MiniMetric, SectionHeader } from "../dashboard/DashboardPrimitives";
import { InviteStatusLegend } from "../InviteStatusLegend";
import { WhatHappensNextPanel } from "../WhatHappensNextPanel";
import { SitesAreasPanel } from "./SitesAreasPanel";
import type { AdminScreenProps, CompanyUserInviteEmailResult, UserInvite } from "../../types/adminScreenProps";
import {
  formatInviteStatusLabel,
  formatUserRoleLabel,
  getInviteStatusHelp,
  inviteStatusBadgeClass,
  isLegacyInviteRowId,
  isStaleOrIncompleteInviteStatus,
} from "../../utils/inviteStatusDisplay";

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

function isActiveCompanyUserInvite(invite: { status: string; loginReady?: boolean }) {
  return invite.status === "Active" || invite.loginReady === true;
}

function UserInviteListRow({
  invite,
  onResendInvite,
  onDeleteInvite,
  onRemoveCompanyUser,
  slatePrimaryCtaInteract,
}: {
  invite: UserInvite;
  onResendInvite: (invite: UserInvite) => void;
  onDeleteInvite: (invite: UserInvite) => void;
  onRemoveCompanyUser: (invite: UserInvite) => void;
  slatePrimaryCtaInteract: string;
}) {
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
          <a
            href={invite.appOnboardingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 no-underline"
          >
            Open link
          </a>
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
          title={
            staleOrIncomplete
              ? "Send a fresh invite from a live company workspace"
              : "Resend invite email"
          }
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
        ) : (
          <DangerActionButton
            type="button"
            onClick={() => onDeleteInvite(invite)}
            title={staleOrIncomplete ? "Revoke stale or incomplete invite" : "Revoke invite link"}
            className="rounded-xl px-3 py-2 text-xs"
          >
            {staleOrIncomplete ? "Revoke" : "Delete"}
          </DangerActionButton>
        )}
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
  | "reportUsers"
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
  | "inviteWorkspaceBanner"
  | "slatePrimaryCtaInteract"
> & {
  godModeFirstUserInvite: boolean;
  workspaceSetupComplete: boolean;
  pilotEditableInput: string;
  pilotLightSurface: string;
  pilotLightNested: string;
  CompanyUserInviteEmailResultPanel: ComponentType<{
    result: CompanyUserInviteEmailResult;
    onDismiss: () => void;
    slatePrimaryCtaInteract: string;
  }>;
};

export function UsersInvitesPilotPanel({
  currentUser,
  inviteEmailInput,
  inviteRoleInput,
  invitedUsers,
  reportUsers,
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
  onResyncUsers,
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
  inviteWorkspaceBanner = "",
  CompanyUserInviteEmailResultPanel,
  slatePrimaryCtaInteract,
  ...healthProps
}: UsersInvitesPilotPanelProps) {
  const [showHealthSync, setShowHealthSync] = useState(false);
  const inviteAllowed = canInviteUsers(currentUser.role);
  const { pendingInvites, activeInvites } = useMemo(() => {
    const pending: UserInvite[] = [];
    const active: UserInvite[] = [];
    for (const invite of invitedUsers) {
      if (isActiveCompanyUserInvite(invite)) {
        active.push(invite);
      } else {
        pending.push(invite);
      }
    }
    return { pendingInvites: pending, activeInvites: active };
  }, [invitedUsers]);

  return (
    <div id="admin-user-management" className="space-y-4">
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
        {!workspaceSetupComplete ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
            {COMPANY_NOT_LIVE_INVITE_MESSAGE}
          </p>
        ) : null}
        {!inviteAllowed ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {INVITE_ROLE_FORBIDDEN_MESSAGE}
          </p>
        ) : (
        <div className={`mt-4 ${pilotLightNested}`}>
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
          <button
            type="button"
            onClick={onInviteUser}
            disabled={
              companyUserInviteEmailSending ||
              masterCompanyContextBlocked ||
              !workspaceSetupComplete
            }
            title={
              masterCompanyContextBlocked
                ? masterCompanyContextMessage
                : !workspaceSetupComplete
                  ? COMPANY_NOT_LIVE_INVITE_MESSAGE
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

      <section className={pilotLightSurface}>
        <SectionHeader
          icon="spark"
          eyebrow="Pending"
          title="Pending invites"
          subtitle="People who have been invited but have not finished setup yet."
        />
        {pendingInvites.length === 0 ? (
          <div className="mt-3">
            <EmptyPanel title="No pending invites" text="New invites appear here after you send them." />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {pendingInvites.map((invite) => (
              <UserInviteListRow
                key={invite.id}
                invite={invite}
                onResendInvite={onResendInvite}
                onDeleteInvite={onDeleteInvite}
                onRemoveCompanyUser={onRemoveCompanyUser}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              />
            ))}
          </div>
        )}
      </section>

      <section className={pilotLightSurface}>
        <SectionHeader
          icon="user"
          eyebrow="Active"
          title="Active users"
          subtitle="People who can sign in or are recorded as active in the company sheet."
        />
        {activeInvites.length === 0 && reportUsers.filter((u) => u.role !== "Master").length === 0 ? (
          <div className="mt-3">
            <EmptyPanel title="No active users yet" text="Users appear here after they complete invite setup." />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {activeInvites.map((invite) => (
              <UserInviteListRow
                key={invite.id}
                invite={invite}
                onResendInvite={onResendInvite}
                onDeleteInvite={onDeleteInvite}
                onRemoveCompanyUser={onRemoveCompanyUser}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
              />
            ))}
            {reportUsers
              .filter((user) => user.role !== "Master")
              .filter((user) => !activeInvites.some((inv) => inv.email.toLowerCase() === user.email.toLowerCase()))
              .map((user) => (
                <div
                  key={user.email}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user.email}</p>
                    <p className="mt-1 text-xs text-slate-500">From company sheet</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    {formatUserRoleLabel(user.role)}
                  </span>
                </div>
              ))}
          </div>
        )}
        <button
          type="button"
          onClick={onResyncUsers}
          className="mt-3 h-11 w-full rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-700"
        >
          Re-sync users from company sheet
        </button>
      </section>

      {!workspaceSetupComplete ? (
        <details className={pilotLightSurface}>
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
            Workspace setup status
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Incomplete</span>
          </summary>
          <p className="mt-3 text-sm text-slate-600">
            Finish Google Drive linking and workspace population from <span className="font-semibold">Companies</span> or{" "}
            <span className="font-semibold">Company Onboarding</span> before inviting field users.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Signed in as {getRoleDisplayName(currentUser.role)} • sync: {healthProps.syncState}
          </p>
        </details>
      ) : null}

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

      <details className={pilotLightSurface}>
        <summary className="cursor-pointer px-1 py-2 text-sm font-semibold text-slate-900">Invite status guide (advanced)</summary>
        <div className="mt-2 border-t border-slate-100 pt-3">
          <InviteStatusLegend />
        </div>
      </details>

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
            <WorkspaceHealthSections {...healthProps} slatePrimaryCtaInteract={slatePrimaryCtaInteract} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
