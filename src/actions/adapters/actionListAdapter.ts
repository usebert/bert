import type { Role } from "../../permissions";
import { getRolePermissions } from "../../permissions";
import type { ActionItem, ActionStatus, RiskLevel } from "../../types/reportsScreenProps";
import type { User } from "../../types/dashboardScreenProps";
import { getActionPrimaryCTA, getRecordNextStepText } from "../../utils/recordNextStep";
import { isEscalated, isOverdue, isStuck } from "../../utils/managerDashboard";
import { isLiveOpenAction } from "../../utils/liveOpenActions";
import { buildActionSourceLink, type BertRecordLink } from "../../lib/bertRecordNavigation";
import type {
  ActionDisplayStatus,
  ActionFilterState,
  ActionListItem,
  ActionSummaryMetric,
  ActionsWorkspaceTab,
} from "../types";

const SEVERITY_RANK: Record<RiskLevel, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function isDueToday(action: ActionItem): boolean {
  return action.status !== "Closed" && action.dueHours >= 0 && action.dueHours <= 24;
}

function isDueSoon(action: ActionItem): boolean {
  return action.status !== "Closed" && action.dueHours >= 0 && action.dueHours <= 24;
}

function urgencyLabel(action: ActionItem): ActionListItem["urgency"] {
  if (isEscalated(action)) return "Escalated";
  if (isOverdue(action)) return "Overdue";
  if (isStuck(action)) return "Stuck";
  if (isDueSoon(action)) return "Due soon";
  return "Normal";
}

function sourceLabel(action: ActionItem): string {
  if (action.nonConformanceId) return "NCR";
  if (action.auditName) return "Audit finding";
  if (action.auditId) return "Audit";
  return "Manual";
}

function displayStatus(action: ActionItem, syncQueued: boolean): ActionDisplayStatus {
  if (syncQueued) return "Awaiting sync";
  if (action.status === "Closed") return "Completed";
  if (action.status === "Rejected") return "Rejected";
  if (action.status === "Awaiting Verification") return "Awaiting verification";
  if (action.status === "In Progress") return "In progress";
  if (isOverdue(action)) return "Overdue";
  if (isDueToday(action)) return "Due today";
  return "Open";
}

function actionLabel(action: ActionItem, permissions: ReturnType<typeof getRolePermissions>): string {
  const cta = getActionPrimaryCTA(action, permissions);
  if (cta.kind === "uploadEvidence") return "Add evidence";
  if (cta.kind === "submitVerification") return "Submit for verification";
  if (cta.kind === "verifyClose") return "Verify";
  if (cta.kind === "start") return "Start";
  if (action.status === "In Progress") return "Continue";
  if (action.status === "Awaiting Verification") return "View";
  if (action.status === "Closed") return "View";
  return "View";
}

function sortPriority(action: ActionItem, display: ActionDisplayStatus, syncQueued: boolean): number {
  if (syncQueued) return -3;
  if (display === "Overdue" || isOverdue(action)) return 0;
  if (display === "Due today") return 5;
  if (action.severity === "Critical") return 8;
  if (action.severity === "High") return 12;
  if (action.status === "Awaiting Verification") return 15;
  if (action.status === "In Progress") return 18;
  if (action.status === "Closed") return 90;
  return 20 + SEVERITY_RANK[action.severity];
}

export function buildActionListItems(input: {
  actions: ActionItem[];
  currentUser: User;
  pendingOfflineActionIds?: Set<string>;
}): ActionListItem[] {
  const permissions = getRolePermissions(input.currentUser.role);
  return input.actions.map((action) => {
    const syncQueued = input.pendingOfflineActionIds?.has(action.id) ?? false;
    const status = displayStatus(action, syncQueued);
    const siteArea = action.siteArea?.trim() || "";
    const [site, area] = siteArea.includes(" / ") ? siteArea.split(" / ", 2) : [siteArea, ""];
    const hasProgress = action.status === "In Progress" || action.evidenceCount > 0 || Boolean(action.comments?.trim());
    const sourceLink = buildActionSourceLink(action, action.companyId) as BertRecordLink | null;
    return {
      id: action.id,
      title: action.suggestedActionTitle?.trim() || action.questionText.trim(),
      description: action.sourceAnswer?.trim() || action.correctiveAction?.trim(),
      sourceLabel: sourceLabel(action),
      sourceReference: sourceLink?.sourceLabel || action.nonConformanceId || action.auditName || undefined,
      sourceLink,
      site: site || undefined,
      area: area || siteArea || undefined,
      assignee: action.assignedToName || action.owner,
      dueLabel: action.dueDate || action.dueLabel,
      dueHours: action.dueHours,
      priority: action.severity,
      status,
      workflowStatus: action.status,
      verificationLabel:
        action.status === "Awaiting Verification"
          ? "Awaiting verification"
          : action.status === "Closed"
            ? "Verified"
            : undefined,
      syncStatus: syncQueued ? "queued" : "none",
      actionLabel: actionLabel(action, permissions),
      nextStep: getRecordNextStepText("action", action.status, input.currentUser.role, {
        evidenceRequired: action.evidenceRequired,
        evidenceCount: action.evidenceCount,
      }).replace(/^Next step:\s*/i, ""),
      evidenceCount: action.evidenceCount,
      evidenceRequired: Boolean(action.evidenceRequired),
      hasProgress,
      urgency: urgencyLabel(action),
      sortPriority: sortPriority(action, status, syncQueued),
      action,
    };
  });
}

