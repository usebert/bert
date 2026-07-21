import { useCallback, useMemo, useState } from "react";
import {
  NOTIFICATION_FILTERS,
  NOTIFICATION_RENDER_CAP,
  type BertNotification,
  type NotificationFilterId,
} from "../presentation/notificationPresentation";
import { useNotificationReadState } from "./useNotificationReadState";
import {
  buildNotificationIndex,
  filterNotificationsByType,
  groupNotifications,
  type NotificationSources,
} from "../services/notificationAdapters/notificationAdapters";

export function useNotifications(sources: NotificationSources | null) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilterId>("all");
  const [error, setError] = useState<string | null>(null);

  const companyScope = sources?.companyFolderId || "no-company";
  const userScope = sources?.currentUser.username || sources?.currentUser.name || "anonymous";

  const allNotifications = useMemo(() => {
    if (!sources) return [];
    try {
      setError(null);
      return buildNotificationIndex(sources).slice(0, NOTIFICATION_RENDER_CAP);
    } catch {
      setError("Notifications could not be refreshed.");
      return [];
    }
  }, [sources]);

  const activeKeys = useMemo(() => allNotifications.map((item) => item.key), [allNotifications]);
  const readState = useNotificationReadState(companyScope, userScope, activeKeys);

  const availableFilterIds = useMemo(() => {
    const types = new Set(allNotifications.map((item) => item.type));
    const filters = new Set<NotificationFilterId>(["all"]);
    for (const option of NOTIFICATION_FILTERS) {
      if (option.id === "all") continue;
      if (option.types.some((type) => types.has(type))) {
        filters.add(option.id);
      }
    }
    return filters;
  }, [allNotifications]);

  const filteredNotifications = useMemo(() => {
    return filterNotificationsByType(allNotifications, filter, availableFilterIds);
  }, [allNotifications, availableFilterIds, filter]);

  const notificationsWithRead = useMemo(
    () =>
      filteredNotifications.map((item) => ({
        ...item,
        isUnread: !readState.isRead(item.key),
      })),
    [filteredNotifications, readState],
  );

  const grouped = useMemo(
    () => groupNotifications(notificationsWithRead),
    [notificationsWithRead],
  );

  const unreadCount = useMemo(
    () => allNotifications.filter((item) => !readState.isRead(item.key)).length,
    [allNotifications, readState],
  );

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  const markRead = useCallback((item: BertNotification) => readState.markRead(item.key), [readState]);
  const markUnread = useCallback((item: BertNotification) => readState.markUnread(item.key), [readState]);
  const markAllRead = useCallback(() => readState.markAllRead(activeKeys), [activeKeys, readState]);

  const retry = useCallback(() => setError(null), []);

  return {
    open,
    openPanel,
    closePanel,
    filter,
    setFilter,
    availableFilterIds,
    grouped,
    notifications: notificationsWithRead,
    unreadCount,
    error,
    retry,
    loading: Boolean(sources?.briefingLoading),
    markRead,
    markUnread,
    markAllRead,
    isRead: readState.isRead,
  };
}
