import type { AuditDraft } from "../types/dashboardScreenProps";
import type { Audit } from "../types/reportsScreenProps";
import type { BriefingRecipientRecord, DashboardToDoItem } from "../types/briefings";
import { briefingActionLabel } from "./briefingActions";
import {
  filterAssignedChecksForThingsToDo,
  sortAssignedChecksForAction,
  type AssignedCheckScheduleMeta,
} from "./assignedCheckDisplay";

const GROUP_ORDER = ["overdue", "dueToday", "waiting", "upcoming"] as const;
const GROUP_LABELS: Record<(typeof GROUP_ORDER)[number], string> = {
  overdue: "Overdue",
  dueToday: "Due today",
  waiting: "Waiting for you",
  upcoming: "Upcoming",
};

function checkGroup(audit: Audit, draft?: AuditDraft): DashboardToDoItem["group"] {
  if (audit.dueHours < 0) {
    return "overdue";
  }
  if (audit.dueLabel === "Due today" || audit.dueHours <= 24) {
    return "dueToday";
  }
  if (draft) {
    return "waiting";
  }
  return "upcoming";
}

function checkPriority(group: DashboardToDoItem["group"], dueHours: number) {
  const base = { overdue: 0, dueToday: 1, waiting: 2, upcoming: 3 }[group];
  return base * 1000 + dueHours;
}

function briefingGroup(item: BriefingRecipientRecord): DashboardToDoItem["group"] {
  if (item.status === "Overdue" || item.overdue) {
    return "overdue";
  }
  const dueDate = item.briefing?.dueDate;
  if (dueDate) {
    const dueMs = Date.parse(`${dueDate}T23:59:59.999Z`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = today.getTime() + 24 * 60 * 60 * 1000;
    if (Number.isFinite(dueMs) && dueMs < tomorrow && dueMs >= today.getTime()) {
      return "dueToday";
    }
  }
  if (!item.openedAt) {
    return "waiting";
  }
  return "waiting";
}

export function buildDashboardToDoItems(input: {
  assignedAudits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMetaByAuditId: Record<string, AssignedCheckScheduleMeta>;
  briefingItems?: BriefingRecipientRecord[];
}): DashboardToDoItem[] {
  const dueChecks = filterAssignedChecksForThingsToDo(
    input.assignedAudits,
    input.drafts,
    input.scheduleMetaByAuditId,
  );
  const sortedChecks = sortAssignedChecksForAction(dueChecks, input.drafts);
  const checkItems: DashboardToDoItem[] = sortedChecks.map((audit) => {
    const group = checkGroup(audit, input.drafts[audit.id]);
    return {
      id: `check-${audit.id}`,
      kind: "check",
      title: audit.name,
      typeLabel: "Check",
      group,
      dueLabel: audit.dueLabel,
      statusLabel: input.drafts[audit.id] ? "In progress" : audit.dueLabel,
      actionLabel: input.drafts[audit.id] ? "Complete" : "Open",
      auditId: audit.id,
      priority: checkPriority(group, audit.dueHours),
    };
  });

  const briefingItems: DashboardToDoItem[] = (input.briefingItems || [])
    .filter((item) => item.needsAction === true)
    .map((item) => {
      const group = briefingGroup(item);
      return {
        id: `briefing-${item.briefingId}`,
        kind: "briefing",
        title: item.briefing?.title || "Briefing",
        typeLabel: item.briefing?.type || "Briefing",
        group,
        dueLabel: item.briefing?.dueDate,
        statusLabel: item.status,
        actionLabel: briefingActionLabel(item),
        briefingId: item.briefingId,
        priority: { overdue: 0, dueToday: 10, waiting: 20, upcoming: 30 }[group],
      };
    });

  return [...checkItems, ...briefingItems].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

export function groupDashboardToDoItems(items: DashboardToDoItem[]) {
  const grouped = new Map<DashboardToDoItem["group"], DashboardToDoItem[]>();
  GROUP_ORDER.forEach((group) => grouped.set(group, []));
  items.forEach((item) => {
    const list = grouped.get(item.group) || [];
    list.push(item);
    grouped.set(item.group, list);
  });
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: grouped.get(group) || [],
  })).filter((entry) => entry.items.length > 0);
}

export { GROUP_ORDER, GROUP_LABELS };
