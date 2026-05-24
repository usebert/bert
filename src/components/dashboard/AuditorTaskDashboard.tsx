import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import { amberThresholdHours, getAuditTrafficStatus, getDueWarning } from "../../utils/dashboardHealth";
import { pickNextAuditorAudit, rankAuditorAudit } from "../../utils/auditorDashboard";
import { DashboardQuickActions, RoleDashboardShell, StatusTile } from "./RoleDashboardPrimitives";
import { EmptyPanel, StartHereCard, StatusBadge } from "./DashboardPrimitives";

type Props = AuditorTaskDashboardProps & {
  workspaceName: string;
  onNavigate: (screen: NavItemId) => void;
};

export function AuditorTaskDashboard({
  workspaceName,
  currentUser,
  assignedAudits,
  drafts,
  showStartHereCard,
  onOpenAudit,
  onNavigate,
  slatePrimaryCtaInteract,
}: Props) {
  void currentUser;
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
    () => sortedAudits.filter((audit) => audit.dueHours >= 0 && audit.dueHours <= 24),
    [sortedAudits],
  );
  const nextAudit = useMemo(() => pickNextAuditorAudit(sortedAudits, drafts), [sortedAudits, drafts]);
  const primaryLabel = useMemo(() => {
    if (!nextAudit) return "No checks assigned";
    if (drafts[nextAudit.id]) return "Continue check";
    return "Start check";
  }, [nextAudit, drafts]);

  return (
    <div className="space-y-4">
      {showStartHereCard ? <StartHereCard /> : null}
      <RoleDashboardShell eyebrow="Today's work" title={workspaceName} intro="Complete assigned checks and submit records from this tablet.">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusTile label="Today's checks" value={String(todaysChecks.length)} />
          <StatusTile label="In progress" value={String(sortedAudits.filter((a) => drafts[a.id]).length)} />
          <StatusTile
            label="Due soon"
            value={String(sortedAudits.filter((a) => a.dueHours >= 0 && a.dueHours < amberThresholdHours).length)}
          />
        </div>

        {sortedAudits.length === 0 ? (
          <EmptyPanel
            title="No checks assigned"
            text="When your manager assigns checks to you, they will appear here with Start and Continue actions."
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => nextAudit && onOpenAudit(nextAudit.id)}
              disabled={!nextAudit}
              className={`min-h-[52px] w-full rounded-2xl text-lg font-semibold ${
                nextAudit ? `bg-slate-900 text-white ${slatePrimaryCtaInteract}` : "cursor-not-allowed bg-slate-200 text-slate-600"
              }`}
            >
              {primaryLabel}
            </button>
            {nextAudit ? (
              <p className="text-sm text-slate-600">
                {drafts[nextAudit.id] ? `Resume ${nextAudit.name}` : `Next: ${nextAudit.name} · ${getDueWarning(nextAudit.dueHours)}`}
              </p>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Today's checks</p>
              <div className="mt-2 space-y-2">
                {(todaysChecks.length > 0 ? todaysChecks : sortedAudits).slice(0, 5).map((audit) => (
                  <button
                    key={audit.id}
                    type="button"
                    onClick={() => onOpenAudit(audit.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left"
                  >
                    <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{audit.name}</p>
                      <p className="text-xs text-slate-500">{getDueWarning(audit.dueHours)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                      {drafts[audit.id] ? "Continue" : "Start"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <DashboardQuickActions
          actions={[
            { label: "My Checks", screen: "audits", onClick: () => onNavigate("audits") },
            { label: "Submit", screen: "incidents", onClick: () => onNavigate("incidents") },
            { label: "History", screen: "sync", onClick: () => onNavigate("sync") },
          ]}
        />
      </RoleDashboardShell>
    </div>
  );
}
