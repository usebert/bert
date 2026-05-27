import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import { getRoleTheme } from "../../config/roleTheme";
import { getDueWarning } from "../../utils/dashboardHealth";
import { pickNextAuditorAudit, rankAuditorAudit } from "../../utils/auditorDashboard";
import { DASHBOARD_CARD, PageHeader, StatusPill } from "./RoleDashboardPrimitives";
import { AuditorStartHereCard, EmptyPanel } from "./DashboardPrimitives";

type Props = AuditorTaskDashboardProps & {
  workspaceName: string;
  onNavigate: (screen: NavItemId) => void;
};

function formatTodayHeading(): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

function checkStatusLabel(auditId: string, dueHours: number, drafts: Record<string, unknown>): string {
  if (drafts[auditId]) return "In progress";
  if (dueHours < 0) return "Overdue";
  return "Not started";
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
  void onNavigate;
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
        (audit) => audit.dueLabel === "Available" || (audit.dueHours >= 0 && audit.dueHours <= 24),
      ),
    [sortedAudits],
  );
  const displayChecks = todaysChecks.length > 0 ? todaysChecks : sortedAudits;
  const nextAudit = useMemo(() => pickNextAuditorAudit(sortedAudits, drafts), [sortedAudits, drafts]);

  return (
    <div className="space-y-6">
      {showStartHereCard ? <AuditorStartHereCard /> : null}
      <PageHeader
        role="Auditor"
        eyebrow="Today"
        title="Your checks"
        subtitle={`${formatTodayHeading()} · ${workspaceName}`}
      />
      <section className={DASHBOARD_CARD}>
        {displayChecks.length === 0 ? (
          <EmptyPanel
            title="No checks assigned"
            text="When your manager assigns checks, they will appear here with a big Start button."
          />
        ) : (
          <ul className="space-y-4">
            {displayChecks.slice(0, 8).map((audit) => {
              const status = checkStatusLabel(audit.id, audit.dueHours, drafts);
              const inProgress = Boolean(drafts[audit.id]);
              const pillTone = audit.dueHours < 0 ? "danger" : inProgress ? "warning" : "neutral";
              return (
                <li key={audit.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-xl font-black text-slate-900">{audit.name}</p>
                    <StatusPill tone={pillTone}>{status}</StatusPill>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{getDueWarning(audit.dueHours)}</p>
                  <button
                    type="button"
                    onClick={() => onOpenAudit(audit.id)}
                    className={[
                      "mt-5 flex min-h-16 w-full items-center justify-center rounded-2xl px-6 text-lg font-black shadow-lg transition active:scale-[0.98]",
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
        {nextAudit && displayChecks.length > 1 ? (
          <p className="mt-4 text-sm text-slate-500">Next up: {nextAudit.name}</p>
        ) : null}
      </section>
    </div>
  );
}
