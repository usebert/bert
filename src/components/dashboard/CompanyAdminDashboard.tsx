import { useMemo } from "react";
import type { NavItemId } from "../../types/navigation";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { UserInvite } from "../../types/adminScreenProps";
import { formatInviteStatusLabel } from "../../utils/inviteStatusDisplay";
import { getAuditTrafficStatus } from "../../utils/dashboardHealth";
import { QmsReadinessSummaryWidget } from "../qms/QmsReadinessSummaryWidget";
import { AlertTriangleIcon } from "../icons/AlertTriangleIcon";
import type { QmsReadinessSummary } from "../../types/qms";
import {
  DASHBOARD_CARD,
  MetricTile,
  RoleDashboardShell,
  SetupChecklistRow,
} from "./RoleDashboardPrimitives";
import { EmptyPanel } from "./DashboardPrimitives";
import { getRoleTheme } from "../../config/roleTheme";

const SETUP_STEPS: Array<{
  id: string;
  title: string;
  hint: string;
  screen: NavItemId;
  actionLabel: string;
  isDone: (ctx: SetupContext) => boolean;
}> = [
  {
    id: "users",
    title: "Invite users",
    hint: "Send setup links so people can sign in.",
    screen: "users",
    actionLabel: "Invite user",
    isDone: (ctx) => ctx.invitedUsers.length > 0,
  },
  {
    id: "areas",
    title: "Add areas",
    hint: "Optional — split the workspace by site or department.",
    screen: "admin",
    actionLabel: "Open workspace",
    isDone: () => false,
  },
  {
    id: "checks",
    title: "Set up checks",
    hint: "Forms, access, and schedules for inspections.",
    screen: "audits",
    actionLabel: "Forms & checks",
    isDone: (ctx) => ctx.assignedAudits.length > 0,
  },
  {
    id: "schedules",
    title: "Schedules",
    hint: "When checks are due for your team.",
    screen: "schedules",
    actionLabel: "Open schedules",
    isDone: () => false,
  },
  {
    id: "reports",
    title: "Reports",
    hint: "Create packs and review shared reports.",
    screen: "reports",
    actionLabel: "Open reports",
    isDone: (ctx) => ctx.openReportsCount > 0 || ctx.history.length > 0,
  },
];

type SetupContext = {
  invitedUsers: UserInvite[];
  assignedAudits: Audit[];
  openReportsCount: number;
  history: HistoryEntry[];
};

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
  const setupCtx: SetupContext = { invitedUsers, assignedAudits, openReportsCount, history };

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
  const reportReady = openReportsCount > 0;

  return (
    <RoleDashboardShell
      role="Admin"
      eyebrow="Company admin"
      title="Set up and stay in control"
      subtitle={`${workspaceName} · Work through setup once, then use Corrective Actions and Reports day to day.`}
      primaryAction={{ label: "Invite user", onClick: () => onNavigate("users") }}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <section className={[DASHBOARD_CARD, "lg:col-span-2"].join(" ")}>
          <h2 className="text-lg font-black text-slate-900">Next steps</h2>
          <p className="mt-1 text-sm text-slate-600">Tick off setup tasks for your workspace.</p>
          <ol className="mt-5 space-y-3">
            {SETUP_STEPS.map((step) => (
              <SetupChecklistRow
                key={step.id}
                done={step.isDone(setupCtx)}
                title={step.title}
                hint={step.hint}
                actionLabel={step.actionLabel}
                onAction={() => onNavigate(step.screen)}
              />
            ))}
          </ol>
        </section>

        <aside className="space-y-4">
          <section className={DASHBOARD_CARD}>
            <h2 className="text-lg font-black text-slate-900">Today</h2>
            <div className="mt-4 space-y-3">
              <MetricTile role="Admin" label="Actions open" value={String(openActions)} alertValue={openActions > 0} onLinkClick={() => onNavigate("actions")} linkLabel="View actions" />
              <MetricTile
                role="Admin"
                label="Reports ready"
                value={reportReady ? String(openReportsCount) : "—"}
                hint={reportReady ? "Open reports to review" : "No open report packs yet"}
                onLinkClick={reportReady ? () => onNavigate("reports") : undefined}
                linkLabel={reportReady ? "Open reports" : undefined}
              />
              <MetricTile role="Admin" label="Open checks" value={String(openChecks)} alertValue={openChecks > 0} />
              <MetricTile role="Admin" label="Awaiting setup" value={String(awaitingSetup)} alertValue={awaitingSetup > 0} />
              <MetricTile role="Admin" label="Active users" value={String(activeUsers)} />
            </div>
          </section>
        </aside>
      </div>

      {qmsSummary ? (
        <QmsReadinessSummaryWidget
          summary={qmsSummary}
          compact
          onOpenHub={() => onNavigate("qmsReadiness")}
          onNavigate={onNavigate}
        />
      ) : null}

      <details className={DASHBOARD_CARD}>
        <summary className="cursor-pointer text-sm font-black text-slate-900">More</summary>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => onNavigate("actions")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800"
          >
            Corrective actions
            <span aria-hidden>›</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("qmsReadiness")}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                <AlertTriangleIcon className="h-4 w-4" />
              </span>
              Quality & Safety Hub
            </span>
            <span aria-hidden>›</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800"
          >
            Tablet / Kiosk
            <span aria-hidden>›</span>
          </button>
        </div>
      </details>

      {invitedUsers.length === 0 ? (
        <div className={[DASHBOARD_CARD, "space-y-4"].join(" ")}>
          <EmptyPanel
            title="No users yet"
            text="Invite your first person from Users & Invites. They will get an email to set up their login."
          />
          <button
            type="button"
            onClick={() => onNavigate("users")}
            className={[
              "inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-5 text-sm font-black shadow-lg sm:w-auto",
              theme.primaryButton,
              theme.primaryButtonHover,
            ].join(" ")}
          >
            Invite user
          </button>
        </div>
      ) : null}

      {assignedAudits.length > 0 ? (
        <section className={DASHBOARD_CARD}>
          <p className="text-lg font-black text-slate-900">Upcoming checks</p>
          <div className="mt-4 space-y-2">
            {assignedAudits.slice(0, 3).map((audit) => (
              <button
                key={audit.id}
                type="button"
                onClick={() => onOpenAudit(audit.id)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-900 hover:bg-white"
              >
                {audit.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </RoleDashboardShell>
  );
}
