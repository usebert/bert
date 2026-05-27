import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ManagerDashboardProps } from "../../types/dashboardScreenProps";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { isOverdue } from "../../utils/managerDashboard";
import { ManagerDashboard } from "./ManagerDashboard";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import type { QmsReadinessSummary } from "../../types/qms";
import { RoleDashboardShell } from "./RoleDashboardPrimitives";
import { getRoleTheme } from "../../config/roleTheme";

type Props = ManagerDashboardProps & {
  workspaceName: string;
  teamCount: number;
  qmsSummary?: QmsReadinessSummary | null;
  onNavigate: (screen: NavItemId) => void;
};

export function ManagerRoleDashboard({ workspaceName, teamCount, qmsSummary, onNavigate, ...managerProps }: Props) {
  const { assignedAudits, actions } = managerProps;
  const theme = getRoleTheme("Manager");

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
  const awaitingEvidence = useMemo(
    () =>
      actions.filter(
        (action) =>
          action.status !== "Closed" &&
          action.evidenceRequired &&
          action.evidenceCount === 0,
      ).length,
    [actions],
  );

  return (
    <div className="space-y-5">
      <RoleDashboardShell role="Manager" title="Dashboard" subtitle={workspaceName} intro="Focus on open work, overdue items, and evidence needed.">
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">What needs you now</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li>
              <span className="font-semibold text-slate-900">{overdueItems}</span> overdue
            </li>
            <li>
              <span className="font-semibold text-slate-900">{openChecks}</span> open checks
            </li>
            <li>
              <span className="font-semibold text-slate-900">{awaitingEvidence}</span> awaiting evidence
            </li>
            <li>
              <span className="font-semibold text-slate-900">{teamCount}</span> people on your team
            </li>
          </ul>
          <button
            type="button"
            onClick={() => onNavigate("actions")}
            className={[
              "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold sm:w-auto",
              theme.primaryButton,
              theme.primaryButtonHover,
            ].join(" ")}
          >
            View actions
          </button>
        </section>

        {qmsSummary ? (
          <QmsReadinessSummaryWidget
            summary={qmsSummary}
            compact
            onOpenHub={() => onNavigate("qmsReadiness")}
            onNavigate={onNavigate}
          />
        ) : null}

        <details className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">More</summary>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onNavigate("audits")}
              className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800"
            >
              Forms & checks
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports")}
              className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800"
            >
              Reports
            </button>
            <button
              type="button"
              onClick={() => onNavigate("invites")}
              className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800"
            >
              Team
            </button>
          </div>
        </details>
      </RoleDashboardShell>

      <details className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Detailed operations board</summary>
        <div className="mt-4">
          <ManagerDashboard {...managerProps} />
        </div>
      </details>
    </div>
  );
}
