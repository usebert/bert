import { AnimatedButton } from "./AnimatedButton";
import { StatusPulse, type SyncVisualState } from "./StatusPulse";
import { queueIndicatorSummary } from "../../utils/submissionQueueMessages";

type Props = {
  offlineMode: boolean;
  queuedCount: number;
  waitingCount: number;
  hasFailed: boolean;
  syncing?: boolean;
  syncProgress?: { current: number; total: number };
  onRetryFailed: () => void;
};

export function OfflineSyncBanner({
  offlineMode,
  queuedCount,
  waitingCount,
  hasFailed,
  syncing = false,
  syncProgress,
  onRetryFailed,
}: Props) {
  const visualState: SyncVisualState = hasFailed
    ? "failed"
    : syncing
      ? "syncing"
      : offlineMode || waitingCount > 0
        ? "waiting"
        : "synced";

  const progressLabel =
    syncing && syncProgress && syncProgress.total > 0
      ? `${Math.min(syncProgress.current, syncProgress.total)} of ${syncProgress.total} synced`
      : null;

  const statusLabel = queueIndicatorSummary({
    waitingCount: waitingCount || queuedCount,
    failedCount: hasFailed ? 1 : 0,
  });

  return (
    <section className="mb-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {offlineMode ? "Offline mode active" : syncing ? "Syncing queued submissions" : "Queued submissions waiting to sync"}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {offlineMode
              ? "Added to queue. This will sync when connection returns."
              : syncing
                ? progressLabel
                  ? `Added to queue. Syncing now… ${progressLabel}`
                  : "Added to queue. Syncing now…"
                : `${queuedCount} queued submission${queuedCount === 1 ? "" : "s"} will sync automatically.`}
          </p>
          <p className="mt-2 text-xs font-bold tabular-nums text-amber-950">{statusLabel}</p>
        </div>
        <StatusPulse state={visualState} label={syncing && progressLabel ? progressLabel : statusLabel} />
      </div>
      {hasFailed ? (
        <AnimatedButton
          type="button"
          onClick={onRetryFailed}
          className="mt-3 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800"
        >
          Retry failed
        </AnimatedButton>
      ) : null}
    </section>
  );
}
