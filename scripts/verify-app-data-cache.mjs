#!/usr/bin/env node
/**
 * App data preload cache — stale-while-revalidate for Briefings + dashboard todo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TTL_MS = 45_000;
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const appTsx = read("App.tsx");
const briefingsScreen = read("src/screens/BriefingsScreen.tsx");
const cacheService = read("src/services/appDataCacheService.ts");
const clearStale = read("src/utils/clearStaleCompanyLocalStorage.ts");
const requestDedupe = read("src/utils/requestDedupe.ts");
const briefingsService = read("src/services/briefingsService.ts");

assert(pkg.scripts["verify:app-data-cache"], "PKG: npm script registered");

/** Static wiring */
assert(cacheService.includes("APP_DATA_CACHE_TTL_MS = 45_000"), "CACHE: 45s TTL constant");
assert(cacheService.includes("briefingsMineCacheKey"), "CACHE: mine cache key helper");
assert(cacheService.includes("briefingsTrackerCacheKey"), "CACHE: tracker cache key helper");
assert(cacheService.includes("loadBriefingsMineCached"), "CACHE: mine SWR loader");
assert(cacheService.includes("loadBriefingsTrackerCached"), "CACHE: tracker SWR loader");
assert(cacheService.includes("loadBriefingsTodoPreviewCached"), "CACHE: todo preview SWR loader");
assert(cacheService.includes("preloadAppData"), "CACHE: post-login preload");
assert(cacheService.includes("invalidateAppDataCache"), "CACHE: invalidation helper");
assert(cacheService.includes("ensureAppDataContext"), "CACHE: context switch invalidation");
assert(cacheService.includes("revalidatePromise"), "CACHE: background revalidate promise");
assert(cacheService.includes("dedupeInFlight"), "CACHE: in-flight dedupe for SWR");

assert(briefingsScreen.includes("loadBriefingsMineCached"), "UI: BriefingsScreen uses cached mine loader");
assert(briefingsScreen.includes("readAppDataCache"), "UI: BriefingsScreen seeds from cache");
assert(briefingsScreen.includes("Refreshing…"), "UI: subtle refreshing label");
assert(briefingsScreen.includes("Showing saved data. Refresh failed."), "UI: refresh-fail warning");
assert(briefingsScreen.includes("loading && mine.length === 0"), "UI: no spinner when cache exists");
assert(briefingsScreen.includes("readBriefingsPendingActions"), "UI: pending actions survive remount");

assert(appTsx.includes("loadBriefingsTodoPreviewCached"), "APP: dashboard todo uses cached loader");
assert(appTsx.includes("preloadAppData"), "APP: post-login preload wired");
assert(appTsx.includes("userEmail="), "APP: BriefingsScreen receives user email");
assert(!appTsx.includes("dashboardBriefingsPreviewKeyRef"), "APP: removed preview ref gate that forced refetch");

assert(clearStale.includes("invalidateAppDataCache({ all: true })"), "LOGOUT: clears in-memory app data cache");
assert(requestDedupe.includes("dedupeInFlight"), "DEDUPE: utility present");
assert(briefingsService.includes("dedupeInFlight"), "DEDUPE: briefings service uses dedupe");

/** Inline SWR harness mirroring appDataCacheService behaviour */
function briefingsMineCacheKey(companyFolderId, userEmail) {
  return `briefings-mine:${companyFolderId.trim()}::${userEmail.trim().toLowerCase()}`;
}

function briefingsTrackerCacheKey(companyFolderId) {
  return `briefings-tracker:${companyFolderId.trim()}`;
}

const memoryCache = new Map();
const inFlight = new Map();
let activeContextKey = "";

function writeCache(key, data, cachedAt = Date.now()) {
  memoryCache.set(key, { data, cachedAt });
}

function readCache(key) {
  return memoryCache.get(key) || null;
}

function isStale(entry, ttlMs = TTL_MS) {
  if (!entry) return true;
  return Date.now() - entry.cachedAt > ttlMs;
}

function invalidateCache({ companyFolderId, userEmail, all = false }) {
  if (all) {
    memoryCache.clear();
    activeContextKey = "";
    return;
  }
  const company = String(companyFolderId || "").trim();
  const email = String(userEmail || "").trim().toLowerCase();
  for (const key of [...memoryCache.keys()]) {
    if (company && key.includes(company) && (!email || key.includes(email))) {
      memoryCache.delete(key);
    }
    if (company && key === briefingsTrackerCacheKey(company)) {
      memoryCache.delete(key);
    }
  }
}

function ensureContext(companyFolderId, userEmail) {
  const nextKey = `${companyFolderId.trim()}::${userEmail.trim().toLowerCase()}`;
  if (activeContextKey && activeContextKey !== nextKey) {
    const [prevCompany, prevUser] = activeContextKey.split("::");
    if (prevCompany !== companyFolderId.trim()) {
      invalidateCache({ companyFolderId: prevCompany });
      invalidateCache({ companyFolderId });
    } else if (prevUser !== userEmail.trim().toLowerCase()) {
      invalidateCache({ companyFolderId, userEmail: prevUser });
    }
  }
  activeContextKey = nextKey;
}

