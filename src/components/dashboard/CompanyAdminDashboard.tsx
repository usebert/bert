import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { UserInvite } from "../../types/adminScreenProps";
import { formatInviteStatusLabel } from "../../utils/inviteStatusDisplay";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import type { QmsReadinessSummary } from "../../types/qms";
import { RoleDashboardShell } from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";
import { getRoleTheme } from "../../config/roleTheme";

const SETUP_STEPS: Array<{
  id: string;
  title: string;
  hint: string;
  screen: NavItemId;
  actionLabel: string;
}> = [
  { id: "users", title: "Invite users", hint: "Send setup links so people can sign in.", screen: "users", actionLabel: "Invite user" },
  { id: "areas", title: "Add areas", hint: "Optional — split the workspace by site or department.", screen: "admin", actionLabel: "Open workspace" },
  { id: "checks", title: "Set up checks", hint: "Forms, access, and schedules for inspections.", screen: "audits", actionLabel: "Forms & checks" },
  { id: "schedules", title: "Schedules", hint: "When checks are due for your team.", screen: "schedules", actionLabel: "Open schedules" },
  { id: "reports", title: "Reports", hint: "Create packs and review shared reports.", screen: "reports", actionLabel: "Open reports" },
];

type Props = {
  workspaceName: string;
  invitedUsers: UserInvite[];
  assignedAudits: Audit[];
  actions: ActionItem[];
  history: HistoryEntry[];
  openReportsCount: number;
  qmsSummary?: QmsReadinessSummary | null;
  onNavigate: (screen: NavItemId) => void;
  onOpenAudit: (auditId: string) => void;
};

export function CompanyAdminDashboard({
  workspaceName,
  invitedUsers,
  assignedAudits,
  actions,
  history,
  openReportsCount,
  qmsSummary,
  onNavigate,
  onOpenAudit,
}: Props) {
  const theme = getRoleTheme("Admin");

  const activeUsers = useMemo(
    () => invitedUsers.filter((u) => u.status === "Active" || u.loginReady === true).length,
    [invitedUsers],
  );
  const awaitingSetup = useMemo(
    () =>
      invitedUsers.filter((u) => {
        const label = formatInviteStatusLabel(u.status);
        return label === "Awaiting setup" || label === "Email sent" || label === "Invite created";
      }).length,
    [invitedUsers],
  );
  const openActions = useMemo(() => actions.filter((a) => a.status !== "Closed").length, [actions]);
  const openChecks = useMemo(
    () => assignedAudits.filter((a) => getAuditTrafficStatus(a.dueHours) !== "green").length,
    [assignedAudits],
  );

  const primaryStep = invitedUsers.length === 0 ? SETUP_STEPS[0] : openChecks > 0 ? SETUP_STEPS[2] : SETUP_STEPS[4];

  return (
    <RoleDashboardShell
      role="Admin"
      title={`${workspaceName}`}
      subtitle="Company dashboard"
      intro="Work through setup once, then use Corrective Actions and Reports day to day."
    >
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Suggested next step</p>
        <p className="mt-1 text-sm text-slate-600">{primaryStep.hint}</p>
        <button
          type="button"
          onClick={() => onNavigate(primaryStep.screen)}
          className={[
            "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold sm:w-auto",
            theme.primaryButton,
            theme.primaryButtonHover,
          ].join(" ")}
        >
          {primaryStep.actionLabel}
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Setup checklist</p>
        <ol className="mt-3 space-y-2">
          {SETUP_STEPS.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => onNavigate(step.screen)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm transition hover:bg-white"
              >
                <span>
                  <span className="font-semibold text-slate-900">{step.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{step.hint}</span>
                </span>
                <span className="shrink-0 text-slate-400" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active users</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{activeUsers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Awaiting setup</p>
          <p className={`mt-2 text-3xl font-semibold ${awaitingSetup > 0 ? "text-amber-700" : "text-slate-900"}`}>{awaitingSetup}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open actions</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{openActions}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open reports</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{openReportsCount}</p>
        </div>
      </div>

      {qmsSummary ? (
        <QmsReadinessSummaryWidget
          summary={qmsSummary}
          compact
          onOpenHub={() => onNavigate("qmsReadiness")}
          onNavigate={onNavigate}
        />
      ) : null}

      <details className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">More</summary>
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => onNavigate("actions")}
            className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"
          >
            Corrective actions
            <span aria-hidden>›</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("qmsReadiness")}
            className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"
          >
            Quality & Safety Hub
            <span aria-hidden>›</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"
          >
            Tablet / Kiosk
            <span aria-hidden>›</span>
          </button>
        </div>
      </details>

      {invitedUsers.length === 0 ? (
        <div className="space-y-3">
          <EmptyPanel
            title="No users yet"
            text="Invite your first person from Users & Invites. They will get an email to set up their login."
          />
          <button
            type="button"
            onClick={() => onNavigate("users")}
            className={[
              "inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold sm:w-auto",
              theme.primaryButton,
              theme.primaryButtonHover,
            ].join(" ")}
          >
            Invite user
          </button>
        </div>
      ) : null}

      {assignedAudits.length > 0 ? (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Upcoming checks</p>
          <div className="mt-2 space-y-2">
            {assignedAudits.slice(0, 3).map((audit) => (
              <button
                key={audit.id}
                type="button"
                onClick={() => onOpenAudit(audit.id)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-900 hover:bg-white"
              >
                {audit.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {history.length > 0 ? (
        <p className="text-xs text-slate-500">{history.length} completed check{history.length === 1 ? "" : "s"} recorded.</p>
      ) : null}
    </RoleDashboardShell>
  );
}
