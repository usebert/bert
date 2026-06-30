import type { NavItemId } from "../../types/navigation";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { DashboardThingsToDoSection } from "./DashboardThingsToDoSection";
import { DashboardLandingCard, RoleDashboardShell } from "./RoleDashboardPrimitives";

type Props = {
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
};

/** Master platform home — mirrors Godmode reference layout. */
export function MasterPlatformDashboard({
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
  assignedChecksLoadErrorDetail,
  onRetryAssignedChecks,
  onOpenAudit,
}: Props) {
  void companiesCount;
  void pendingOnboardingCount;

  const openSelect = () => {
    onOpenSelectCompany?.();
    onNavigate("godmodeHome");
  };

  const cards = [
    {
      title: "Work on existing company",
      description: "Pick a live company workspace before viewing users, checks, actions, or reports.",
      label: "Select company",
      iconTone: "orange" as const,
      onClick: openSelect,
      primary: true,
    },
    {
      title: "Create new company",
      description: "Start clean. No old users, checks, invites, or company data carried over.",
      label: "Create company +",
      iconTone: "blue" as const,
      onClick: () => onNavigate("onboarding"),
    },
    {
      title: "Platform setup",
      description: "Google, Shared Drive, email, and platform readiness in one place.",
      label: "Open setup",
      iconTone: "grey" as const,
      onClick: () => onOpenInitialSetup(),
    },
    {
      title: "Reports / Diagnostics",
      description: "Check platform health and readiness without entering a company workspace.",
      label: "Open diagnostics",
      iconTone: "green" as const,
      onClick: () => onNavigate("reports"),
    },
  ];

  return (
    <RoleDashboardShell
      role="Master"
      eyebrow="Platform control"
      title="Godmode"
      subtitle="Choose what you want to do. No company is loaded until you select one."
      primaryAction={{ label: "Select company", onClick: openSelect, icon: "search" }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <DashboardLandingCard
            key={card.title}
            role="Master"
            title={card.title}
            description={card.description}
            actionLabel={card.label}
            onAction={card.onClick}
            primary={card.primary}
            iconTone={card.iconTone}
          />
        ))}
      </div>

      {companyWorkspaceLinked && onOpenAudit ? (
        <DashboardThingsToDoSection
          assignedAudits={assignedAudits}
          drafts={drafts}
          scheduleMetaByAuditId={assignedCheckScheduleMeta}
          onOpenAudit={onOpenAudit}
          loading={assignedChecksLoading}
          loadError={assignedChecksLoadError}
          loadErrorDetail={assignedChecksLoadErrorDetail}
          onRetry={onRetryAssignedChecks}
          role="Master"
          cardIndex={4}
        />
      ) : null}
    </RoleDashboardShell>
  );
}
