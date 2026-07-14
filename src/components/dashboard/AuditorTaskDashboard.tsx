import { useMemo, type ReactNode } from "react";
import type { NavItemId } from "../../types/navigation";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { ActionItem } from "../../types/reportsScreenProps";
import type { AuditorTaskDashboardProps } from "../../types/dashboardScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import {
  filterAssignedChecksForThingsToDo,
  sortAssignedChecksForAction,
} from "../../utils/assignedCheckDisplay";
import { pickNextAuditorAudit } from "../../utils/auditorDashboard";
import { briefingActionLabel } from "../../utils/briefingActions";
import { AnimatedCard } from "../animation/AnimatedCard";
import { bertBtnInteractive, bertRowInteractive } from "../animation/animationClasses";
import { AssignedCheckActionRow } from "../checks/AssignedCheckActionRow";
import {
  DASHBOARD_CARD,
  PrimaryButton,
  RoleDashboardShell,
  SecondaryButton,
  TodayMetricBlock,
} from "./RoleDashboardPrimitives";

type Props = AuditorTaskDashboardProps & {
  workspaceName: string;
  assignedCheckScheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksLoadError?: string;
  assignedChecksLoadErrorDetail?: string;
  onRetryAssignedChecks?: () => void;
  briefingTodoItems?: BriefingRecipientRecord[];
  briefingTodoLoading?: boolean;
  onOpenBriefing?: (briefingId: string) => void;
  onViewAllBriefings?: () => void;
  onNavigate: (screen: NavItemId) => void;
};

