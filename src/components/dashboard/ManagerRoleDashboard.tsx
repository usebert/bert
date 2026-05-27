import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ManagerDashboardProps } from "../../types/dashboardScreenProps";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { isOverdue } from "../../utils/managerDashboard";
import { ManagerDashboard } from "./ManagerDashboard";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import type { QmsReadinessSummary } from "../../types/qms";
import {
  DASHBOARD_CARD,
  MetricTile,
  RoleDashboardShell,
  StatusPill,
} from "./RoleDashboardPrimitives";

type Props = ManagerDashboardProps & {
  workspaceName: string;
  teamCount: number;
  qmsSummary?: QmsReadinessSummary | null;
  onNavigate: (screen: NavItemId) => void;
};

export function ManagerRoleDashboard({ workspaceName, teamCount, qmsSummary, onNavigate, ...managerProps }: Props) {
  const { assignedAudits, actions } = managerProps;
  void teamCount;

  const overdueCount = useMemo(
    () =>
      assignedAudits.filter((audit) => getAuditTrafficStatus(audit.dueHours) === "red").length +
      actions.filter((action) => isOverdue(action)).length,
    [assignedAudits, actions],
  );
  const evidenceNeeded = useMemo(
    () =>
      actions.filter(
        (action) => action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0,
      ).length,
    [actions],
  );
  const closedCount = useMemo(() => actions.filter((action) => action.status === "Closed").length, [actions]);
  const openActions = useMemo(() => actions.filter((action) => action.status !== "Closed"), [actions]);

  return (
    <div className="space-y-6">
      <RoleDashboardShell
        role="Manager"
        eyebrow="Operations"
        title="What needs fixing?"
        subtitle={workspaceName}
        primaryAction={{ label: "View actions", onClick: () => onNavigate("actions") }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricTile role="Manager" label="Overdue" value={String(overdueCount)} alertValue={overdueCount > 0} />
          <MetricTile role="Manager" label="Evidence needed" value={String(evidenceNeeded)} alertValue={evidenceNeeded > 0} />
          <MetricTile role="Manager" label="Closed" value={String(closedCount)} />
        </div>

        <section className={DASHBOARD_CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-black text-slate-900">Open actions</h2>
            {openActions.length > 0 ? <StatusPill tone="warning">{openActions.length} open</StatusPill> : null}
          </div>
          {openActions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No open corrective actions right now.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {openActions.slice(0, 8).map((action) => (
                <li key={action.id} className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{action.auditName}</p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {action.assignedToName || action.owner} · {action.dueLabel}
                    </p>
                  </div>
                  <StatusPill tone={isOverdue(action) ? "danger" : action.status === "Awaiting Verification" ? "warning" : "neutral"}>
                    {action.status}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>

        {qmsSummary ? (
          <QmsReadinessSummaryWidget
            summary={qmsSummary}
            compact
            onOpenHub={() => onNavigate("qmsReadiness")}
            onNavigate={onNavigate}
          />
        ) : null}

        <details className={DASHBOARD_CARD}>
          <summary className="cursor-pointer text-sm font-black text-slate-900">More</summary>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onNavigate("audits")}
              className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-800"
            >
              Forms & checks
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports")}
              className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-800"
            >
              Reports
            </button>
            <button
              type="button"
              onClick={() => onNavigate("invites")}
              className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-800"
            >
              Team
            </button>
          </div>
        </details>
      </RoleDashboardShell>

      <details className={DASHBOARD_CARD}>
        <summary className="cursor-pointer text-sm font-black text-slate-900">Detailed operations board</summary>
        <div className="mt-4">
          <ManagerDashboard {...managerProps} />
        </div>
      </details>
    </div>
  );
}
