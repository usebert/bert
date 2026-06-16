export type SyncItemType = "auditSubmission" | "actionUpdate" | "evidenceUpload" | "scheduleEdit" | "reportExport";
export type SyncStatus = "Pending Sync" | "Syncing" | "Synced" | "Failed" | "Conflict";

export type SyncQueueItem = {
  id: string;
  itemType: SyncItemType;
  localId: string;
  status: SyncStatus;
  createdAt: string;
  updatedAt: string;
  /** ISO or display stamp when a sync attempt last started (optional for older persisted queue rows). */
  attemptedAt?: string;
  retryCount: number;
  lastError: string;
  payload: Record<string, unknown>;
};
