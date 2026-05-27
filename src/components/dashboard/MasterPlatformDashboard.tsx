import type { NavItemId } from "../../types/navigation";
import { DashboardLandingCard, RoleDashboardShell } from "./RoleDashboardPrimitives";

type Props = {
  companiesCount: number;
  pendingOnboardingCount: number;
  onNavigate: (screen: NavItemId) => void;
  onOpenInitialSetup: () => void;
};

/** Master platform home — mirrors Godmode cards; no company metrics or technical status here. */
export function MasterPlatformDashboard({
  companiesCount,
  pendingOnboardingCount,
  onNavigate,
  onOpenInitialSetup,
}: Props) {
  void companiesCount;
  void pendingOnboardingCount;

  const cards = [
    {
      title: "Work on existing company",
      description: "Choose a live company to manage users, areas, checks, and reports.",
      label: "Select company",
      onClick: () => onNavigate("godmodeHome"),
    },
    {
      title: "Create new company",
      description: "Start a new workspace with a clean form — no previous company data.",
      label: "Create company",
      onClick: () => onNavigate("onboarding"),
    },
    {
      title: "Platform setup",
      description: "Google, shared drive, email, and tablet kiosk.",
      label: "Open platform setup",
      onClick: () => onOpenInitialSetup(),
    },
    {
      title: "Reports / Diagnostics",
      description: "Health checks and readiness for the platform.",
      label: "Open diagnostics",
      onClick: () => onNavigate("reports"),
    },
  ];

  return (
    <RoleDashboardShell role="Master" eyebrow="Platform control" title="Platform" subtitle="No company workspace loaded. Pick a company or create one.">
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card, index) => (
          <DashboardLandingCard
            key={card.title}
            title={card.title}
            description={card.description}
            actionLabel={card.label}
            onAction={card.onClick}
            primary={index === 0}
          />
        ))}
      </div>
    </RoleDashboardShell>
  );
}
