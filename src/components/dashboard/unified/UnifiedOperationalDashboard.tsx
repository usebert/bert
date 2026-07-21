import { useMemo } from "react";
import type { Role } from "../../../permissions";
import type { NavItemId } from "../../../types/navigation";
import type { AuditDraft } from "../../../types/dashboardScreenProps";
import type { ActionItem, Audit, HistoryEntry } from "../../../types/reportsScreenProps";
import type { BriefingRecipientRecord } from "../../../types/briefings";
import type { AssignedCheckScheduleMeta } from "../../../utils/assignedCheckDisplay";
import { getGreetingFirstName, getTimeBasedGreeting } from "../../../utils/userDisplay";
import { buildUnifiedDashboardSections } from "../../../dashboard/unified/buildUnifiedDashboardSections";
import { getRoleDashboardSubtitle } from "../../../dashboard/unified/roleConfig";
import type { DashboardNavTarget } from "../../../dashboard/unified/types";
import { useUnifiedLiveDashboard } from "../../../hooks/useUnifiedLiveDashboard";
import { Button } from "../../ui/Button";
import { Card, CardContent } from "../../ui/Card";
import { EmptyState, SkeletonCard, SkeletonMetric } from "../../ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../../ui/PageLayout";
import { StatusBadge, statusToBadgeVariant } from "../../ui/StatusBadge";

type Props = {
  role: Role;
  displayName: string;
  companyFolderId?: string;
  masterSheetId?: string;
  companyName?: string;
  userEmail?: string;
  assignedAudits?: Audit[];
  drafts?: Record<string, AuditDraft>;
  assignedCheckScheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  assignedChecksLoading?: boolean;
  assignedChecksError?: string;
  onRetryAssignedChecks?: () => void;
  briefingItems?: BriefingRecipientRecord[];
  briefingLoading?: boolean;
  actions?: ActionItem[];
  history?: HistoryEntry[];
  pendingSyncCount?: number;
  failedSyncCount?: number;
  pendingOnboardingCount?: number;
  includeActivityUser?: boolean;
  onNavigate: (screen: NavItemId) => void;
  onNavigateWithFilter?: (screen: NavItemId, actionFilter?: string) => void;
  onOpenAudit: (auditId: string) => void;
  onOpenBriefing?: (briefingId: string) => void;
  secondaryContent?: React.ReactNode;
  topSlot?: React.ReactNode;
};

function priorityVariant(priority: string) {
  if (priority === "Critical") return "danger";
  if (priority === "High") return "warning";
  if (priority === "Medium") return "info";
  return "neutral";
}

function followTarget(
  target: DashboardNavTarget,
  handlers: {
    onNavigate: (screen: NavItemId) => void;
    onNavigateWithFilter?: (screen: NavItemId, actionFilter?: string) => void;
    onOpenAudit: (auditId: string) => void;
    onOpenBriefing?: (briefingId: string) => void;
  },
) {
  if (target.kind === "audit") {
    handlers.onOpenAudit(target.auditId);
    return;
  }
  if (target.kind === "briefing") {
    if (handlers.onOpenBriefing) {
      handlers.onOpenBriefing(target.briefingId);
      return;
    }
    handlers.onNavigate("briefings");
    return;
  }
  if (target.actionFilter && handlers.onNavigateWithFilter) {
    handlers.onNavigateWithFilter(target.screen, target.actionFilter);
    return;
  }
  handlers.onNavigate(target.screen);
}

function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Could not load this section"
      description={message}
      primaryAction={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
    />
  );
}

