import type { NavItemId } from "../../types/navigation";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { HistoryEntry } from "../../types/reportsScreenProps";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { RoleUnifiedDashboard } from "./unified/RoleUnifiedDashboard";

type Props = AuditorTaskDashboardProps & {
  displayName: string;
  workspaceName: string;
  companyFolderId?: string;
  masterSheetId?: string;
  companyName?: string;
  userIdentity?: string;
  history?: HistoryEntry[];
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
  onNavigateWithFilter?: (screen: NavItemId, actionFilter?: string) => void;
};

export function AuditorTaskDashboard({
  displayName,
  currentUser,
  companyFolderId = "",
  masterSheetId = "",
  companyName = "",
  userIdentity = "",
  assignedAudits,
  drafts,
  actions,
  history = [],
  pendingSyncCount,
  failedSyncCount,
  assignedCheckScheduleMeta = {},
  assignedChecksLoading = false,
  assignedChecksLoadError,
  onRetryAssignedChecks,
  briefingTodoItems = [],
  briefingTodoLoading = false,
  onOpenBriefing,
  onOpenAudit,
  onNavigate,
  onNavigateWithFilter,
  ...rest
}: Props) {
  void currentUser;
  void rest;

  return (
    <RoleUnifiedDashboard
      role="Auditor"
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
      pendingSyncCount={pendingSyncCount}
      failedSyncCount={failedSyncCount}
      includeActivityUser={false}
      onNavigate={onNavigate}
      onNavigateWithFilter={onNavigateWithFilter}
      onOpenAudit={onOpenAudit}
      onOpenBriefing={onOpenBriefing}
    />
  );
}
