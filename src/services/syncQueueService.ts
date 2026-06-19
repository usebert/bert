import { CURRENT_SCHEMA_VERSION } from "../schema/companySchema";
import { createLocalRecordMetadata, localDatabaseService, type LocalSyncLifecycle } from "./localDatabaseService";

export type SyncOperation = "Create" | "Update" | "Append" | "UploadEvidence";
export type SyncQueueStatus = "Pending Sync" | "Syncing" | "Synced" | "Failed" | "Conflict";
export type SyncEntityType =
  | "auditSubmission"
  | "auditResult"
  | "auditFinding"
  | "actionUpdate"
  | "actionComment"
  | "evidenceUpload"
  | "scheduleEdit"
  | "reportExport"
  | "syncLog";

export type SyncQueueRecord = {
  id: string;
  localId: string;
  entityId?: string;
  status: SyncQueueStatus;
  updatedAt: string;
  attemptedAt?: string;
  completedAt?: string;
  syncAttempts?: number;
  retryCount: number;
  lastError: string;
  lastSyncedAt?: string;
} & Record<string, unknown>;

function toUiStatus(value: LocalSyncLifecycle): SyncQueueStatus {
  if (value === "Pending") return "Pending Sync";
  if (value === "Syncing") return "Syncing";
  if (value === "Synced") return "Synced";
  if (value === "Conflict") return "Conflict";
  return "Failed";
}

function toLocalStatus(value: SyncQueueStatus): LocalSyncLifecycle {
  if (value === "Pending Sync") return "Pending";
  if (value === "Syncing") return "Syncing";
  if (value === "Synced") return "Synced";
  if (value === "Conflict") return "Conflict";
  return "Failed";
}

export function buildSyncQueueItem(input: {
  companyId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  actor: string;
  priority?: number;
  status?: SyncQueueStatus;
  createdAt?: string;
}) {
  const createdAt = input.createdAt || new Date().toISOString();
  const metadata = createLocalRecordMetadata({
    id: `sync-${input.entityType}-${input.entityId}-${Date.now()}`,
    companyId: input.companyId,
    actor: input.actor,
    createdAt,
    syncStatus: toLocalStatus(input.status || "Pending Sync"),
  });

  return {
    syncItemId: metadata.id,
    id: metadata.id,
    companyId: input.companyId,
    entityType: input.entityType,
    entityId: input.entityId,
    itemType: input.entityType,
    localId: input.entityId,
    operation: input.operation,
    payload: input.payload,
    status: toUiStatus(metadata.syncStatus),
    createdAt,
    updatedAt: createdAt,
    attemptedAt: "",
    completedAt: "",
    retryCount: 0,
    syncAttempts: 0,
    lastError: "",
    priority: input.priority ?? 50,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdBy: input.actor,
    updatedBy: input.actor,
    remoteRowId: "",
    localUpdatedAt: createdAt,
    remoteUpdatedAt: "",
    lastSyncedAt: "",
    versionNumber: 1,
  };
}

export const syncQueueService = {
  loadQueue<T extends SyncQueueRecord>() {
    return localDatabaseService.loadSyncQueue<T>();
  },
  saveQueue<T extends SyncQueueRecord>(items: T[]) {
    localDatabaseService.saveSyncQueue(items);
  },
  enqueue<T extends SyncQueueRecord>(item: T) {
    const current = this.loadQueue<T>();
    const next = [item, ...current.filter((existing) => existing.id !== item.id)];
    this.saveQueue(next);
    return next;
  },
  updateStatus<T extends SyncQueueRecord>(items: T[], entityId: string, status: SyncQueueStatus, lastError = "") {
    const attemptedAt = new Date().toISOString();
    const next = items.map((item) =>
      item.localId === entityId || item.entityId === entityId
        ? {
            ...item,
            status,
            attemptedAt,
            completedAt: status === "Synced" ? attemptedAt : item.completedAt,
            updatedAt: attemptedAt,
            syncAttempts:
              status === "Syncing" || status === "Failed"
                ? (item.syncAttempts || 0) + 1
                : (item.syncAttempts || 0),
            retryCount: status === "Failed" ? item.retryCount + 1 : item.retryCount,
            lastError,
            lastSyncedAt: status === "Synced" ? attemptedAt : item.lastSyncedAt,
          }
        : item,
    );
    this.saveQueue(next);
    return next;
  },
  retryFailed<T extends SyncQueueRecord>(items: T[]) {
    const next = items.map((item) =>
      item.status === "Failed"
        ? {
            ...item,
            status: "Pending Sync" as SyncQueueStatus,
            lastError: "",
            updatedAt: new Date().toISOString(),
          }
        : item,
    );
    this.saveQueue(next);
    return next;
  },
  groupCounts<T extends SyncQueueRecord>(items: T[]) {
    return items.reduce(
      (accumulator, item) => {
        if (item.status === "Failed") accumulator.failed += 1;
        if (item.status === "Conflict") accumulator.conflicts += 1;
        if (item.status === "Pending Sync") accumulator.pending += 1;
        if (item.status === "Synced") accumulator.synced += 1;
        return accumulator;
      },
      { failed: 0, conflicts: 0, pending: 0, synced: 0 },
    );
  },
};
