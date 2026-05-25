import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import { getRoleTheme } from "../../config/roleTheme";
import { getAuditTrafficStatus, getDueWarning } from "../../utils/dashboardHealth";
import { pickNextAuditorAudit, rankAuditorAudit } from "../../utils/auditorDashboard";
import { AuditorInfoStrip, DashboardQuickActions, RoleDashboardShell } from "./RoleDashboardPrimitives";
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
      year: "numeric",
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
      <RoleDashboardShell
        role="Auditor"
        title="Today"
        subtitle={`${formatTodayHeading()} · ${workspaceName}`}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
          <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
            <p className="text-base font-semibold text-slate-900">Today&apos;s checks</p>
            {displayChecks.length === 0 ? (
              <div className="mt-3">
                <EmptyPanel
                  title="No checks assigned"
                  text="When your manager assigns checks to you, they will appear here with Start and Continue."
                />
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {displayChecks.slice(0, 8).map((audit) => {
                  const status = checkStatusLabel(audit.id, audit.dueHours, drafts);
                  const inProgress = Boolean(drafts[audit.id]);
                  return (
                    <li
                      key={audit.id}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-3.5 sm:flex-nowrap"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-slate-900">{audit.name}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {status}
                          {status !== "Not started" ? ` · ${getDueWarning(audit.dueHours)}` : ` · ${getDueWarning(audit.dueHours)}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenAudit(audit.id)}
                        className={[
                          "min-h-[2.75rem] shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition active:scale-[0.98]",
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
            {nextAudit && displayChecks.length > 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Next up: {nextAudit.name} ({getAuditTrafficStatus(nextAudit.dueHours)})
              </p>
            ) : null}
          </section>

          <div className="space-y-3">
            <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
              <p className="text-base font-semibold text-slate-900">Need to submit something?</p>
              <p className="mt-1 text-sm text-slate-600">Report an incident or near miss from the field.</p>
              <button
                type="button"
                onClick={() => onNavigate("incidents")}
                className={[
                  "mt-3 min-h-[2.75rem] w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98]",
                  theme.outlineButton,
                ].join(" ")}
              >
                Go to Submit
              </button>
            </section>

            <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
              <p className="text-base font-semibold text-slate-900">History</p>
              <p className="mt-1 text-sm text-slate-600">See checks and reports you have already sent.</p>
              <button
                type="button"
                onClick={() => onNavigate("sync")}
                className={[
                  "mt-3 min-h-[2.75rem] w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98]",
                  theme.outlineButton,
                ].join(" ")}
              >
                View History
              </button>
            </section>
          </div>
        </div>

        <DashboardQuickActions
          role="Auditor"
          actions={[
            { label: "My Checks", screen: "audits", onClick: () => onNavigate("audits") },
            { label: "Submit", screen: "incidents", onClick: () => onNavigate("incidents") },
            { label: "History", screen: "sync", onClick: () => onNavigate("sync") },
          ]}
        />

        <AuditorInfoStrip message="No checks assigned? If you think something is missing, contact your manager." />
      </RoleDashboardShell>
    </div>
  );
}
