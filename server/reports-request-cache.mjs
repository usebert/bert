/**
 * Reports workbook cache — in-flight dedupe for tab ensure/read and exports folder resolution.
 */
function trim(value) {
  return String(value ?? "").trim();
}

function workbookKey(companyFolderId, masterSheetId, suffix = "") {
  return `${trim(companyFolderId)}::${trim(masterSheetId)}::${suffix}`;
}

function exportsKey(companyFolderId) {
  return `${trim(companyFolderId)}::exports-folder`;
}

/** @type {Map<string, { expiresAt: number, value: unknown }>} */
const tabReadCache = new Map();
/** @type {Map<string, Promise<unknown>>} */
const tabReadInflight = new Map();
/** @type {Map<string, Promise<unknown>>} */
const tabEnsureInflight = new Map();
/** @type {Map<string, { expiresAt: number, value: string }>} */
const exportsFolderCache = new Map();
/** @type {Map<string, Promise<string>>} */
const exportsFolderInflight = new Map();

export const REPORTS_TAB_READ_CACHE_TTL_MS = 30_000;

export function clearReportsRequestCacheForTests() {
  tabReadCache.clear();
  tabReadInflight.clear();
  tabEnsureInflight.clear();
  exportsFolderCache.clear();
  exportsFolderInflight.clear();
}

export function invalidateReportsWorkbookCache(companyFolderId, masterSheetId) {
  const prefix = `${trim(companyFolderId)}::${trim(masterSheetId)}::`;
  for (const key of tabReadCache.keys()) {
    if (key.startsWith(prefix)) {
      tabReadCache.delete(key);
    }
  }
  for (const key of tabReadInflight.keys()) {
    if (key.startsWith(prefix)) {
      tabReadInflight.delete(key);
    }
  }
  for (const key of tabEnsureInflight.keys()) {
    if (key.startsWith(prefix)) {
      tabEnsureInflight.delete(key);
    }
  }
  const exportsPrefix = exportsKey(companyFolderId);
  exportsFolderCache.delete(exportsPrefix);
  exportsFolderInflight.delete(exportsPrefix);
}

export async function dedupedEnsureReportsTabColumns(
  auth,
  deps,
  companyFolderId,
  masterSheetId,
  tabName,
  columns,
  ensureFn,
) {
  const key = workbookKey(companyFolderId, masterSheetId, `ensure:${tabName}`);
  if (tabEnsureInflight.has(key)) {
    return tabEnsureInflight.get(key);
  }
  const promise = ensureFn(auth, deps, masterSheetId, tabName, columns).finally(() => {
    tabEnsureInflight.delete(key);
  });
  tabEnsureInflight.set(key, promise);
  return promise;
}

export async function cachedReadReportsTabRecords(
  auth,
  deps,
  companyFolderId,
  masterSheetId,
  tabName,
  readFn,
  options = {},
) {
  const cacheKey = workbookKey(companyFolderId, masterSheetId, `read:${tabName}:${options.summaryOnly ? "summary" : "full"}`);
  const cached = tabReadCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { ...cached.value, cacheHit: true };
  }
  if (tabReadInflight.has(cacheKey)) {
    const value = await tabReadInflight.get(cacheKey);
    return { ...value, cacheHit: true };
  }
  const promise = readFn(auth, deps, masterSheetId, tabName, options).then((value) => {
    tabReadCache.set(cacheKey, { expiresAt: Date.now() + REPORTS_TAB_READ_CACHE_TTL_MS, value });
    return value;
  }).finally(() => {
    tabReadInflight.delete(cacheKey);
  });
  tabReadInflight.set(cacheKey, promise);
  const value = await promise;
  return { ...value, cacheHit: false };
}

export async function cachedResolveExportsFolderId(companyFolderId, resolveFn) {
  const key = exportsKey(companyFolderId);
  const cached = exportsFolderCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { exportsFolderId: cached.value, cacheHit: true };
  }
  if (exportsFolderInflight.has(key)) {
    const exportsFolderId = await exportsFolderInflight.get(key);
    return { exportsFolderId, cacheHit: true };
  }
  const promise = resolveFn().then((exportsFolderId) => {
    exportsFolderCache.set(key, { expiresAt: Date.now() + REPORTS_TAB_READ_CACHE_TTL_MS, value: exportsFolderId });
    return exportsFolderId;
  }).finally(() => {
    exportsFolderInflight.delete(key);
  });
  exportsFolderInflight.set(key, promise);
  const exportsFolderId = await promise;
  return { exportsFolderId, cacheHit: false };
}
