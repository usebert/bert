import { useCallback, useEffect, useMemo, useState } from "react";
import { NOTIFICATION_READ_STORAGE_PREFIX } from "../presentation/notificationPresentation";

type ReadStateMap = Record<string, string>;

function buildStorageKey(companyScope: string, userScope: string) {
  return `${NOTIFICATION_READ_STORAGE_PREFIX}:${companyScope}:${userScope}`;
}

function readStoredMap(key: string): ReadStateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReadStateMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredMap(key: string, map: ReadStateMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(map));
}

function pruneStaleEntries(map: ReadStateMap, activeKeys: Set<string>, maxAgeMs = 90 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  const next: ReadStateMap = {};
  for (const [entryKey, readAt] of Object.entries(map)) {
    if (!activeKeys.has(entryKey)) continue;
    const readMs = Date.parse(readAt);
    if (!Number.isFinite(readMs) || now - readMs > maxAgeMs) continue;
    next[entryKey] = readAt;
  }
  return next;
}

export function useNotificationReadState(companyScope: string, userScope: string, activeKeys: string[]) {
  const storageKey = useMemo(() => buildStorageKey(companyScope, userScope), [companyScope, userScope]);
  const activeKeySet = useMemo(() => new Set(activeKeys), [activeKeys]);
  const [readMap, setReadMap] = useState<ReadStateMap>(() => readStoredMap(storageKey));

  useEffect(() => {
    setReadMap(readStoredMap(storageKey));
  }, [storageKey]);

  useEffect(() => {
    setReadMap((current) => {
      const pruned = pruneStaleEntries(current, activeKeySet);
      if (Object.keys(pruned).length !== Object.keys(current).length) {
        writeStoredMap(storageKey, pruned);
      }
      return pruned;
    });
  }, [activeKeySet, storageKey]);

  const isRead = useCallback((key: string) => Boolean(readMap[key]), [readMap]);

  const markRead = useCallback(
    (key: string) => {
      setReadMap((current) => {
        const next = { ...current, [key]: new Date().toISOString() };
        writeStoredMap(storageKey, pruneStaleEntries(next, activeKeySet));
        return next;
      });
    },
    [activeKeySet, storageKey],
  );

  const markUnread = useCallback(
    (key: string) => {
      setReadMap((current) => {
        const next = { ...current };
        delete next[key];
        writeStoredMap(storageKey, pruneStaleEntries(next, activeKeySet));
        return next;
      });
    },
    [activeKeySet, storageKey],
  );

  const markAllRead = useCallback(
    (keys: string[]) => {
      const timestamp = new Date().toISOString();
      setReadMap((current) => {
        const next = { ...current };
        for (const key of keys) {
          next[key] = timestamp;
        }
        writeStoredMap(storageKey, pruneStaleEntries(next, activeKeySet));
        return next;
      });
    },
    [activeKeySet, storageKey],
  );

  const unreadCount = useMemo(
    () => activeKeys.filter((key) => !readMap[key]).length,
    [activeKeys, readMap],
  );

  return {
    isRead,
    markRead,
    markUnread,
    markAllRead,
    unreadCount,
  };
}
