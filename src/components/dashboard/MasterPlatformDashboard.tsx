import type { NavItemId } from "../../types/navigation";
import type { ReactNode } from "react";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import type { BriefingRecipientRecord } from "../../types/briefings";
import { AnimatedCard } from "../animation/AnimatedCard";
import { DashboardLandingCard } from "./RoleDashboardPrimitives";
import { RoleUnifiedDashboard } from "./unified/RoleUnifiedDashboard";

type Props = {
  displayName: string;
  companiesCount: number;
  pendingOnboardingCount: number;
  onNavigate: (screen: NavItemId) => void;
  onOpenInitialSetup: () => void;
  onOpenSelectCompany?: () => void;
  companyWorkspaceLinked?: boolean;
  assignedAudits?: Audit[];
  drafts?: Record<string, AuditDraft>;
  assignedCheckScheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  assignedChecksLoadErrorDetail?: string;
  onRetryAssignedChecks?: () => void;
  onOpenAudit?: (auditId: string) => void;
  briefingTodoItems?: BriefingRecipientRecord[];
  briefingTodoLoading?: boolean;
  onOpenBriefing?: (briefingId: string) => void;
  onViewAllBriefings?: () => void;
  pendingSyncCount?: number;
  failedSyncCount?: number;
  onboardingSlot?: React.ReactNode;
};

/** Master platform home with unified operational layout. */
export function MasterPlatformDashboard({
  displayName,
  companiesCount,
  pendingOnboardingCount,
  onNavigate,
  onOpenInitialSetup,
  onOpenSelectCompany,
  companyWorkspaceLinked = false,
  assignedAudits = [],
  drafts = {},
  assignedCheckScheduleMeta = {},
  assignedChecksLoading = false,
  assignedChecksLoadError,
  onRetryAssignedChecks,
  onOpenAudit,
  briefingTodoItems = [],
  briefingTodoLoading = false,
  onOpenBriefing,
  pendingSyncCount = 0,
  failedSyncCount = 0,
  onboardingSlot,
}: Props) {
  void companiesCount;

  const openSelect = () => {
    onOpenSelectCompany?.();
    onNavigate("godmodeHome");
  };

  const secondaryContent = (
    <div className="grid gap-4 sm:grid-cols-2">
      <AnimatedCard index={0}>
        <DashboardLandingCard
          role="Master"
          title="Work on existing company"
          description="Pick a live company workspace before viewing users, checks, actions, or reports."
          actionLabel="Select company"
          onAction={openSelect}
          primary
          iconTone="orange"
        />
      </AnimatedCard>
      <AnimatedCard index={1}>
        <DashboardLandingCard
          role="Master"
          title="Create new company"
          description="Start clean. No old users, checks, invites, or company data carried over."
          actionLabel="Create company +"
          onAction={() => onNavigate("onboarding")}
          iconTone="blue"
        />
      </AnimatedCard>
      <AnimatedCard index={2}>
        <DashboardLandingCard
          role="Master"
          title="Platform setup"
          description="Google, Shared Drive, email, and platform readiness in one place."
          actionLabel="Open setup"
          onAction={() => onOpenInitialSetup()}
          iconTone="grey"
        />
      </AnimatedCard>
      <AnimatedCard index={3}>
        <DashboardLandingCard
          role="Master"
          title="Reports / Diagnostics"
          description="Check platform health and readiness without entering a company workspace."
          actionLabel="Open diagnostics"
          onAction={() => onNavigate("reports")}
          iconTone="green"
        />
      </AnimatedCard>
    </div>
  );

  return (
    <RoleUnifiedDashboard
      role="Master"
      displayName={displayName}
      assignedAudits={companyWorkspaceLinked ? assignedAudits : []}
      drafts={drafts}
      assignedCheckScheduleMeta={assignedCheckScheduleMeta}
      assignedChecksLoading={companyWorkspaceLinked ? assignedChecksLoading : false}
      assignedChecksLoadError={assignedChecksLoadError}
      onRetryAssignedChecks={onRetryAssignedChecks}
      briefingTodoItems={companyWorkspaceLinked ? briefingTodoItems : []}
      briefingTodoLoading={briefingTodoLoading}
      pendingOnboardingCount={pendingOnboardingCount}
      pendingSyncCount={pendingSyncCount}
      failedSyncCount={failedSyncCount}
      onNavigate={onNavigate}
      onOpenAudit={onOpenAudit ?? (() => undefined)}
      onOpenBriefing={onOpenBriefing}
      secondaryContent={secondaryContent}
      topSlot={companyWorkspaceLinked ? onboardingSlot : null}
    />
  );
}
