import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import { SECTION_INTROS } from "../../config/sectionIntros";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { UserInvite } from "../../types/adminScreenProps";
import { formatInviteStatusLabel } from "../../utils/inviteStatusDisplay";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { DashboardQuickActions, RoleDashboardShell, StatusTile } from "./RoleDashboardPrimitives";
import { EmptyPanel, KpiCard } from "./DashboardPrimitives";

type Props = {
  workspaceName: string;
  invitedUsers: UserInvite[];
  assignedAudits: Audit[];
  actions: ActionItem[];
  history: HistoryEntry[];
  openReportsCount: number;
  onNavigate: (screen: NavItemId) => void;
  onOpenAudit: (auditId: string) => void;
};

export function CompanyAdminDashboard({
  workspaceName,
  invitedUsers,
  assignedAudits,
  actions,
  history,
  openReportsCount,
  onNavigate,
  onOpenAudit,
}: Props) {
  const activeUsers = useMemo(
    () => invitedUsers.filter((u) => u.status === "Active" || u.loginReady === true).length,
    [invitedUsers],
  );
  const awaitingSetup = useMemo(
    () =>
      invitedUsers.filter((u) => {
        const label = formatInviteStatusLabel(u.status);
        return label === "Awaiting setup" || label === "Email sent" || label === "Invite created";
      }).length,
    [invitedUsers],
  );
  const completedChecks = history.length;
  const openChecks = useMemo(
    () => assignedAudits.filter((a) => getAuditTrafficStatus(a.dueHours) !== "green").length,
    [assignedAudits],
  );
  const openActions = useMemo(
    () => actions.filter((a) => a.status === "Open" || a.status === "In Progress").length,
    [actions],
  );

  return (
    <RoleDashboardShell
      role="Admin"
      eyebrow="Company workspace"
      title={workspaceName}
      intro={SECTION_INTROS.workspace}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile role="Admin" label="Active users" value={String(activeUsers)} />
        <StatusTile role="Admin" label="Awaiting setup" value={String(awaitingSetup)} ok={awaitingSetup === 0 ? true : null} />
        <StatusTile role="Admin" label="Open checks" value={String(openChecks)} />
        <StatusTile role="Admin" label="Open reports" value={String(openReportsCount)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard title="Completed submissions" value={String(completedChecks)} tone="green" subtitle="Recent completions" />
        <KpiCard title="Open actions" value={String(openActions)} tone={openActions ? "amber" : "green"} subtitle="Follow-up work" />
      </div>

      {invitedUsers.length === 0 ? (
        <EmptyPanel
          title="No users yet"
          text="Invite your first company user from Users & Invites. They will receive a setup email to create their login."
        />
      ) : null}

      {assignedAudits.length === 0 ? (
        <EmptyPanel
          title="No forms or checks yet"
          text="When schedules and templates are linked to this workspace, checks will appear under Forms & Checks."
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Upcoming checks</p>
          <div className="mt-2 space-y-2">
            {assignedAudits.slice(0, 3).map((audit) => (
              <button
                key={audit.id}
                type="button"
                onClick={() => onOpenAudit(audit.id)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-900 hover:bg-white"
              >
                {audit.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {openReportsCount === 0 && completedChecks === 0 ? (
        <EmptyPanel title="No reports yet" text="Reports appear after checks are completed and synced." />
      ) : null}

      <DashboardQuickActions
        role="Admin"
        actions={[
          { label: "Invite user", screen: "users", onClick: () => onNavigate("users") },
          { label: "Manage users", screen: "users", onClick: () => onNavigate("users") },
          { label: "Forms & Checks", screen: "audits", onClick: () => onNavigate("audits") },
          { label: "Reports", screen: "reports", onClick: () => onNavigate("reports") },
          { label: "Tablet / Kiosk", screen: "settings", onClick: () => onNavigate("settings") },
        ]}
      />
    </RoleDashboardShell>
  );
}
