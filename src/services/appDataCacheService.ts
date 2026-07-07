import { storageKeys } from "../config/storageKeys";
import type { Role } from "../permissions";
import { canManageBriefings } from "../permissions";
import type { BriefingRecipientRecord } from "../types/briefings";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import {
  fetchBriefingsTodoPreview,
  fetchBriefingsTracker,
  fetchMyBriefings,
} from "./briefingsService";
import { fetchLiveDashboard } from "./liveDashboardService";
import type { LiveDashboardContext, LiveDashboardPayload, LiveDashboardQuery } from "../types/liveDashboard";

/** Briefings list TTL — stale-while-revalidate window (30–60s). */
export const APP_DATA_CACHE_TTL_MS = 45_000;

/** Live operational dashboard TTL — short window so "act today" stays current. */
export const LIVE_DASHBOARD_CACHE_TTL_MS = 30_000;

export type AppDataCacheEntry<T> = {
  data: T;
  cachedAt: number;
};

type BriefingTrackerRow = Record<string, unknown>;

type BriefingPendingActionSnapshot = {
  action: string;
  phase: "saving" | "syncing" | "failed";
  error?: string;
  snapshot: BriefingRecipientRecord;
};

const memoryCache = new Map<string, AppDataCacheEntry<unknown>>();
const briefingsPendingActions = new Map<string, Record<string, BriefingPendingActionSnapshot>>();

let activeContextKey = "";

export function briefingsMineCacheKey(companyFolderId: string, userEmail: string): string {
  return `briefings-mine:${companyFolderId.trim()}::${userEmail.trim().toLowerCase()}`;
}

export function briefingsTrackerCacheKey(companyFolderId: string): string {
  return `briefings-tracker:${companyFolderId.trim()}`;
}

export function briefingsTodoPreviewCacheKey(companyFolderId: string, userEmail: string, limit = 5): string {
  return `briefings-todo:${companyFolderId.trim()}::${userEmail.trim().toLowerCase()}::${limit}`;
}

export function liveDashboardCacheKey(companyFolderId: string, userEmail: string): string {
  return `live-dashboard:${companyFolderId.trim()}::${userEmail.trim().toLowerCase()}`;
}

export function appDataContextKey(companyFolderId: string, userEmail: string): string {
  return `${companyFolderId.trim()}::${userEmail.trim().toLowerCase()}`;
}

function readPersistedCache<T>(cacheKey: string): AppDataCacheEntry<T> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.appDataCache);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, AppDataCacheEntry<T>>;
    const entry = parsed[cacheKey];
    if (!entry || entry.data === undefined) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writePersistedCache<T>(cacheKey: string, entry: AppDataCacheEntry<T>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.appDataCache);
    const parsed = raw ? (JSON.parse(raw) as Record<string, AppDataCacheEntry<T>>) : {};
    parsed[cacheKey] = entry;
    window.localStorage.setItem(storageKeys.appDataCache, JSON.stringify(parsed));
  } catch {
    /* ignore quota */
  }
}

export function readAppDataCache<T>(cacheKey: string): AppDataCacheEntry<T> | null {
  const memory = memoryCache.get(cacheKey);
  if (memory) {
    return memory as AppDataCacheEntry<T>;
  }
  const persisted = readPersistedCache<T>(cacheKey);
  if (persisted) {
    memoryCache.set(cacheKey, persisted as AppDataCacheEntry<unknown>);
    return persisted;
  }
  return null;
}

export function writeAppDataCache<T>(cacheKey: string, data: T, persist = true): void {
  const entry: AppDataCacheEntry<T> = { data, cachedAt: Date.now() };
  memoryCache.set(cacheKey, entry as AppDataCacheEntry<unknown>);
  if (persist) {
    writePersistedCache(cacheKey, entry);
  }
}

export function isAppDataCacheStale(
  entry: AppDataCacheEntry<unknown> | null | undefined,
  ttlMs = APP_DATA_CACHE_TTL_MS,
): boolean {
  if (!entry) {
    return true;
  }
  return Date.now() - entry.cachedAt > ttlMs;
}

export function patchBriefingsMineCache(
  companyFolderId: string,
  userEmail: string,
  briefingId: string,
  patch: Partial<BriefingRecipientRecord>,
): BriefingRecipientRecord[] {
  const cacheKey = briefingsMineCacheKey(companyFolderId, userEmail);
  const cached = readAppDataCache<BriefingRecipientRecord[]>(cacheKey);
  const items = (cached?.data || []).map((item) =>
    item.briefingId === briefingId ? { ...item, ...patch } : item,
  );
  writeAppDataCache(cacheKey, items);
  return items;
}

