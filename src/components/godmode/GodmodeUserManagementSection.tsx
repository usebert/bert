import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "../../permissions";
import { ActiveUserCard } from "../admin/ActiveUserCard";
import { canManageCompanyMembers } from "../../permissions";
import type { CompanyMember, CompanyMembersDiagnostics } from "../../services/companyUserService";
import { CompanyMembersDiagnosticsPanel } from "../CompanyMembersDiagnosticsPanel";
import { DangerActionButton } from "../DangerActionButton";
import { EmptyPanel } from "../dashboard/DashboardPrimitives";
import { InviteStatusLegend } from "../InviteStatusLegend";
import { WhatHappensNextPanel } from "../WhatHappensNextPanel";
import type { CompanyUserInviteEmailResult, Site, UserInvite, UserSiteAssignments } from "../../types/adminScreenProps";
import type { CompanyReportUser } from "../../types/reports";
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

function isActiveCompanyUserInvite(invite: { status: string; loginReady?: boolean }) {
  return invite.status === "Active" || invite.loginReady === true;
}

export type GodmodeUserManagementSectionProps = {
  inviteEmailInput: string;
  inviteRoleInput: Role;
  invitedUsers: UserInvite[];
  reportUsers: CompanyReportUser[];
  sites: Site[];
  selectedSiteId: string;
  userSiteAssignments: UserSiteAssignments;
  creatableRoles: Role[];
  companyUserInviteEmailResult: CompanyUserInviteEmailResult | null;
  companyUserInviteEmailSending: boolean;
  pilotEditableInput: string;
  pilotLightNested: string;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: Role) => void;
  onInviteUser: () => void;
  onDismissCompanyUserInviteEmailResult: () => void;
  onResendInvite: (invite: UserInvite) => void;
  onDeleteInvite: (invite: UserInvite) => void;
  onRemoveCompanyUser: (invite: UserInvite) => void;
  onUpdateCompanyMember?: (member: CompanyMember, input: { name: string; role: string }) => void | Promise<void>;
  onDeactivateCompanyMember?: (member: CompanyMember) => void | Promise<void>;
  activeCompanyMembers?: CompanyMember[];
  activeMembersLoading?: boolean;
  activeMembersLoadError?: string;
  activeMembersLoadErrorDetail?: string;
  activeMembersLoadReasonCode?: string;
  activeMembersLoadFailedStep?: string;
  activeMembersLoadDiagnostics?: CompanyMembersDiagnostics;
  activeMembersWarning?: string;
  companyMemberEditing?: boolean;
  currentUserRole?: Role;
  currentUserEmail?: string;
  onResyncUsers: () => void;
  onSelectSite: (siteId: string) => void;
  onAddSite: () => void;
  onArchiveSite: (siteId: string) => void;
  onToggleUserSiteAssignment: (email: string, siteId: string) => void;
  CompanyUserInviteEmailResultPanel: ComponentType<{
    result: CompanyUserInviteEmailResult;
    onDismiss: () => void;
    slatePrimaryCtaInteract: string;
  }>;
  slatePrimaryCtaInteract: string;
};

