/**
 * Small in-memory hint cache: companyFolderId -> masterSheetId / companyName.
 * Hint only — never overrides explicit folder-first values from session/API.
 */
const DEFAULT_TTL_MS = Math.max(
  1_000,
  Number(process.env.COMPANY_CONTEXT_HINT_CACHE_TTL_MS || String(60_000)),
);

function trim(value) {
  return String(value ?? "").trim();
}

/** @type {Map<string, { expiresAt: number, masterSheetId: string, companyName: string }>} */
const companyContextHints = new Map();

export function getCompanyContextHint(companyFolderId) {
  const folderId = trim(companyFolderId);
  if (!folderId) {
    return null;
  }
  const entry = companyContextHints.get(folderId);
  if (!entry || entry.expiresAt <= Date.now()) {
    companyContextHints.delete(folderId);
    return null;
  }
  return {
    masterSheetId: entry.masterSheetId,
    companyName: entry.companyName,
  };
}

export function setCompanyContextHint(companyFolderId, meta = {}, ttlMs = DEFAULT_TTL_MS) {
  const folderId = trim(companyFolderId);
  const masterSheetId = trim(meta.masterSheetId);
  if (!folderId || !masterSheetId) {
    return;
  }
  companyContextHints.set(folderId, {
    expiresAt: Date.now() + Math.max(Number(ttlMs) || DEFAULT_TTL_MS, 1_000),
    masterSheetId,
    companyName: trim(meta.companyName),
  });
}

export function clearCompanyContextHint(companyFolderId) {
  const folderId = trim(companyFolderId);
  if (!folderId) {
    return;
  }
  companyContextHints.delete(folderId);
}

export function getCompanyContextHintCacheTtlMs() {
  return DEFAULT_TTL_MS;
}
