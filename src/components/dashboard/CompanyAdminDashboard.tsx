import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { UserInvite } from "../../types/adminScreenProps";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import type { QmsReadinessSummary } from "../../types/qms";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { AnimatedCard } from "../animation/AnimatedCard";
import type { BriefingRecipientRecord } from "../../types/briefings";
import {
  DASHBOARD_CARD,
  SetupChecklistRow,
  TodayMetricBlock,
} from "./RoleDashboardPrimitives";
import { DashboardLayoutBoard } from "../dashboard-layout/DashboardLayoutBoard";
import { LolerSummaryCard } from "./LolerSummaryCard";
import { CalendarSummaryCard } from "./CalendarSummaryCard";
import { RoleUnifiedDashboard } from "./unified/RoleUnifiedDashboard";

const SETUP_STEPS: Array<{
  id: string;
  titleKey: string;
  actionKey: string;
  screen: NavItemId;
  isDone: (ctx: SetupContext) => boolean;
  alwaysReady?: boolean;
}> = [
  {
    id: "workspace",
    titleKey: "dashboard.workspaceReady",
    actionKey: "common.next",
    screen: "dashboard",
    isDone: () => true,
    alwaysReady: true,
  },
  {
    id: "users",
    titleKey: "dashboard.inviteFirstAuditor",
    actionKey: "common.next",
    screen: "users",
    isDone: (ctx) => ctx.invitedUsers.length > 0,
  },
  {
    id: "checks",
    titleKey: "dashboard.addOneCheck",
    actionKey: "dashboard.addCheck",
    screen: "audits",
    isDone: (ctx) => ctx.assignedAudits.length > 0,
  },
  {
    id: "schedules",
    titleKey: "dashboard.scheduleFirstCheck",
    actionKey: "dashboard.schedule",
    screen: "schedules",
    isDone: () => false,
  },
  {
    id: "reports",
    titleKey: "dashboard.runFirstReport",
    actionKey: "dashboard.createReport",
    screen: "reports",
    isDone: (ctx) => ctx.openReportsCount > 0 || ctx.history.length > 0,
  },
];

type SetupContext = {
  invitedUsers: UserInvite[];
  assignedAudits: Audit[];
  openReportsCount: number;
  history: HistoryEntry[];
};

type Props = {
  displayName: string;
  masterSheetId?: string;
  companyName?: string;
  workspaceName: string;
  companyFolderId?: string;
  userIdentity?: string;
  invitedUsers: UserInvite[];
  assignedAudits: Audit[];
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
  actions: ActionItem[];
  openActionsCount?: number;
  openActionsCountLoading?: boolean;
  history: HistoryEntry[];
  openReportsCount: number;
  syncIssueCount?: number;
  pendingSyncCount?: number;
  failedSyncCount?: number;
  qmsSummary?: QmsReadinessSummary | null;
  onNavigate: (screen: NavItemId) => void;
  onNavigateWithFilter?: (screen: NavItemId, actionFilter?: string) => void;
  onOpenAudit: (auditId: string) => void;
  onboardingSlot?: React.ReactNode;
};

