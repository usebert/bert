import type { TabletOfflineSubmission } from "../services/tabletOfflineService";
import type { SubmissionQueueItem, SubmissionQueueItemType, SubmissionQueueStatus } from "../types/submissionQueue";
import type { SyncQueueItem, SyncItemType, SyncStatus } from "../types/sync";

function toSyncStatus(status: SubmissionQueueStatus): SyncStatus {
  if (status === "queued") return "Pending Sync";
  if (status === "syncing") return "Syncing";
  if (status === "synced") return "Synced";
  return "Failed";
}

function fromSyncStatus(status: SyncStatus): SubmissionQueueStatus {
  if (status === "Pending Sync") return "queued";
  if (status === "Syncing") return "syncing";
  if (status === "Synced") return "synced";
  return "failed";
}

function toSyncItemType(type: SubmissionQueueItemType): SyncItemType {
  if (type === "scheduleEdit") return "scheduleEdit";
  if (type === "reportExport") return "reportExport";
  if (type === "evidenceUpload") return "evidenceUpload";
  if (type === "actionUpdate") return "actionUpdate";
  return "auditSubmission";
}

function fromSyncItemType(itemType: SyncItemType): SubmissionQueueItemType {
  if (itemType === "scheduleEdit") return "scheduleEdit";
  if (itemType === "reportExport") return "reportExport";
  if (itemType === "evidenceUpload") return "evidenceUpload";
  if (itemType === "actionUpdate") return "actionUpdate";
  return "auditSubmission";
}

export function submissionQueueItemToSyncQueueItem(item: SubmissionQueueItem): SyncQueueItem {
  return {
    id: item.id,
    itemType: toSyncItemType(item.type),
    localId: item.localId,
    status: toSyncStatus(item.status),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    attemptedAt: item.attemptCount > 0 ? item.updatedAt : undefined,
    retryCount: item.attemptCount,
    lastError: item.lastError,
    payload: item.payload,
  };
}

export function syncQueueItemToSubmissionQueueItem(
  item: SyncQueueItem,
  input: { companyFolderId?: string; userEmail?: string; idempotencyKey?: string },
): SubmissionQueueItem {
  return {
    id: item.id,
    type: fromSyncItemType(item.itemType),
    companyFolderId: String(input.companyFolderId || item.payload.companyFolderId || ""),
    userEmail: String(input.userEmail || ""),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    status: fromSyncStatus(item.status),
    attemptCount: item.retryCount,
    lastError: item.lastError,
    payload: item.payload,
    idempotencyKey: input.idempotencyKey || `sync-${item.itemType}-${item.localId}`,
    localId: item.localId,
  };
}

export function offlineSubmissionToQueueItem(submission: TabletOfflineSubmission): SubmissionQueueItem {
  return {
    id: submission.localSubmissionId,
    type: "auditCompletion",
    companyFolderId: submission.companyFolderId || "",
    userEmail: submission.userId,
    createdAt: submission.createdAt,
    updatedAt: submission.createdAt,
    status:
      submission.syncStatus === "synced"
        ? "synced"
        : submission.syncStatus === "syncing"
          ? "syncing"
          : submission.syncStatus === "failed"
            ? "failed"
            : "queued",
    attemptCount: submission.retryCount,
    lastError: submission.lastError,
    payload: { offlineSubmission: submission },
    evidenceRefs: submission.evidenceRefs,
    idempotencyKey: `audit-completion-${submission.localSubmissionId}`,
    localId: submission.localSubmissionId,
  };
}

export function queueItemToOfflineSubmission(item: SubmissionQueueItem): TabletOfflineSubmission | null {
  if (item.type !== "auditCompletion") {
    return null;
  }
  const embedded = item.payload.offlineSubmission as TabletOfflineSubmission | undefined;
  if (embedded) {
    return {
      ...embedded,
      syncStatus:
        item.status === "synced"
          ? "synced"
          : item.status === "syncing"
            ? "syncing"
            : item.status === "failed"
              ? "failed"
              : "queued",
      retryCount: item.attemptCount,
      lastError: item.lastError,
    };
  }
  return null;
}

export function syncQueueItemsFromSubmissionQueue(items: SubmissionQueueItem[]): SyncQueueItem[] {
  return items
    .filter((item) => item.type !== "auditCompletion" && item.status !== "synced")
    .map(submissionQueueItemToSyncQueueItem);
}

export function offlineSubmissionsFromQueue(items: SubmissionQueueItem[]): TabletOfflineSubmission[] {
  return items
    .filter((item) => item.type === "auditCompletion" && item.status !== "synced")
    .map((item) => queueItemToOfflineSubmission(item))
    .filter((item): item is TabletOfflineSubmission => Boolean(item));
}

export function offlineSubmissionToSyncQueueItem(submission: TabletOfflineSubmission): SyncQueueItem {
  const status: SyncStatus =
    submission.syncStatus === "synced"
      ? "Synced"
      : submission.syncStatus === "syncing"
        ? "Syncing"
        : submission.syncStatus === "failed"
          ? "Failed"
          : "Pending Sync";
  return {
    id: submission.localSubmissionId,
    itemType: "auditSubmission",
    localId: submission.localSubmissionId,
    status,
    createdAt: submission.createdAt,
    updatedAt: submission.createdAt,
    retryCount: submission.retryCount,
    lastError: submission.lastError,
    payload: {
      auditId: submission.checkId,
      companyFolderId: submission.companyFolderId || "",
      offlineCompletion: true,
    },
  };
}
