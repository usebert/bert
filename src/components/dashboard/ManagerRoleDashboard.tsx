import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import { SECTION_INTROS } from "../../config/sectionIntros";
import type { ManagerDashboardProps } from "../../types/dashboardScreenProps";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { isOverdue } from "../../utils/managerDashboard";
import { ManagerDashboard } from "./ManagerDashboard";
import { DashboardQuickActions, RoleDashboardShell, StatusTile } from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";

type Props = ManagerDashboardProps & {
  workspaceName: string;
  teamCount: number;
  onNavigate: (screen: NavItemId) => void;
};

function completedWithinDays(completedAt: string, days: number): boolean {
  const parsed = Date.parse(completedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Date.now() - parsed <= days * 24 * 60 * 60 * 1000;
}

export function ManagerRoleDashboard({ workspaceName, teamCount, onNavigate, ...managerProps }: Props) {
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

  return (
    <div className="space-y-4">
      <RoleDashboardShell
        eyebrow="Day-to-day operations"
        title={workspaceName}
        intro={SECTION_INTROS.formsChecks}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusTile label="Team" value={String(teamCount)} hint="People in this workspace." />
          <StatusTile label="Open checks" value={String(openChecks)} />
          <StatusTile label="Completed this week" value={String(completedThisWeek)} ok={completedThisWeek > 0 ? true : null} />
          <StatusTile label="Overdue items" value={String(overdueItems)} ok={overdueItems === 0 ? true : false} />
        </div>
        {assignedAudits.length === 0 ? (
          <EmptyPanel
            title="No forms or checks yet"
            text="Checks appear here when schedules are active and assigned to your sites."
          />
        ) : null}
        <DashboardQuickActions
          actions={[
            { label: "Forms & Checks", screen: "audits", onClick: () => onNavigate("audits") },
            { label: "Reports", screen: "reports", onClick: () => onNavigate("reports") },
            { label: "Team", screen: "invites", onClick: () => onNavigate("invites") },
          ]}
        />
      </RoleDashboardShell>
      <ManagerDashboard {...managerProps} />
    </div>
  );
}
