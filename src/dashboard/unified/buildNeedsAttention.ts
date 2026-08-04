import type { LiveActTodayItem } from "../../types/liveDashboard";
import type { ActionItem } from "../../types/reportsScreenProps";
import { bertLinkToDashboardTarget, buildBertRecordLink, buildKpiListNavigation } from "../../lib/bertRecordNavigation";
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

export function actTodayItemTarget(item: LiveActTodayItem, companyFolderId = ""): DashboardNavTarget {
  if (item.route && item.navigate) {
    return bertLinkToDashboardTarget({
      itemType: item.itemType || item.recordType || item.type,
      recordType: item.recordType || item.itemType || item.type,
      recordId: item.recordId || "",
      route: item.route,
      screen: item.navigate.screen,
      navigate: item.navigate,
    });
  }
  const link = buildBertRecordLink({
    recordType: item.type,
    recordId: item.recordId || item.id,
    companyFolderId,
    scheduleId: item.scheduleId,
    templateId: item.templateId || item.auditId,
    filter: item.type === "overdue-action" ? "overdue" : item.type === "open-action" ? "open" : undefined,
  });
  return bertLinkToDashboardTarget(link);
}

export function buildNeedsAttentionFromActToday(
  actToday: LiveActTodayItem[],
  limit = 5,
  companyFolderId = "",
): NeedsAttentionItem[] {
  return actToday.slice(0, limit).map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle || undefined,
    area: item.area || undefined,
    dueLabel: item.dueLabel,
    priority: item.priority,
    typeLabel: actTodayTypeLabel(item.type),
    target: actTodayItemTarget(item, companyFolderId),
    route: item.route,
    rank: item.rank,
  }));
}

export function buildNeedsAttentionFromActions(actions: ActionItem[], limit = 5, companyFolderId = ""): NeedsAttentionItem[] {
  return actions
    .filter((action) => action.status !== "Closed")
    .sort((a, b) => {
      const aOver = a.dueHours < 0 ? 0 : 1;
      const bOver = b.dueHours < 0 ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return a.dueHours - b.dueHours;
    })
    .slice(0, limit)
    .map((action, index) => {
      const link = buildBertRecordLink({
        recordType: "action",
        recordId: action.id,
        companyFolderId,
        filter: action.dueHours < 0 ? "overdue" : "open",
        title: action.suggestedActionTitle || action.questionText,
      });
      return {
        id: `action-${action.id}`,
        title: action.suggestedActionTitle || action.auditName || action.questionText,
        subtitle: action.questionText,
        area: action.siteArea || action.owner,
        dueLabel: action.dueHours < 0 ? "Overdue" : action.dueLabel || "Open",
        priority: action.severity === "Critical" || action.severity === "High" ? action.severity : "Medium",
        typeLabel: action.dueHours < 0 ? "Overdue action" : "Open action",
        target: bertLinkToDashboardTarget(link),
        route: link.route,
        rank: index + 1,
      };
    });
}

export { buildKpiListNavigation };

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
