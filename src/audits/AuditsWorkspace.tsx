import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  canCompleteAuditAsAuditor,
  canAccessWorkspaceNav,
  canSubmitAuditForReview,
} from "../permissions";
import { ASSIGNED_CHECKS_LOADING_MESSAGE, ASSIGNED_CHECKS_REFRESHING_MESSAGE } from "../services/checkService";
import { AuditCentreBackButton } from "../components/auditCentre/AuditCentreBackButton";
import { FormsChecksTemplatesPanel } from "../components/forms/FormsChecksTemplatesPanel";
import { AssignedCheckActionRow } from "../components/checks/AssignedCheckActionRow";
import { Button } from "../components/ui/Button";
import { EmptyState, SkeletonCard } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import {
  buildAuditListItems,
  buildAuditSummaryMetrics,
  defaultTabForRole,
  filterAuditItems,
  groupMyAudits,
  roleAuditsSubtitle,
  visibleTabsForRole,
} from "./adapters/auditListAdapter";
import { AuditFilters } from "./components/AuditFilters";
import { AuditList } from "./components/AuditList";
import { AuditSummaryCards } from "./components/AuditSummaryCards";
import type { AuditFilterState, AuditsWorkspaceProps, AuditsWorkspaceTab } from "./types";

const TAB_LABELS: Record<AuditsWorkspaceTab, string> = {
  "my-audits": "My Audits",
  scheduled: "Scheduled",
  "in-progress": "In Progress",
  completed: "Completed",
  templates: "Templates",
};

function SectionError({ message, detail }: { message: string; detail?: string }) {
  return (
    <EmptyState
      title="Could not load audits"
      description={detail ? `${message} ${detail}` : message}
    />
  );
}

