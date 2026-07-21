import type { LiveActTodayItem } from "../../types/liveDashboard";
import type { ActionItem } from "../../types/reportsScreenProps";
import type { DashboardNavTarget, NeedsAttentionItem } from "./types";

const TYPE_LABELS: Record<string, string> = {
  "overdue-inspection": "Overdue inspection",
  incident: "Incident",
  "overdue-action": "Overdue action",
  briefing: "Briefing",
  "due-today": "Due today",
  "open-action": "Open action",
  "open-ncr": "Open NCR",
  "document-review": "Document review",
  "loler-overdue": "LOLER overdue",
  sync: "Sync issue",
};

function actTodayTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "Needs attention";
}

export function actTodayItemTarget(item: LiveActTodayItem): DashboardNavTarget {
  if (item.type === "overdue-inspection" || item.type === "due-today") {
    const auditId = item.id.replace(/^insp-(?:overdue|today)-/, "");
    if (auditId && auditId !== item.id) {
      return { kind: "audit", auditId };
    }
    return { kind: "screen", screen: "schedules" };
  }
  if (item.type === "incident") {
    return { kind: "screen", screen: "incidents" };
  }
  if (item.type === "overdue-action" || item.type === "open-action") {
    return { kind: "screen", screen: "actions", actionFilter: item.type === "overdue-action" ? "Overdue" : "Open" };
  }
  if (item.type === "briefing") {
    const briefingId = item.id.replace(/^briefing-/, "");
    if (briefingId && briefingId !== item.id) {
      return { kind: "briefing", briefingId };
    }
    return { kind: "screen", screen: "briefings" };
  }
  return { kind: "screen", screen: "dashboard" };
}

export function buildNeedsAttentionFromActToday(actToday: LiveActTodayItem[], limit = 5): NeedsAttentionItem[] {
  return actToday.slice(0, limit).map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle || undefined,
    area: item.area || undefined,
    dueLabel: item.dueLabel,
    priority: item.priority,
    typeLabel: actTodayTypeLabel(item.type),
    target: actTodayItemTarget(item),
    rank: item.rank,
  }));
}

export function buildNeedsAttentionFromActions(actions: ActionItem[], limit = 5): NeedsAttentionItem[] {
  return actions
    .filter((action) => action.status !== "Closed")
    .sort((a, b) => {
      const aOver = a.dueHours < 0 ? 0 : 1;
      const bOver = b.dueHours < 0 ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return a.dueHours - b.dueHours;
    })
    .slice(0, limit)
    .map((action, index) => ({
      id: `action-${action.id}`,
      title: action.suggestedActionTitle || action.auditName || action.questionText,
      subtitle: action.questionText,
      area: action.siteArea || action.owner,
      dueLabel: action.dueHours < 0 ? "Overdue" : action.dueLabel || "Open",
      priority: action.severity === "Critical" || action.severity === "High" ? action.severity : "Medium",
      typeLabel: action.dueHours < 0 ? "Overdue action" : "Open action",
      target: {
        kind: "screen",
        screen: "actions",
        actionFilter: action.dueHours < 0 ? "Overdue" : "Open",
      },
      rank: index + 1,
    }));
}

export function buildMasterNeedsAttention(input: {
  pendingOnboardingCount: number;
  failedSyncCount: number;
  pendingSyncCount: number;
}): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = [];
  if (input.pendingOnboardingCount > 0) {
    items.push({
      id: "master-onboarding",
      title: `${input.pendingOnboardingCount} compan${input.pendingOnboardingCount === 1 ? "y" : "ies"} awaiting onboarding`,
      subtitle: "Finish provisioning before users can sign in.",
      dueLabel: "Pending",
      priority: "High",
      typeLabel: "Onboarding",
      target: { kind: "screen", screen: "onboarding" },
      rank: items.length + 1,
    });
  }
  if (input.failedSyncCount > 0) {
    items.push({
      id: "master-sync-failed",
      title: `${input.failedSyncCount} failed offline upload${input.failedSyncCount === 1 ? "" : "s"}`,
      subtitle: "Retry submissions from Sync / Offline Uploads.",
      dueLabel: "Failed",
      priority: "High",
      typeLabel: "Sync issue",
      target: { kind: "screen", screen: "sync" },
      rank: items.length + 1,
    });
  } else if (input.pendingSyncCount > 0) {
    items.push({
      id: "master-sync-queued",
      title: `${input.pendingSyncCount} queued offline upload${input.pendingSyncCount === 1 ? "" : "s"}`,
      subtitle: "Waiting to reach the workbook.",
      dueLabel: "Queued",
      priority: "Medium",
      typeLabel: "Sync issue",
      target: { kind: "screen", screen: "sync" },
      rank: items.length + 1,
    });
  }
  return items.slice(0, 5);
}
