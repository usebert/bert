/** Shared customer-facing status labels for lists, badges and summaries. */
export const STATUS_LABELS = {
  open: "Open",
  inProgress: "In Progress",
  dueToday: "Due Today",
  overdue: "Overdue",
  awaitingReview: "Awaiting Review",
  awaitingVerification: "Awaiting Verification",
  completed: "Completed",
  closed: "Closed",
  archived: "Archived",
  awaitingSync: "Awaiting Sync",
  syncing: "Syncing…",
  syncFailed: "Sync failed",
} as const;

export type StatusLabelKey = keyof typeof STATUS_LABELS;

export function statusLabel(key: StatusLabelKey): string {
  return STATUS_LABELS[key];
}

/** Normalise legacy/internal status strings to customer-facing labels. */
export function normalizeStatusLabel(raw: string): string {
  const value = raw.trim();
  if (!value) return STATUS_LABELS.open;
  const lower = value.toLowerCase();
  if (lower === "in progress") return STATUS_LABELS.inProgress;
  if (lower === "due today") return STATUS_LABELS.dueToday;
  if (lower === "awaiting verification") return STATUS_LABELS.awaitingVerification;
  if (lower === "awaiting review") return STATUS_LABELS.awaitingReview;
  if (lower === "awaiting sync" || lower === "pending sync") return STATUS_LABELS.awaitingSync;
  if (lower === "closed") return STATUS_LABELS.closed;
  if (lower === "completed") return STATUS_LABELS.completed;
  if (lower === "archived") return STATUS_LABELS.archived;
  if (lower === "overdue") return STATUS_LABELS.overdue;
  if (lower === "open") return STATUS_LABELS.open;
  return value;
}
