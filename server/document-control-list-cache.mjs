/**
 * Document Control list cache, in-flight dedupe, and list timing helpers.
 */
const LIST_CACHE_TTL_MS = 30_000;
const ENSURED_TAB_TTL_MS = 5 * 60_000;
const FOLDER_STRUCTURE_CACHE_TTL_MS = 5 * 60_000;

const listCache = new Map();
const listInFlight = new Map();
const ensuredTabs = new Map();
const folderStructureCache = new Map();

function trim(value) {
  return String(value ?? "").trim();
}

function actorCanManageDocumentControl(actor) {
  if (!actor?.email) {
    return false;
  }
  const kind = actor.kind;
  if (kind !== "company" && kind !== "godmode" && kind !== "invite") {
    return false;
  }
  const role = trim(actor?.role);
  return role === "Master" || role === "Admin" || role === "Manager";
}

function actorListScope(actor) {
  const role = trim(actor?.role) || "unknown";
  const manage = actorCanManageDocumentControl(actor) ? "manage" : "view";
  return `${role}:${manage}`;
}

const workbookSheetCache = new Map();

export function documentControlListCacheKey(resolved, actor, options = {}) {
  const companyFolderId = trim(resolved?.companyFolderId);
  const masterSheetId = trim(resolved?.masterSheetId);
  const includeArchived = options.includeArchived === true ? "1" : "0";
  const status = trim(options.status).toLowerCase();
  return `${companyFolderId}:${masterSheetId}:${actorListScope(actor)}:${includeArchived}:${status}`;
}

export function invalidateDocumentControlListCache(context = {}) {
  const companyFolderId = trim(context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  if (!companyFolderId && !masterSheetId) {
    listCache.clear();
    listInFlight.clear();
    workbookSheetCache.clear();
    ensuredTabs.clear();
    folderStructureCache.clear();
    return;
  }
  const prefix = masterSheetId ? `${companyFolderId}:${masterSheetId}:` : `${companyFolderId}:`;
  for (const key of listCache.keys()) {
    if (key.startsWith(prefix) || (companyFolderId && key.startsWith(`${companyFolderId}:`))) {
      listCache.delete(key);
    }
  }
  for (const key of listInFlight.keys()) {
    if (key.startsWith(prefix) || (companyFolderId && key.startsWith(`${companyFolderId}:`))) {
      listInFlight.delete(key);
    }
  }
  if (masterSheetId) {
    workbookSheetCache.delete(trim(masterSheetId));
    invalidateEnsuredTabs(masterSheetId);
  }
  if (companyFolderId) {
    invalidateDocumentControlFolderCache(companyFolderId);
  }
}

export function invalidateEnsuredTabs(masterSheetId) {
  const id = trim(masterSheetId);
  if (!id) {
    ensuredTabs.clear();
    return;
  }
  for (const key of ensuredTabs.keys()) {
    if (key.startsWith(`${id}:`)) {
      ensuredTabs.delete(key);
    }
  }
}

export function isDocumentControlTabEnsured(masterSheetId, tabName) {
  const key = `${trim(masterSheetId)}:${trim(tabName)}`;
  const entry = ensuredTabs.get(key);
  return Boolean(entry && entry.expiresAt > Date.now());
}

export function markDocumentControlTabEnsured(masterSheetId, tabName) {
  const key = `${trim(masterSheetId)}:${trim(tabName)}`;
  ensuredTabs.set(key, { expiresAt: Date.now() + ENSURED_TAB_TTL_MS });
}

export function createDocumentControlListTiming(meta = {}) {
  const startedAt = Date.now();
  let lastStageAt = startedAt;
  const base = {
    companyFolderId: trim(meta.companyFolderId),
    workbookId: trim(meta.workbookId),
  };

  return {
    log(stage, extra = {}) {
      const now = Date.now();
      const durationMs = now - lastStageAt;
      const totalMs = now - startedAt;
      lastStageAt = now;
      console.info("[document-control:list-timing]", {
        stage,
        ...base,
        rowCounts: extra.rowCounts || undefined,
        durationMs,
        totalMs,
        ...extra,
      });
    },
    startedAt,
  };
}

export async function withDocumentControlListCache(cacheKey, loader) {
  const cached = listCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { payload: cached.payload, cacheHit: true };
  }

  let inFlight = listInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = loader().finally(() => {
      listInFlight.delete(cacheKey);
    });
    listInFlight.set(cacheKey, inFlight);
  }

  const payload = await inFlight;
  if (payload?.ok) {
    listCache.set(cacheKey, {
      expiresAt: Date.now() + LIST_CACHE_TTL_MS,
      payload,
    });
  }
  return { payload, cacheHit: false };
}

export function peekDocumentControlListCache(cacheKey) {
  const cached = listCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }
  return cached.payload;
}

export function getWorkbookSheetCache(masterSheetId) {
  const entry = workbookSheetCache.get(trim(masterSheetId));
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry;
}

export function setWorkbookSheetCache(masterSheetId, data) {
  const id = trim(masterSheetId);
  if (!id) {
    return;
  }
  workbookSheetCache.set(id, {
    ...data,
    expiresAt: Date.now() + LIST_CACHE_TTL_MS,
  });
}

export function getDocumentControlFolderStructureCache(companyFolderId) {
  const entry = folderStructureCache.get(trim(companyFolderId));
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry;
}

export function setDocumentControlFolderStructureCache(companyFolderId, structure) {
  const id = trim(companyFolderId);
  if (!id || !structure) {
    return;
  }
  folderStructureCache.set(id, {
    ...structure,
    expiresAt: Date.now() + FOLDER_STRUCTURE_CACHE_TTL_MS,
  });
}

export function invalidateDocumentControlFolderCache(companyFolderId) {
  const id = trim(companyFolderId);
  if (!id) {
    folderStructureCache.clear();
    return;
  }
  folderStructureCache.delete(id);
}
