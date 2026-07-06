import { queueIndicatorSummary } from "./submissionQueueMessages";

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
  const waitingCount = pendingSyncCount + offlineQueueCount;
  const summary = queueIndicatorSummary({ waitingCount, failedCount: failedSyncCount });

  if (failedSyncCount > 0) {
    return {
      summary,
      detail: `Sync failed — retry from Sync Centre when you are back online.${last ? ` Last synced ${last}.` : ""}`,
      tone: "problem",
    };
  }
  if (waitingCount > 0) {
    return {
      summary,
      detail: `${waitingCount} item${waitingCount === 1 ? "" : "s"} waiting to sync.${last ? ` Last synced ${last}.` : ""}`,
      tone: "waiting",
    };
  }
  return {
    summary: "All synced",
    detail: last ? `All synced. Last synced ${last}.` : "All synced.",
    tone: "ok",
  };
}
