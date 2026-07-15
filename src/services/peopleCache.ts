/**
 * Stale-while-revalidate cache for People / assignee list loads.
 * Presentation-only preference layer — does not alter auth, permissions, or APIs.
 */
import type { ScheduleAssigneeDiagnostics, ScheduleAssigneeOption } from "../utils/scheduleAssignees";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import {
  fetchCompanyMembers,
  sanitizeCompanyMembersForClient,
  type CompanyMember,
  type CompanyMembersDiagnostics,
  type FetchCompanyMembersResult,
} from "./companyUserService";
import {
  fetchScheduleAssignees,
  type CompanyScheduleContext,
  type FetchScheduleAssigneesResult,
} from "./scheduleService";

export const PEOPLE_CACHE_TTL_MS = 45_000;
export const PEOPLE_CACHE_VERSION = 1 as const;
export const PEOPLE_CACHE_KEY_PREFIX = "bert:people-cache";

export type CachedPeopleResult<T> = {
  version: typeof PEOPLE_CACHE_VERSION;
  cachedAt: number;
  data: T;
};

export type CompanyMembersCachedPayload = {
  members: CompanyMember[];
  warning?: string;
  diagnostics?: CompanyMembersDiagnostics;
  reasonCode?: string;
  failedStep?: string;
};

export type ScheduleAssigneesCachedPayload = {
  assignees: ScheduleAssigneeOption[];
  warning?: string;
  diagnostics?: ScheduleAssigneeDiagnostics;
};

export type PeopleSwrOptions = {
  forceRefresh?: boolean;
  refresh?: boolean;
  manualRefresh?: boolean;
  signal?: AbortSignal;
};

export type PeopleSwrResult<T> = {
  data: T;
  fromCache: boolean;
  hadCache: boolean;
  refreshWarning?: string;
  revalidatePromise?: Promise<T | void>;
};

type MemoryEntry = CachedPeopleResult<unknown>;

const memoryCache = new Map<string, MemoryEntry>();
let activeCompanyFolderId = "";

export function peopleCacheStorageKey(companyFolderId: string, scope: string): string {
  const company = String(companyFolderId || "").trim();
  const safeScope = String(scope || "").trim() || "default";
  return `${PEOPLE_CACHE_KEY_PREFIX}:${company}:${safeScope}`;
}

/** Company-wide People list (GET …/users). */
export function companyMembersPeopleScope(): string {
  return "company-members";
}

/** Schedule / action assignee list — company-wide, optional area filter. */
export function scheduleAssigneesPeopleScope(selectedArea = ""): string {
  const area = String(selectedArea || "").trim().toLowerCase() || "all";
  return `schedule-assignees:${area}`;
}

export function isPeopleCacheStale(
  entry: CachedPeopleResult<unknown> | null | undefined,
  ttlMs = PEOPLE_CACHE_TTL_MS,
): boolean {
  if (!entry || typeof entry.cachedAt !== "number" || !Number.isFinite(entry.cachedAt)) {
    return true;
  }
  return Date.now() - entry.cachedAt > ttlMs;
}

function isValidCachedPeopleResult(value: unknown): value is CachedPeopleResult<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== PEOPLE_CACHE_VERSION) {
    return false;
  }
  if (typeof candidate.cachedAt !== "number" || !Number.isFinite(candidate.cachedAt) || candidate.cachedAt <= 0) {
    return false;
  }
  return candidate.data !== undefined && candidate.data !== null;
}

function isValidMembersPayload(data: unknown): data is CompanyMembersCachedPayload {
  if (!data || typeof data !== "object") {
    return false;
  }
  const members = (data as CompanyMembersCachedPayload).members;
  return Array.isArray(members);
}

function isValidAssigneesPayload(data: unknown): data is ScheduleAssigneesCachedPayload {
  if (!data || typeof data !== "object") {
    return false;
  }
  const assignees = (data as ScheduleAssigneesCachedPayload).assignees;
  return Array.isArray(assignees);
}

function dedupeMembersByEmail(members: CompanyMember[]): CompanyMember[] {
  const seen = new Set<string>();
  const out: CompanyMember[] = [];
  for (const member of sanitizeCompanyMembersForClient(members)) {
    const email = String(member.email || "").trim().toLowerCase();
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    out.push({ ...member, email });
  }
  return out;
}

function dedupeAssigneesByEmail(assignees: ScheduleAssigneeOption[]): ScheduleAssigneeOption[] {
  const seen = new Set<string>();
  const out: ScheduleAssigneeOption[] = [];
  for (const row of assignees) {
    const email = String(row.email || "").trim().toLowerCase();
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    out.push({ ...row, email });
  }
  return out;
}