function normalizeIdentity(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function GodmodeUserManagementSection({
  inviteEmailInput,
  inviteRoleInput,
  invitedUsers,
  reportUsers,
  sites,
  selectedSiteId,
  userSiteAssignments,
  creatableRoles,
  companyUserInviteEmailResult,
  companyUserInviteEmailSending,
  pilotEditableInput,
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
  activeCompanyMembers = [],
  activeMembersLoading = false,
  activeMembersLoadError,
  activeMembersLoadErrorDetail,
  activeMembersLoadReasonCode,
  activeMembersLoadFailedStep,
  activeMembersLoadDiagnostics,
  activeMembersWarning,
  companyMemberEditing = false,
  currentUserRole = "Master",
  currentUserEmail,
  onResyncUsers,
  onSelectSite,
  onAddSite,
  onArchiveSite,
  onToggleUserSiteAssignment,
  CompanyUserInviteEmailResultPanel,
  slatePrimaryCtaInteract,
}: GodmodeUserManagementSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Send a company user invite. The recipient sets their name and password from the email link.
      </p>
      <div className={pilotLightNested}>
        <p className="text-sm font-semibold text-slate-900">{t("people.inviteUsers")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("godmode.userEmail")}</span>
            <input
              value={inviteEmailInput}
              onChange={(event) => onInviteEmailChange(event.target.value)}
              placeholder="name@company.com"
              className={pilotEditableInput}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("people.role")}</span>
            <select
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
          </label>
        </div>
        <button
          type="button"
          onClick={onInviteUser}
          disabled={companyUserInviteEmailSending}
          className={`mt-3 h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${slatePrimaryCtaInteract}`}
        >
          {companyUserInviteEmailSending ? t("people.sending") : t("godmode.sendInviteLink")}
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
        <button
          type="button"
          onClick={onResyncUsers}
          className="mt-2 h-10 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800"
        >
          Refresh users from company data
        </button>
      </div>

      <div className={pilotLightNested}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">Role / site assignment</p>
          <button
            type="button"
            onClick={onAddSite}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700"
          >
            Add site
          </button>
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectSite("")}
            className={[
              "w-full rounded-xl border px-3 py-2 text-left text-sm",
              selectedSiteId === ""
                ? "border-orange-300 bg-orange-50 text-orange-950"
                : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
          >
            All sites
          </button>
          {sites
            .filter((site) => site.active)
            .map((site) => (
              <div key={site.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectSite(site.id)}
                  className={[
                    "flex-1 rounded-xl border px-3 py-2 text-left text-sm",
                    selectedSiteId === site.id
                      ? "border-orange-300 bg-orange-50 text-orange-950"
                      : "border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                >
                  {site.name}
                </button>
                <button
                  type="button"
                  onClick={() => onArchiveSite(site.id)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 text-xs font-semibold text-rose-800"
                >
                  Archive
                </button>
              </div>
            ))}
        </div>
        <div className="mt-4 space-y-3">
          {reportUsers
            .filter((user) => user.role !== "Master")
            .map((user) => {
              const assignmentKey = normalizeIdentity(user.email);
              const assignedIds = userSiteAssignments[assignmentKey] ?? [];
              const activeSites = sites.filter((site) => site.active);
              return (
                <div key={user.email} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{user.email}</p>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{user.role}</span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {activeSites.map((site) => {
                      const checked = assignedIds.includes(site.id);
                      return (
                        <label
                          key={`${user.email}-${site.id}`}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleUserSiteAssignment(user.email, site.id)}
                            className="h-4 w-4 shrink-0 rounded border-slate-300"
                          />
                          <span className="min-w-0 truncate">{site.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div className={pilotLightNested}>
        <p className="text-sm font-semibold text-slate-900">{t("people.companyPeople")}</p>
        {activeMembersLoadError ? (
          <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <p className="font-semibold">Could not load company people from the company workbook.</p>
            {activeMembersLoadReasonCode || activeMembersLoadFailedStep ? (
              <p className="mt-1 text-xs font-medium text-rose-900">
                {[activeMembersLoadReasonCode, activeMembersLoadFailedStep && `step: ${activeMembersLoadFailedStep}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {activeMembersLoadErrorDetail ? (
              <p className="mt-1 text-xs text-rose-900">{activeMembersLoadErrorDetail}</p>
            ) : null}
            <CompanyMembersDiagnosticsPanel
              reasonCode={activeMembersLoadReasonCode}
              failedStep={activeMembersLoadFailedStep}
              diagnostics={activeMembersLoadDiagnostics}
              detail={activeMembersLoadErrorDetail}
              defaultOpen={Boolean(activeMembersLoadReasonCode || activeMembersLoadFailedStep)}
            />
          </div>
        ) : null}
        {activeMembersWarning ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            {activeMembersWarning}
          </p>
        ) : null}
        {activeMembersLoading && activeCompanyMembers.length === 0 ? (
          <EmptyPanel title="Loading company people…" text="Reading the company Users tab." />
        ) : !activeMembersLoadError && activeCompanyMembers.length === 0 ? (
          <EmptyPanel title="No company people yet" text="Profiles appear here once someone is invited or added." />
        ) : activeCompanyMembers.length === 0 ? null : (
          <div className="mt-3 space-y-2">
            {activeCompanyMembers.map((member) => (
              <ActiveUserCard
                key={member.email}
                member={member}
                currentUserRole={currentUserRole}
                currentUserEmail={currentUserEmail}
                editing={companyMemberEditing}
                slatePrimaryCtaInteract={slatePrimaryCtaInteract}
                onEdit={(target, input) => onUpdateCompanyMember?.(target, input)}
                onDeactivate={(target) => onDeactivateCompanyMember?.(target)}
                onRemove={
                  canManageCompanyMembers(currentUserRole)
                    ? (target) =>
                        onRemoveCompanyUser({
                          id: `active-${target.email}`,
                          email: target.email,
                          role: target.role as Role,
                          status: "Active",
                          invitedBy: "Godmode",
                          sentAt: "",
                        })
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className={pilotLightNested}>
        <p className="text-sm font-semibold text-slate-900">Existing users &amp; invites</p>
        {invitedUsers.length === 0 ? (
          <EmptyPanel
            title="No invites yet"
            text="Send an invite link above once the company workspace is live."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {invitedUsers.map((invite) => {
              const staleOrIncomplete =
                isStaleOrIncompleteInviteStatus(invite.status) || isLegacyInviteRowId(invite.id);
              return (
                <li
                  key={invite.id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{invite.email}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {formatUserRoleLabel(invite.role)}
                      </span>
                      <span
                        className={inviteStatusBadgeClass(invite.status)}
                        title={getInviteStatusHelp(invite.status)}
                      >
                        {formatInviteStatusLabel(invite.status)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onResendInvite(invite)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      {staleOrIncomplete ? "Send fresh invite" : "Resend"}
                    </button>
                    {isActiveCompanyUserInvite(invite) ? (
                      <DangerActionButton
                        type="button"
                        onClick={() => onRemoveCompanyUser(invite)}
                        className="rounded-lg px-3 py-1.5 text-xs"
                      >
                        Remove user
                      </DangerActionButton>
                    ) : (
                      <DangerActionButton
                        type="button"
                        onClick={() => onDeleteInvite(invite)}
                        className="rounded-lg px-3 py-1.5 text-xs"
                      >
                        {staleOrIncomplete ? "Revoke" : "Delete"}
                      </DangerActionButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <InviteStatusLegend className="mt-3" />
      </div>
    </div>
  );
}
