import type { LiveDashboardMetrics, LiveDashboardPayload } from "../../types/liveDashboard";
import type { ActionItem } from "../../types/reportsScreenProps";
import type { Audit } from "../../types/reportsScreenProps";
import type { KpiMetricId } from "./roleConfig";
import { getKpiOrderForRole } from "./roleConfig";
import type { DashboardNavTarget, PerformanceKpi, UnifiedDashboardRole } from "./types";

type LocalCounts = {
  openActions?: number;
  overdueActions?: number;
  dueTodayChecks?: number;
  outstandingChecks?: number;
  pendingBriefings?: number;
  pendingSyncCount?: number;
  failedSyncCount?: number;
  auditsCompletedToday?: number;
};

function kpiTarget(id: KpiMetricId): DashboardNavTarget {
  if (id === "compliance-score") return { kind: "screen", screen: "reports" };
  if (id === "open-actions" || id === "overdue-actions") {
    return { kind: "screen", screen: "actions", actionFilter: id === "overdue-actions" ? "Overdue" : "Open" };
  }
  if (id === "current-incidents") return { kind: "screen", screen: "incidents" };
  if (id === "audits-completed" || id === "today-due" || id === "today-outstanding") {
    return { kind: "screen", screen: "audits" };
  }
  if (id === "outstanding-briefings") return { kind: "screen", screen: "briefings" };
  if (id === "equipment-due") return { kind: "screen", screen: "loler" };
  if (id === "documents-awaiting") return { kind: "screen", screen: "documentControl" };
  if (id === "sync-queued") return { kind: "screen", screen: "sync" };
  return { kind: "screen", screen: "dashboard" };
}

function toneForMetric(id: KpiMetricId, value: number): PerformanceKpi["tone"] {
  if (id === "compliance-score") {
    if (value >= 85) return "success";
    if (value >= 70) return "warning";
    return "danger";
  }
  if (id === "overdue-actions" || id === "current-incidents") {
    return value > 0 ? "danger" : "success";
  }
  if (id === "open-actions" || id === "today-outstanding" || id === "outstanding-briefings" || id === "equipment-due") {
    return value > 0 ? "warning" : "success";
  }
  if (id === "audits-completed" || id === "today-due") {
    return value > 0 ? "info" : "neutral";
  }
  if (id === "sync-queued") {
    return value > 0 ? "warning" : "success";
  }
  return "neutral";
}

function metricValue(id: KpiMetricId, live?: LiveDashboardMetrics | null, local?: LocalCounts): number | null {
  if (live) {
    if (id === "compliance-score") return live.complianceScore;
    if (id === "open-actions") return live.openActions;
    if (id === "overdue-actions") return live.overdueActions;
    if (id === "current-incidents") return live.currentIncidents;
    if (id === "audits-completed") return live.todayCompleted;
    if (id === "outstanding-briefings") return live.pendingBriefings;
    if (id === "today-due") return live.todayDue;
    if (id === "today-outstanding") return live.todayOutstanding;
    if (id === "equipment-due") return live.overdueInspections;
  }
  if (!local) return null;
  if (id === "open-actions" && typeof local.openActions === "number") return local.openActions;
  if (id === "overdue-actions" && typeof local.overdueActions === "number") return local.overdueActions;
  if (id === "outstanding-briefings" && typeof local.pendingBriefings === "number") return local.pendingBriefings;
  if (id === "today-due" && typeof local.dueTodayChecks === "number") return local.dueTodayChecks;
  if (id === "today-outstanding" && typeof local.outstandingChecks === "number") return local.outstandingChecks;
  if (id === "audits-completed" && typeof local.auditsCompletedToday === "number") return local.auditsCompletedToday;
  if (id === "sync-queued") return (local.pendingSyncCount ?? 0) + (local.failedSyncCount ?? 0);
  return null;
}

const KPI_LABELS: Record<KpiMetricId, string> = {
  "compliance-score": "Compliance score",
  "open-actions": "Open actions",
  "overdue-actions": "Overdue actions",
  "current-incidents": "Current incidents",
  "audits-completed": "Audits completed",
  "documents-awaiting": "Documents awaiting review",
  "outstanding-briefings": "Outstanding briefings",
  "equipment-due": "Equipment due / overdue",
  "today-due": "Due today",
  "today-outstanding": "Outstanding today",
  "sync-queued": "Sync queue",
};

export function buildPerformanceKpis(input: {
  role: UnifiedDashboardRole;
  livePayload?: LiveDashboardPayload | null;
  localCounts?: LocalCounts;
}): PerformanceKpi[] {
  const liveMetrics = input.livePayload?.metrics;
  const complianceScore = input.livePayload?.compliance?.score;
  const order = getKpiOrderForRole(input.role);
  const kpis: PerformanceKpi[] = [];

  for (const id of order) {
    if (id === "compliance-score") {
      if (typeof complianceScore !== "number") continue;
      kpis.push({
        id,
        label: KPI_LABELS[id],
        value: String(complianceScore),
        tone: toneForMetric(id, complianceScore),
        subtitle: input.livePayload?.compliance.label,
        target: kpiTarget(id),
      });
      continue;
    }
    const value = metricValue(id, liveMetrics, input.localCounts);
    if (value === null) continue;
    kpis.push({
      id,
      label: KPI_LABELS[id],
      value: String(value),
      tone: toneForMetric(id, value),
      target: kpiTarget(id),
    });
  }

  return kpis;
}

export function deriveLocalCounts(input: {
  actions?: ActionItem[];
  assignedAudits?: Audit[];
  pendingBriefings?: number;
  pendingSyncCount?: number;
  failedSyncCount?: number;
}): LocalCounts {
  const actions = input.actions ?? [];
  const assignedAudits = input.assignedAudits ?? [];
  return {
    openActions: actions.filter((action) => action.status !== "Closed").length,
    overdueActions: actions.filter((action) => action.dueHours < 0 && action.status !== "Closed").length,
    dueTodayChecks: assignedAudits.filter(
      (audit) => audit.dueHours >= 0 && (audit.dueLabel === "Due today" || audit.dueHours <= 24),
    ).length,
    outstandingChecks: assignedAudits.filter((audit) => audit.dueHours >= 0).length,
    pendingBriefings: input.pendingBriefings,
    pendingSyncCount: input.pendingSyncCount,
    failedSyncCount: input.failedSyncCount,
  };
}
