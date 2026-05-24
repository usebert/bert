import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { UserInvite } from "../../types/adminScreenProps";
import { WhatHappensNextPanel } from "../WhatHappensNextPanel";
import { formatInviteStatusLabel } from "../../utils/inviteStatusDisplay";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { DashboardQuickActions, MetricTile, RoleDashboardShell } from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";

const ADMIN_ONBOARDING_STEPS = [
  "Send a user invite from Users & Invites.",
  "The user receives a setup email and creates their login.",
  "Assign forms, checks, and site access as needed.",
  "They complete checks on tablet or web; reports sync to the workspace.",
  "Review activity and reports from this dashboard.",
];

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

  const recentActivity = useMemo(() => {
    const fromHistory = history.slice(0, 3).map((entry) => ({
      id: entry.id,
      label: entry.auditName || "Completed check",
      detail: entry.completedAt,
      tone: "green" as const,
    }));
    const fromActions = actions
      .filter((a) => a.status === "Open" || a.status === "In Progress")
      .slice(0, 2)
      .map((action) => ({
        id: action.id,
        label: action.questionText || action.auditName,
        detail: action.status,
        tone: "amber" as const,
      }));
    return [...fromHistory, ...fromActions].slice(0, 5);
  }, [history, actions]);

  return (
    <RoleDashboardShell role="Admin" title={`${workspaceName} Dashboard`} intro="Workspace metrics and quick actions for your company.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          role="Admin"
          label="Active users"
          value={String(activeUsers)}
          linkLabel="View users"
          onLinkClick={() => onNavigate("users")}
        />
        <MetricTile
          role="Admin"
          label="Awaiting setup"
          value={String(awaitingSetup)}
          alertValue={awaitingSetup > 0}
          linkLabel="Manage invites"
          onLinkClick={() => onNavigate("users")}
        />
        <MetricTile
          role="Admin"
          label="Completed checks"
          value={String(completedChecks)}
          linkLabel="View reports"
          onLinkClick={() => onNavigate("reports")}
        />
        <MetricTile
          role="Admin"
          label="Open reports"
          value={String(openReportsCount)}
          linkLabel="Open reports"
          onLinkClick={() => onNavigate("reports")}
        />
      </div>

      <DashboardQuickActions
        role="Admin"
        actions={[
          { label: "Invite User", screen: "users", onClick: () => onNavigate("users") },
          { label: "Manage Users", screen: "users", onClick: () => onNavigate("users") },
          { label: "Forms & Checks", screen: "audits", onClick: () => onNavigate("audits") },
          { label: "Reports", screen: "reports", onClick: () => onNavigate("reports") },
          { label: "Tablet / Kiosk", screen: "settings", onClick: () => onNavigate("settings") },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Recent activity</p>
          {recentActivity.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Activity will appear here as users complete checks and actions.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recentActivity.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
                  <span
                    className={[
                      "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                      item.tone === "green" ? "bg-emerald-500" : "bg-amber-500",
                    ].join(" ")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">{item.label}</span>
                    <span className="text-xs text-slate-500">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {openChecks > 0 ? (
            <p className="mt-2 text-xs text-slate-500">{openChecks} open check{openChecks === 1 ? "" : "s"} need attention.</p>
          ) : null}
        </section>

        <WhatHappensNextPanel title="What happens next?" steps={ADMIN_ONBOARDING_STEPS} className="border-blue-100 bg-blue-50/60" />
      </div>

      {invitedUsers.length === 0 ? (
        <EmptyPanel
          title="No users yet"
          text="Invite your first company user from Users & Invites. They will receive a setup email to create their login."
        />
      ) : null}

      {assignedAudits.length > 0 ? (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
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
      ) : null}
    </RoleDashboardShell>
  );
}