export function readBriefingsPendingActions(
  companyFolderId: string,
  userEmail: string,
): Record<string, BriefingPendingActionSnapshot> {
  return briefingsPendingActions.get(briefingsMineCacheKey(companyFolderId, userEmail)) || {};
}

export function writeBriefingsPendingActions(
  companyFolderId: string,
  userEmail: string,
  pending: Record<string, BriefingPendingActionSnapshot>,
): void {
  briefingsPendingActions.set(briefingsMineCacheKey(companyFolderId, userEmail), pending);
}

export function invalidateAppDataCache(context: {
  companyFolderId?: string;
  userEmail?: string;
  all?: boolean;
}): void {
  if (context.all) {
    memoryCache.clear();
    briefingsPendingActions.clear();
    activeContextKey = "";
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKeys.appDataCache);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const companyFolderId = String(context.companyFolderId || "").trim();
  const userEmail = String(context.userEmail || "").trim().toLowerCase();
  const keysToDelete: string[] = [];

  for (const key of memoryCache.keys()) {
    if (!companyFolderId && !userEmail) {
      continue;
    }
    if (companyFolderId && key.includes(companyFolderId)) {
      if (!userEmail || key.includes(userEmail)) {
        keysToDelete.push(key);
      }
      if (key.startsWith(`briefings-tracker:${companyFolderId}`)) {
        keysToDelete.push(key);
      }
    }
  }

  keysToDelete.forEach((key) => memoryCache.delete(key));

  if (userEmail && companyFolderId) {
    briefingsPendingActions.delete(briefingsMineCacheKey(companyFolderId, userEmail));
  }

  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(storageKeys.appDataCache);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, AppDataCacheEntry<unknown>>;
      for (const key of Object.keys(parsed)) {
        const companyMatch = companyFolderId && key.includes(companyFolderId);
        const userMatch = !userEmail || key.includes(userEmail);
        if (companyMatch && userMatch) {
          delete parsed[key];
        }
        if (companyFolderId && key === briefingsTrackerCacheKey(companyFolderId)) {
          delete parsed[key];
        }
      }
      window.localStorage.setItem(storageKeys.appDataCache, JSON.stringify(parsed));
    } catch {
      /* ignore */
    }
  }
}

export function ensureAppDataContext(
  companyFolderId: string,
  userEmail: string,
  options: { role?: Role } = {},
): void {
  const nextKey = appDataContextKey(companyFolderId, userEmail);
  if (activeContextKey && activeContextKey !== nextKey) {
    const [prevCompany, prevUser] = activeContextKey.split("::");
    if (prevCompany !== companyFolderId.trim()) {
      invalidateAppDataCache({ companyFolderId: prevCompany, all: false });
      invalidateAppDataCache({ companyFolderId });
    } else if (prevUser !== userEmail.trim().toLowerCase()) {
      invalidateAppDataCache({ companyFolderId, userEmail: prevUser });
    }
  }
  activeContextKey = nextKey;
  void options;
}

type SwrOptions = {
  forceRefresh?: boolean;
  refresh?: boolean;
  manualRefresh?: boolean;
};

type SwrResult<T> = {
  data: T;
  fromCache: boolean;
  hadCache: boolean;
  refreshWarning?: string;
  /** Resolves when a stale-while-revalidate background fetch completes (if started). */
  revalidatePromise?: Promise<T | void>;
};

async function runSwrFetch<T>(input: {
  cacheKey: string;
  fetcher: () => Promise<T>;
  options?: SwrOptions;
  persist?: boolean;
  ttlMs?: number;
}): Promise<SwrResult<T>> {
  const { cacheKey, fetcher, options = {}, persist = true, ttlMs = APP_DATA_CACHE_TTL_MS } = input;
  const cached = readAppDataCache<T>(cacheKey);
  const hadCache = Boolean(cached);
  const stale = isAppDataCacheStale(cached, ttlMs);
  const mustAwait =
    !hadCache || options.forceRefresh === true || options.manualRefresh === true || options.refresh === true;
  const shouldBackgroundRefresh = hadCache && stale && !mustAwait;

  if (shouldBackgroundRefresh) {
    const dedupeKey = requestDedupeKey("SWR", cacheKey);
    const revalidatePromise = dedupeInFlight(dedupeKey, async () => {
      try {
        const fresh = await fetcher();
        writeAppDataCache(cacheKey, fresh, persist);
        return fresh;
      } catch {
        /* keep cache on background failure */
        return undefined;
      }
    });
    return { data: cached!.data, fromCache: true, hadCache: true, revalidatePromise };
  }

  if (hadCache && !mustAwait) {
    return { data: cached!.data, fromCache: true, hadCache: true };
  }

  const dedupeKey = requestDedupeKey("SWR", `${cacheKey}:${mustAwait ? "await" : "bg"}`);
  try {
    const fresh = await dedupeInFlight(dedupeKey, fetcher);
    writeAppDataCache(cacheKey, fresh, persist);
    return { data: fresh, fromCache: false, hadCache };
  } catch (error) {
    if (hadCache) {
      return {
        data: cached!.data,
        fromCache: true,
        hadCache: true,
        refreshWarning: error instanceof Error ? error.message : "Could not refresh data.",
      };
    }
    throw error;
  }
}