export function readPeopleCache<T>(storageKey: string): CachedPeopleResult<T> | null {
  if (!storageKey.startsWith(`${PEOPLE_CACHE_KEY_PREFIX}:`)) {
    return null;
  }
  const memory = memoryCache.get(storageKey);
  if (memory && isValidCachedPeopleResult(memory)) {
    return memory as CachedPeopleResult<T>;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCachedPeopleResult(parsed)) {
      return null;
    }
    memoryCache.set(storageKey, parsed);
    return parsed as CachedPeopleResult<T>;
  } catch {
    return null;
  }
}

export function writePeopleCache<T>(storageKey: string, data: T): CachedPeopleResult<T> {
  const entry: CachedPeopleResult<T> = {
    version: PEOPLE_CACHE_VERSION,
    cachedAt: Date.now(),
    data,
  };
  memoryCache.set(storageKey, entry as MemoryEntry);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(entry));
    } catch {
      /* ignore quota / private mode */
    }
  }
  return entry;
}

export function clearPeopleCacheMemory(): void {
  memoryCache.clear();
  activeCompanyFolderId = "";
}

/** Remove persisted + in-memory people cache entries (logout / company wipe). */
export function invalidatePeopleCache(options: { companyFolderId?: string; all?: boolean } = {}): void {
  if (options.all) {
    clearPeopleCacheMemory();
    if (typeof window !== "undefined") {
      try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith(`${PEOPLE_CACHE_KEY_PREFIX}:`)) {
            keys.push(key);
          }
        }
        for (const key of keys) {
          window.localStorage.removeItem(key);
        }
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const companyFolderId = String(options.companyFolderId || "").trim();
  if (!companyFolderId) {
    return;
  }
  const prefix = `${PEOPLE_CACHE_KEY_PREFIX}:${companyFolderId}:`;
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
  if (typeof window !== "undefined") {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keys.push(key);
        }
      }
      for (const key of keys) {
        window.localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }
}

/** Ensure in-memory people data cannot leak across companies within one session. */
export function ensurePeopleCacheContext(companyFolderId: string): void {
  const next = String(companyFolderId || "").trim();
  if (activeCompanyFolderId && next && activeCompanyFolderId !== next) {
    clearPeopleCacheMemory();
  }
  if (next) {
    activeCompanyFolderId = next;
  }
}

async function runPeopleSwrFetch<T>(input: {
  storageKey: string;
  /** Background refreshes must not use the screen AbortSignal so cache can still update. */
  fetcher: (mode: "await" | "background") => Promise<T>;
  isValidData: (data: unknown) => data is T;
  options?: PeopleSwrOptions;
  ttlMs?: number;
}): Promise<PeopleSwrResult<T>> {
  const { storageKey, fetcher, isValidData, options = {}, ttlMs = PEOPLE_CACHE_TTL_MS } = input;
  const cachedEntry = readPeopleCache<T>(storageKey);
  const cachedData =
    cachedEntry && isValidData(cachedEntry.data) ? (cachedEntry.data as T) : null;
  const hadCache = cachedData !== null;
  const stale = !hadCache || isPeopleCacheStale(cachedEntry, ttlMs);
  const mustAwait =
    !hadCache ||
    options.forceRefresh === true ||
    options.manualRefresh === true ||
    options.refresh === true;
  const shouldBackgroundRefresh = hadCache && stale && !mustAwait;

  if (shouldBackgroundRefresh) {
    const dedupeKey = requestDedupeKey("SWR", storageKey);
    const revalidatePromise = dedupeInFlight(dedupeKey, async () => {
      try {
        const fresh = await fetcher("background");
        if (!isValidData(fresh)) {
          return undefined;
        }
        writePeopleCache(storageKey, fresh);
        return fresh;
      } catch {
        return undefined;
      }
    });
    return {
      data: cachedData as T,
      fromCache: true,
      hadCache: true,
      revalidatePromise,
    };
  }

  if (hadCache && !mustAwait) {
    return { data: cachedData as T, fromCache: true, hadCache: true };
  }

  const dedupeKey = requestDedupeKey("SWR", `${storageKey}:${mustAwait ? "await" : "bg"}`);
  try {
    const fresh = await dedupeInFlight(dedupeKey, () => fetcher("await"));
    if (!isValidData(fresh)) {
      if (hadCache) {
        return {
          data: cachedData as T,
          fromCache: true,
          hadCache: true,
          refreshWarning: "Could not refresh people list.",
        };
      }
      throw new Error("People list response was incomplete.");
    }
    writePeopleCache(storageKey, fresh);
    return { data: fresh, fromCache: false, hadCache };
  } catch (error) {
    if (hadCache) {
      return {
        data: cachedData as T,
        fromCache: true,
        hadCache: true,
        refreshWarning: error instanceof Error ? error.message : "Could not refresh people list.",
      };
    }
    throw error;
  }
}

