/**
 * In-memory TTL cache for GET /api/company-areas — successful reads only.
 * Keyed by masterSheetId + companyFolderId (when available).
 */
const DEFAULT_TTL_MS = Math.max(
  1_000,
  Number(process.env.COMPANY_AREAS_CACHE_TTL_MS || String(60_000)),
);

function trim(value) {
  return String(value ?? "").trim();
}

/** @type {Map<string, { expiresAt: number, payload: object }>} */
const companyAreasCache = new Map();

export function companyAreasCacheKey(masterSheetId, companyFolderId = "") {
  const sheetId = trim(masterSheetId);
  const folderId = trim(companyFolderId);
  return `${sheetId}::${folderId}`;
}

export function getCompanyAreasCacheEntry(masterSheetId, companyFolderId = "") {
  const key = companyAreasCacheKey(masterSheetId, companyFolderId);
  const entry = companyAreasCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    companyAreasCache.delete(key);
    return null;
  }
  return entry.payload;
}

export function setCompanyAreasCacheEntry(masterSheetId, companyFolderId, payload, ttlMs = DEFAULT_TTL_MS) {
  const sheetId = trim(masterSheetId);
  if (!sheetId || !payload || typeof payload !== "object") {
    return;
  }
  const key = companyAreasCacheKey(sheetId, companyFolderId);
  companyAreasCache.set(key, {
    expiresAt: Date.now() + Math.max(Number(ttlMs) || DEFAULT_TTL_MS, 1_000),
    payload: {
      ok: true,
      masterSheetId: sheetId,
      companyFolderId: trim(companyFolderId),
      areaRestrictionsEnabled: Boolean(payload.areaRestrictionsEnabled),
      defaultFormLanguage: trim(payload.defaultFormLanguage),
      areas: Array.isArray(payload.areas) ? payload.areas : [],
    },
  });
}

export function invalidateCompanyAreasCache(masterSheetId = "", companyFolderId = "") {
  const sheetId = trim(masterSheetId);
  const folderId = trim(companyFolderId);
  if (!sheetId && !folderId) {
    companyAreasCache.clear();
    return;
  }
  for (const key of [...companyAreasCache.keys()]) {
    const [keySheetId, keyFolderId] = key.split("::");
    if (sheetId && keySheetId === sheetId) {
      companyAreasCache.delete(key);
      continue;
    }
    if (folderId && keyFolderId === folderId) {
      companyAreasCache.delete(key);
    }
  }
}

export function getCompanyAreasCacheTtlMs() {
  return DEFAULT_TTL_MS;
}
