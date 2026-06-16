export type PlainEnglishSyncInput = {
  offlineQueueCount: number;
  pendingSyncCount: number;
  failedSyncCount: number;
  /** e.g. company sheet `lastSyncedAt` */
  lastSyncedAt?: string | null;
};

export type PlainEnglishSyncResult = {
  /** Short line for pills / compact UI */
  summary: string;
  /** Longer dashboard line */
  detail: string;
  tone: "ok" | "waiting" | "problem";
};

/**
 * User-facing sync copy for dashboards and field views (not deep Sync Centre diagnostics).
 */
export function getPlainEnglishSyncStatus(input: PlainEnglishSyncInput): PlainEnglishSyncResult {
  const { offlineQueueCount, pendingSyncCount, failedSyncCount, lastSyncedAt } = input;
  const last = lastSyncedAt?.trim();

  if (failedSyncCount > 0) {
    return {
      summary: `${failedSyncCount} item${failedSyncCount === 1 ? "" : "s"} not yet saved online`,
      detail: `${failedSyncCount} item${failedSyncCount === 1 ? "" : "s"} could not be saved online yet. Open Sync Centre (under More) to retry or review.${last ? ` Last synced ${last}.` : ""}`,
      tone: "problem",
    };
  }
  if (pendingSyncCount > 0 || offlineQueueCount > 0) {
    const waiting = pendingSyncCount + offlineQueueCount;
    return {
      summary: `${waiting} item${waiting === 1 ? "" : "s"} waiting to sync`,
      detail: `${waiting} piece${waiting === 1 ? "" : "s"} of work ${waiting === 1 ? "is" : "are"} waiting to sync when you are back online.${last ? ` Last synced ${last}.` : ""}`,
      tone: "waiting",
    };
  }
  return {
    summary: "All work saved",
    detail: last ? `Everything looks saved. Last synced ${last}.` : "Everything looks saved and up to date.",
    tone: "ok",
  };
}
