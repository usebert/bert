import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem } from "../../types/reportsScreenProps";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { ManagerDashboardProps } from "../../types/dashboardScreenProps";
import { isOverdue } from "../../utils/managerDashboard";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { AnimatedCard } from "../animation/AnimatedCard";
import type { BriefingRecipientRecord } from "../../types/briefings";
import { DashboardToDoSection } from "./DashboardToDoSection";
import {
  DASHBOARD_CARD,
  ManagerSummaryCard,
  OpenActionRow,
  RoleDashboardShell,
} from "./RoleDashboardPrimitives";
import { DashboardLayoutBoard } from "../dashboard-layout/DashboardLayoutBoard";
import { LolerSummaryCard } from "./LolerSummaryCard";
import { CalendarSummaryCard } from "./CalendarSummaryCard";

type Props = ManagerDashboardProps & {
  workspaceName: string;
  teamCount: number;
  companyFolderId?: string;
  userIdentity?: string;
  nonConformances?: Array<{ id: string; reference: string; auditQuestion: string; status: string; site: string }>;
  onNavigate: (screen: NavItemId) => void;
  drafts: Record<string, AuditDraft>;
  assignedCheckScheduleMeta: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  assignedChecksLoadErrorDetail?: string;
  onRetryAssignedChecks?: () => void;
  briefingTodoItems?: BriefingRecipientRecord[];
  briefingTodoLoading?: boolean;
  onOpenBriefing?: (briefingId: string) => void;
  onViewAllBriefings?: () => void;
};

function actionStatusLabel(
  action: ActionItem,
  labels: { overdue: string; evidenceNeeded: string; open: string },
): { label: string; tone: "danger" | "warning" | "info" | "neutral" } {
  if (isOverdue(action)) return { label: labels.overdue, tone: "danger" };
  if (action.status !== "Closed" && action.evidenceRequired && action.evidenceCount === 0) {
    return { label: labels.evidenceNeeded, tone: "warning" };
  }
  if (action.status === "Open") return { label: labels.open, tone: "info" };
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

export function ManagerRoleDashboard({
  workspaceName,
  teamCount,
  companyFolderId = "",
  userIdentity = "",
  onNavigate,
  assignedAudits,
  drafts,
  assignedCheckScheduleMeta,
  assignedChecksLoading = false,
  assignedChecksLoadError,
  assignedChecksLoadErrorDetail,
  onRetryAssignedChecks,
  onOpenBriefing,
  onViewAllBriefings,
  briefingTodoItems = [],
  briefingTodoLoading = false,
  nonConformances = [],
  onOpenAudit,
  actions,
  ...managerProps
}: Props) {
  void workspaceName;
  void teamCount;
  void managerProps;
  const { t } = useTranslation();
  const statusLabels = {
    overdue: t("common.overdue"),
    evidenceNeeded: t("common.evidenceNeeded"),
    open: t("common.openStatus"),
  };

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
  const openNcrs = useMemo(
    () => nonConformances.filter((item) => item.status !== "Completed"),
    [nonConformances],
  );

  const overdueMetric = overdueActions.length === 1 ? "1 action" : `${overdueActions.length} actions`;
  const evidenceMetric = evidenceNeededActions.length === 1 ? "1 action" : `${evidenceNeededActions.length} actions`;
  const closedMetric = `${closedWeekCount} this week`;

  const layoutCards = {
    "things-to-do": (
      <DashboardToDoSection
        assignedAudits={assignedAudits}
        drafts={drafts}
        scheduleMetaByAuditId={assignedCheckScheduleMeta}
        briefingItems={briefingTodoItems}
        onOpenAudit={onOpenAudit}
        onOpenBriefing={onOpenBriefing}
        onViewAllBriefings={onViewAllBriefings}
        loading={assignedChecksLoading}
        briefingLoading={briefingTodoLoading}
        loadError={assignedChecksLoadError}
        loadErrorDetail={assignedChecksLoadErrorDetail}
        onRetry={onRetryAssignedChecks}
        role="Manager"
        cardIndex={0}
        showTeamSummary
        teamSummary={{
          overdueChecks: assignedAudits.filter((audit) => audit.dueHours < 0).length,
          unreadBriefings: briefingTodoItems.filter((item) => item.needsAction !== false).length,
        }}
      />
    ),
    "summary-metrics": (
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
    ),
    "open-actions": (
      <AnimatedCard as="section" index={4} className={DASHBOARD_CARD}>
        <h2 className="text-lg font-black text-slate-900">Open actions</h2>
        {openActions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No open corrective actions right now.</p>
        ) : (
          <ul className="mt-2">
            {openActions.slice(0, 8).map((action) => {
              const { label, tone } = actionStatusLabel(action, statusLabels);
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
    ),
    "open-ncrs": (
      <AnimatedCard as="section" index={5} className={DASHBOARD_CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-black text-slate-900">Open NCRs</h2>
          {openNcrs.length > 0 ? (
            <button
              type="button"
              onClick={() => onNavigate("nonConformance")}
              className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline"
            >
              View all
            </button>
          ) : null}
        </div>
        {openNcrs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No open non-conformances right now.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {openNcrs.slice(0, 5).map((ncr) => (
              <li key={ncr.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-semibold text-slate-900">{ncr.reference}</p>
                <p className="mt-1 text-xs text-slate-600">{ncr.auditQuestion}</p>
                <p className="mt-1 text-xs text-slate-500">{ncr.site || ncr.status}</p>
              </li>
            ))}
          </ul>
        )}
      </AnimatedCard>
    ),
    "loler-summary": (
      <AnimatedCard index={6}>
        <LolerSummaryCard companyFolderId={companyFolderId} onNavigate={onNavigate} />
      </AnimatedCard>
    ),
    "calendar-summary": (
      <AnimatedCard index={7}>
        <CalendarSummaryCard companyFolderId={companyFolderId} onNavigate={onNavigate} />
      </AnimatedCard>
    ),
  };

  return (
    <RoleDashboardShell
      role="Manager"
      eyebrow={t("dashboard.managerEyebrow")}
      title={t("dashboard.managerTitle")}
      subtitle={t("dashboard.managerSubtitle")}
      primaryAction={{ label: t("dashboard.openActions"), onClick: () => onNavigate("actions"), icon: "alert" }}
    >
      <DashboardLayoutBoard
        catalogId="manager-role"
        companyFolderId={companyFolderId}
        userIdentity={userIdentity}
        cards={layoutCards}
        listClassName="space-y-6"
      />
    </RoleDashboardShell>
  );
}