async function dedupeInFlight(key, run) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function runSwr({ cacheKey, fetcher, forceRefresh = false, manualRefresh = false }) {
  const cached = readCache(cacheKey);
  const hadCache = Boolean(cached);
  const stale = isStale(cached);
  const mustAwait = !hadCache || forceRefresh || manualRefresh;
  const shouldBackgroundRefresh = hadCache && stale && !mustAwait;

  if (shouldBackgroundRefresh) {
    const revalidatePromise = dedupeInFlight(`SWR ${cacheKey}`, async () => {
      const fresh = await fetcher();
      writeCache(cacheKey, fresh);
      return fresh;
    });
    return { data: cached.data, fromCache: true, hadCache, revalidatePromise };
  }

  if (hadCache && !mustAwait) {
    return { data: cached.data, fromCache: true, hadCache };
  }

  try {
    const fresh = await dedupeInFlight(`SWR ${cacheKey}:await`, fetcher);
    writeCache(cacheKey, fresh);
    return { data: fresh, fromCache: false, hadCache };
  } catch (error) {
    if (hadCache) {
      return { data: cached.data, fromCache: true, hadCache, refreshWarning: String(error) };
    }
    throw error;
  }
}

memoryCache.clear();
inFlight.clear();
activeContextKey = "";

let fetchCount = 0;
const companyA = "folder-a";
const companyB = "folder-b";
const userOne = "auditor@test.co";
const userTwo = "manager@test.co";
const mineKey = briefingsMineCacheKey(companyA, userOne);

async function fetchMine() {
  fetchCount += 1;
  return [{ briefingId: `BRF-${fetchCount}`, status: "New" }];
}

/** 1: cached data on remount without hard loading */
writeCache(mineKey, [{ briefingId: "BRF-cached", status: "New" }]);
const remount = await runSwr({ cacheKey: mineKey, fetcher: fetchMine });
assert(remount.fromCache && remount.data[0].briefingId === "BRF-cached", "1: remount shows cached mine immediately");

/** 2: within TTL does not refetch */
const beforeFresh = fetchCount;
const freshHit = await runSwr({ cacheKey: mineKey, fetcher: fetchMine });
assert(freshHit.fromCache && fetchCount === beforeFresh, "2: fresh cache skips network fetch");

/** 3: background refresh updates stale cache */
writeCache(mineKey, [{ briefingId: "BRF-stale", status: "New" }], Date.now() - TTL_MS - 1);
fetchCount = 0;
const staleHit = await runSwr({ cacheKey: mineKey, fetcher: fetchMine });
assert(staleHit.fromCache && staleHit.data[0].briefingId === "BRF-stale", "3a: stale cache returned immediately");
assert(staleHit.revalidatePromise, "3b: stale cache starts background refresh");
const refreshed = await staleHit.revalidatePromise;
assert(refreshed[0].briefingId === "BRF-1", "3c: background refresh returns fresh data");
assert(readCache(mineKey).data[0].briefingId === "BRF-1", "3d: cache updated after background refresh");

/** 4: failed refresh keeps cached data */
writeCache(mineKey, [{ briefingId: "BRF-keep", status: "New" }]);
const failed = await runSwr({
  cacheKey: mineKey,
  fetcher: async () => {
    throw new Error("network down");
  },
  manualRefresh: true,
});
assert(failed.data[0].briefingId === "BRF-keep" && failed.refreshWarning, "4: failed refresh keeps cached data");

/** 5: optimistic pending actions map (service-level) */
assert(cacheService.includes("briefingsPendingActions"), "5: pending actions stored outside component state");

/** 6: company switch invalidates cache */
writeCache(briefingsMineCacheKey(companyA, userOne), [{ briefingId: "A", status: "New" }]);
writeCache(briefingsTrackerCacheKey(companyA), [{ briefingId: "T-A" }]);
ensureContext(companyA, userOne);
ensureContext(companyB, userOne);
assert(!readCache(briefingsMineCacheKey(companyA, userOne)), "6a: company switch clears previous mine cache");
assert(!readCache(briefingsTrackerCacheKey(companyA)), "6b: company switch clears previous tracker cache");

/** 7: user switch invalidates mine cache */
writeCache(briefingsMineCacheKey(companyA, userOne), [{ briefingId: "U1", status: "New" }]);
writeCache(briefingsMineCacheKey(companyA, userTwo), [{ briefingId: "U2", status: "New" }]);
ensureContext(companyA, userOne);
ensureContext(companyA, userTwo);
assert(!readCache(briefingsMineCacheKey(companyA, userOne)), "7: user switch clears previous user mine cache");

/** 8: dashboard todo preload starts after login */
assert(
  /useEffect\([\s\S]{0,1200}preloadAppData\([\s\S]{0,400}masterCompanyWorkspaceDataMatchesSelection/.test(appTsx) ||
    /useEffect\([\s\S]{0,400}masterCompanyWorkspaceDataMatchesSelection[\s\S]{0,1200}preloadAppData/.test(appTsx),
  "8: preload runs when company workspace context is ready",
);
assert(cacheService.includes("loadBriefingsTodoPreviewCached(companyFolderId, userEmail)"), "8b: preload includes dashboard todo");

/** 9: duplicate in-flight GETs deduped */
fetchCount = 0;
writeCache(mineKey, [{ briefingId: "BRF-dedupe", status: "New" }], Date.now() - TTL_MS - 1);
const [a, b] = await Promise.all([
  runSwr({ cacheKey: mineKey, fetcher: fetchMine }),
  runSwr({ cacheKey: mineKey, fetcher: fetchMine }),
]);
await Promise.all([a.revalidatePromise, b.revalidatePromise].filter(Boolean));
assert(fetchCount === 1, "9: concurrent stale revalidations share one fetch");

/** 10: existing briefings workflow still wired */
assert(briefingsScreen.includes("briefingActionPending"), "10a: briefing actions still use pending checks");
assert(briefingsScreen.includes("refresh: true"), "10b: post-action refresh still bypasses cache gate");
assert(read("scripts/verify-briefings-to-do.mjs").includes("verify:briefings-to-do"), "10c: briefings verifier still registered");

console.log(`verify:app-data-cache — ${caseCount} checks OK`);
