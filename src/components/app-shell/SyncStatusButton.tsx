import { IconInbox } from "../ui/Icon";

type Props = {
  waitingCount: number;
  failedCount: number;
  syncing?: boolean;
  onOpenSync: () => void;
};

function formatCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function SyncStatusButton({ waitingCount, failedCount, syncing = false, onOpenSync }: Props) {
  const total = waitingCount + failedCount;
  if (total === 0 && !syncing) {
    return null;
  }

  const label = failedCount
    ? `Sync failed, ${failedCount} item${failedCount === 1 ? "" : "s"}`
    : syncing
      ? "Syncing"
      : `${waitingCount} awaiting sync`;

  const tone = failedCount
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : syncing
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <button
      type="button"
      onClick={onOpenSync}
      className={["inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold", tone].join(" ")}
      aria-label={label}
    >
      <IconInbox size="sm" aria-hidden />
      <span className="hidden sm:inline">{failedCount ? "Sync failed" : syncing ? "Syncing" : "Awaiting sync"}</span>
      <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">{formatCount(failedCount || waitingCount)}</span>
    </button>
  );
}
