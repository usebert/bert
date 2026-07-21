import type { HistoryEntry } from "../../types/reportsScreenProps";
import type { DashboardNavTarget, RecentActivityItem } from "./types";

function formatRelativeTime(isoOrLabel: string): string {
  const parsed = Date.parse(isoOrLabel);
  if (!Number.isFinite(parsed)) {
    return isoOrLabel;
  }
  const diffMs = Date.now() - parsed;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(parsed).toLocaleDateString();
}

export function buildRecentActivityFromHistory(
  history: HistoryEntry[],
  options?: { limit?: number; includeUser?: boolean },
): RecentActivityItem[] {
  const limit = options?.limit ?? 10;
  return history.slice(0, limit).map((entry) => ({
    id: entry.id,
    action: "Audit completed",
    recordName: entry.auditName,
    user: options?.includeUser === false ? undefined : entry.completedBy,
    timestamp: entry.completedAt,
    relativeTime: formatRelativeTime(entry.completedAt),
    target: entry.auditId ? { kind: "audit", auditId: entry.auditId } : { kind: "screen", screen: "reports" },
  }));
}

export function mergeRecentActivity(items: RecentActivityItem[], limit = 10): RecentActivityItem[] {
  const seen = new Set<string>();
  const merged: RecentActivityItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}
