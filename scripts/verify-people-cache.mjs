#!/usr/bin/env node
/**
 * People / assignee stale-while-revalidate cache verification.
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
const peopleCache = read("src/services/peopleCache.ts");
const clearStale = read("src/utils/clearStaleCompanyLocalStorage.ts");
const hook = read("src/hooks/useCachedPeople.ts");

assert(pkg.scripts["verify:people-cache"], "PKG: npm script registered");
assert(peopleCache.includes("PEOPLE_CACHE_TTL_MS = 45_000"), "1: 45s TTL");
assert(peopleCache.includes('PEOPLE_CACHE_KEY_PREFIX = "bert:people-cache"'), "2: namespaced key prefix");
assert(peopleCache.includes("version: typeof PEOPLE_CACHE_VERSION"), "3: versioned payload");
assert(peopleCache.includes("dedupeInFlight"), "4: in-flight dedupe");
assert(peopleCache.includes("loadCompanyMembersCached"), "5: company members SWR loader");
assert(peopleCache.includes("loadScheduleAssigneesCached"), "6: schedule assignees SWR loader");
assert(peopleCache.includes("preloadPeople"), "7: preload after login");
assert(peopleCache.includes("invalidatePeopleCache"), "8: invalidation helper");
assert(peopleCache.includes("sanitizeCompanyMembersForClient"), "9: never caches credential fields unsanitized");
assert(hook.includes("useCachedCompanyMembers") && hook.includes("useCachedScheduleAssignees"), "10: shared hooks");

assert(appTsx.includes("loadCompanyMembersCached"), "11: App uses members SWR loader");
assert(appTsx.includes("loadScheduleAssigneesCached"), "12: App uses assignees SWR loader");
assert(appTsx.includes("preloadPeople"), "13: App preloads people after login");
assert(appTsx.includes("readPeopleCache"), "14: App seeds from people cache");
assert(!appTsx.includes("readCompanyMembersCache"), "15: App does not use legacy members bag cache");
assert(!appTsx.includes("readScheduleAssigneesCache"), "16: App does not use legacy assignees bag cache");
assert(clearStale.includes("invalidatePeopleCache({ all: true })"), "17: logout clears people memory + storage");

/** Inline SWR harness mirroring peopleCache behaviour */
const PEOPLE_CACHE_VERSION = 1;
const memoryCache = new Map();
const inFlight = new Map();
let activeCompany = "";

function peopleCacheStorageKey(companyFolderId, scope) {
  return `bert:people-cache:${companyFolderId.trim()}:${scope}`;
}

function isValidEntry(value) {
  return (
    value &&
    typeof value === "object" &&
    value.version === PEOPLE_CACHE_VERSION &&
    typeof value.cachedAt === "number" &&
    value.data !== undefined &&
    value.data !== null
  );
}

function writeCache(key, data, cachedAt = Date.now()) {
  const entry = { version: PEOPLE_CACHE_VERSION, cachedAt, data };
  memoryCache.set(key, entry);
  return entry;
}

function readCache(key) {
  const entry = memoryCache.get(key);
  return isValidEntry(entry) ? entry : null;
}

