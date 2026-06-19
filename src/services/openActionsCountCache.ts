import { storageKeys } from "../config/storageKeys";

const CACHE_PREFIX = storageKeys.openActionsCountCache;

function cacheKey(companyFolderId: string, userId: string) {
  return `${CACHE_PREFIX}:${companyFolderId}:${userId}`;
}

export function readCachedOpenActionsCount(companyFolderId: string, userId: string): number | null {
  if (typeof window === "undefined" || !companyFolderId || !userId) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(cacheKey(companyFolderId, userId));
    if (raw === null) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedOpenActionsCount(companyFolderId: string, userId: string, count: number) {
  if (typeof window === "undefined" || !companyFolderId || !userId) {
    return;
  }
  try {
    window.localStorage.setItem(cacheKey(companyFolderId, userId), String(Math.max(0, count)));
  } catch {
    /* ignore quota */
  }
}

export function clearCachedOpenActionsCount(companyFolderId?: string, userId?: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (companyFolderId && userId) {
      window.localStorage.removeItem(cacheKey(companyFolderId, userId));
      return;
    }
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${CACHE_PREFIX}:`)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}
