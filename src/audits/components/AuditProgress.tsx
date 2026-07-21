export function AuditProgress({
  current,
  total,
  answered,
  savedAt,
  syncLabel,
  offlineMode,
}: {
  current: number;
  total: number;
  answered: number;
  savedAt?: string;
  syncLabel?: string;
  offlineMode?: boolean;
}) {
  const percent = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ui-text-primary)]">
          Question {current} of {total}
        </p>
        <p className="text-sm text-[var(--ui-text-secondary)]">{percent}% complete</p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-[var(--ui-neutral-border)]" aria-hidden>
        <div className="h-2 rounded-full bg-[var(--ui-accent)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ui-text-muted)]">
        <span>{answered} answered</span>
        {savedAt ? <span>Saved {savedAt}</span> : null}
        {syncLabel ? <span>{syncLabel}</span> : null}
        {offlineMode ? <span className="font-semibold text-[var(--ui-warning-fg)]">Offline — saved on device</span> : null}
      </div>
    </div>
  );
}
