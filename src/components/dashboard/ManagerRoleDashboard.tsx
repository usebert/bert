import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ManagerDashboardProps } from "../../types/dashboardScreenProps";
import { WhatHappensNextPanel } from "../WhatHappensNextPanel";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { isOverdue } from "../../utils/managerDashboard";
import { ManagerDashboard } from "./ManagerDashboard";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import type { QmsReadinessSummary } from "../../types/qms";
import { DashboardQuickActions, MetricTile, RoleDashboardShell } from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";

type Props = ManagerDashboardProps & {
  workspaceName: string;
  teamCount: number;
  qmsSummary?: QmsReadinessSummary | null;
  onNavigate: (screen: NavItemId) => void;
};

const MANAGER_NEXT_STEPS = [
  "Review open checks and overdue items on this dashboard.",
  "Assign or adjust forms and checks for your team.",
  "Follow up on reports and actions that need verification.",
];

function completedWithinDays(completedAt: string, days: number): boolean {
  const parsed = Date.parse(completedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Date.now() - parsed <= days * 24 * 60 * 60 * 1000;
}

export function ManagerRoleDashboard({ workspaceName, teamCount, qmsSummary, onNavigate, ...managerProps }: Props) {
  const { assignedAudits, actions, history } = managerProps;

  const openChecks = useMemo(
    () => assignedAudits.filter((audit) => getAuditTrafficStatus(audit.dueHours) !== "green").length,
    [assignedAudits],
  );
  const overdueItems = useMemo(
    () =>
      assignedAudits.filter((audit) => getAuditTrafficStatus(audit.dueHours) === "red").length +
      actions.filter((action) => isOverdue(action)).length,
    [assignedAudits, actions],
  );
  const completedThisWeek = useMemo(
    () => history.filter((entry) => completedWithinDays(entry.completedAt, 7)).length,
    [history],
  );

  const recentSubmissions = useMemo(
    () =>
      history.slice(0, 4).map((entry) => ({
        id: entry.id,
        name: entry.auditName || "Submission",
        when: entry.completedAt,
      })),
    [history],
  );

  return (
    <div className="space-y-5">
      <RoleDashboardShell role="Manager" title="Manager Dashboard" intro={`Day-to-day operations for ${workspaceName}.`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile role="Manager" label="My team" value={String(teamCount)} />
          <MetricTile role="Manager" label="Open checks" value={String(openChecks)} />
          <MetricTile role="Manager" label="Completed this week" value={String(completedThisWeek)} />
          <MetricTile
            role="Manager"
            label="Overdue items"
            value={String(overdueItems)}
            alertValue={overdueItems > 0}
          />
        </div>

        {assignedAudits.length === 0 ? (
          <EmptyPanel
            title="No forms or checks yet"
            text="Checks appear here when schedules are active and assigned to your sites."
          />
        ) : null}

        {qmsSummary ? (
          <QmsReadinessSummaryWidget
            summary={qmsSummary}
            compact
            onOpenHub={() => onNavigate("qmsReadiness")}
            onNavigate={onNavigate}
          />
        ) : null}

        <DashboardQuickActions
          role="Manager"
          actions={[
            { label: "Quality & safety readiness", screen: "qmsReadiness", onClick: () => onNavigate("qmsReadiness") },
            { label: "Forms & Checks", screen: "audits", onClick: () => onNavigate("audits") },
            { label: "Reports", screen: "reports", onClick: () => onNavigate("reports") },
            { label: "Team", screen: "invites", onClick: () => onNavigate("invites") },
          ]}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Recent submissions</p>
            {recentSubmissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Completed checks will appear here.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recentSubmissions.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 font-semibold text-slate-900">{entry.name}</span>
                    <button
                      type="button"
                      onClick={() => onNavigate("reports")}
                      className="shrink-0 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                    >
                      View
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <WhatHappensNextPanel title="What's next?" steps={MANAGER_NEXT_STEPS} className="border-emerald-100 bg-emerald-50/60" />
        </div>
      </RoleDashboardShell>
      <ManagerDashboard {...managerProps} />
    </div>
  );
}
