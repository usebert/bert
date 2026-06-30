/**
 * In-memory Users tab raw values cache — 30s TTL keyed by masterSheetId.
 * Caches successful { headers, rows } reads only; never exposed to API clients.
 */
import { safeLoginTimingMeta } from "./login-timing.mjs";

const DEFAULT_TTL_MS = Math.max(1000, Number(process.env.USERS_TAB_CACHE_TTL_MS || 30_000));

const USERS_TAB_LEGACY_LOWER = new Set(["companyusers", "user", "login", "company login"]);

const CACHE_TIMING_PREFIX = "[users-tab-cache]";

const memory = new Map();

export const USERS_TAB_CACHE_TTL_MS = DEFAULT_TTL_MS;

function trim(value) {
  return String(value ?? "").trim();
}

function safeLower(value) {
  return trim(value).toLowerCase();
}

export function isUsersTabTitle(tabName) {
  const lower = safeLower(tabName);
  return lower === "users" || USERS_TAB_LEGACY_LOWER.has(lower);
}

function isFresh(entry) {
  if (!entry || !Array.isArray(entry.rows)) {
    return false;
  }
  const cachedAt = Number(entry.cachedAt || 0);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) {
    return false;
  }
  return Date.now() - cachedAt < DEFAULT_TTL_MS;
}

/** @returns {{ headers: string[], rows: unknown[][], tabTitle?: string } | null} */
export function getUsersTabCache(masterSheetId) {
  const id = trim(masterSheetId);
  if (!id) {
    return null;
  }
  const entry = memory.get(id);
  if (!entry || !isFresh(entry)) {
    if (entry) {
      memory.delete(id);
    }
    return null;
  }
  return {
    headers: entry.headers,
    rows: entry.rows,
    tabTitle: entry.tabTitle,
  };
}

/** Cache successful raw Users tab values keyed by masterSheetId. */
export function setUsersTabCache(masterSheetId, payload = {}) {
  const id = trim(masterSheetId);
  if (!id || !Array.isArray(payload.rows) || payload.rows.length === 0) {
    return null;
  }
  const headers = Array.isArray(payload.headers)
    ? payload.headers.map((cell) => String(cell || "").trim())
    : (payload.rows[0] || []).map((cell) => String(cell || "").trim());
  const entry = {
    headers,
    rows: payload.rows,
    tabTitle: trim(payload.tabTitle) || undefined,
    cachedAt: Date.now(),
  };
  memory.set(id, entry);
  return { headers: entry.headers, rows: entry.rows };
}

export function invalidateUsersTabCache(masterSheetId, meta = {}) {
  const id = trim(masterSheetId);
  if (!id) {
    return false;
  }
  const hadEntry = memory.has(id);
  memory.delete(id);
  const t0 = Date.now();
  console.info(CACHE_TIMING_PREFIX, "users_tab_cache_invalidate", {
    durationMs: Date.now() - t0,
    masterSheetId: id,
    hadEntry,
    ...safeLoginTimingMeta(meta),
  });
  return hadEntry;
}

/** Test-only — clear all cached Users tab entries. */
export function clearUsersTabCache() {
  memory.clear();
}

function logCacheEvent(event, startMs, meta = {}) {
  console.info(CACHE_TIMING_PREFIX, event, {
    durationMs: Date.now() - startMs,
    ...safeLoginTimingMeta(meta),
  });
}

/**
 * Read Users tab raw rows with cache — full-range reads only (A1:ZZ5000).
 * @param {() => Promise<unknown[][]>} readFn underlying Google read
 */
export async function readUsersTabValuesWithCache(auth, masterSheetId, tabTitle, readFn, options = {}) {
  const id = trim(masterSheetId);
  const tab = trim(tabTitle);

  if (!options.bypassCache && id) {
    const cached = getUsersTabCache(id);
    if (cached) {
      const tHit = Date.now();
      logCacheEvent("users_tab_cache_hit", tHit, {
        masterSheetId: id,
        tabTitle: tab || cached.tabTitle,
        rowCount: Math.max(0, cached.rows.length - 1),
      });
      return cached.rows;
    }
  }

  const tMiss = Date.now();
  logCacheEvent("users_tab_cache_miss", tMiss, { masterSheetId: id, tabTitle: tab });

  const rows = await readFn();
  if (!Array.isArray(rows) || rows.length === 0) {
    return Array.isArray(rows) ? rows : [];
  }

  const tSet = Date.now();
  setUsersTabCache(id, { headers: rows[0], rows, tabTitle: tab });
  logCacheEvent("users_tab_cache_set", tSet, {
    masterSheetId: id,
    tabTitle: tab,
    rowCount: Math.max(0, rows.length - 1),
  });
  return rows;
}

/** Wrap server getTabValues — cache only full Users tab reads. */
export function wrapGetTabValuesWithUsersTabCache(baseGetTabValues) {
  if (typeof baseGetTabValues !== "function") {
    return baseGetTabValues;
  }
  return async function cachedGetTabValues(auth, spreadsheetId, tabName, range = "A1:ZZ5000") {
    const sheetId = trim(spreadsheetId);
    const tab = trim(tabName);
    const rangeNorm = trim(range) || "A1:ZZ5000";
    if (!isUsersTabTitle(tab) || rangeNorm !== "A1:ZZ5000") {
      return baseGetTabValues(auth, spreadsheetId, tabName, range);
    }
    return readUsersTabValuesWithCache(auth, sheetId, tab, () =>
      baseGetTabValues(auth, spreadsheetId, tabName, range),
    );
  };
}
