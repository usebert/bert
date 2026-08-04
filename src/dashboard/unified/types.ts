import type { Role } from "../../permissions";
import type { NavItemId } from "../../types/navigation";
import type { LiveRiskLevel } from "../../types/liveDashboard";
import type { SearchNavigateTarget } from "../../presentation/searchPresentation";

export type DashboardNavTarget =
  | {
      kind: "screen";
      screen: NavItemId;
      actionFilter?: string;
      filter?: string;
      route?: string;
    }
  | { kind: "audit"; auditId: string; scheduleId?: string; route?: string }
  | { kind: "briefing"; briefingId: string; route?: string }
  | { kind: "record"; route: string; navigate: SearchNavigateTarget };

export type NeedsAttentionItem = {
  id: string;
  title: string;
  subtitle?: string;
  area?: string;
  dueLabel: string;
  priority: LiveRiskLevel;
  typeLabel: string;
  target: DashboardNavTarget;
  route?: string;
  rank: number;
};

export type TodaysWorkItem = {
  id: string;
  title: string;
  reason: string;
  dueLabel?: string;
  area?: string;
  statusLabel: string;
  actionLabel: string;
  target: DashboardNavTarget;
  priority: number;
};

export type PerformanceKpi = {
  id: string;
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  subtitle?: string;
  target: DashboardNavTarget;
};

export type RecentActivityItem = {
  id: string;
  action: string;
  recordName: string;
  user?: string;
  timestamp: string;
  relativeTime: string;
  target?: DashboardNavTarget;
};

export type RoleShortcut = {
  label: string;
  description: string;
  target: DashboardNavTarget;
};

export type UnifiedDashboardRole = Role;

export type SectionLoadState = "idle" | "loading" | "ready" | "error";

export type UnifiedDashboardSections = {
  needsAttention: NeedsAttentionItem[];
  needsAttentionTotal: number;
  todaysWork: TodaysWorkItem[];
  performance: PerformanceKpi[];
  recentActivity: RecentActivityItem[];
  shortcuts: RoleShortcut[];
};
