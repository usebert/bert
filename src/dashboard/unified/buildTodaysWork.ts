import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import { buildDashboardToDoItems } from "../../utils/dashboardToDo";
import type { DashboardNavTarget, RoleShortcut, TodaysWorkItem } from "./types";
import { getRoleShortcuts } from "./roleConfig";

function todoTarget(item: ReturnType<typeof buildDashboardToDoItems>[number]): DashboardNavTarget {
  if (item.kind === "check" && item.auditId) {
    return { kind: "audit", auditId: item.auditId };
  }
  if (item.kind === "briefing" && item.briefingId) {
    return { kind: "briefing", briefingId: item.briefingId };
  }
  return { kind: "screen", screen: "dashboard" };
}

function groupReason(group: string): string {
  if (group === "overdue") return "Overdue and needs immediate attention";
  if (group === "dueToday") return "Due today on your schedule";
  if (group === "waiting") return "Waiting for you to complete";
  return "Upcoming assigned work";
}

export function buildTodaysWorkFromAssigned(input: {
  assignedAudits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMetaByAuditId: Record<string, AssignedCheckScheduleMeta>;
  briefingItems?: BriefingRecipientRecord[];
  pendingSyncCount?: number;
  failedSyncCount?: number;
  limit?: number;
}): TodaysWorkItem[] {
  const limit = input.limit ?? 8;
  const items: TodaysWorkItem[] = buildDashboardToDoItems({
    assignedAudits: input.assignedAudits,
    drafts: input.drafts,
    scheduleMetaByAuditId: input.scheduleMetaByAuditId,
    briefingItems: input.briefingItems,
  }).map((item) => ({
    id: item.id,
    title: item.title,
    reason: groupReason(item.group),
    dueLabel: item.dueLabel,
    area: item.typeLabel,
    statusLabel: item.statusLabel || item.dueLabel || "Assigned",
    actionLabel: item.actionLabel,
    target: todoTarget(item),
    priority: item.priority ?? 99,
  }));

  const syncTotal = (input.pendingSyncCount ?? 0) + (input.failedSyncCount ?? 0);
  if (syncTotal > 0) {
    items.unshift({
      id: "sync-queue",
      title: "Sync queued offline submissions",
      reason:
        (input.failedSyncCount ?? 0) > 0
          ? `${input.failedSyncCount} failed — retry from Sync / Offline Uploads`
          : `${input.pendingSyncCount} waiting to upload`,
      statusLabel: (input.failedSyncCount ?? 0) > 0 ? "Failed" : "Queued",
      actionLabel: "Open sync",
      target: { kind: "screen", screen: "sync" },
      priority: (input.failedSyncCount ?? 0) > 0 ? -10 : 0,
    });
  }

  return items.sort((a, b) => a.priority - b.priority).slice(0, limit);
}

export function buildRoleShortcuts(role: import("../../permissions").Role): RoleShortcut[] {
  return getRoleShortcuts(role).map((entry) => ({
    label: entry.label,
    description: entry.description,
    target: { kind: "screen", screen: entry.screen },
  }));
}