export function CompanyAdminDashboard({
  displayName,
  masterSheetId = "",
  companyName = "",
  workspaceName,
  companyFolderId = "",
  userIdentity = "",
  invitedUsers,
  assignedAudits,
  drafts,
  assignedCheckScheduleMeta,
  assignedChecksLoading = false,
  assignedChecksLoadError,
  onRetryAssignedChecks,
  briefingTodoItems = [],
  briefingTodoLoading = false,
  onOpenBriefing,
  actions,
  openActionsCount,
  openActionsCountLoading = false,
  history,
  openReportsCount,
  syncIssueCount = 0,
  pendingSyncCount = 0,
  failedSyncCount = 0,
  qmsSummary,
  onNavigate,
  onNavigateWithFilter,
  onOpenAudit,
  onboardingSlot,
}: Props) {
  void workspaceName;
  const { t } = useTranslation();

  const setupCtx: SetupContext = { invitedUsers, assignedAudits, openReportsCount, history };
  const openActionsMetric = useMemo(() => {
    if (openActionsCountLoading) {
      return "—";
    }
    if (typeof openActionsCount === "number") {
      return String(openActionsCount);
    }
    return String(actions.filter((a) => a.status !== "Closed").length);
  }, [actions, openActionsCount, openActionsCountLoading]);
  const reportsReady = openReportsCount;

  const secondaryContent = (
    <DashboardLayoutBoard
      catalogId="company-admin"
      companyFolderId={companyFolderId}
      userIdentity={userIdentity}
      listClassName="space-y-6"
      cards={{
        "next-steps": (
          <AnimatedCard as="section" index={0} className={[DASHBOARD_CARD, "lg:col-span-2"].join(" ")}>
            <h2 className="text-lg font-black text-slate-900">{t("dashboard.nextSteps")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t("dashboard.companySubtitle")}</p>
            <ol className="mt-5 space-y-3">
              {SETUP_STEPS.map((step) => {
                const done = step.isDone(setupCtx);
                return (
                  <SetupChecklistRow
                    key={step.id}
                    done={done}
                    title={t(step.titleKey)}
                    readyBadge={step.alwaysReady && done}
                    actionLabel={!done && !step.alwaysReady ? t(step.actionKey) : undefined}
                    onAction={!done && !step.alwaysReady ? () => onNavigate(step.screen) : undefined}
                  />
                );
              })}
            </ol>
          </AnimatedCard>
        ),
        "today-panel": (
          <AnimatedCard as="section" index={1} className={DASHBOARD_CARD}>
            <h2 className="text-lg font-black text-slate-900">{t("dashboard.today")}</h2>
            <div className="mt-4 space-y-3">
              <TodayMetricBlock value={openActionsMetric} label={t("dashboard.openActions")} tone="orange" />
              <TodayMetricBlock value={String(reportsReady)} label={t("dashboard.createReport")} tone="blue" />
              <TodayMetricBlock value={String(syncIssueCount)} label={t("nav.syncCentre")} tone="green" />
            </div>
          </AnimatedCard>
        ),
        "qms-summary": qmsSummary ? (
          <AnimatedCard index={3}>
            <QmsReadinessSummaryWidget
              summary={qmsSummary}
              compact
              onOpenHub={() => onNavigate("qmsReadiness")}
              onNavigate={onNavigate}
              onOpenReviewPack={() => onNavigate("reports")}
            />
          </AnimatedCard>
        ) : null,
        "loler-summary": (
          <AnimatedCard index={4}>
            <LolerSummaryCard companyFolderId={companyFolderId} onNavigate={onNavigate} />
          </AnimatedCard>
        ),
        "calendar-summary": (
          <AnimatedCard index={5}>
            <CalendarSummaryCard companyFolderId={companyFolderId} onNavigate={onNavigate} />
          </AnimatedCard>
        ),
      }}
    />
  );

  return (
    <RoleUnifiedDashboard
      role="Admin"
      displayName={displayName}
      companyFolderId={companyFolderId}
      masterSheetId={masterSheetId}
      companyName={companyName}
      userEmail={userIdentity}
      assignedAudits={assignedAudits}
      drafts={drafts}
      assignedCheckScheduleMeta={assignedCheckScheduleMeta}
      assignedChecksLoading={assignedChecksLoading}
      assignedChecksLoadError={assignedChecksLoadError}
      onRetryAssignedChecks={onRetryAssignedChecks}
      briefingTodoItems={briefingTodoItems}
      briefingTodoLoading={briefingTodoLoading}
      actions={actions}
      history={history}
      pendingSyncCount={pendingSyncCount || syncIssueCount}
      failedSyncCount={failedSyncCount}
      onNavigate={onNavigate}
      onNavigateWithFilter={onNavigateWithFilter}
      onOpenAudit={onOpenAudit}
      onOpenBriefing={onOpenBriefing}
      secondaryContent={secondaryContent}
      topSlot={onboardingSlot}
    />
  );
}
