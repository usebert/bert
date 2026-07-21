import { useCallback, useMemo, useRef } from "react";
import { NotificationButton } from "./NotificationButton";
import { NotificationPanel } from "./NotificationPanel";
import { useNotifications } from "../../hooks/useNotifications";
import type { NotificationDestination } from "../../presentation/notificationPresentation";
import type { BertNotification } from "../../presentation/notificationPresentation";
import type { NotificationSources } from "../../services/notificationAdapters/notificationAdapters";

type Props = {
  sources: NotificationSources | null;
  onNavigate: (destination: NotificationDestination, item: BertNotification) => void;
};

export function useNotificationControls(sources: NotificationSources | null, onNavigate: (destination: NotificationDestination, item: BertNotification) => void) {
  const notifications = useNotifications(sources);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenItem = useCallback(
    (item: BertNotification) => {
      notifications.markRead(item);
      onNavigate(item.destination, item);
      notifications.closePanel();
    },
    [notifications, onNavigate],
  );

  const handleToggleRead = useCallback(
    (item: BertNotification) => {
      if (notifications.isRead(item.key)) {
        notifications.markUnread(item);
      } else {
        notifications.markRead(item);
      }
    },
    [notifications],
  );

  return useMemo(
    () => ({
      unreadCount: notifications.unreadCount,
      button: (
        <NotificationButton
          ref={triggerRef}
          unreadCount={notifications.unreadCount}
          open={notifications.open}
          onClick={() => (notifications.open ? notifications.closePanel() : notifications.openPanel())}
        />
      ),
      panel: (
        <NotificationPanel
          open={notifications.open}
          onClose={notifications.closePanel}
          triggerRef={triggerRef}
          filter={notifications.filter}
          availableFilterIds={notifications.availableFilterIds}
          onFilterChange={notifications.setFilter}
          groups={notifications.grouped}
          totalCount={notifications.notifications.length}
          unreadCount={notifications.unreadCount}
          loading={notifications.loading}
          error={notifications.error}
          onRetry={notifications.retry}
          onMarkAllRead={notifications.markAllRead}
          onOpen={handleOpenItem}
          onToggleRead={handleToggleRead}
        />
      ),
      triggerRef,
    }),
    [handleOpenItem, handleToggleRead, notifications],
  );
}
