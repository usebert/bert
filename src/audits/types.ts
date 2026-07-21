import type { Role } from "../permissions";
import type { AuditDraft } from "../types/dashboardScreenProps";
import type { Audit, AuditTemplate } from "../types/reportsScreenProps";
import type { AssignedCheckScheduleMeta } from "../utils/assignedCheckDisplay";
import type { AuditsScreenProps } from "../types/auditsScreenProps";

export type AuditsWorkspaceTab =
  | "my-audits"
  | "scheduled"
  | "in-progress"
  | "completed"
  | "templates";

export type AuditDisplayStatus =
  | "Due today"
  | "Overdue"
  | "In progress"
  | "Draft"
  | "Completed"
  | "Failed"
  | "Awaiting sync"
  | "Sync failed"
  | "Upcoming"
  | "Available";

export type AuditListItem = {
  id: string;
  name: string;
  site?: string;
  area?: string;
  assignee?: string;
  dueLabel?: string;
  dueHours: number;
  status: AuditDisplayStatus;
  progressLabel?: string;
  resultLabel?: string;
  syncStatus?: "synced" | "queued" | "failed" | "none";
  actionLabel: string;
  hasDraft: boolean;
  scheduleName?: string;
  frequency?: string;
  lastCompletedAt?: string;
  nextDueAt?: string;
  priority: number;
  audit: Audit;
};

export type AuditSummaryMetric = {
  id: string;
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  tab?: AuditsWorkspaceTab;
};

export type AuditFilterState = {
  query: string;
  status: string;
  site: string;
  sync: string;
};

export type AuditsWorkspaceProps = AuditsScreenProps & {
  offlineMode?: boolean;
  onNavigateToResults?: () => void;
};

export type BuildAuditListInput = {
  audits: Audit[];
  drafts: Record<string, AuditDraft>;
  scheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  unsyncedAuditIds?: Set<string>;
  role: Role;
};
