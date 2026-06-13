/**
 * Server-side company user cache — loading optimisation only; Users tab is source of truth.
 */
import fs from "node:fs";

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function createCompanyUsersCacheApi(cachePath) {
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

  function getEntry(companyFolderId) {
    const id = String(companyFolderId || "").trim();
    if (!id) {
      return null;
    }
    const store = readStore();
    const entry = store[id];
    if (!entry || !Array.isArray(entry.users)) {
      return null;
    }
    return entry;
  }

  function isUserInCache(companyFolderId, email) {
    const entry = getEntry(companyFolderId);
    if (!entry) {
      return false;
    }
    const target = normalizeEmail(email);
    return entry.users.some((row) => normalizeEmail(row.email) === target);
  }

  function findCompanyFolderIdByMasterSheet(masterSheetId) {
    const sheetId = String(masterSheetId || "").trim();
    if (!sheetId) {
      return "";
    }
    const store = readStore();
    for (const [folderId, entry] of Object.entries(store)) {
      if (String(entry?.masterSheetId || "").trim() === sheetId) {
        return folderId;
      }
    }
    return "";
  }

  function isUserInCacheByMasterSheet(masterSheetId, email) {
    const folderId = findCompanyFolderIdByMasterSheet(masterSheetId);
    if (!folderId) {
      return false;
    }
    return isUserInCache(folderId, email);
  }

  /**
   * Replace cache with sheet ACTIVE users; remove cache-only emails.
   */
  function rebuildCompanyUsersCache(companyFolderId, activeUsers, meta = {}) {
    const id = String(companyFolderId || "").trim();
    const users = Array.isArray(activeUsers) ? activeUsers : [];
    const store = readStore();
    const previous = store[id];
    const prevEmails = new Set(
      (previous?.users || []).map((row) => normalizeEmail(row.email)).filter(Boolean),
    );
    const nextEmails = new Set(users.map((row) => normalizeEmail(row.email)).filter(Boolean));
    const cacheOnlyEmails = [...prevEmails].filter((email) => !nextEmails.has(email));

    store[id] = {
      companyFolderId: id,
      masterSheetId: String(meta.masterSheetId || previous?.masterSheetId || "").trim() || undefined,
      users,
      rebuiltAt: Date.now(),
    };
    writeStore(store);

    return {
      cacheUsersBefore: prevEmails.size,
      cacheOnlyUsersRemoved: cacheOnlyEmails.length,
      cacheOnlyEmails,
      activeSheetUsers: users.length,
      keptEmails: [...nextEmails],
    };
  }

  function clearCompanyUsersCache(companyFolderId) {
    const id = String(companyFolderId || "").trim();
    if (!id) {
      return { cacheEntriesRemoved: 0 };
    }
    const store = readStore();
    const previous = store[id];
    const cacheEntriesRemoved = Array.isArray(previous?.users) ? previous.users.length : previous ? 1 : 0;
    if (previous) {
      delete store[id];
      writeStore(store);
    }
    return { cacheEntriesRemoved };
  }

  function clearAllCompanyUsersCache() {
    const store = readStore();
    let cacheEntriesRemoved = 0;
    for (const entry of Object.values(store)) {
      if (Array.isArray(entry?.users)) {
        cacheEntriesRemoved += entry.users.length;
      } else if (entry) {
        cacheEntriesRemoved += 1;
      }
    }
    writeStore({});
    return { cacheEntriesRemoved, companiesCleared: Object.keys(store).length };
  }

  return {
    getEntry,
    isUserInCache,
    isUserInCacheByMasterSheet,
    findCompanyFolderIdByMasterSheet,
    rebuildCompanyUsersCache,
    clearCompanyUsersCache,
    clearAllCompanyUsersCache,
    readStore,
  };
}
