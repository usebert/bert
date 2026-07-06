export const SUBMISSION_QUEUE_MESSAGES = {
  added: "Added to queue",
  addedOnline: "Added to queue. Syncing now…",
  addedOffline: "Added to queue. This will sync when connection returns.",
  success: "Submitted successfully",
  failure: "Sync failed. Your item is still in the queue. Please retry.",
  evidenceAdded: "Evidence added",
  evidenceSubmit: "Added to queue. Uploading evidence and saving submission…",
} as const;

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

export function queueIndicatorSummary(input: {
  waitingCount: number;
  failedCount: number;
}): "All synced" | "Sync failed — retry" | `${number} item waiting to sync` | `${number} items waiting to sync` {
  if (input.failedCount > 0) {
    return "Sync failed — retry";
  }
  if (input.waitingCount > 0) {
    return `${input.waitingCount} item${input.waitingCount === 1 ? "" : "s"} waiting to sync`;
  }
  return "All synced";
}
