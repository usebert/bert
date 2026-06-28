import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { UserInvite } from "../../types/adminScreenProps";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import type { QmsReadinessSummary } from "../../types/qms";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { AnimatedCard } from "../animation/AnimatedCard";
import { DashboardThingsToDoSection } from "./DashboardThingsToDoSection";
import {
  DASHBOARD_CARD,
  RoleDashboardShell,
  SetupChecklistRow,
  TodayMetricBlock,
} from "./RoleDashboardPrimitives";

const SETUP_STEPS: Array<{
  id: string;
  title: string;
  screen: NavItemId;
  actionLabel: string;
  isDone: (ctx: SetupContext) => boolean;
  alwaysReady?: boolean;
}> = [
  {
    id: "workspace",
    title: "Workspace ready",
    screen: "dashboard",
    actionLabel: "Next",
    isDone: () => true,
    alwaysReady: true,
  },
  {
    id: "users",
    title: "Invite first auditor",
    screen: "users",
    actionLabel: "Next",
    isDone: (ctx) => ctx.invitedUsers.length > 0,
  },
  {
    id: "checks",
    title: "Add one check",
    screen: "audits",
    actionLabel: "Add check",
    isDone: (ctx) => ctx.assignedAudits.length > 0,
  },
  {
    id: "schedules",
    title: "Schedule first check",
    screen: "schedules",
    actionLabel: "Schedule",
    isDone: () => false,
  },
  {
    id: "reports",
    title: "Run first report",
    screen: "reports",
    actionLabel: "Create report",
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
  workspaceName: string;
  invitedUsers: UserInvite[];
  assignedAudits: Audit[];
  drafts: Record<string, AuditDraft>;
  assignedCheckScheduleMeta: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  assignedChecksLoadErrorDetail?: string;
  actions: ActionItem[];
  openActionsCount?: number;
  openActionsCountLoading?: boolean;
  history: HistoryEntry[];
  openReportsCount: number;
  syncIssueCount?: number;
  qmsSummary?: QmsReadinessSummary | null;
  onNavigate: (screen: NavItemId) => void;
  onOpenAudit: (auditId: string) => void;
};

export function CompanyAdminDashboard({
  workspaceName,
  invitedUsers,
  assignedAudits,
  drafts,
  assignedCheckScheduleMeta,
  assignedChecksLoading = false,
  assignedChecksLoadError,
  assignedChecksLoadErrorDetail,
  actions,
  openActionsCount,
  openActionsCountLoading = false,
  history,
  openReportsCount,
  syncIssueCount = 0,
  qmsSummary,
  onNavigate,
  onOpenAudit,
}: Props) {
  void workspaceName;

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

  return (
    <RoleDashboardShell
      role="Admin"
      eyebrow="Company workspace"
      title="Set up and stay in control"
      subtitle="One simple checklist to get the company working: users, areas, checks, schedules, reports."
      primaryAction={{ label: "Invite user", onClick: () => onNavigate("users"), icon: "invite" }}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <AnimatedCard as="section" index={0} className={[DASHBOARD_CARD, "lg:col-span-2"].join(" ")}>
          <h2 className="text-lg font-black text-slate-900">Next steps</h2>
          <p className="mt-1 text-sm text-slate-600">Finish these in order. BERT will keep the complex setup underneath.</p>
          <ol className="mt-5 space-y-3">
            {SETUP_STEPS.map((step) => {
              const done = step.isDone(setupCtx);
              return (
                <SetupChecklistRow
                  key={step.id}
                  done={done}
                  title={step.title}
                  readyBadge={step.alwaysReady && done}
                  actionLabel={!done && !step.alwaysReady ? step.actionLabel : undefined}
                  onAction={!done && !step.alwaysReady ? () => onNavigate(step.screen) : undefined}
                />
              );
            })}
          </ol>
        </AnimatedCard>

        <aside>
          <AnimatedCard as="section" index={1} className={DASHBOARD_CARD}>
            <h2 className="text-lg font-black text-slate-900">Today</h2>
            <div className="mt-4 space-y-3">
              <TodayMetricBlock value={openActionsMetric} label="actions open" tone="orange" />
              <TodayMetricBlock value={String(reportsReady)} label="report ready" tone="blue" />
              <TodayMetricBlock value={String(syncIssueCount)} label="sync issues" tone="green" />
            </div>
          </AnimatedCard>
        </aside>
      </div>

      <DashboardThingsToDoSection
        assignedAudits={assignedAudits}
        drafts={drafts}
        scheduleMetaByAuditId={assignedCheckScheduleMeta}
        onOpenAudit={onOpenAudit}
        loading={assignedChecksLoading}
        loadError={assignedChecksLoadError}
        loadErrorDetail={assignedChecksLoadErrorDetail}
        role="Admin"
        cardIndex={2}
      />

      {qmsSummary ? (
        <AnimatedCard index={3}>
        <QmsReadinessSummaryWidget
          summary={qmsSummary}
          compact
          onOpenHub={() => onNavigate("qmsReadiness")}
          onNavigate={onNavigate}
          onOpenReviewPack={() => onNavigate("reports")}
        />
        </AnimatedCard>
      ) : null}
    </RoleDashboardShell>
  );
}