export function sortActionItems(items: ActionListItem[]): ActionListItem[] {
  return [...items].sort((a, b) => {
    if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
    if (a.dueHours !== b.dueHours) return a.dueHours - b.dueHours;
    return SEVERITY_RANK[a.priority] - SEVERITY_RANK[b.priority];
  });
}

export function sortCompletedActionItems(items: ActionListItem[]): ActionListItem[] {
  return [...items].sort((a, b) => {
    const aClosed = Date.parse(a.action.closedAt || "");
    const bClosed = Date.parse(b.action.closedAt || "");
    if (Number.isFinite(aClosed) && Number.isFinite(bClosed) && aClosed !== bClosed) {
      return bClosed - aClosed;
    }
    return b.dueHours - a.dueHours;
  });
}

export function filterItemsForTab(
  items: ActionListItem[],
  tab: ActionsWorkspaceTab,
  currentUser: User,
  liveScope: { companyFolderId?: string; pendingOfflineActionIds?: Set<string> },
): ActionListItem[] {
  const permissions = getRolePermissions(currentUser.role);
  switch (tab) {
    case "my-actions":
      return items.filter(
        (item) =>
          isLiveOpenAction(item.action, liveScope) &&
          (item.action.assignedToName === currentUser.name || item.action.assignedToUserId === currentUser.username),
      );
    case "all-open":
      return items.filter((item) => isLiveOpenAction(item.action, liveScope));
    case "overdue":
      return items.filter((item) => isOverdue(item.action));
    case "awaiting-verification":
      return items.filter((item) => item.workflowStatus === "Awaiting Verification");
    case "completed":
      return items.filter((item) => item.workflowStatus === "Closed" || item.workflowStatus === "Rejected");
    case "archived":
      return permissions.canAssignActions ? [] : [];
    default:
      return items;
  }
}

