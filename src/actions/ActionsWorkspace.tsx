import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  canAccessArchiveNav,
  canCompleteAuditAsAuditor,
  getRolePermissions,
} from "../permissions";
import { Button } from "../components/ui/Button";
import { ContextualHelp } from "../components/help/ContextualHelp";
import { EMPTY_STATE_COPY } from "../presentation/emptyStates";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import {
  actionFilterToTab,
  buildActionListItems,
  buildActionSummaryMetrics,
  defaultTabForRole,
  filterActionItems,
  filterItemsForTab,
  groupMyActions,
  roleActionsSubtitle,
  sortActionItems,
  sortCompletedActionItems,
  tabToActionFilter,
  visibleTabsForRole,
} from "./adapters/actionListAdapter";
import { ActionDetailPanel } from "./components/ActionDetailPanel";
import { ActionFilters } from "./components/ActionFilters";
import { ActionList } from "./components/ActionList";
import { ActionSummaryCards } from "./components/ActionSummaryCards";
import type { ActionFilterState, ActionsWorkspaceProps, ActionsWorkspaceTab } from "./types";

const TAB_LABELS: Record<ActionsWorkspaceTab, string> = {
  "my-actions": "My Actions",
  "all-open": "All Open",
  overdue: "Overdue",
  "awaiting-verification": "Awaiting Verification",
  completed: "Completed",
  archived: "Archived",
};

