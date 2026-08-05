/**
 * Risk Register workbook caches — tab ensure dedupe and in-flight detail coalescing.
 * Scoped per workbook ID; invalidated after mutations that change risk/control/review rows.
 */
function trim(value) {
  return String(value ?? "").trim();
}

function workbookPrefix(masterSheetId) {
  return `${trim(masterSheetId)}:`;
}

const ensuredTabsByWorkbook = new Map();
const detailInFlightByKey = new Map();

export function riskRegisterCacheKey(masterSheetId, suffix = "") {
  return `${trim(masterSheetId)}:${trim(suffix)}`;
}

export async function ensureRiskRegisterTabsCached(masterSheetId, ensureFn) {
  const key = riskRegisterCacheKey(masterSheetId, "tabs");
  let pending = ensuredTabsByWorkbook.get(key);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => ensureFn())
      .catch((error) => {
        ensuredTabsByWorkbook.delete(key);
        throw error;
      });
    ensuredTabsByWorkbook.set(key, pending);
  }
  return pending;
}

export function invalidateRiskRegisterWorkbookCache(masterSheetId) {
  const prefix = workbookPrefix(masterSheetId);
  for (const key of [...detailInFlightByKey.keys()]) {
    if (key.startsWith(prefix)) {
      detailInFlightByKey.delete(key);
    }
  }
}

export async function dedupeRiskRegisterDetailLoad(cacheKey, loader) {
  let pending = detailInFlightByKey.get(cacheKey);
  if (!pending) {
    pending = loader().finally(() => {
      detailInFlightByKey.delete(cacheKey);
    });
    detailInFlightByKey.set(cacheKey, pending);
  }
  return pending;
}

export function clearRiskRegisterCachesForTests() {
  ensuredTabsByWorkbook.clear();
  detailInFlightByKey.clear();
}