export function filterActionItems(items: ActionListItem[], filters: ActionFilterState): ActionListItem[] {
  const q = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.site && item.site !== filters.site && item.area !== filters.site) return false;
    if (filters.source && item.sourceLabel !== filters.source) return false;
    if (filters.sync === "queued" && item.syncStatus !== "queued") return false;
    if (filters.sync === "synced" && item.syncStatus !== "none") return false;
    if (!q) return true;
    const haystack = [
      item.title,
      item.description,
      item.sourceReference,
      item.site,
      item.area,
      item.assignee,
      item.action.auditName,
      item.action.nonConformanceId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function groupMyActions(items: ActionListItem[]) {
  const groups: Record<string, ActionListItem[]> = {
    overdue: [],
    dueToday: [],
    upcoming: [],
    inProgress: [],
    awaitingVerification: [],
    awaitingSync: [],
  };
  items.forEach((item) => {
    if (item.syncStatus === "queued") {
      groups.awaitingSync.push(item);
    } else if (item.workflowStatus === "Awaiting Verification") {
      groups.awaitingVerification.push(item);
    } else if (item.workflowStatus === "In Progress" || item.hasProgress) {
      groups.inProgress.push(item);
    } else if (item.status === "Overdue" || isOverdue(item.action)) {
      groups.overdue.push(item);
    } else if (item.status === "Due today") {
      groups.dueToday.push(item);
    } else {
      groups.upcoming.push(item);
    }
  });
  return [
    { id: "overdue", label: "Overdue", items: sortActionItems(groups.overdue) },
    { id: "dueToday", label: "Due today", items: sortActionItems(groups.dueToday) },
    { id: "upcoming", label: "Upcoming", items: sortActionItems(groups.upcoming) },
    { id: "inProgress", label: "In progress", items: sortActionItems(groups.inProgress) },
    { id: "awaitingVerification", label: "Awaiting verification", items: sortActionItems(groups.awaitingVerification) },
    { id: "awaitingSync", label: "Awaiting sync", items: sortActionItems(groups.awaitingSync) },
  ].filter((group) => group.items.length > 0);
}

export function buildActionSummaryMetrics(items: ActionListItem[], role: Role, currentUser: User): ActionSummaryMetric[] {
  const open = items.filter((item) => item.workflowStatus !== "Closed" && item.workflowStatus !== "Rejected");
  const assignedToMe = open.filter(
    (item) => item.assignee === currentUser.name || item.action.assignedToUserId === currentUser.username,
  );
  const overdue = open.filter((item) => isOverdue(item.action));
  const dueToday = open.filter((item) => item.status === "Due today");
  const highPriority = open.filter((item) => item.priority === "Critical" || item.priority === "High");
  const awaitingVerification = items.filter((item) => item.workflowStatus === "Awaiting Verification");
  const completedMonth = items.filter((item) => {
    if (item.workflowStatus !== "Closed") return false;
    const closed = Date.parse(item.action.closedAt || "");
    if (!Number.isFinite(closed)) return false;
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return closed >= monthAgo;
  });
  const syncIssues = items.filter((item) => item.syncStatus === "queued");

  if (role === "Auditor") {
    const metrics: ActionSummaryMetric[] = [
      { id: "assigned", label: "Assigned to me", value: assignedToMe.length, tone: "info", tab: "my-actions" },
      { id: "dueToday", label: "Due today", value: dueToday.length, tone: dueToday.length ? "warning" : "neutral", tab: "my-actions", filter: "Due today" },
      { id: "overdue", label: "Overdue", value: overdue.length, tone: overdue.length ? "danger" : "success", tab: "overdue" },
      { id: "verification", label: "Awaiting verification", value: awaitingVerification.length, tone: awaitingVerification.length ? "warning" : "neutral", tab: "awaiting-verification" },
    ];
    return metrics.filter((metric) => metric.value !== 0 || metric.id === "assigned" || metric.id === "overdue");
  }

  const metrics: ActionSummaryMetric[] = [
    { id: "open", label: "Open", value: open.length, tone: "info", tab: "all-open" },
    { id: "overdue", label: "Overdue", value: overdue.length, tone: overdue.length ? "danger" : "success", tab: "overdue" },
    { id: "priority", label: "High priority", value: highPriority.length, tone: highPriority.length ? "warning" : "neutral", tab: "all-open", filter: "High" },
    { id: "verification", label: "Awaiting verification", value: awaitingVerification.length, tone: awaitingVerification.length ? "warning" : "neutral", tab: "awaiting-verification" },
    { id: "completed", label: "Completed this month", value: completedMonth.length, tone: "success", tab: "completed" },
    ...(syncIssues.length > 0 ? [{ id: "sync", label: "Sync issues", value: syncIssues.length, tone: "danger" as const, tab: "my-actions" as const, filter: "queued" }] : []),
  ];
  return metrics;
}

export function defaultTabForRole(role: Role): ActionsWorkspaceTab {
  if (role === "Admin" || role === "Master") return "all-open";
  return "my-actions";
}

export function visibleTabsForRole(role: Role, canArchive: boolean): ActionsWorkspaceTab[] {
  const tabs: ActionsWorkspaceTab[] = ["my-actions", "all-open", "overdue", "awaiting-verification", "completed"];
  if (canArchive) tabs.push("archived");
  if (role === "Auditor") {
    return ["my-actions", "overdue", "awaiting-verification", "completed"];
  }
  return tabs;
}

export function roleActionsSubtitle(role: Role): string {
  if (role === "Auditor") return "View and complete actions assigned to you.";
  if (role === "Manager") return "Manage actions across your sites, teams and areas.";
  if (role === "Admin") return "Monitor company-wide actions, ownership and overdue work.";
  if (role === "Master") return "Monitor company-scoped actions, ownership and overdue work.";
  return "Track corrective actions and verification.";
}

export function tabToActionFilter(tab: ActionsWorkspaceTab): import("../types").ActionFilter | null {
  if (tab === "all-open" || tab === "my-actions") return "Open";
  if (tab === "overdue") return "Overdue";
  if (tab === "awaiting-verification") return "Awaiting Verification";
  if (tab === "completed") return "Closed";
  return null;
}

export function actionFilterToTab(filter: import("../types").ActionFilter, role: Role): ActionsWorkspaceTab {
  if (filter === "Overdue") return "overdue";
  if (filter === "Awaiting Verification") return "awaiting-verification";
  if (filter === "Closed") return "completed";
  if (filter === "Open") return role === "Auditor" ? "my-actions" : "all-open";
  return role === "Auditor" ? "my-actions" : "all-open";
}
