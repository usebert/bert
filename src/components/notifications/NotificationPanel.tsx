import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { lockDialogScroll } from "../ui/dialogScrollLock";
import { SkeletonCard } from "../ui/LoadingStates";
import { NotificationEmptyState } from "./NotificationEmptyState";
import { NotificationFilters } from "./NotificationFilters";
import { NotificationList } from "./NotificationList";
import { NotificationSummary } from "./NotificationSummary";
import type { BertNotification, NotificationFilterId } from "../../presentation/notificationPresentation";
import type { NotificationGroupId } from "../../presentation/notificationPresentation";

type Group = {
  id: NotificationGroupId;
  label: string;
  items: Array<BertNotification & { isUnread: boolean }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  filter: NotificationFilterId;
  availableFilterIds: Set<NotificationFilterId>;
  onFilterChange: (filter: NotificationFilterId) => void;
  groups: Group[];
  totalCount: number;
  unreadCount: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onMarkAllRead: () => void;
  onOpen: (item: BertNotification) => void;
  onToggleRead: (item: BertNotification) => void;
};

export function NotificationPanel({
  open,
  onClose,
  triggerRef,
  filter,
  availableFilterIds,
  onFilterChange,
  groups,
  totalCount,
  unreadCount,
  loading = false,
  error = null,
  onRetry,
  onMarkAllRead,
  onOpen,
  onToggleRead,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const unlock = lockDialogScroll();
    const previousFocus = document.activeElement as HTMLElement | null;
    const timer = window.requestAnimationFrame(() => panelRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(timer);
      document.removeEventListener("keydown", onKeyDown);
      unlock();
      triggerRef.current?.focus();
      if (!triggerRef.current && previousFocus) {
        previousFocus.focus?.();
      }
    };
  }, [onClose, open, triggerRef]);

  if (!open || typeof document === "undefined") return null;

  const showEmpty = !loading && !error && totalCount === 0;
  const showFilterEmpty = !loading && !error && totalCount > 0 && groups.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/35 motion-reduce:transition-none" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close notifications" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-panel-title"
        aria-busy={loading || undefined}
        className="relative flex h-[100dvh] w-full max-w-md flex-col border-l border-[var(--ui-border)] bg-[var(--ui-bg-surface)] shadow-2xl outline-none sm:h-auto sm:max-h-[min(100dvh,720px)] sm:min-h-[24rem]"
      >
        <header className="border-b border-[var(--ui-border)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="notification-panel-title" className="text-lg font-semibold text-[var(--ui-text-primary)]">
                Notifications
              </h2>
              <NotificationSummary total={totalCount} unreadCount={unreadCount} />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--ui-border)] text-sm font-semibold text-[var(--ui-text-secondary)]"
              aria-label="Close notifications"
            >
              ×
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <NotificationFilters activeFilter={filter} availableFilterIds={availableFilterIds} onChange={onFilterChange} />
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="shrink-0 min-h-11 rounded-full px-3 text-xs font-semibold text-[var(--ui-text-secondary)] underline-offset-2 hover:underline"
              >
                Mark all as read
              </button>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading ? (
            <div className="space-y-3" aria-live="polite">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : error ? (
            <NotificationEmptyState variant="error" onRetry={onRetry} />
          ) : showEmpty ? (
            <NotificationEmptyState variant="empty" />
          ) : showFilterEmpty ? (
            <NotificationEmptyState variant="filter-empty" />
          ) : (
            <NotificationList groups={groups} onOpen={onOpen} onToggleRead={onToggleRead} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
