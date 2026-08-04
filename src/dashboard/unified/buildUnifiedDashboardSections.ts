import type { LiveDashboardPayload } from "../../types/liveDashboard";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { ActionItem, Audit, HistoryEntry } from "../../types/reportsScreenProps";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { Role } from "../../permissions";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import {
  buildMasterNeedsAttention,
  buildNeedsAttentionFromActToday,
  buildNeedsAttentionFromActions,
} from "./buildNeedsAttention";
import { buildPerformanceKpis, deriveLocalCounts } from "./buildPerformanceKpis";
import { buildRecentActivityFromHistory } from "./buildRecentActivity";
import { buildRoleShortcuts, buildTodaysWorkFromAssigned } from "./buildTodaysWork";
import type { UnifiedDashboardSections } from "./types";

export function buildUnifiedDashboardSections(input: {
  role: Role;
  livePayload?: LiveDashboardPayload | null;
  companyFolderId?: string;
  assignedAudits?: Audit[];
  drafts?: Record<string, AuditDraft>;
  scheduleMetaByAuditId?: Record<string, AssignedCheckScheduleMeta>;
  briefingItems?: BriefingRecipientRecord[];
  actions?: ActionItem[];
  history?: HistoryEntry[];
  pendingSyncCount?: number;
  failedSyncCount?: number;
  pendingOnboardingCount?: number;
  includeActivityUser?: boolean;
}): UnifiedDashboardSections {
  const role = input.role;
  const companyFolderId = input.companyFolderId || "";
  const actToday = input.livePayload?.actToday ?? [];
  const needsAttention =
    actToday.length > 0
      ? buildNeedsAttentionFromActToday(actToday, 5, companyFolderId)
      : role === "Master"
        ? buildMasterNeedsAttention({
            pendingOnboardingCount: input.pendingOnboardingCount ?? 0,
            failedSyncCount: input.failedSyncCount ?? 0,
            pendingSyncCount: input.pendingSyncCount ?? 0,
          })
        : buildNeedsAttentionFromActions(input.actions ?? [], 5, companyFolderId);

  const needsAttentionTotal =
    actToday.length > 0
      ? actToday.length
      : role === "Master"
        ? needsAttention.length
        : (input.actions ?? []).filter((action) => action.status !== "Closed" && action.dueHours < 0).length ||
          needsAttention.length;

  const todaysWork = buildTodaysWorkFromAssigned({
    assignedAudits: input.assignedAudits ?? [],
    drafts: input.drafts ?? {},
    scheduleMetaByAuditId: input.scheduleMetaByAuditId ?? {},
    briefingItems: input.briefingItems,
    pendingSyncCount: input.pendingSyncCount,
    failedSyncCount: input.failedSyncCount,
  });

  const pendingBriefings = (input.briefingItems ?? []).filter((item) => item.needsAction === true).length;
  const localCounts = deriveLocalCounts({
    actions: input.actions,
    assignedAudits: input.assignedAudits,
    pendingBriefings,
    pendingSyncCount: input.pendingSyncCount,
    failedSyncCount: input.failedSyncCount,
  });
  if (input.livePayload?.metrics) {
    localCounts.auditsCompletedToday = input.livePayload.metrics.todayCompleted;
  }

  const performance = buildPerformanceKpis({
    role,
    livePayload: input.livePayload,
    localCounts,
    companyFolderId,
  });

  const recentActivity = buildRecentActivityFromHistory(input.history ?? [], {
    limit: 10,
    includeUser: input.includeActivityUser ?? role !== "Auditor",
  });

  return {
    needsAttention,
    needsAttentionTotal,
    todaysWork,
    performance,
    recentActivity,
    shortcuts: buildRoleShortcuts(role),
  };
}
