import type { TabletEvidenceRef } from "../services/tabletOfflineService";

export type SubmissionQueueItemType =
  | "auditCompletion"
  | "auditSubmission"
  | "actionUpdate"
  | "evidenceUpload"
  | "incidentReport"
  | "briefingCreate"
  | "briefingAck"
  | "briefingSign"
  | "briefingReply"
  | "scheduleTaskCompletion"
  | "scheduleEdit"
  | "reportExport";

export type SubmissionQueueStatus = "queued" | "syncing" | "synced" | "failed";

export type SubmissionQueueItem = {
  id: string;
  type: SubmissionQueueItemType;
  companyFolderId: string;
  userEmail: string;
  createdAt: string;
  updatedAt: string;
  status: SubmissionQueueStatus;
  attemptCount: number;
  lastError: string;
  payload: Record<string, unknown>;
  evidenceRefs?: TabletEvidenceRef[];
  idempotencyKey: string;
  /** Stable local reference used by Sync Centre retry UI */
  localId: string;
  nextRetryAt?: string;
  /**
   * Marks an item that can never be synced automatically (legacy/malformed
   * payload). It is excluded from auto-retry and must be dismissed manually.
   */
  unsyncable?: boolean;
};

export type SubmissionQueueMeta = {
  lastSyncedAt?: string;
  lastHydratedAt?: string;
  /** localIds the user dismissed — prevents legacy workspace migration from resurrecting them */
  dismissedLocalIds?: string[];
  /** idempotency keys the user dismissed — belt-and-suspenders for migrate/enqueue */
  dismissedIdempotencyKeys?: string[];
};
