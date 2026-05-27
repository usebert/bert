import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import { getRoleTheme } from "../../config/roleTheme";
import { getDueWarning } from "../../utils/dashboardHealth";
import { pickNextAuditorAudit, rankAuditorAudit } from "../../utils/auditorDashboard";
import { AuditorInfoStrip, RoleDashboardShell } from "./RoleDashboardPrimitives";
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
    <div className="space-y-5">
      {showStartHereCard ? <AuditorStartHereCard /> : null}
      <RoleDashboardShell role="Auditor" title="Today" subtitle={`${formatTodayHeading()} · ${workspaceName}`}>
        <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Today&apos;s checks</p>
          {displayChecks.length === 0 ? (
            <div className="mt-4">
              <EmptyPanel
                title="No checks assigned"
                text="When your manager assigns checks, they will appear here with a big Start button."
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {displayChecks.slice(0, 8).map((audit) => {
                const status = checkStatusLabel(audit.id, audit.dueHours, drafts);
                const inProgress = Boolean(drafts[audit.id]);
                return (
                  <li
                    key={audit.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4"
                  >
                    <p className="text-lg font-semibold text-slate-900">{audit.name}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {status} · {getDueWarning(audit.dueHours)}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenAudit(audit.id)}
                      className={[
                        "mt-4 flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl px-6 text-base font-semibold transition active:scale-[0.98]",
                        theme.primaryButton,
                        theme.primaryButtonHover,
                      ].join(" ")}
                    >
                      {inProgress ? "Continue check" : "Start check"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {nextAudit && displayChecks.length > 1 ? (
            <p className="mt-4 text-sm text-slate-500">Next: {nextAudit.name}</p>
          ) : null}
        </section>

        <details className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">More</summary>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => onNavigate("audits")}
              className={[
                "flex min-h-[2.75rem] w-full items-center justify-center rounded-xl px-4 text-sm font-semibold",
                theme.outlineButton,
              ].join(" ")}
            >
              All my checks
            </button>
            <button
              type="button"
              onClick={() => onNavigate("incidents")}
              className={[
                "flex min-h-[2.75rem] w-full items-center justify-center rounded-xl px-4 text-sm font-semibold",
                theme.outlineButton,
              ].join(" ")}
            >
              Submit a report
            </button>
            <button
              type="button"
              onClick={() => onNavigate("sync")}
              className={[
                "flex min-h-[2.75rem] w-full items-center justify-center rounded-xl px-4 text-sm font-semibold",
                theme.outlineButton,
              ].join(" ")}
            >
              History
            </button>
          </div>
        </details>

        <AuditorInfoStrip message="Missing a check? Ask your manager to assign it to you." />
      </RoleDashboardShell>
    </div>
  );
}
