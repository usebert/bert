import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import { getRoleTheme } from "../../config/roleTheme";
import { rankAuditorAudit } from "../../utils/auditorDashboard";
import { DASHBOARD_CARD, PageHeader, TabletBottomNav } from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";

type Props = AuditorTaskDashboardProps & {
  workspaceName: string;
  onNavigate: (screen: NavItemId) => void;
};

function duePillLabel(dueHours: number, inProgress: boolean): string {
  if (inProgress) return "In progress";
  if (dueHours < 0) return "Overdue";
  if (dueHours <= 2) return "Due now";
  return "Due today";
}

function estimateMinutes(questionCount: number): number {
  if (questionCount <= 0) return 3;
  return Math.max(3, Math.min(15, Math.round(questionCount * 0.75)));
}

export function AuditorTaskDashboard({
  workspaceName,
  currentUser,
  assignedAudits,
  drafts,
  showStartHereCard,
  onOpenAudit,
  onNavigate,
}: Props) {
  void currentUser;
  void workspaceName;
  void showStartHereCard;
  const theme = getRoleTheme("Auditor");

  const sortedAudits = useMemo(
    () =>
      [...assignedAudits].sort((a, b) => {
        const rankDiff = rankAuditorAudit(a, Boolean(drafts[a.id])) - rankAuditorAudit(b, Boolean(drafts[b.id]));
        if (rankDiff !== 0) return rankDiff;
        return a.dueHours - b.dueHours;
      }),
    [assignedAudits, drafts],
  );
  const todaysChecks = useMemo(
    () =>
      sortedAudits.filter(
        (audit) => audit.dueLabel === "Available" || (audit.dueHours >= 0 && audit.dueHours <= 24) || audit.dueHours < 0,
      ),
    [sortedAudits],
  );
  const displayChecks = todaysChecks.length > 0 ? todaysChecks : sortedAudits;
  const checksSubtitle =
    displayChecks.length === 1
      ? "1 check to do. Tap start and follow the steps."
      : `${displayChecks.length} checks to do. Tap start and follow the steps.`;

  return (
    <div className="space-y-6">
      <PageHeader role="Auditor" eyebrow="Tablet mode" title="Today" subtitle={checksSubtitle} />
      {displayChecks.length === 0 ? (
        <section className={DASHBOARD_CARD}>
          <EmptyPanel
            title="No checks assigned"
            text="When your manager assigns checks, they will appear here with a big Start button."
          />
        </section>
      ) : (
        <ul className="space-y-4">
          {displayChecks.slice(0, 8).map((audit) => {
            const inProgress = Boolean(drafts[audit.id]);
            const pillLabel = duePillLabel(audit.dueHours, inProgress);
            const minutes = estimateMinutes(audit.questions?.length ?? 0);
            return (
              <li key={audit.id} className={[DASHBOARD_CARD, "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"].join(" ")}>
                <div className="min-w-0 flex-1">
                  <span className="inline-flex rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-black uppercase tracking-wide text-violet-800">
                    {pillLabel}
                  </span>
                  <p className="mt-3 text-2xl font-black text-slate-900">{audit.name}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Takes about {minutes} minute{minutes === 1 ? "" : "s"}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenAudit(audit.id)}
                  className={[
                    "flex min-h-16 shrink-0 items-center justify-center rounded-2xl px-10 text-lg font-black text-white shadow-lg transition active:scale-[0.98] sm:min-w-[8rem]",
                    theme.primaryButton,
                    theme.primaryButtonHover,
                  ].join(" ")}
                >
                  {inProgress ? "Continue" : "Start"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <TabletBottomNav
        onChecks={() => onNavigate("audits")}
        onSubmit={() => onNavigate("reports")}
        onHistory={() => onNavigate("reports")}
      />
    </div>
  );
}
