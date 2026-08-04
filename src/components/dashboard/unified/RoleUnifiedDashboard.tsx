import type { ReactNode } from "react";
import type { Role } from "../../../permissions";
import type { NavItemId } from "../../../types/navigation";
import type { AuditDraft } from "../../../types/dashboardScreenProps";
import type { ActionItem, Audit, HistoryEntry } from "../../../types/reportsScreenProps";
import type { BriefingRecipientRecord } from "../../../types/briefings";
import type { AssignedCheckScheduleMeta } from "../../../utils/assignedCheckDisplay";
import { UnifiedOperationalDashboard } from "../unified/UnifiedOperationalDashboard";

export type UnifiedDashboardCommonProps = {
  role: Role;
  displayName: string;
  companyFolderId?: string;
  masterSheetId?: string;
  companyName?: string;
  userEmail?: string;
  assignedAudits?: Audit[];
  drafts?: Record<string, AuditDraft>;
  assignedCheckScheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  onRetryAssignedChecks?: () => void;
  briefingTodoItems?: BriefingRecipientRecord[];
  briefingTodoLoading?: boolean;
  actions?: ActionItem[];
  history?: HistoryEntry[];
  pendingSyncCount?: number;
  failedSyncCount?: number;
  pendingOnboardingCount?: number;
  includeActivityUser?: boolean;
  onNavigate: (screen: NavItemId) => void;
  onNavigateWithFilter?: (screen: NavItemId, actionFilter?: string) => void;
  onNavigateToTarget?: (target: import("../../../presentation/searchPresentation").SearchNavigateTarget, route?: string) => void;
  onOpenAudit: (auditId: string) => void;
  onOpenBriefing?: (briefingId: string) => void;
  secondaryContent?: ReactNode;
  topSlot?: ReactNode;
};

export function RoleUnifiedDashboard(props: UnifiedDashboardCommonProps) {
  return (
    <UnifiedOperationalDashboard
      role={props.role}
      displayName={props.displayName}
      companyFolderId={props.companyFolderId}
      masterSheetId={props.masterSheetId}
      companyName={props.companyName}
      userEmail={props.userEmail}
      assignedAudits={props.assignedAudits}
      drafts={props.drafts}
      assignedCheckScheduleMeta={props.assignedCheckScheduleMeta}
      assignedChecksLoading={props.assignedChecksLoading}
      assignedChecksError={props.assignedChecksLoadError}
      onRetryAssignedChecks={props.onRetryAssignedChecks}
      briefingItems={props.briefingTodoItems}
      briefingLoading={props.briefingTodoLoading}
      actions={props.actions}
      history={props.history}
      pendingSyncCount={props.pendingSyncCount}
      failedSyncCount={props.failedSyncCount}
      pendingOnboardingCount={props.pendingOnboardingCount}
      includeActivityUser={props.includeActivityUser}
      onNavigate={props.onNavigate}
      onNavigateWithFilter={props.onNavigateWithFilter}
      onNavigateToTarget={props.onNavigateToTarget}
      onOpenAudit={props.onOpenAudit}
      onOpenBriefing={props.onOpenBriefing}
      secondaryContent={props.secondaryContent}
      topSlot={props.topSlot}
    />
  );
}
