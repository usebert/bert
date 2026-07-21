import type { SearchNavigateTarget } from "./searchPresentation";

export type BertNotificationType =
  | "audit"
  | "action"
  | "safety"
  | "ncr"
  | "document"
  | "briefing"
  | "equipment"
  | "sync"
  | "onboarding";

export type BertNotificationSeverity = "info" | "warning" | "high" | "critical";

export type NotificationDestination = SearchNavigateTarget;

export type BertNotification = {
  key: string;
  type: BertNotificationType;
  title: string;
  description?: string;
  status?: string;
  severity?: BertNotificationSeverity;
  dueAt?: string;
  createdAt?: string;
  siteName?: string;
  areaName?: string;
  destination: NotificationDestination;
  sourceRecordKey?: string;
  priority: number;
  group: NotificationGroupId;
};

export type NotificationGroupId =
  | "urgent"
  | "due-today"
  | "upcoming"
  | "awaiting-review"
  | "sync"
  | "setup";

export type NotificationFilterId =
  | "all"
  | "audits"
  | "actions"
  | "safety"
  | "ncrs"
  | "documents"
  | "equipment"
  | "briefings"
  | "sync";

export type NotificationFilterOption = {
  id: NotificationFilterId;
  label: string;
  types: BertNotificationType[];
};

export const NOTIFICATION_FILTERS: NotificationFilterOption[] = [
  { id: "all", label: "All", types: [] },
  { id: "audits", label: "Audits", types: ["audit"] },
  { id: "actions", label: "Actions", types: ["action"] },
  { id: "safety", label: "Safety", types: ["safety"] },
  { id: "ncrs", label: "NCRs", types: ["ncr"] },
  { id: "documents", label: "Documents", types: ["document"] },
  { id: "equipment", label: "Equipment", types: ["equipment"] },
  { id: "briefings", label: "Briefings", types: ["briefing"] },
  { id: "sync", label: "Sync", types: ["sync"] },
];

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroupId, string> = {
  urgent: "Urgent",
  "due-today": "Due today",
  upcoming: "Upcoming",
  "awaiting-review": "Awaiting review",
  sync: "Sync issues",
  setup: "Setup",
};

export const NOTIFICATION_GROUP_ORDER: NotificationGroupId[] = [
  "urgent",
  "due-today",
  "awaiting-review",
  "sync",
  "setup",
  "upcoming",
];

export const NOTIFICATION_PRIORITY = {
  SYNC_FAILED: 10,
  SAFETY_CRITICAL: 20,
  AUDIT_OVERDUE: 30,
  ACTION_OVERDUE: 40,
  NCR_OVERDUE: 50,
  LOLER_OVERDUE: 60,
  DUE_TODAY: 70,
  AWAITING_VERIFICATION: 80,
  BRIEFING_MANDATORY: 90,
  DOCUMENT_REVIEW: 100,
  ONBOARDING: 110,
  SYNC_QUEUED: 120,
  UPCOMING: 200,
} as const;

export const NOTIFICATION_READ_STORAGE_PREFIX = "bert:notifications-read";

export const NOTIFICATION_RENDER_CAP = 80;
