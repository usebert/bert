import type { SubmissionQueueItem } from "../types/submissionQueue";

export const SUBMISSION_QUEUE_MESSAGES = {
  added: "Added to queue",
  addedOnline: "Added to queue. Syncing now…",
  addedOffline: "Added to queue. This will sync when connection returns.",
  success: "Submitted successfully",
  itemSuccess: "Item submitted successfully",
  allSynced: "All queued items synced",
  partialFailure: "Some items could not sync",
  failure: "Sync failed. Your item is still in the queue. Please retry.",
  legacyUnsyncable:
    "This queued item was created by an older app version and cannot be synced automatically.",
  dismissWarning:
    "This removes the item from your local queue. It will not be synced. Continue?",
  evidenceAdded: "Evidence added",
  evidenceSubmit: "Added to queue. Uploading evidence and saving submission…",
} as const;

/**
 * Safe, user-facing sync failure reasons. We only ever surface phrases from this
 * allow-list so that raw error text (stack traces, tokens, secrets, password
 * hashes, Google credentials, or raw payloads) can never leak into the UI or the
 * persisted queue.
 */
export const SAFE_SYNC_ERROR_REASONS = {
  missingFolder: "Missing company folder",
  templateNotFound: "Audit template not found",
  network: "Network request failed",
  serverRejected: "Server rejected submission",
  generic: SUBMISSION_QUEUE_MESSAGES.failure,
} as const;

export type SafeSyncErrorReason = (typeof SAFE_SYNC_ERROR_REASONS)[keyof typeof SAFE_SYNC_ERROR_REASONS];

/**
 * Maps an arbitrary/raw error into one of a small set of safe, human-readable
 * reasons. The raw error text is only inspected to pick a bucket — it is never
 * returned verbatim, so nothing sensitive is exposed.
 */
export function safeSyncErrorMessage(error: unknown): SafeSyncErrorReason {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const text = raw.toLowerCase();

  if (!text) {
    return SAFE_SYNC_ERROR_REASONS.generic;
  }
  if (
    /company (master sheet|folder)|master sheet|workspace is not linked|not linked yet|folder id|company folder|missing folder|selectedfolder/.test(
      text,
    )
  ) {
    return SAFE_SYNC_ERROR_REASONS.missingFolder;
  }
  if (
    /template not found|audit template|missing sync data|sync data|submitting the check again|check again|no audit|unknown audit/.test(
      text,
    )
  ) {
    return SAFE_SYNC_ERROR_REASONS.templateNotFound;
  }
  if (/network|failed to fetch|fetch failed|offline|timeout|timed out|connection|econn|dns|unreachable/.test(text)) {
    return SAFE_SYNC_ERROR_REASONS.network;
  }
  if (
    /\b[45]\d\d\b|status code|rejected|server|sheet|permission|denied|unauthor|forbidden|invalid|bad request|quota/.test(
      text,
    )
  ) {
    return SAFE_SYNC_ERROR_REASONS.serverRejected;
  }
  return SAFE_SYNC_ERROR_REASONS.generic;
}

/**
 * Detects queue items whose payload predates the current sync handler and can
 * therefore never be synced automatically (legacy / malformed items left behind
 * by earlier app versions or interrupted tests).
 */
export function isLegacyUnsyncableItem(item: Pick<SubmissionQueueItem, "type" | "payload">): boolean {
  const payload = (item.payload || {}) as Record<string, unknown>;
  if (item.type === "auditCompletion") {
    const offline = payload.offlineSubmission as
      | { audit?: unknown; answers?: unknown }
      | undefined;
    if (!offline || typeof offline !== "object") {
      return true;
    }
    return !offline.audit || !offline.answers;
  }
  if (item.type === "auditSubmission") {
    return !payload.syncBundle;
  }
  if (item.type === "reportExport") {
    return !payload.report;
  }
  if (item.type === "evidenceUpload") {
    const records = payload.evidenceRecords as unknown[] | undefined;
    return !Array.isArray(records);
  }
  return false;
}

export function queueAddedMessage(input: { online: boolean; hasEvidence?: boolean; isEvidenceSubmit?: boolean }) {
  if (input.isEvidenceSubmit || input.hasEvidence) {
    return SUBMISSION_QUEUE_MESSAGES.evidenceSubmit;
  }
  if (input.online) {
    return SUBMISSION_QUEUE_MESSAGES.addedOnline;
  }
  if (!input.online) {
    return SUBMISSION_QUEUE_MESSAGES.addedOffline;
  }
  return SUBMISSION_QUEUE_MESSAGES.added;
}

/**
 * Builds the toast shown after a sync run, based on how many items actually
 * synced vs failed. Critically, a partial or total failure never claims
 * everything synced.
 */
export function syncResultToast(input: {
  syncedCount: number;
  failedCount: number;
}): { title: string; message: string; tone: "success" | "warning" | "neutral" } {
  if (input.failedCount > 0 && input.syncedCount > 0) {
    return {
      title: "Some items could not sync",
      message: `${input.syncedCount} synced, ${input.failedCount} failed`,
      tone: "warning",
    };
  }
  if (input.failedCount > 0) {
    return {
      title: SUBMISSION_QUEUE_MESSAGES.partialFailure,
      message: SUBMISSION_QUEUE_MESSAGES.failure,
      tone: "warning",
    };
  }
  if (input.syncedCount > 0) {
    return {
      title: SUBMISSION_QUEUE_MESSAGES.allSynced,
      message: SUBMISSION_QUEUE_MESSAGES.allSynced,
      tone: "success",
    };
  }
  return { title: SUBMISSION_QUEUE_MESSAGES.added, message: SUBMISSION_QUEUE_MESSAGES.added, tone: "neutral" };
}

export function queueIndicatorSummary(input: {
  waitingCount: number;
  failedCount: number;
}): string {
  if (input.failedCount > 0 && input.waitingCount > 0) {
    return `${input.waitingCount} waiting, ${input.failedCount} failed`;
  }
  if (input.failedCount > 0) {
    return "Sync failed — retry";
  }
  if (input.waitingCount > 0) {
    return `${input.waitingCount} item${input.waitingCount === 1 ? "" : "s"} waiting to sync`;
  }
  return "All synced";
}
