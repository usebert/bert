import type { NavItemId } from "../../types/navigation";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { DashboardThingsToDoSection } from "./DashboardThingsToDoSection";
import { PageHeader, TabletBottomNav } from "./RoleDashboardPrimitives";

type Props = AuditorTaskDashboardProps & {
  workspaceName: string;
  assignedCheckScheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  assignedChecksLoadErrorDetail?: string;
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

      <DashboardThingsToDoSection
        assignedAudits={assignedAudits}
        drafts={drafts}
        scheduleMetaByAuditId={assignedCheckScheduleMeta}
        onOpenAudit={onOpenAudit}
        loading={assignedChecksLoading}
        loadError={assignedChecksLoadError}
        loadErrorDetail={assignedChecksLoadErrorDetail}
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