export async function loadBriefingsMineCached(
  companyFolderId: string,
  userEmail: string,
  options: SwrOptions = {},
): Promise<SwrResult<BriefingRecipientRecord[]>> {
  const result = await runSwrFetch({
    cacheKey: briefingsMineCacheKey(companyFolderId, userEmail),
    fetcher: async () => {
      const response = await fetchMyBriefings(companyFolderId, {
        refresh: options.forceRefresh || options.manualRefresh || options.refresh,
      });
      return (response.items || []) as BriefingRecipientRecord[];
    },
    options,
  });
  return result;
}

export async function loadBriefingsTrackerCached(
  companyFolderId: string,
  options: SwrOptions = {},
): Promise<SwrResult<BriefingTrackerRow[]>> {
  return runSwrFetch({
    cacheKey: briefingsTrackerCacheKey(companyFolderId),
    fetcher: async () => {
      const response = await fetchBriefingsTracker(companyFolderId, {
        refresh: options.forceRefresh || options.manualRefresh || options.refresh,
      });
      return (response.items || []) as BriefingTrackerRow[];
    },
    options,
  });
}

export async function loadBriefingsTodoPreviewCached(
  companyFolderId: string,
  userEmail: string,
  options: SwrOptions & { limit?: number } = {},
): Promise<SwrResult<BriefingRecipientRecord[]>> {
  const limit = options.limit ?? 5;
  return runSwrFetch({
    cacheKey: briefingsTodoPreviewCacheKey(companyFolderId, userEmail, limit),
    fetcher: async () => {
      const response = await fetchBriefingsTodoPreview(companyFolderId, { limit });
      return (response.items || []) as BriefingRecipientRecord[];
    },
    options,
    persist: true,
  });
}

/**
 * Live operational dashboard — stale-while-revalidate. Cached data shows instantly;
 * a stale entry refreshes in the background. Manual refresh forces an awaited fetch.
 */
export async function loadLiveDashboardCached(
  context: LiveDashboardContext & { userEmail: string },
  options: SwrOptions & { query?: LiveDashboardQuery } = {},
): Promise<SwrResult<LiveDashboardPayload>> {
  const companyFolderId = String(context.companyFolderId || context.companyId || "").trim();
  return runSwrFetch({
    cacheKey: liveDashboardCacheKey(companyFolderId, context.userEmail),
    ttlMs: LIVE_DASHBOARD_CACHE_TTL_MS,
    fetcher: async () => {
      const payload = await fetchLiveDashboard(context, {
        query: {
          ...options.query,
          refresh: options.manualRefresh || options.forceRefresh || options.query?.refresh,
        },
      });
      if (!payload.ok) {
        throw new Error(payload.loadError || "Could not load the live dashboard right now. Try again.");
      }
      return payload;
    },
    options,
  });
}

export type AppDataPreloadContext = {
  companyFolderId: string;
  userEmail: string;
  role: Role;
};

let preloadInFlightKey: string | null = null;

/** Background warm-up after login / company context — does not block navigation. */
export function preloadAppData(context: AppDataPreloadContext): void {
  const companyFolderId = String(context.companyFolderId || "").trim();
  const userEmail = String(context.userEmail || "").trim().toLowerCase();
  if (!companyFolderId || !userEmail) {
    return;
  }

  ensureAppDataContext(companyFolderId, userEmail, { role: context.role });
  const preloadKey = `${companyFolderId}::${userEmail}::${context.role}`;
  if (preloadInFlightKey === preloadKey) {
    return;
  }
  preloadInFlightKey = preloadKey;

  void (async () => {
    const tasks: Array<Promise<unknown>> = [
      loadBriefingsTodoPreviewCached(companyFolderId, userEmail).catch(() => undefined),
      loadBriefingsMineCached(companyFolderId, userEmail).catch(() => undefined),
    ];

    if (canManageBriefings(context.role)) {
      tasks.push(loadBriefingsTrackerCached(companyFolderId).catch(() => undefined));
    }

    await Promise.allSettled(tasks);
    if (preloadInFlightKey === preloadKey) {
      preloadInFlightKey = null;
    }
  })();
}
