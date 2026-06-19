import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem } from "../../types/reportsScreenProps";
import type { ManagerDashboardProps } from "../../types/dashboardScreenProps";
import { isOverdue } from "../../utils/managerDashboard";
import { AnimatedCard } from "../animation/AnimatedCard";
import {
  DASHBOARD_CARD,
  ManagerSummaryCard,
  OpenActionRow,
  RoleDashboardShell,
} from "./RoleDashboardPrimitives";

type Props = ManagerDashboardProps & {
  workspaceName: string;
  teamCount: number;
  onNavigate: (screen: NavItemId) => void;
};

function actionStatusLabel(action: ActionItem): { label: string; tone: "danger" | "warning" | "info" | "neutral" } {
  if (isOverdue(action)) return { label: "Overdue", tone: "danger" };
  if (action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0) {
    return { label: "Evidence needed", tone: "warning" };
  }
  if (action.status === "Open") return { label: "Open", tone: "info" };
  return { label: action.status, tone: "neutral" };
}

function closedThisWeek(actions: ActionItem[]): number {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return actions.filter((action) => {
    if (action.status !== "Closed" || !action.closedAt) return false;
    const closed = Date.parse(action.closedAt);
    return Number.isFinite(closed) && closed >= weekAgo;
  }).length;
}

export function ManagerRoleDashboard({ workspaceName, teamCount, onNavigate, actions, ...managerProps }: Props) {
  void workspaceName;
  void teamCount;
  void managerProps;

  const overdueActions = useMemo(() => actions.filter((action) => isOverdue(action)), [actions]);
  const evidenceNeededActions = useMemo(
    () =>
      actions.filter(
        (action) => action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0 && !isOverdue(action),
      ),
    [actions],
  );
  const closedWeekCount = useMemo(() => closedThisWeek(actions), [actions]);
  const openActions = useMemo(
    () =>
      actions
        .filter((action) => action.status !== "Closed")
        .sort((a, b) => {
          const aOver = isOverdue(a) ? 0 : 1;
          const bOver = isOverdue(b) ? 0 : 1;
          if (aOver !== bOver) return aOver - bOver;
          return a.dueHours - b.dueHours;
        }),
    [actions],
  );

  const overdueMetric = overdueActions.length === 1 ? "1 action" : `${overdueActions.length} actions`;
  const evidenceMetric = evidenceNeededActions.length === 1 ? "1 action" : `${evidenceNeededActions.length} actions`;
  const closedMetric = `${closedWeekCount} this week`;

  return (
    <RoleDashboardShell
      role="Manager"
      eyebrow="Manager"
      title="What needs fixing?"
      subtitle="Failed checks, open actions, and evidence waiting for review. No setup clutter."
      primaryAction={{ label: "View actions", onClick: () => onNavigate("actions"), icon: "alert" }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <AnimatedCard index={0}>
          <ManagerSummaryCard
            pill="Overdue"
            pillTone="danger"
            metric={overdueMetric}
            description="Need attention today."
            actionLabel="Review →"
            onAction={() => onNavigate("actions")}
            primary
          />
        </AnimatedCard>
        <AnimatedCard index={1}>
          <ManagerSummaryCard
            pill="Evidence needed"
            pillTone="warning"
            metric={evidenceMetric}
            description="Waiting for a photo or document."
            actionLabel="Add evidence"
            onAction={() => onNavigate("actions")}
          />
        </AnimatedCard>
        <AnimatedCard index={2}>
          <ManagerSummaryCard
            pill="Closed"
            pillTone="success"
            metric={closedMetric}
            description="Completed with proof."
            actionLabel="View report"
            onAction={() => onNavigate("reports")}
          />
        </AnimatedCard>
      </div>

      <AnimatedCard as="section" index={3} className={DASHBOARD_CARD}>
        <h2 className="text-lg font-black text-slate-900">Open actions</h2>
        {openActions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No open corrective actions right now.</p>
        ) : (
          <ul className="mt-2">
            {openActions.slice(0, 8).map((action) => {
              const { label, tone } = actionStatusLabel(action);
              const title = action.suggestedActionTitle || action.auditName || action.questionText;
              const area = action.siteArea || action.owner;
              return (
                <OpenActionRow
                  key={action.id}
                  title={title}
                  area={area}
                  statusLabel={label}
                  statusTone={tone}
                  onOpen={() => onNavigate("actions")}
                />
              );
            })}
          </ul>
        )}
      </AnimatedCard>
    </RoleDashboardShell>
  );
}
