import { AnimatedButton } from "./AnimatedButton";
import { StatusPulse, type SyncVisualState } from "./StatusPulse";

type Props = {
  offlineMode: boolean;
  queuedCount: number;
  waitingCount: number;
  hasFailed: boolean;
  syncing?: boolean;
  onRetryFailed: () => void;
};

export function OfflineSyncBanner({
  offlineMode,
  queuedCount,
  waitingCount,
  hasFailed,
  syncing = false,
  onRetryFailed,
}: Props) {
  const visualState: SyncVisualState = hasFailed
    ? "failed"
    : syncing
      ? "syncing"
      : offlineMode || waitingCount > 0
        ? "waiting"
        : "synced";

  const statusLabel = hasFailed
    ? "Sync failed — retry when online"
    : syncing
      ? "Syncing saved checks"
      : offlineMode
        ? "Offline — saved on this tablet"
        : `${queuedCount} queued — will sync automatically`;

  return (
    <section className="mb-4 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {offlineMode ? "Offline mode active" : "Queued submissions waiting to sync"}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {offlineMode
              ? "You are offline. Checks will be saved on this tablet and synced when internet returns."
              : `${queuedCount} queued submission${queuedCount === 1 ? "" : "s"} will sync automatically.`}
          </p>
          <p className="mt-2 text-xs text-amber-900">{waitingCount} waiting to sync</p>
        </div>
        <StatusPulse state={visualState} label={statusLabel} />
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
