import type { NavItemId } from "../../types/navigation";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { DashboardToDoSection } from "./DashboardToDoSection";
import { PageHeader, TabletBottomNav } from "./RoleDashboardPrimitives";

type Props = AuditorTaskDashboardProps & {
  workspaceName: string;
  assignedCheckScheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  assignedChecksLoadErrorDetail?: string;
  onRetryAssignedChecks?: () => void;
  briefingTodoItems?: BriefingRecipientRecord[];
  briefingTodoLoading?: boolean;
  onOpenBriefing?: (briefingId: string) => void;
  onViewAllBriefings?: () => void;
  onNavigate: (screen: NavItemId) => void;
};

export function AuditorTaskDashboard({
  workspaceName,
  currentUser,
  assignedAudits,
  drafts,
  assignedCheckScheduleMeta = {},
  assignedChecksLoading = false,
  assignedChecksLoadError,
  assignedChecksLoadErrorDetail,
  onRetryAssignedChecks,
  briefingTodoItems = [],
  briefingTodoLoading = false,
  onOpenBriefing,
  onViewAllBriefings,
  showStartHereCard,
  onOpenAudit,
  onNavigate,
}: Props) {
  void currentUser;
  void workspaceName;
  void showStartHereCard;

  const checksSubtitle =
    assignedAudits.length === 1
      ? "1 check to do. Tap start and follow the steps."
      : assignedAudits.length > 0
        ? `${assignedAudits.length} checks to do. Tap start and follow the steps.`
        : "When your manager assigns checks, they will appear here with a big Start button.";

  return (
    <div className="space-y-6">
      <PageHeader role="Auditor" eyebrow="Tablet mode" title="Today" subtitle={checksSubtitle} />

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
        role="Auditor"
        cardIndex={0}
      />

      <TabletBottomNav
        onChecks={() => onNavigate("audits")}
        onSubmit={() => onNavigate("reports")}
        onHistory={() => onNavigate("reports")}
      />
    </div>
  );
}