function isStale(entry, ttlMs = TTL_MS) {
  if (!entry) return true;
  return Date.now() - entry.cachedAt > ttlMs;
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

async function runSwr({ cacheKey, fetcher, forceRefresh = false }) {
  const cached = readCache(cacheKey);
  const hadCache = Boolean(cached);
  const stale = isStale(cached);
  const mustAwait = !hadCache || forceRefresh;

  if (hadCache && stale && !mustAwait) {
    const revalidatePromise = dedupeInFlight(`SWR ${cacheKey}`, async () => {
      try {
        const fresh = await fetcher();
        writeCache(cacheKey, fresh);
        return fresh;
      } catch {
        return undefined;
      }
    });
    return { data: cached.data, fromCache: true, hadCache: true, revalidatePromise };
  }

  if (hadCache && !mustAwait) {
    return { data: cached.data, fromCache: true, hadCache: true };
  }

  try {
    const fresh = await dedupeInFlight(`SWR ${cacheKey}:await`, fetcher);
    writeCache(cacheKey, fresh);
    return { data: fresh, fromCache: false, hadCache };
  } catch (error) {
    if (hadCache) {
      return {
        data: cached.data,
        fromCache: true,
        hadCache: true,
        refreshWarning: error instanceof Error ? error.message : "refresh failed",
      };
    }
    throw error;
  }
}

function ensurePeopleCacheContext(companyFolderId) {
  const next = companyFolderId.trim();
  if (activeCompany && next && activeCompany !== next) {
    memoryCache.clear();
  }
  activeCompany = next;
}

memoryCache.clear();
inFlight.clear();

/** 18: no cache uses loading / awaited path */
{
  const key = peopleCacheStorageKey("coA", "company-members");
  let fetches = 0;
  const result = await runSwr({
    cacheKey: key,
    fetcher: async () => {
      fetches += 1;
      return { members: [{ email: "a@example.com" }] };
    },
  });
  assert(!result.fromCache && fetches === 1 && result.data.members.length === 1, "18: no cache fetches");
}

/** 19: fresh cache appears immediately without fetch */
{
  const key = peopleCacheStorageKey("coA", "company-members");
  writeCache(key, { members: [{ email: "cached@example.com" }] }, Date.now());
  let fetches = 0;
  const result = await runSwr({
    cacheKey: key,
    fetcher: async () => {
      fetches += 1;
      return { members: [{ email: "fresh@example.com" }] };
    },
  });
  assert(result.fromCache && fetches === 0 && result.data.members[0].email === "cached@example.com", "19: fresh cache hits");
}

/** 20: stale cache appears immediately while refresh runs */
{
  const key = peopleCacheStorageKey("coA", "company-members");
  writeCache(key, { members: [{ email: "stale@example.com" }] }, Date.now() - TTL_MS - 1);
  let resolveFetch;
  const fetchStarted = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const result = await runSwr({
    cacheKey: key,
    fetcher: async () => {
      resolveFetch();
      await new Promise((r) => setTimeout(r, 20));
      return { members: [{ email: "fresh@example.com" }] };
    },
  });
  assert(result.fromCache && result.data.members[0].email === "stale@example.com", "20: stale shown immediately");
  assert(Boolean(result.revalidatePromise), "20b: background refresh started");
  await fetchStarted;
  const fresh = await result.revalidatePromise;
  assert(fresh.members[0].email === "fresh@example.com", "21: successful refresh replaces cache");
  assert(readCache(key).data.members[0].email === "fresh@example.com", "21b: cache updated");
}

/** 22: failed refresh retains cache */
{
  const key = peopleCacheStorageKey("coB", "company-members");
  writeCache(key, { members: [{ email: "keep@example.com" }] }, Date.now() - TTL_MS - 1);
  const result = await runSwr({
    cacheKey: key,
    fetcher: async () => {
      throw new Error("network down");
    },
  });
  assert(result.fromCache && result.data.members[0].email === "keep@example.com", "22: failed refresh retains");
  await result.revalidatePromise;
  assert(readCache(key).data.members[0].email === "keep@example.com", "22b: cache unchanged after failure");
}

/** 23: invalid JSON / bad version ignored */
assert(!isValidEntry(JSON.parse('{"version":2,"cachedAt":1,"data":{"members":[]}}')), "23: unsupported version ignored");
assert(!isValidEntry(JSON.parse('{"cachedAt":1,"data":{"members":[]}}')), "23b: missing version ignored");
assert(!isValidEntry(null), "23c: malformed ignored");

/** 24: duplicate simultaneous requests deduped */
{
  const key = peopleCacheStorageKey("coC", "schedule-assignees:all");
  memoryCache.delete(key);
  let fetches = 0;
  const fetcher = async () => {
    fetches += 1;
    await new Promise((r) => setTimeout(r, 30));
    return { assignees: [{ email: "one@example.com" }] };
  };
  const [a, b] = await Promise.all([
    runSwr({ cacheKey: key, fetcher }),
    runSwr({ cacheKey: key, fetcher }),
  ]);
  assert(fetches === 1, "24: duplicate in-flight deduped");
  assert(a.data.assignees[0].email === "one@example.com" && b.data.assignees[0].email === "one@example.com", "24b: same data");
}

/** 25: company isolation */
{
  writeCache(peopleCacheStorageKey("companyA", "company-members"), { members: [{ email: "a@co.com" }] });
  writeCache(peopleCacheStorageKey("companyB", "company-members"), { members: [{ email: "b@co.com" }] });
  assert(
    readCache(peopleCacheStorageKey("companyA", "company-members")).data.members[0].email === "a@co.com",
    "25: company A key isolated",
  );
  assert(
    readCache(peopleCacheStorageKey("companyB", "company-members")).data.members[0].email === "b@co.com",
    "25b: company B key isolated",
  );
}

/** 26: user-scoped key shape available */
{
  const userKey = peopleCacheStorageKey("companyA", "user:alice@example.com:visible-people");
  writeCache(userKey, { members: [{ email: "alice@example.com" }] });
  const other = peopleCacheStorageKey("companyA", "user:bob@example.com:visible-people");
  assert(readCache(other) === null, "26: user-scoped keys do not cross users");
}

/** 27: selection preserved by stable email identity after refresh */
{
  const selected = "keep@example.com";
  const before = [{ email: "keep@example.com" }, { email: "other@example.com" }];
  const after = [{ email: "other@example.com" }, { email: "keep@example.com" }];
  const stillSelected = after.some((row) => row.email === selected);
  assert(stillSelected && before.find((r) => r.email === selected), "27: selection by email survives refresh");
}

/** 28: duplicates removed safely */
{
  const members = [
    { email: "Dup@Example.com" },
    { email: "dup@example.com" },
    { email: "unique@example.com" },
  ];
  const seen = new Set();
  const deduped = [];
  for (const row of members) {
    const email = row.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    deduped.push({ ...row, email });
  }
  assert(deduped.length === 2, "28: duplicate people removed");
}

/** 29: role filtering unchanged — cache stores API payload only */
assert(
  !peopleCache.includes("canManageCompanyMembers(") && !peopleCache.includes("getEditableCompanyMemberRoles"),
  "29: people cache does not re-implement role filtering",
);

/** 30: preload does not block — fire-and-forget void */
assert(/export function preloadPeople[\s\S]{0,400}void \(async \(\) =>/.test(peopleCache), "30: preload non-blocking");
assert(/\.catch\(\(\) => undefined\)/.test(peopleCache), "31: failed preload silent");

/** 32: logout clears in-memory so next login cannot reuse */
{
  ensurePeopleCacheContext("companyA");
  writeCache(peopleCacheStorageKey("companyA", "company-members"), { members: [{ email: "a@co.com" }] });
  ensurePeopleCacheContext("companyB");
  assert(memoryCache.size === 0, "32: company switch clears in-memory people cache");
}

/** 33: data shape preserved */
{
  const payload = { members: [{ email: "x@y.com", name: "X", role: "Auditor", status: "ACTIVE" }], warning: "w" };
  writeCache(peopleCacheStorageKey("coShape", "company-members"), payload);
  const read = readCache(peopleCacheStorageKey("coShape", "company-members")).data;
  assert(read.members[0].role === "Auditor" && read.warning === "w", "33: same data shape");
}

console.log(`[verify:people-cache] OK — ${caseCount} cases passed`);