export function UnifiedOperationalDashboard({
  role,
  displayName,
  companyFolderId = "",
  masterSheetId = "",
  companyName = "",
  userEmail = "",
  assignedAudits = [],
  drafts = {},
  assignedCheckScheduleMeta = {},
  assignedChecksLoading = false,
  assignedChecksError,
  onRetryAssignedChecks,
  briefingItems = [],
  briefingLoading = false,
  actions = [],
  history = [],
  pendingSyncCount = 0,
  failedSyncCount = 0,
  pendingOnboardingCount = 0,
  includeActivityUser,
  onNavigate,
  onNavigateWithFilter,
  onOpenAudit,
  onOpenBriefing,
  secondaryContent,
  topSlot,
}: Props) {
  const live = useUnifiedLiveDashboard({
    companyFolderId,
    masterSheetId,
    companyName,
    userEmail,
    role,
    pendingSyncCount,
    failedSyncCount,
  });

  const greetingFirst = getGreetingFirstName(displayName);
  const greetingTitle = greetingFirst ? `${getTimeBasedGreeting()}, ${greetingFirst}` : getTimeBasedGreeting();

  const sections = useMemo(
    () =>
      buildUnifiedDashboardSections({
        role,
        livePayload: live.payload,
        assignedAudits,
        drafts,
        scheduleMetaByAuditId: assignedCheckScheduleMeta,
        briefingItems,
        actions,
        history,
        pendingSyncCount,
        failedSyncCount,
        pendingOnboardingCount,
        includeActivityUser,
      }),
    [
      role,
      live.payload,
      assignedAudits,
      drafts,
      assignedCheckScheduleMeta,
      briefingItems,
      actions,
      history,
      pendingSyncCount,
      failedSyncCount,
      pendingOnboardingCount,
      includeActivityUser,
    ],
  );

  const navHandlers = { onNavigate, onNavigateWithFilter, onOpenAudit, onOpenBriefing };
  const workLoading = assignedChecksLoading || briefingLoading;
  const workError = assignedChecksError;

  return (
    <PageContainer className="max-w-none space-y-6 overflow-x-hidden">
      <PageHeader title={greetingTitle} description={getRoleDashboardSubtitle(role)} />
      {topSlot}

      <Section
        title="Needs attention"
        description="Highest-priority live issues, sorted by urgency."
        actions={
          sections.needsAttentionTotal > 5 ? (
            <Button variant="ghost" size="sm" onClick={() => onNavigate("actions")}>
              View all
            </Button>
          ) : null
        }
      >
        {live.enabled && live.loading ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : live.enabled && live.error && sections.needsAttention.length === 0 ? (
          <SectionError message={live.error} onRetry={live.retry} />
        ) : sections.needsAttention.length === 0 ? (
          <EmptyState
            title="All clear for now"
            description="No overdue inspections, incidents, or urgent actions need attention right now."
          />
        ) : (
          <ul className="space-y-3">
            {sections.needsAttention.map((item) => (
              <li key={item.id}>
                <Card
                  variant="interactive"
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer p-0"
                  onClick={() => followTarget(item.target, navHandlers)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      followTarget(item.target, navHandlers);
                    }
                  }}
                >
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge variant={priorityVariant(item.priority)}>{item.priority}</StatusBadge>
                        <StatusBadge variant={statusToBadgeVariant(item.dueLabel)} dot={false}>
                          {item.dueLabel}
                        </StatusBadge>
                        <span className="text-xs font-medium text-[var(--ui-text-muted)]">{item.typeLabel}</span>
                      </div>
                      <p className="mt-2 break-words text-sm font-semibold text-[var(--ui-text-primary)]">{item.title}</p>
                      {item.subtitle ? (
                        <p className="mt-1 break-words text-sm text-[var(--ui-text-secondary)]">{item.subtitle}</p>
                      ) : null}
                      {item.area ? <p className="mt-1 text-xs text-[var(--ui-text-muted)]">{item.area}</p> : null}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] shrink-0"
                      onClick={(event) => {
                        event.stopPropagation();
                        followTarget(item.target, navHandlers);
                      }}
                    >
                      Open
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Today's work" description="Next-best actions from your live queue.">
        {workLoading && sections.todaysWork.length === 0 ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : workError && sections.todaysWork.length === 0 ? (
          <SectionError message={workError} onRetry={onRetryAssignedChecks} />
        ) : sections.todaysWork.length === 0 ? (
          <div className="space-y-4">
            <EmptyState
              title="No assigned work right now"
              description="When checks, briefings, or actions are assigned to you they will appear here first."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.shortcuts.map((shortcut) => (
                <Card
                  key={shortcut.label}
                  variant="interactive"
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer p-0"
                  onClick={() => followTarget(shortcut.target, navHandlers)}
                >
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold text-[var(--ui-text-primary)]">{shortcut.label}</p>
                    <p className="mt-1 text-sm text-[var(--ui-text-secondary)]">{shortcut.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {sections.todaysWork.map((item) => (
              <li key={item.id}>
                <Card
                  variant="interactive"
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer p-0"
                  onClick={() => followTarget(item.target, navHandlers)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      followTarget(item.target, navHandlers);
                    }
                  }}
                >
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-[var(--ui-text-primary)]">{item.title}</p>
                      <p className="mt-1 text-sm text-[var(--ui-text-secondary)]">{item.reason}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-text-muted)]">
                        {item.area ? <span>{item.area}</span> : null}
                        {item.dueLabel ? <span>Due {item.dueLabel}</span> : null}
                        <StatusBadge variant={statusToBadgeVariant(item.statusLabel)} dot={false}>
                          {item.statusLabel}
                        </StatusBadge>
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="min-h-[44px] shrink-0"
                      onClick={(event) => {
                        event.stopPropagation();
                        followTarget(item.target, navHandlers);
                      }}
                    >
                      {item.actionLabel}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Performance" description="Key numbers from live operational data.">
        {live.enabled && live.loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonMetric key={index} className="rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] p-4" />
            ))}
          </div>
        ) : live.enabled && live.error && sections.performance.length === 0 ? (
          <SectionError message={live.error} onRetry={live.retry} />
        ) : sections.performance.length === 0 ? (
          <EmptyState title="No KPIs available yet" description="Metrics appear once live company data is connected." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {sections.performance.map((kpi) => (
              <Card
                key={kpi.id}
                variant="interactive"
                role="button"
                tabIndex={0}
                className="cursor-pointer p-0"
                onClick={() => followTarget(kpi.target, navHandlers)}
              >
                <CardContent className="space-y-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">{kpi.label}</p>
                  <p className="text-2xl font-semibold text-[var(--ui-text-primary)]">{kpi.value}</p>
                  {kpi.subtitle ? <p className="text-xs text-[var(--ui-text-secondary)]">{kpi.subtitle}</p> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent activity" description="Latest completions and updates in your scope.">
        {sections.recentActivity.length === 0 ? (
          <EmptyState
            title="No recent activity"
            description="Completed audits and synced work will show up here as your team progresses."
          />
        ) : (
          <ul className="space-y-2">
            {sections.recentActivity.map((item) => (
              <li key={item.id}>
                <Card
                  variant={item.target ? "interactive" : "default"}
                  role={item.target ? "button" : undefined}
                  tabIndex={item.target ? 0 : undefined}
                  className={item.target ? "cursor-pointer p-0" : "p-0"}
                  onClick={item.target ? () => followTarget(item.target!, navHandlers) : undefined}
                >
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]">{item.action}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-[var(--ui-text-primary)]">{item.recordName}</p>
                      {item.user ? <p className="mt-1 text-xs text-[var(--ui-text-secondary)]">{item.user}</p> : null}
                    </div>
                    <p className="shrink-0 text-xs text-[var(--ui-text-muted)]">{item.relativeTime}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {secondaryContent ? <div className="space-y-6">{secondaryContent}</div> : null}
    </PageContainer>
  );
}