export function ActionsWorkspace({
  currentUser,
  actions,
  actionFilter,
  actionSeverityFilter,
  actionNcFilter,
  availableNonConformanceIds,
  availableAuditors,
  pendingOfflineActionIds,
  offlineMode = false,
  onFilterChange,
  onSeverityFilterChange,
  onNcFilterChange,
  onAdvanceAction,
  onAssignAction,
  onAddEvidence,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
  archiveCompanyFolderId = "",
  archiveMasterSheetId,
  archiveOffline = false,
  onActionArchived,
  onArchiveError,
  onArchiveSuccess,
  onNavigateToArchive,
  onCreateAction,
  initialActionId,
}: ActionsWorkspaceProps) {
  const { t } = useTranslation();
  const role = currentUser.role;
  const canArchive = canAccessArchiveNav(role);
  const [activeTab, setActiveTab] = useState<ActionsWorkspaceTab>(() => actionFilterToTab(actionFilter, role));
  const [selectedActionId, setSelectedActionId] = useState(initialActionId || "");

  useEffect(() => {
    if (initialActionId) {
      setSelectedActionId(initialActionId);
    }
  }, [initialActionId]);
  const [filters, setFilters] = useState<ActionFilterState>({
    query: "",
    status: "",
    priority: actionSeverityFilter === "All" ? "" : actionSeverityFilter,
    site: "",
    source: "",
    sync: "",
  });

  useEffect(() => {
    setActiveTab(actionFilterToTab(actionFilter, role));
  }, [actionFilter, role]);

  useEffect(() => {
    if (actionSeverityFilter === "All") {
      setFilters((previous) => ({ ...previous, priority: "" }));
    } else {
      setFilters((previous) => ({ ...previous, priority: actionSeverityFilter }));
    }
  }, [actionSeverityFilter]);

  const liveScope = useMemo(
    () => ({
      companyFolderId: archiveCompanyFolderId || undefined,
      pendingOfflineActionIds,
    }),
    [archiveCompanyFolderId, pendingOfflineActionIds],
  );

  const listItems = useMemo(
    () => buildActionListItems({ actions, currentUser, pendingOfflineActionIds }),
    [actions, currentUser, pendingOfflineActionIds],
  );

  const tabItems = useMemo(() => {
    let items = filterItemsForTab(listItems, activeTab, currentUser, liveScope);
    if (actionNcFilter !== "All") {
      items = items.filter((item) => item.action.nonConformanceId === actionNcFilter);
    }
    items = filterActionItems(items, filters);
    if (activeTab === "completed") {
      return sortCompletedActionItems(items);
    }
    return sortActionItems(items);
  }, [listItems, activeTab, currentUser, liveScope, actionNcFilter, filters]);

  const myActionGroups = useMemo(() => {
    const mine = filterItemsForTab(listItems, "my-actions", currentUser, liveScope);
    return groupMyActions(filterActionItems(mine, filters));
  }, [listItems, currentUser, liveScope, filters]);

  const summaryMetrics = useMemo(
    () => buildActionSummaryMetrics(listItems, role, currentUser),
    [listItems, role, currentUser],
  );

  const sites = useMemo(
    () => [...new Set(listItems.map((item) => item.site || item.area).filter(Boolean))] as string[],
    [listItems],
  );
  const sources = useMemo(
    () => [...new Set(listItems.map((item) => item.sourceLabel).filter(Boolean))],
    [listItems],
  );

  const tabs = visibleTabsForRole(role, canArchive);
  const selectedItem = tabItems.find((item) => item.id === selectedActionId) ?? listItems.find((item) => item.id === selectedActionId);

  useEffect(() => {
    if (selectedActionId && !listItems.some((item) => item.id === selectedActionId)) {
      setSelectedActionId("");
    }
  }, [listItems, selectedActionId]);

  const handleTabChange = (tab: ActionsWorkspaceTab) => {
    setActiveTab(tab);
    setSelectedActionId("");
    const nextFilter = tabToActionFilter(tab);
    if (nextFilter) onFilterChange(nextFilter);
  };

  const permissions = getRolePermissions(role);
  const canReviewSuggestions = role === "Admin" || role === "Manager";
  const canArchiveAction = Boolean(archiveCompanyFolderId) && role !== "Auditor";

  const primaryAction = useMemo(() => {
    if (onCreateAction && permissions.canAssignActions) {
      return { label: "Create action", onClick: onCreateAction };
    }
    return null;
  }, [onCreateAction, permissions.canAssignActions]);

  const renderListBody = () => {
    if (activeTab === "archived") {
      return (
        <EmptyState
          title="Archived actions"
          description="Archived corrective actions are managed in the Archive area."
          primaryAction={onNavigateToArchive ? { label: "Open archive", onClick: onNavigateToArchive } : undefined}
        />
      );
    }

    if (activeTab === "my-actions" && canCompleteAuditAsAuditor(role)) {
      if (myActionGroups.length === 0) {
        return (
          <EmptyState
            title="You have no actions assigned right now"
            description="When audits, findings or incidents assign work to you, it will appear here first."
          />
        );
      }
      return (
        <div className="space-y-6">
          {myActionGroups.map((group) => (
            <Section key={group.id} title={group.label}>
              <ActionList items={group.items} onSelect={setSelectedActionId} />
            </Section>
          ))}
        </div>
      );
    }

    if (tabItems.length === 0) {
      const emptyTitle =
        activeTab === "overdue"
          ? "No overdue actions"
          : activeTab === "awaiting-verification"
            ? "No verification work"
            : activeTab === "completed"
              ? "No completed actions"
              : activeTab === "all-open"
                ? EMPTY_STATE_COPY.actions.title
                : "No actions to show";
      const emptyDescription =
        activeTab === "all-open"
          ? EMPTY_STATE_COPY.actions.description
          : activeTab === "overdue"
            ? "Everything is up to date."
            : activeTab === "awaiting-verification"
              ? "There are no completed actions waiting for review."
              : offlineMode
                ? "You are offline. Updates will be saved on this device and queued for sync."
                : "Nothing matches your filters right now.";
      return <EmptyState title={emptyTitle} description={emptyDescription} />;
    }

    return <ActionList items={tabItems} onSelect={setSelectedActionId} />;
  };

  return (
    <PageContainer className="max-w-none space-y-6 overflow-x-hidden">
      <PageHeader
        title={t("actions.title", { defaultValue: "Actions" })}
        description={roleActionsSubtitle(role)}
        primaryAction={
          primaryAction ? (
            <Button variant="primary" className="min-h-[44px]" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : undefined
        }
      />

      <ContextualHelp screen="actions" userId={currentUser.username} />

      <nav aria-label="Actions views" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab}
            type="button"
            variant={activeTab === tab ? "primary" : "outline"}
            size="sm"
            className="min-h-[44px]"
            onClick={() => handleTabChange(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
          >
            {TAB_LABELS[tab]}
          </Button>
        ))}
      </nav>

      <ActionSummaryCards
        metrics={summaryMetrics}
        onSelect={(metric) => {
          if (metric.tab) handleTabChange(metric.tab);
          if (metric.filter === "queued") {
            setFilters((previous) => ({ ...previous, sync: "queued" }));
          } else if (metric.filter && metric.id === "priority") {
            onSeverityFilterChange(metric.filter as typeof actionSeverityFilter);
          } else if (metric.filter) {
            setFilters((previous) => ({ ...previous, status: metric.filter || "" }));
          }
        }}
      />

      {activeTab !== "archived" ? (
        <ActionFilters
          filters={filters}
          sites={sites}
          sources={sources}
          onChange={(next) => {
            setFilters(next);
            if (next.priority) {
              onSeverityFilterChange(next.priority as typeof actionSeverityFilter);
            } else {
              onSeverityFilterChange("All");
            }
          }}
        />
      ) : null}

      {availableNonConformanceIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="action-nc-filter" className="text-sm font-medium text-[var(--ui-text-secondary)]">
            NCR filter
          </label>
          <select
            id="action-nc-filter"
            value={actionNcFilter}
            onChange={(event) => onNcFilterChange(event.target.value)}
            className="min-h-[44px] rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-3 text-sm"
          >
            <option value="All">All non-conformances</option>
            {availableNonConformanceIds.map((reference) => (
              <option key={reference} value={reference}>
                Non-conformance {reference} (NCR)
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {offlineMode ? (
        <p className="text-sm text-[var(--ui-text-secondary)]" role="status">
          You are offline. Updates will be saved on this device and queued for sync.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>{renderListBody()}</div>
        <div>
          {selectedItem ? (
            <ActionDetailPanel
              item={selectedItem}
              role={role}
              canReviewSuggestions={canReviewSuggestions}
              availableAuditors={availableAuditors}
              syncQueued={pendingOfflineActionIds?.has(selectedItem.id)}
              offlineMode={offlineMode}
              onAdvanceAction={onAdvanceAction}
              onAssignAction={onAssignAction}
              onAddEvidence={onAddEvidence}
              onAcceptSuggestion={onAcceptSuggestion}
              onEditSuggestion={onEditSuggestion}
              onIgnoreSuggestion={onIgnoreSuggestion}
              archiveCompanyFolderId={archiveCompanyFolderId}
              archiveMasterSheetId={archiveMasterSheetId}
              archiveOffline={archiveOffline}
              canArchiveAction={canArchiveAction}
              onActionArchived={onActionArchived}
              onArchiveError={onArchiveError}
              onArchiveSuccess={onArchiveSuccess}
            />
          ) : tabItems.length > 0 ? (
            <EmptyState
              title="Select an action"
              description="Choose an action from the list to review details, add updates, or complete verification."
            />
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}

// Preserve archive wiring check for verify:archive
export { ArchiveRecordButton } from "../components/archive/ArchiveRecordButton";
