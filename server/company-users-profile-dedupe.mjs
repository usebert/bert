/**
 * In-flight deduplication for concurrent company profile loads and auth-index sync.
 */

const inFlightProfileLoads = new Map();
const inFlightAuthIndexSyncs = new Map();

function trim(value) {
  return String(value ?? "").trim();
}

export function buildCompanyProfileLoadKey(companyFolderId, masterSheetId) {
  const folder = trim(companyFolderId);
  const sheet = trim(masterSheetId);
  if (!folder) {
    return "";
  }
  return `${folder}:${sheet}`;
}

export function resolveProfileLoadDedupeKey(companyContext = {}, deps = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  if (!companyFolderId) {
    return "";
  }
  if (companyContext.trustSessionContext === true) {
    const trustedSheet = trim(companyContext.masterSheetId);
    if (trustedSheet) {
      return buildCompanyProfileLoadKey(companyFolderId, trustedSheet);
    }
  }
  const cache = deps?.masterSheetCache;
  const cachedSheet =
    cache && typeof cache.getEntry === "function" ? trim(cache.getEntry(companyFolderId)?.masterSheetId) : "";
  if (cachedSheet) {
    return buildCompanyProfileLoadKey(companyFolderId, cachedSheet);
  }
  return buildCompanyProfileLoadKey(companyFolderId, "");
}

export function buildAuthIndexSyncKey(companyFolderId, masterSheetId) {
  return buildCompanyProfileLoadKey(companyFolderId, masterSheetId);
}

function logCompanyUsersDedupe(event, stageStartMs, meta = {}) {
  try {
    console.info("company_users_dedupe", {
      event,
      durationMs: Date.now() - stageStartMs,
      ...meta,
    });
  } catch {
    /* timing log must never affect request */
  }
}

function logAuthIndexSyncDedupe(event, stageStartMs, meta = {}) {
  try {
    console.info("auth_index_sync_dedupe", {
      event,
      durationMs: Date.now() - stageStartMs,
      ...meta,
    });
  } catch {
    /* timing log must never affect request */
  }
}

export async function dedupeCompanyProfileLoad(key, loadFn, meta = {}) {
  if (!key || typeof loadFn !== "function") {
    return loadFn();
  }

  const existing = inFlightProfileLoads.get(key);
  if (existing) {
    const joinStart = Date.now();
    logCompanyUsersDedupe("joined", joinStart, { ...meta, dedupeKey: key });
    try {
      const result = await existing;
      logCompanyUsersDedupe("completed", joinStart, { ...meta, dedupeKey: key, joined: true });
      return result;
    } catch (error) {
      logCompanyUsersDedupe("failed", joinStart, { ...meta, dedupeKey: key, joined: true });
      throw error;
    }
  }

  const leaderStart = Date.now();
  logCompanyUsersDedupe("leader", leaderStart, { ...meta, dedupeKey: key });

  const promise = (async () => loadFn())();
  inFlightProfileLoads.set(key, promise);

  try {
    const result = await promise;
    logCompanyUsersDedupe("completed", leaderStart, { ...meta, dedupeKey: key, leader: true });
    return result;
  } catch (error) {
    logCompanyUsersDedupe("failed", leaderStart, { ...meta, dedupeKey: key, leader: true });
    throw error;
  } finally {
    inFlightProfileLoads.delete(key);
  }
}

export async function dedupeAuthIndexSync(key, syncFn, meta = {}) {
  if (!key || typeof syncFn !== "function") {
    return syncFn();
  }

  const existing = inFlightAuthIndexSyncs.get(key);
  if (existing) {
    const joinStart = Date.now();
    logAuthIndexSyncDedupe("joined", joinStart, { ...meta, dedupeKey: key });
    try {
      const result = await existing;
      logAuthIndexSyncDedupe("completed", joinStart, { ...meta, dedupeKey: key, joined: true });
      return result;
    } catch (error) {
      logAuthIndexSyncDedupe("failed", joinStart, { ...meta, dedupeKey: key, joined: true });
      throw error;
    }
  }

  const leaderStart = Date.now();
  logAuthIndexSyncDedupe("leader", leaderStart, { ...meta, dedupeKey: key });

  const promise = (async () => syncFn())();
  inFlightAuthIndexSyncs.set(key, promise);

  try {
    const result = await promise;
    logAuthIndexSyncDedupe("completed", leaderStart, { ...meta, dedupeKey: key, leader: true });
    return result;
  } catch (error) {
    logAuthIndexSyncDedupe("failed", leaderStart, { ...meta, dedupeKey: key, leader: true });
    throw error;
  } finally {
    inFlightAuthIndexSyncs.delete(key);
  }
}

/** Test-only — clear in-flight maps between verifier cases. */
export function clearCompanyUsersProfileDedupeState() {
  inFlightProfileLoads.clear();
  inFlightAuthIndexSyncs.clear();
}
