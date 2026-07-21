import type { Role } from "../permissions";
import type { User } from "../types/dashboardScreenProps";
import type { ActionItem, ActionStatus, RiskLevel } from "../types/reportsScreenProps";

export type ActionsWorkspaceTab =
  | "my-actions"
  | "all-open"
  | "overdue"
  | "awaiting-verification"
  | "completed"
  | "archived";

export type ActionDisplayStatus =
  | "Open"
  | "In progress"
  | "Due today"
  | "Overdue"
  | "Awaiting verification"
  | "Completed"
  | "Verified"
  | "Rejected"
  | "Awaiting sync"
  | "Sync failed"
  | "Archived";

export type ActionListItem = {
  id: string;
  title: string;
  description?: string;
  sourceLabel: string;
  sourceReference?: string;
  site?: string;
  area?: string;
  assignee: string;
  dueLabel: string;
  dueHours: number;
  priority: RiskLevel;
  status: ActionDisplayStatus;
  workflowStatus: ActionStatus;
  verificationLabel?: string;
  syncStatus: "synced" | "queued" | "failed" | "none";
  actionLabel: string;
  nextStep?: string;
  evidenceCount: number;
  evidenceRequired: boolean;
  hasProgress: boolean;
  urgency: "Escalated" | "Overdue" | "Stuck" | "Due soon" | "Normal";
  sortPriority: number;
  action: ActionItem;
};

export type ActionSummaryMetric = {
  id: string;
  label: string;
  value: string | number;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  tab?: ActionsWorkspaceTab;
  filter?: string;
};

export type ActionFilterState = {
  query: string;
  status: string;
  priority: string;
  site: string;
  source: string;
  sync: string;
};

export type ActionFilter = "Open" | "Overdue" | "Awaiting Verification" | "Closed" | "Severity";

export type ActionsWorkspaceProps = {
  currentUser: User;
  actions: ActionItem[];
  actionFilter: ActionFilter;
  actionSeverityFilter: RiskLevel | "All";
  actionNcFilter: string;
  availableNonConformanceIds: string[];
  availableAuditors: string[];
  pendingOfflineActionIds?: Set<string>;
  offlineMode?: boolean;
  onFilterChange: (value: ActionFilter) => void;
  onSeverityFilterChange: (value: RiskLevel | "All") => void;
  onNcFilterChange: (value: string) => void;
  onAdvanceAction: (actionId: string, nextStatus?: ActionStatus) => void;
  onAssignAction: (actionId: string, assignee: string) => void;
  onAddEvidence: (actionId: string, files: FileList) => void;
  onAcceptSuggestion: (actionId: string) => void;
  onEditSuggestion: (actionId: string) => void;
  onIgnoreSuggestion: (actionId: string) => void;
  archiveCompanyFolderId?: string;
  archiveMasterSheetId?: string;
  archiveOffline?: boolean;
  onActionArchived?: (actionId: string) => void | Promise<void>;
  onArchiveError?: (message: string) => void;
  onArchiveSuccess?: () => void;
  onNavigateToArchive?: () => void;
  onCreateAction?: () => void;
};

export type ActionsRole = Role;