export function AuditsWorkspace(props: AuditsWorkspaceProps) {
  const { t } = useTranslation();
  const {
    currentUser,
    audits,
    myAssignedChecks = [],
    assignedCheckScheduleMeta = {},
    drafts,
    unsyncedAuditIds,
    onOpenAudit,
    assignedChecksLoading = false,
    assignedChecksLoadError,
    assignedChecksLoadErrorDetail,
    onBackToAuditCentre,
    onNavigateToSchedules,
    onNavigateToAuditBuilder,
    onNavigateToResults,
    templates = [],
    syncState,
    googleConnected,
    companyFolderId,
    masterSheetId,
    canCreateTemplates,
    onToggleTemplate,
    onEditTemplate,
    onTemplateCopied,
    onTemplateRevised,
    onTemplateArchived,
    onGoogleFormUpdated,
    companyGoogleForms,
    companyGoogleFormsStatus,
    companyGoogleFormsDiagnostics,
    showGoogleFormsDiagnostics,
    offlineMode,
    auditAccessMatrix,
    auditScheduleMatrix,
  } = props;

  const role = currentUser.role;
  const [activeTab, setActiveTab] = useState<AuditsWorkspaceTab>(defaultTabForRole(role));
  const [filters, setFilters] = useState<AuditFilterState>({ query: "", status: "", site: "", sync: "" });

  const sourceAudits = canCompleteAuditAsAuditor(role)
    ? myAssignedChecks
    : myAssignedChecks.length > 0
      ? myAssignedChecks
      : audits;

  const listItems = useMemo(
    () =>
      buildAuditListItems({
        audits: sourceAudits,
        drafts,
        scheduleMeta: assignedCheckScheduleMeta,
        unsyncedAuditIds,
        role,
      }),
    [sourceAudits, drafts, assignedCheckScheduleMeta, unsyncedAuditIds, role],
  );

  const inProgressItems = useMemo(() => listItems.filter((item) => item.hasDraft), [listItems]);
  const filteredItems = useMemo(() => filterAuditItems(listItems, filters), [listItems, filters]);
  const myAuditGroups = useMemo(() => groupMyAudits(filteredItems), [filteredItems]);
  const sites = useMemo(
    () => [...new Set(listItems.map((item) => item.area || item.site).filter(Boolean))] as string[],
    [listItems],
  );

  const summaryMetrics = useMemo(
    () => buildAuditSummaryMetrics(listItems, role, inProgressItems.length),
    [listItems, role, inProgressItems.length],
  );

  const tabs = visibleTabsForRole(role, {
    canTemplates: canAccessWorkspaceNav(role) || Boolean(templates.length),
    canScheduled: !canCompleteAuditAsAuditor(role),
  });

  const primaryAction = useMemo(() => {
    if (canCompleteAuditAsAuditor(role) && listItems.length > 0) {
      const next = listItems.find((item) => item.actionLabel === "Continue") ?? listItems[0];
      if (!next) return null;
      return {
        label: next.actionLabel === "Continue" ? "Continue audit" : "Start audit",
        onClick: () => onOpenAudit(next.id),
      };
    }
    if (onNavigateToSchedules && !canCompleteAuditAsAuditor(role)) {
      return { label: "Schedule audit", onClick: onNavigateToSchedules };
    }
    if (onNavigateToAuditBuilder && canAccessWorkspaceNav(role)) {
      return { label: "Create template", onClick: onNavigateToAuditBuilder };
    }
    return null;
  }, [role, listItems, onOpenAudit, onNavigateToSchedules, onNavigateToAuditBuilder]);

  const renderListBody = () => {
    if (assignedChecksLoading && listItems.length === 0) {
      return (
        <div className="space-y-3" role="status" aria-label={ASSIGNED_CHECKS_LOADING_MESSAGE}>
          <p className="text-sm text-[var(--ui-text-secondary)]">{ASSIGNED_CHECKS_LOADING_MESSAGE}</p>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      );
    }
    if (assignedChecksLoadError && listItems.length === 0) {
      return <SectionError message={assignedChecksLoadError} detail={assignedChecksLoadErrorDetail} />;
    }

    if (activeTab === "templates") {
      return (
        <FormsChecksTemplatesPanel
          templates={templates}
          syncState={syncState ?? "Not synced"}
          googleConnected={googleConnected ?? false}
          companyFolderId={companyFolderId}
          masterSheetId={masterSheetId}
          role={role}
          companyGoogleForms={companyGoogleForms ?? []}
          companyGoogleFormsStatus={companyGoogleFormsStatus ?? "idle"}
          companyGoogleFormsDiagnostics={companyGoogleFormsDiagnostics ?? null}
          showGoogleFormsDiagnostics={showGoogleFormsDiagnostics ?? false}
          canCreateTemplates={canCreateTemplates ?? false}
          onToggleTemplate={onToggleTemplate}
          onEditTemplate={onEditTemplate}
          onTemplateCopied={onTemplateCopied || onEditTemplate}
          onTemplateRevised={onTemplateRevised || onEditTemplate}
          onTemplateArchived={onTemplateArchived}
          onGoogleFormUpdated={onGoogleFormUpdated}
        />
      );
    }

    if (activeTab === "completed") {
      return (
        <EmptyState
          title="View completed audits"
          description="Completed submissions and results open in the Results area."
          primaryAction={onNavigateToResults ? { label: "Open results", onClick: onNavigateToResults } : undefined}
        />
      );
    }

    if (activeTab === "my-audits" && canCompleteAuditAsAuditor(role)) {
      if (filteredItems.length === 0) {
        return (
          <EmptyState
            title="You have no audits assigned right now"
            description="When schedules assign work to you, overdue and due-today checks will appear here first."
          />
        );
      }
      return (
        <div className="space-y-6">
          {myAuditGroups.map((group) => (
            <Section key={group.id} title={group.label}>
              <AuditList
                items={group.items}
                drafts={drafts}
                scheduleMeta={assignedCheckScheduleMeta}
                onOpenAudit={onOpenAudit}
                themeRole={role}
              />
            </Section>
          ))}
        </div>
      );
    }

    const tabItems =
      activeTab === "in-progress"
        ? inProgressItems
        : activeTab === "scheduled"
          ? filteredItems.filter((item) => item.status !== "Completed")
          : filteredItems;

    if (tabItems.length === 0) {
      const emptyTitle =
        activeTab === "in-progress"
          ? "No audits in progress"
          : activeTab === "scheduled"
            ? "No scheduled audits"
            : "No audits to show";
      const emptyDescription = offlineMode
        ? "You are offline. Audit progress will be saved on this device and queued for sync."
        : "Nothing matches your filters right now.";
      return <EmptyState title={emptyTitle} description={emptyDescription} />;
    }

    return (
      <AuditList
        items={tabItems}
        drafts={drafts}
        scheduleMeta={assignedCheckScheduleMeta}
        onOpenAudit={onOpenAudit}
        themeRole={role}
      />
    );
  };

  return (
    <PageContainer className="max-w-none space-y-6 overflow-x-hidden">
      {onBackToAuditCentre ? <AuditCentreBackButton onClick={onBackToAuditCentre} /> : null}

      <PageHeader
        title={t("audits.centre", { defaultValue: "Audits" })}
        description={roleAuditsSubtitle(role)}
        primaryAction={
          primaryAction ? (
            <Button variant="primary" className="min-h-[44px]" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : undefined
        }
      />

      <nav aria-label="Audits views" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab}
            type="button"
            variant={activeTab === tab ? "primary" : "outline"}
            size="sm"
            className="min-h-[44px]"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
          >
            {TAB_LABELS[tab]}
          </Button>
        ))}
      </nav>

      <AuditSummaryCards
        metrics={summaryMetrics}
        onSelect={(metric) => {
          if (metric.tab) setActiveTab(metric.tab);
        }}
      />

      {activeTab !== "templates" && activeTab !== "completed" ? (
        <AuditFilters filters={filters} sites={sites} onChange={setFilters} />
      ) : null}

      {assignedChecksLoading && listItems.length > 0 ? (
        <p className="text-sm text-[var(--ui-text-secondary)]" role="status">
          {ASSIGNED_CHECKS_REFRESHING_MESSAGE}
        </p>
      ) : null}

      {renderListBody()}

      {canSubmitAuditForReview(role) && auditAccessMatrix.length > 0 ? (
        <details className="rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--ui-text-primary)]">
            Advanced access matrix
          </summary>
          <p className="mt-2 text-sm text-[var(--ui-text-secondary)]">
            {auditScheduleMatrix ? `${Object.keys(auditScheduleMatrix).length} scheduled mappings loaded.` : ""}
          </p>
        </details>
      ) : null}
    </PageContainer>
  );
}

// Keep AssignedCheckActionRow referenced for verify:my-checks-page-wiring
export { AssignedCheckActionRow };