export async function loadCompanyMembersCached(
  apiUrl: (path: string) => string,
  input: {
    companyId: string;
    masterSheetId?: string;
    companyName?: string;
  },
  options: PeopleSwrOptions = {},
): Promise<PeopleSwrResult<CompanyMembersCachedPayload> & { fetchResult?: FetchCompanyMembersResult }> {
  const companyId = String(input.companyId || "").trim();
  ensurePeopleCacheContext(companyId);
  const storageKey = peopleCacheStorageKey(companyId, companyMembersPeopleScope());

  try {
    const swr = await runPeopleSwrFetch({
      storageKey,
      isValidData: isValidMembersPayload,
      options,
      fetcher: async (mode) => {
        const result = await fetchCompanyMembers(apiUrl, {
          companyId: input.companyId,
          masterSheetId: input.masterSheetId,
          companyName: input.companyName,
          signal: mode === "await" ? options.signal : undefined,
        });
        if (!result.ok) {
          const error = new Error(result.loadErrorDetail || result.loadError || "Could not load company users.");
          (error as Error & { fetchResult?: FetchCompanyMembersResult }).fetchResult = result;
          throw error;
        }
        return {
          members: dedupeMembersByEmail(result.members),
          warning: result.warning,
          diagnostics: result.diagnostics,
          reasonCode: result.reasonCode,
          failedStep: result.failedStep,
        };
      },
    });
    return swr;
  } catch (error) {
    const fetchResult = (error as Error & { fetchResult?: FetchCompanyMembersResult }).fetchResult;
    if (fetchResult) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { fetchResult });
    }
    throw error;
  }
}

export async function loadScheduleAssigneesCached(
  companyContext: CompanyScheduleContext,
  options: PeopleSwrOptions & {
    selectedArea?: string;
    includeDiagnostics?: boolean;
  } = {},
): Promise<PeopleSwrResult<ScheduleAssigneesCachedPayload> & { fetchResult?: FetchScheduleAssigneesResult }> {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  ensurePeopleCacheContext(companyFolderId);
  const selectedArea = String(options.selectedArea || "").trim();
  const storageKey = peopleCacheStorageKey(companyFolderId, scheduleAssigneesPeopleScope(selectedArea));

  try {
    const swr = await runPeopleSwrFetch({
      storageKey,
      isValidData: isValidAssigneesPayload,
      options,
      fetcher: async (mode) => {
        const result = await fetchScheduleAssignees(companyContext, {
          selectedArea,
          includeDiagnostics: options.includeDiagnostics,
          signal: mode === "await" ? options.signal : undefined,
        });
        if (!result.ok) {
          const error = new Error(result.loadErrorDetail || result.loadError || "Could not load assignees.");
          (error as Error & { fetchResult?: FetchScheduleAssigneesResult }).fetchResult = result;
          throw error;
        }
        return {
          assignees: dedupeAssigneesByEmail(result.assignees),
          warning: result.warning,
          diagnostics: result.diagnostics,
        };
      },
    });
    return swr;
  } catch (error) {
    const fetchResult = (error as Error & { fetchResult?: FetchScheduleAssigneesResult }).fetchResult;
    if (fetchResult) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { fetchResult });
    }
    throw error;
  }
}

export type PreloadPeopleContext = {
  companyFolderId: string;
  masterSheetId?: string;
  companyName?: string;
  apiUrl: (path: string) => string;
  /** Optional signed-in email — reserved for future user-scoped people scopes. */
  userIdentity?: string;
};

let preloadInFlightKey: string | null = null;

/**
 * After login succeeds — warm company People + default assignee lists.
 * Must not block navigation; failures are silent.
 */
export function preloadPeople(context: PreloadPeopleContext): void {
  const companyFolderId = String(context.companyFolderId || "").trim();
  if (!companyFolderId) {
    return;
  }
  ensurePeopleCacheContext(companyFolderId);
  const preloadKey = `${companyFolderId}::${String(context.masterSheetId || "").trim()}`;
  if (preloadInFlightKey === preloadKey) {
    return;
  }
  preloadInFlightKey = preloadKey;

  void (async () => {
    try {
      await Promise.allSettled([
        loadCompanyMembersCached(context.apiUrl, {
          companyId: companyFolderId,
          masterSheetId: context.masterSheetId,
          companyName: context.companyName,
        }).catch(() => undefined),
        loadScheduleAssigneesCached(
          {
            companyId: companyFolderId,
            companyFolderId,
            masterSheetId: String(context.masterSheetId || "").trim(),
            companyName: String(context.companyName || "").trim(),
          },
          { selectedArea: "" },
        ).catch(() => undefined),
      ]);
    } finally {
      if (preloadInFlightKey === preloadKey) {
        preloadInFlightKey = null;
      }
    }
  })();
}
