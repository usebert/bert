import type { NavItemId } from "../../types/navigation";
import { getRoleTheme } from "../../config/roleTheme";
import { RoleDashboardShell } from "./RoleDashboardPrimitives";

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
  const theme = getRoleTheme("Master");

  const cards = [
    {
      title: "Work on a company",
      description: "Choose a live company to manage users, areas, checks, and reports.",
      label: "Select company",
      onClick: () => onNavigate("godmodeHome"),
    },
    {
      title: "Create a company",
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
      title: "Diagnostics",
      description: "Health checks and readiness for the platform.",
      label: "Open diagnostics",
      onClick: () => onNavigate("reports"),
    },
  ];

  return (
    <RoleDashboardShell
      role="Master"
      title="Platform"
      intro="Pick a task below. Company details appear after you select a workspace."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <article
            key={card.title}
            className="flex h-full flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm"
          >
            <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{card.description}</p>
            <button
              type="button"
              onClick={card.onClick}
              className={[
                "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold transition",
                theme.primaryButton,
                theme.primaryButtonHover,
              ].join(" ")}
            >
              {card.label}
            </button>
          </article>
        ))}
      </div>
    </RoleDashboardShell>
  );
}
