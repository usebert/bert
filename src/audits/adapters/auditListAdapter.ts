import type { Role } from "../../permissions";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import {
  assignedCheckCardStatus,
  sortAssignedChecksForAction,
  type AssignedCheckScheduleMeta,
} from "../../utils/assignedCheckDisplay";
import { rankAuditorAudit } from "../../utils/auditorDashboard";
import type { AuditDisplayStatus, AuditListItem, AuditSummaryMetric, AuditsWorkspaceTab } from "../types";

function displayStatus(
  audit: Audit,
  hasDraft: boolean,
  unsynced: boolean,
  completedForCurrentDue: boolean,
): AuditDisplayStatus {
  if (unsynced) return "Awaiting sync";
  if (hasDraft) return "In progress";
  if (completedForCurrentDue) return "Completed";
  if (audit.dueHours < 0) return "Overdue";
  if (audit.dueLabel === "Due today" || (audit.dueHours >= 0 && audit.dueHours <= 24)) return "Due today";
  if (audit.dueLabel === "Available") return "Available";
  return "Upcoming";
}

function actionLabel(hasDraft: boolean, status: AuditDisplayStatus): string {
  if (status === "Awaiting sync") return "Retry sync";
  if (hasDraft || status === "In progress") return "Continue";
  if (status === "Completed") return "Review";
  return "Start";
}

function priorityScore(audit: Audit, hasDraft: boolean, status: AuditDisplayStatus): number {
  if (status === "Awaiting sync") return -5;
  if (status === "Overdue") return 0;
  if (hasDraft || status === "In progress") return 5;
  if (status === "Due today") return 10;
  if (status === "Upcoming" || status === "Available") return 20;
  if (status === "Completed") return 90;
  return 50;
}

export function buildAuditListItems(input: {
  audits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  unsyncedAuditIds?: Set<string>;
  role: Role;
}): AuditListItem[] {
  const sorted = sortAssignedChecksForAction(input.audits, input.drafts);
  return sorted.map((audit) => {
    const hasDraft = Boolean(input.drafts[audit.id]);
    const meta = input.scheduleMeta?.[audit.id];
    const unsynced = input.unsyncedAuditIds?.has(audit.id) ?? false;
    const completedForCurrentDue = meta?.completedForCurrentDue === true;
    const status = displayStatus(audit, hasDraft, unsynced, completedForCurrentDue);
  const cardStatus = assignedCheckCardStatus(audit, hasDraft, completedForCurrentDue, meta?.completionMode);
    void cardStatus;
    return {
      id: audit.id,
      name: audit.name,
      site: audit.siteArea?.split(" / ")[0],
      area: audit.siteArea,
      assignee: audit.owner,
      dueLabel: audit.dueLabel,
      dueHours: audit.dueHours,
      status,
      progressLabel: hasDraft ? "Draft saved" : undefined,
      resultLabel: completedForCurrentDue ? "Completed for this period" : undefined,
      syncStatus: unsynced ? "queued" : "none",
      actionLabel: actionLabel(hasDraft, status),
      hasDraft,
      scheduleName: meta?.scheduleName,
      frequency: meta?.frequency,
      lastCompletedAt: audit.lastCompletedAt,
      nextDueAt: meta?.nextDueAt,
      priority: priorityScore(audit, hasDraft, status),
      audit,
    };
  });
}

export function groupMyAudits(items: AuditListItem[]) {
  const groups: Record<string, AuditListItem[]> = {
    overdue: [],
    dueToday: [],
    upcoming: [],
    inProgress: [],
    awaitingSync: [],
  };
  items.forEach((item) => {
    if (item.status === "Awaiting sync") {
      groups.awaitingSync.push(item);
    } else if (item.hasDraft || item.status === "In progress") {
      groups.inProgress.push(item);
    } else if (item.status === "Overdue") {
      groups.overdue.push(item);
    } else if (item.status === "Due today") {
      groups.dueToday.push(item);
    } else {
      groups.upcoming.push(item);
    }
  });
  return [
    { id: "overdue", label: "Overdue", items: groups.overdue },
    { id: "dueToday", label: "Due today", items: groups.dueToday },
    { id: "upcoming", label: "Upcoming", items: groups.upcoming },
    { id: "inProgress", label: "In progress", items: groups.inProgress },
    { id: "awaitingSync", label: "Awaiting sync", items: groups.awaitingSync },
  ].filter((group) => group.items.length > 0);
}

export function filterAuditItems(items: AuditListItem[], filters: { query: string; status: string; site: string; sync: string }) {
  const q = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.site && item.site !== filters.site && item.area !== filters.site) return false;
    if (filters.sync === "queued" && item.syncStatus !== "queued") return false;
    if (filters.sync === "synced" && item.syncStatus !== "none") return false;
    if (!q) return true;
    return [item.name, item.area, item.assignee, item.scheduleName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
}

export function buildAuditSummaryMetrics(
  items: AuditListItem[],
  role: Role,
  inProgressCount: number,
): AuditSummaryMetric[] {
  const dueToday = items.filter((item) => item.status === "Due today").length;
  const overdue = items.filter((item) => item.status === "Overdue").length;
  const awaitingSync = items.filter((item) => item.status === "Awaiting sync").length;
  const completed = items.filter((item) => item.status === "Completed").length;

  if (role === "Auditor") {
    return [
      { id: "due-today", label: "Due today", value: String(dueToday), tone: dueToday ? "info" : "neutral", tab: "my-audits" },
      { id: "overdue", label: "Overdue", value: String(overdue), tone: overdue ? "danger" : "success", tab: "my-audits" },
      { id: "in-progress", label: "In progress", value: String(inProgressCount), tone: inProgressCount ? "warning" : "neutral", tab: "in-progress" },
      { id: "awaiting-sync", label: "Awaiting sync", value: String(awaitingSync), tone: awaitingSync ? "warning" : "success", tab: "my-audits" },
    ];
  }

  return [
    { id: "due-today", label: "Due today", value: String(dueToday), tone: dueToday ? "info" : "neutral", tab: "scheduled" },
    { id: "overdue", label: "Overdue", value: String(overdue), tone: overdue ? "danger" : "success", tab: "scheduled" },
    { id: "completed", label: "Completed", value: String(completed), tone: "success", tab: "completed" },
    { id: "in-progress", label: "In progress", value: String(inProgressCount), tone: inProgressCount ? "warning" : "neutral", tab: "in-progress" },
    { id: "awaiting-sync", label: "Awaiting sync", value: String(awaitingSync), tone: awaitingSync ? "warning" : "success", tab: "my-audits" },
  ];
}

export function defaultTabForRole(role: Role): AuditsWorkspaceTab {
  if (role === "Auditor") return "my-audits";
  if (role === "Master") return "templates";
  return "scheduled";
}

export function visibleTabsForRole(
  role: Role,
  options: { canTemplates: boolean; canScheduled: boolean },
): AuditsWorkspaceTab[] {
  if (role === "Auditor") {
    return ["my-audits", "in-progress", "completed"];
  }
  const tabs: AuditsWorkspaceTab[] = ["scheduled", "my-audits", "in-progress", "completed"];
  if (options.canTemplates) tabs.push("templates");
  return tabs;
}

export function roleAuditsSubtitle(role: Role): string {
  if (role === "Auditor") return "View and complete your assigned audits and inspections.";
  if (role === "Manager") return "Schedule, monitor and review audits across your areas.";
  if (role === "Admin") return "Manage company audit schedules, progress and results.";
  if (role === "Master") return "Review templates and company-level audit setup.";
  return "Manage audits and inspections.";
}