function PrioritySection({
  title,
  count,
  children,
  emptyText,
}: {
  title: string;
  count: number;
  children: ReactNode;
  emptyText?: string;
}) {
  if (count === 0 && !emptyText) {
    return null;
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">{count}</span>
      </div>
      {count === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  );
}

function ActionPriorityRow({
  title,
  meta,
  actionLabel,
  onAction,
}: {
  title: string;
  meta: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <li className={["flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3", bertRowInteractive].join(" ")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 truncate text-sm text-slate-500">{meta}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className={["shrink-0 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white", bertBtnInteractive].join(" ")}
      >
        {actionLabel}
      </button>
    </li>
  );
}

export function AuditorTaskDashboard({
  currentUser,
  assignedAudits,
  drafts,
  actions,
  pendingSyncCount,
  failedSyncCount,
  assignedCheckScheduleMeta = {},
  assignedChecksLoading = false,
  assignedChecksLoadError,
  assignedChecksLoadErrorDetail,
  onRetryAssignedChecks,
  briefingTodoItems = [],
  briefingTodoLoading = false,
  onOpenBriefing,
  onViewAllBriefings,
  onOpenAudit,
  onNavigate,
}: Props) {
  void currentUser;

  const sortedChecks = useMemo(
    () =>
      sortAssignedChecksForAction(
        filterAssignedChecksForThingsToDo(assignedAudits, drafts, assignedCheckScheduleMeta),
        drafts,
      ),
    [assignedAudits, drafts, assignedCheckScheduleMeta],
  );

  const dueTodayChecks = useMemo(
    () => sortedChecks.filter((audit) => audit.dueHours >= 0 && (audit.dueLabel === "Due today" || audit.dueHours <= 24)),
    [sortedChecks],
  );
  const overdueChecks = useMemo(() => sortedChecks.filter((audit) => audit.dueHours < 0), [sortedChecks]);
  const openActions = useMemo(
    () =>
      actions
        .filter((action) => action.status !== "Closed")
        .sort((a, b) => {
          const aOver = a.dueHours < 0 ? 0 : 1;
          const bOver = b.dueHours < 0 ? 0 : 1;
          if (aOver !== bOver) return aOver - bOver;
          return a.dueHours - b.dueHours;
        }),
    [actions],
  );
  const pendingBriefings = useMemo(
    () => briefingTodoItems.filter((item) => item.needsAction === true),
    [briefingTodoItems],
  );

  const nextCheck = useMemo(() => pickNextAuditorAudit(sortedChecks, drafts), [sortedChecks, drafts]);
  const syncIssueCount = pendingSyncCount + failedSyncCount;
  const checksLoading = assignedChecksLoading && sortedChecks.length === 0 && !assignedChecksLoadError;
  const briefingsLoading = briefingTodoLoading && pendingBriefings.length === 0;

  const priorityCount =
    dueTodayChecks.length +
    overdueChecks.length +
    openActions.length +
    pendingBriefings.length +
    (syncIssueCount > 0 ? 1 : 0);

  return (
    <RoleDashboardShell role="Auditor" title="My work today" subtitle="What you need to do next.">
      <div className="grid grid-cols-2 gap-3">
        <TodayMetricBlock value={String(dueTodayChecks.length)} label="Due today" tone="blue" />
        <TodayMetricBlock value={String(overdueChecks.length)} label="Overdue" tone="orange" />
        <TodayMetricBlock value={String(openActions.length)} label="Open actions" tone="green" />
        <TodayMetricBlock value={String(pendingBriefings.length)} label="Briefings" tone="blue" />
      </div>

      <AnimatedCard as="section" index={0} className={[DASHBOARD_CARD, "space-y-5"].join(" ")}>
        <div>
          <h2 className="text-xl font-black text-slate-900">Priority list</h2>
          <p className="mt-1 text-sm text-slate-600">Tap an item to open it.</p>
        </div>

        {checksLoading || briefingsLoading ? (
          <ul className="space-y-3" aria-busy="true" aria-label="Loading work items">
            {[0, 1, 2].map((placeholder) => (
              <li key={placeholder} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </ul>
        ) : assignedChecksLoadError && sortedChecks.length === 0 ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
            <p className="text-sm font-semibold text-rose-900">Could not load your checks</p>
            <p className="mt-2 text-sm text-rose-800">{assignedChecksLoadError}</p>
            {assignedChecksLoadErrorDetail ? (
              <p className="mt-2 break-all font-mono text-xs text-rose-700">{assignedChecksLoadErrorDetail}</p>
            ) : null}
            {onRetryAssignedChecks ? (
              <button
                type="button"
                onClick={onRetryAssignedChecks}
                className="mt-3 rounded-xl bg-rose-900 px-3 py-2 text-xs font-semibold text-white"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : priorityCount === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
            You&apos;re all caught up. New checks, actions, and briefings will appear here.
          </p>
        ) : (
          <div className="space-y-5">
            <PrioritySection title="Checks due today" count={dueTodayChecks.length}>
              <ul className="space-y-2">
                {dueTodayChecks.slice(0, 6).map((audit) => (
                  <AssignedCheckActionRow
                    key={audit.id}
                    audit={audit}
                    drafts={drafts}
                    scheduleMeta={assignedCheckScheduleMeta[audit.id]}
                    onOpenAudit={onOpenAudit}
                    themeRole="Auditor"
                  />
                ))}
              </ul>
            </PrioritySection>

            <PrioritySection title="Overdue checks" count={overdueChecks.length}>
              <ul className="space-y-2">
                {overdueChecks.slice(0, 6).map((audit) => (
                  <AssignedCheckActionRow
                    key={audit.id}
                    audit={audit}
                    drafts={drafts}
                    scheduleMeta={assignedCheckScheduleMeta[audit.id]}
                    onOpenAudit={onOpenAudit}
                    themeRole="Auditor"
                  />
                ))}
              </ul>
            </PrioritySection>

            <PrioritySection title="My open actions" count={openActions.length}>
              <ul className="space-y-2">
                {openActions.slice(0, 6).map((action: ActionItem) => (
                  <ActionPriorityRow
                    key={action.id}
                    title={action.questionText || action.auditName}
                    meta={[action.siteArea, action.dueLabel].filter(Boolean).join(" • ")}
                    actionLabel="Open"
                    onAction={() => onNavigate("actions")}
                  />
                ))}
              </ul>
            </PrioritySection>

            <PrioritySection title="Briefings to read/sign" count={pendingBriefings.length}>
              <ul className="space-y-2">
                {pendingBriefings.slice(0, 6).map((item) => (
                  <ActionPriorityRow
                    key={item.briefingId}
                    title={item.briefing?.title || "Briefing"}
                    meta={[item.briefing?.type, item.status].filter(Boolean).join(" • ")}
                    actionLabel={briefingActionLabel(item)}
                    onAction={() => {
                      if (onOpenBriefing) {
                        onOpenBriefing(item.briefingId);
                        return;
                      }
                      onNavigate("briefings");
                    }}
                  />
                ))}
              </ul>
              {pendingBriefings.length > 0 && onViewAllBriefings ? (
                <button
                  type="button"
                  onClick={onViewAllBriefings}
                  className="mt-2 text-sm font-semibold text-sky-700"
                >
                  View all briefings →
                </button>
              ) : null}
            </PrioritySection>

            {syncIssueCount > 0 ? (
              <PrioritySection
                title="Failed / offline sync"
                count={syncIssueCount}
                emptyText="All work is synced."
              >
                <button
                  type="button"
                  onClick={() => onNavigate("sync")}
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-left",
                    bertRowInteractive,
                  ].join(" ")}
                >
                  <div>
                    <p className="text-base font-semibold text-amber-950">
                      {failedSyncCount > 0
                        ? `${failedSyncCount} failed • ${pendingSyncCount} waiting`
                        : `${pendingSyncCount} waiting to sync`}
                    </p>
                    <p className="mt-1 text-sm text-amber-900">Open Sync Centre to retry or review.</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-amber-900">Open →</span>
                </button>
              </PrioritySection>
            ) : null}
          </div>
        )}
      </AnimatedCard>

      <section aria-label="Quick actions" className="grid grid-cols-2 gap-3">
        <PrimaryButton
          role="Auditor"
          onClick={() => {
            if (nextCheck) {
              onOpenAudit(nextCheck.id);
              return;
            }
            onNavigate("audits");
          }}
          fullWidth
          className="min-h-[5.5rem] text-base"
        >
          Start check
        </PrimaryButton>
        <SecondaryButton onClick={() => onNavigate("actions")} className="min-h-[5.5rem] text-base font-black">
          View my actions
        </SecondaryButton>
        <SecondaryButton onClick={() => onNavigate("briefings")} className="min-h-[5.5rem] text-base font-black">
          View briefings
        </SecondaryButton>
        <SecondaryButton onClick={() => onNavigate("sync")} className="min-h-[5.5rem] text-base font-black">
          Sync Centre
        </SecondaryButton>
      </section>
    </RoleDashboardShell>
  );
}
