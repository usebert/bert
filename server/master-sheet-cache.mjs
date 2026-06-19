/**
 * Resolved masterSheetId cache per companyFolderId — skips slow Drive folder discovery on repeat reads.
 * File-backed with in-memory layer; 24h TTL by default.
 */
import fs from "node:fs";

const DEFAULT_TTL_MS = Math.max(
  60_000,
  Number(process.env.MASTER_SHEET_CACHE_TTL_MS || String(24 * 60 * 60 * 1000)),
);

function trim(value) {
  return String(value ?? "").trim();
}

export function createMasterSheetCacheApi(cachePath, options = {}) {
  const ttlMs = Number(options.ttlMs) || DEFAULT_TTL_MS;
  const memory = new Map();

  function readStore() {
    try {
      const raw = fs.readFileSync(cachePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeStore(store) {
    const dir = cachePath.replace(/[/\\][^/\\]+$/, "");
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(store, null, 2), "utf8");
  }

  function isFresh(entry) {
    if (!entry || !trim(entry.masterSheetId)) {
      return false;
    }
    const cachedAt = Number(entry.cachedAt || 0);
    if (!Number.isFinite(cachedAt) || cachedAt <= 0) {
      return false;
    }
    return Date.now() - cachedAt < ttlMs;
  }

  function getEntry(companyFolderId) {
    const id = trim(companyFolderId);
    if (!id) {
      return null;
    }
    const cached = memory.get(id);
    if (cached && isFresh(cached)) {
      return cached;
    }
    const store = readStore();
    const entry = store[id];
    if (!entry || !isFresh(entry)) {
      memory.delete(id);
      return null;
    }
    memory.set(id, entry);
    return entry;
  }

  function setEntry(companyFolderId, masterSheetId, meta = {}) {
    const folderId = trim(companyFolderId);
    const sheetId = trim(masterSheetId);
    if (!folderId || !sheetId) {
      return null;
    }
    const entry = {
      companyFolderId: folderId,
      masterSheetId: sheetId,
      companyName: trim(meta.companyName) || undefined,
      source: trim(meta.source) || undefined,
      cachedAt: Date.now(),
    };
    memory.set(folderId, entry);
    const store = readStore();
    store[folderId] = entry;
    writeStore(store);
    return entry;
  }

  function clearEntry(companyFolderId) {
    const id = trim(companyFolderId);
    if (!id) {
      return;
    }
    memory.delete(id);
    const store = readStore();
    if (store[id]) {
      delete store[id];
      writeStore(store);
    }
  }

  return {
    ttlMs,
    getEntry,
    setEntry,
    clearEntry,
    isFresh,
  };
}
