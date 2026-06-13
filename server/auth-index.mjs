/**
 * Fast auth index — login reads this only; Users tab remains source of truth.
 * Rebuilt asynchronously on invite, user edit, users refresh, and godmode rebuild.
 */
import fs from "node:fs";
import { verifyPassword } from "./master-auth.mjs";
import { isKnownStaleAuthIndexPairing } from "../shared/auth-index-trust.mjs";
import { validateLiveCompanyContext } from "./company-context-service.mjs";
import {
  defaultAccessLevelForRole,
  isPasswordHash,
  normalizeUsersTabRowObject,
  parseCompanyAreas,
  parseRoleFromUsersSheet,
  normalizeUserStatus,
  readCompanyUsersTabRecord,
} from "./company-users.mjs";
import {
  isValidCompanyUserEmail,
  pickRowCompanyFolderId,
  pickRowCompanyId,
  pickRowCompanyName,
  rowMatchesCompanyContext,
} from "./users-tab-schema.mjs";
import { isCompanyRegistryLive } from "../shared/company-invite-permissions.mjs";

const DEFAULT_STALE_MS = Math.max(
  60_000,
  Number(process.env.AUTH_INDEX_STALE_MS || String(6 * 60 * 60 * 1000)),
);

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function safeIso(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return new Date().toISOString();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

function pickField(obj, ...keys) {
  if (!obj || typeof obj !== "object") {
    return "";
  }
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) {
      return String(obj[key]).trim();
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (keys.some((key) => String(k).trim().toLowerCase() === String(key).trim().toLowerCase()) && String(v || "").trim()) {
      return String(v).trim();
    }
  }
  return "";
}

export function createAuthIndexApi(indexPath) {
  function readStore() {
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { version: 1, byEmail: {}, rebuiltAt: null };
      }
      if (!parsed.byEmail || typeof parsed.byEmail !== "object") {
        parsed.byEmail = {};
      }
      return parsed;
    } catch {
      return { version: 1, byEmail: {}, rebuiltAt: null };
    }
  }

  function writeStore(store) {
    const dir = indexPath.replace(/[/\\][^/\\]+$/, "");
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(indexPath, JSON.stringify(store, null, 2), "utf8");
  }

  function lookupByEmail(email) {
    const key = normalizeEmail(email);
    if (!key) {
      return null;
    }
    const store = readStore();
    const entry = store.byEmail[key];
    if (!entry || typeof entry !== "object") {
      return null;
    }
    if (isKnownStaleAuthIndexPairing(key, entry.companyName)) {
      return null;
    }
    return { ...entry, email: key };
  }

  /**
   * Drive-validated lookup — removes index row when folder is missing or not under Live Companies.
   */
  async function lookupByEmailValidated(auth, deps, email) {
    const key = normalizeEmail(email);
    const entry = lookupByEmail(email);
    if (!auth || !key || !entry?.masterSheetId) {
      return entry;
    }
    const validation = await validateLiveCompanyContext(auth, deps, {
      masterSheetId: entry.masterSheetId,
      companyFolderId: entry.companyFolderId || entry.companyId,
      companyName: entry.companyName,
    }).catch(() => ({ companyContextValid: false }));
    if (!validation.companyContextValid) {
      removeEntry(key);
      return null;
    }
    return {
      ...entry,
      email: key,
      companyId: validation.companyFolderId || entry.companyId,
      companyFolderId: validation.companyFolderId || entry.companyFolderId,
      companyName: validation.companyName || entry.companyName,
      masterSheetId: validation.masterSheetId || entry.masterSheetId,
    };
  }

  function upsertEntry(entry) {
    const email = normalizeEmail(entry?.email);
    if (!email || !email.includes("@")) {
      return null;
    }
    const store = readStore();
    const next = {
      email,
      name: String(entry.name || email).trim() || email,
      role: String(entry.role || "User").trim() || "User",
      accessLevel: String(entry.accessLevel || "").trim(),
      companyId: String(entry.companyId || entry.companyFolderId || "").trim(),
      companyName: String(entry.companyName || "").trim(),
      companyFolderId: String(entry.companyFolderId || entry.companyId || "").trim(),
      masterSheetId: String(entry.masterSheetId || "").trim(),
      status: normalizeUserStatus(entry.status || "ACTIVE"),
      passwordHash: String(entry.passwordHash || "").trim(),
      updatedAt: safeIso(entry.updatedAt),
      companyAreas: Array.isArray(entry.companyAreas) ? entry.companyAreas : parseCompanyAreas(entry.companyAreas || ""),
      indexedAt: Date.now(),
    };
    store.byEmail[email] = next;
    writeStore(store);
    return next;
  }

  function removeEntry(email) {
    const key = normalizeEmail(email);
    if (!key) {
      return false;
    }
    const store = readStore();
    if (!store.byEmail[key]) {
      return false;
    }
    delete store.byEmail[key];
    writeStore(store);
    return true;
  }

  function isEntryStale(entry, maxAgeMs = DEFAULT_STALE_MS) {
    if (!entry) {
      return true;
    }
    const updatedAt = Date.parse(String(entry.updatedAt || ""));
    const indexedAt = Number(entry.indexedAt || 0);
    const now = Date.now();
    if (Number.isFinite(updatedAt) && now - updatedAt > maxAgeMs) {
      return true;
    }
    if (indexedAt > 0 && now - indexedAt > maxAgeMs) {
      return true;
    }
    return false;
  }

  function verifyPasswordForEntry(entry, plainPassword) {
    if (!entry?.passwordHash) {
      return false;
    }
    const stored = String(entry.passwordHash).trim();
    if (!stored) {
      return false;
    }
    if (isPasswordHash(stored)) {
      return verifyPassword(plainPassword, stored);
    }
    return String(stored) === String(plainPassword);
  }

  function entryFromUsersTabRow(row, meta = {}) {
    const email = normalizeEmail(row?.email);
    if (!email) {
      return null;
    }
    const rowFolderId = pickRowCompanyFolderId(row?.rowObject || row) || pickRowCompanyId(row?.rowObject || row);
    const companyFolderId = String(
      rowFolderId || row.companyFolderId || row.companyId || meta.companyFolderId || meta.companyId || "",
    ).trim();
    const companyName = String(pickRowCompanyName(row?.rowObject || row) || row.companyName || meta.companyName || "").trim();
    const roleRaw = String(row.roleRaw || row.role || "").trim();
    const role = parseRoleFromUsersSheet(roleRaw) || roleRaw || "User";
    return {
      email,
      name: String(row.name || email).trim() || email,
      role,
      accessLevel: String(row.accessLevel || defaultAccessLevelForRole(role)).trim(),
      companyId: companyFolderId,
      companyFolderId,
      companyName,
      masterSheetId: String(meta.masterSheetId || "").trim(),
      status: normalizeUserStatus(row.status || "ACTIVE"),
      passwordHash: String(row.passwordHash || "").trim(),
      updatedAt: safeIso(row.updatedAt || row.updatedAtVal),
      companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : parseCompanyAreas(row.companyAreasRaw || ""),
    };
  }

  function entrySortKey(entry, companyLive = false) {
    const liveScore = companyLive ? 1 : 0;
    const updatedAt = Date.parse(String(entry?.updatedAt || ""));
    const indexedAt = Number(entry?.indexedAt || 0);
    const timeScore = Number.isFinite(updatedAt) ? updatedAt : indexedAt;
    return { liveScore, timeScore };
  }

  function shouldPreferIncomingEntry(existing, incoming, existingLive, incomingLive) {
    const left = entrySortKey(existing, existingLive);
    const right = entrySortKey(incoming, incomingLive);
    if (right.liveScore !== left.liveScore) {
      return right.liveScore > left.liveScore;
    }
    return right.timeScore >= left.timeScore;
  }

  function logAuthIndexConflict(email, kept, dropped) {
    console.warn(
      `[auth-index] duplicate email=${email} kept=${kept?.companyName || kept?.masterSheetId || "?"} dropped=${dropped?.companyName || dropped?.masterSheetId || "?"}`,
    );
  }

  function upsertAuthIndexEntry(store, email, incoming, incomingLive, conflicts = null) {
    const key = normalizeEmail(email);
    const existing = store.byEmail[key];
    const { companyLive: _incomingLiveFlag, ...storedIncoming } = incoming;
    if (!existing) {
      store.byEmail[key] = storedIncoming;
      return { upserted: true, replaced: false };
    }
    const existingSheet = String(existing.masterSheetId || "").trim();
    const incomingSheet = String(storedIncoming.masterSheetId || "").trim();
    if (existingSheet === incomingSheet) {
      store.byEmail[key] = storedIncoming;
      return { upserted: true, replaced: false };
    }
    const existingLive = Boolean(existing.companyLive);
    if (shouldPreferIncomingEntry(existing, storedIncoming, existingLive, incomingLive)) {
      if (conflicts) {
        conflicts.push({
          email: key,
          kept: incoming.companyName || incoming.masterSheetId,
          dropped: existing.companyName || existing.masterSheetId,
        });
      }
      logAuthIndexConflict(key, storedIncoming, existing);
      store.byEmail[key] = storedIncoming;
      return { upserted: true, replaced: true };
    }
    if (conflicts) {
      conflicts.push({
        email: key,
        kept: existing.companyName || existing.masterSheetId,
        dropped: storedIncoming.companyName || storedIncoming.masterSheetId,
      });
    }
    logAuthIndexConflict(key, existing, storedIncoming);
    return { upserted: false, replaced: false };
  }

  async function rebuildCompanyAuthIndexFromSheet(auth, deps, companyContext = {}) {
    const masterSheetId = String(companyContext.masterSheetId || "").trim();
    const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
    const companyName = String(companyContext.companyName || "").trim();
    const companyLive =
      companyContext.companyLive === true ||
      (typeof companyContext.registryStatus === "string" &&
        isCompanyRegistryLive({ registryStatus: companyContext.registryStatus, status: companyContext.registryStatus }));
    if (!auth || !masterSheetId) {
      return { ok: false, reason: "missing_context", upserted: 0, removed: 0 };
    }

    const liveValidation = await validateLiveCompanyContext(auth, deps, {
      masterSheetId,
      companyFolderId,
      companyName,
    }).catch(() => ({ companyContextValid: false }));
    if (!liveValidation.companyContextValid) {
      const cleared = clearCompanyAuthIndexEntries({ companyFolderId, masterSheetId });
      return {
        ok: false,
        reason: liveValidation.reasonCode || "company_not_live",
        upserted: 0,
        removed: cleared.authIndexEntriesRemoved || 0,
      };
    }
    const resolvedFolderId = String(liveValidation.companyFolderId || companyFolderId).trim();
    const resolvedCompanyName = String(liveValidation.companyName || companyName).trim();
    const resolvedMasterSheetId = String(liveValidation.masterSheetId || masterSheetId).trim();

    const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
    if (typeof userDeps.migrateUsersTabColumns === "function") {
      await userDeps
        .migrateUsersTabColumns(auth, masterSheetId, userDeps, {
          companyContext: { companyFolderId, companyId: companyFolderId, companyName },
        })
        .catch(() => null);
    }

    const { getTabValues } = userDeps;
    const tabTitle =
      userDeps.usersTabTitle ||
      (typeof userDeps.resolveUsersTab === "function"
        ? String((await userDeps.resolveUsersTab(auth, masterSheetId, userDeps, { createIfMissing: false }))?.tabTitle || "Users").trim()
        : "Users");

    const rows = await getTabValues(auth, masterSheetId, tabTitle).catch(() => []);
    if (!rows.length) {
      return { ok: true, upserted: 0, removed: 0, masterSheetId, companyFolderId };
    }

    const headers = rows[0].map((cell) => String(cell || "").trim());
    const store = readStore();
    const seenEmails = new Set();
    const conflicts = [];
    let upserted = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = String(rows[i][idx] || "").trim();
      });
      const obj = normalizeUsersTabRowObject(rowObj);
      const email = normalizeEmail(pickField(obj, "Email", "email"));
      if (!isValidCompanyUserEmail(email)) {
        continue;
      }
      const roleRaw = pickField(obj, "Role", "role");
      const fullName = pickField(obj, "Name", "name", "Full Name", "Full name") || email;
      const status = normalizeUserStatus(pickField(obj, "Status", "status"));
      if (status !== "ACTIVE") {
        continue;
      }
      if (!rowMatchesCompanyContext(obj, { companyFolderId: resolvedFolderId, companyId: resolvedFolderId })) {
        continue;
      }
      const accessLevel =
        pickField(obj, "AccessLevel", "Access Level", "accessLevel") ||
        defaultAccessLevelForRole(parseRoleFromUsersSheet(roleRaw));
      const companyAreasRaw = pickField(obj, "CompanyAreas", "Company Areas", "companyAreas");
      const updatedAtVal = pickField(obj, "UpdatedAt");
      const passwordHash =
        String(updatedAtVal).startsWith("scrypt$") || isPasswordHash(updatedAtVal)
          ? updatedAtVal
          : pickField(obj, "PasswordHash", "passwordHash");
      const match = {
        email,
        roleRaw,
        role: parseRoleFromUsersSheet(roleRaw) || roleRaw || "User",
        name: fullName,
        companyId: pickRowCompanyId(obj) || pickField(obj, "Company ID", "CompanyId", "companyId"),
        companyFolderId: pickRowCompanyFolderId(obj) || resolvedFolderId,
        companyName: pickRowCompanyName(obj),
        status,
        accessLevel,
        companyAreasRaw,
        companyAreas: parseCompanyAreas(companyAreasRaw),
        passwordHash,
        updatedAt: pickField(obj, "UpdatedAt", "Updated At"),
        rowObject: obj,
      };
      const entry = entryFromUsersTabRow(match, {
        companyFolderId: match.companyFolderId || resolvedFolderId,
        companyName: match.companyName || resolvedCompanyName,
        masterSheetId: resolvedMasterSheetId,
      });
      if (!entry?.passwordHash) {
        continue;
      }
      if (isKnownStaleAuthIndexPairing(email, entry.companyName)) {
        continue;
      }
      const indexedEntry = { ...entry, indexedAt: Date.now(), companyLive };
      const outcome = upsertAuthIndexEntry(store, email, indexedEntry, companyLive, conflicts);
      if (outcome.upserted) {
        upserted += 1;
      }
      seenEmails.add(email);
    }

    let removed = 0;
    for (const [email, entry] of Object.entries(store.byEmail)) {
      const entrySheet = String(entry.masterSheetId || "").trim();
      const entryFolder = String(entry.companyFolderId || entry.companyId || "").trim();
      const sameCompany =
        (entrySheet && entrySheet === masterSheetId) ||
        (entryFolder && companyFolderId && entryFolder === companyFolderId);
      if (sameCompany && !seenEmails.has(normalizeEmail(email))) {
        delete store.byEmail[email];
        removed += 1;
      }
    }

    store.rebuiltAt = Date.now();
    if (conflicts.length) {
      store.lastConflicts = conflicts.slice(-20);
    }
    writeStore(store);
    return { ok: true, upserted, removed, masterSheetId, companyFolderId, activeEmails: [...seenEmails], conflicts };
  }

  /**
   * Full rebuild — one truth per email; Live Companies win duplicate conflicts.
   */
  async function rebuildAuthIndex(auth, deps, options = {}) {
    const readRegistry =
      typeof deps.readCanonicalCompanyWorkspaceRegistryMap === "function"
        ? deps.readCanonicalCompanyWorkspaceRegistryMap
        : null;
    if (!auth || !readRegistry) {
      return { ok: false, reason: "missing_context", upserted: 0, companies: 0, conflicts: [] };
    }

    const registryResult = await readRegistry(auth, deps).catch(() => ({ map: new Map() }));
    const companiesMap = registryResult?.map instanceof Map ? registryResult.map : new Map();
    const companies = [...companiesMap.values()].filter((record) => String(record?.masterSheetId || "").trim());
    companies.sort((a, b) => {
      const aLive = isCompanyRegistryLive(a) ? 1 : 0;
      const bLive = isCompanyRegistryLive(b) ? 1 : 0;
      return aLive - bLive;
    });

    const store = readStore();
    store.byEmail = {};
    store.rebuiltAt = Date.now();
    writeStore(store);
    const conflicts = [];
    let upserted = 0;
    let companiesProcessed = 0;

    for (const record of companies) {
      const masterSheetId = String(record?.masterSheetId || "").trim();
      const companyFolderId = String(record?.companyFolderId || record?.companyId || "").trim();
      const companyName = String(record?.companyName || "").trim();
      const liveValidation = await validateLiveCompanyContext(auth, deps, {
        masterSheetId,
        companyFolderId,
        companyName,
      }).catch(() => ({ companyContextValid: false }));
      if (!liveValidation.companyContextValid) {
        continue;
      }
      const rebuilt = await rebuildCompanyAuthIndexFromSheet(auth, deps, {
        masterSheetId: String(liveValidation.masterSheetId || masterSheetId).trim(),
        companyFolderId: String(liveValidation.companyFolderId || companyFolderId).trim(),
        companyName: String(liveValidation.companyName || companyName).trim(),
        companyLive: isCompanyRegistryLive(record),
        registryStatus: record?.registryStatus || record?.status,
      }).catch(() => null);
      if (!rebuilt?.ok) {
        continue;
      }
      companiesProcessed += 1;
      upserted += Number(rebuilt.upserted || 0);
      if (Array.isArray(rebuilt.conflicts)) {
        conflicts.push(...rebuilt.conflicts);
      }
    }

    const mergedStore = readStore();
    mergedStore.rebuiltAt = Date.now();
    if (conflicts.length) {
      mergedStore.lastConflicts = conflicts.slice(-50);
    }
    writeStore(mergedStore);

    const liveMasterSheetIds = new Set(
      companies.map((record) => String(record?.masterSheetId || "").trim()).filter(Boolean),
    );
    const pruned =
      options.pruneInvalid === false
        ? { authIndexEntriesRemoved: 0 }
        : await pruneStaleAuthIndexEntries(auth, deps, { liveMasterSheetIds }).catch(() => ({
            authIndexEntriesRemoved: 0,
          }));

    return {
      ok: true,
      upserted,
      companies: companiesProcessed,
      conflicts,
      authIndexEntriesRemoved: pruned.authIndexEntriesRemoved || 0,
    };
  }

  async function verifyAuthIndexEntryFromSheet(auth, deps, email, companyContext = {}) {
    const key = normalizeEmail(email);
    const cached = lookupByEmail(key);
    if (!auth || !key || !cached?.masterSheetId) {
      return { ok: false, reason: "missing_context", expired: false };
    }
    const masterSheetId = String(companyContext.masterSheetId || cached.masterSheetId).trim();
    await rebuildCompanyAuthIndexFromSheet(auth, deps, {
      masterSheetId,
      companyFolderId: String(companyContext.companyFolderId || cached.companyFolderId || cached.companyId || "").trim(),
      companyName: String(companyContext.companyName || cached.companyName || "").trim(),
    }).catch(() => null);
    const refreshed = lookupByEmail(key);
    if (!refreshed || normalizeUserStatus(refreshed.status) !== "ACTIVE" || !refreshed.passwordHash) {
      removeEntry(key);
      return { ok: true, expired: true, reason: refreshed ? "inactive" : "removed" };
    }
    return { ok: true, expired: false, entry: refreshed };
  }

  function readAllEntries() {
    const store = readStore();
    return Object.values(store.byEmail || {});
  }

  function clearCompanyAuthIndexEntries({ companyFolderId = "", masterSheetId = "" } = {}) {
    const folderId = String(companyFolderId || "").trim();
    const sheetId = String(masterSheetId || "").trim();
    if (!folderId && !sheetId) {
      return { authIndexEntriesRemoved: 0, removedEmails: [] };
    }
    const store = readStore();
    const removedEmails = [];
    for (const [email, entry] of Object.entries(store.byEmail || {})) {
      const entrySheet = String(entry?.masterSheetId || "").trim();
      const entryFolder = String(entry?.companyFolderId || entry?.companyId || "").trim();
      const sameCompany =
        (sheetId && entrySheet === sheetId) || (folderId && entryFolder && entryFolder === folderId);
      if (sameCompany) {
        delete store.byEmail[email];
        removedEmails.push(normalizeEmail(email));
      }
    }
    store.rebuiltAt = Date.now();
    writeStore(store);
    return { authIndexEntriesRemoved: removedEmails.length, removedEmails };
  }

  function clearAllCompanyAuthIndexEntries() {
    const store = readStore();
    const removedEmails = Object.keys(store.byEmail || {}).map(normalizeEmail).filter(Boolean);
    store.byEmail = {};
    store.rebuiltAt = Date.now();
    writeStore(store);
    return { authIndexEntriesRemoved: removedEmails.length, removedEmails };
  }

  /**
   * Ensure auth index row matches an ACTIVE Users tab row in its workbook and live Drive context.
   * Never trust index companyName/folderId when the workbook resolves differently.
   */
  async function verifyAuthIndexEntryMatchesUsersWorkbook(auth, deps, email, entry = {}) {
    const key = normalizeEmail(email);
    const masterSheetId = String(entry.masterSheetId || "").trim();
    if (!auth || !key || !masterSheetId) {
      return { ok: false, reason: "missing_context" };
    }
    if (isKnownStaleAuthIndexPairing(key, entry.companyName)) {
      return { ok: false, reason: "known_stale_pairing", removeEntry: true };
    }

    const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
    const rec = await readCompanyUsersTabRecord(auth, masterSheetId, key, userDeps).catch(() => null);
    if (!rec || normalizeUserStatus(rec.status) !== "ACTIVE") {
      return { ok: false, reason: "user_not_in_workbook", removeEntry: true };
    }

    const validation = await validateLiveCompanyContext(auth, deps, {
      masterSheetId,
      companyFolderId: entry.companyFolderId || entry.companyId,
      companyName: entry.companyName,
    }).catch(() => ({ companyContextValid: false }));

    if (!validation.companyContextValid) {
      return {
        ok: false,
        reason: validation.reasonCode || "company_invalid",
        removeEntry: true,
        validation,
      };
    }

    if (isKnownStaleAuthIndexPairing(key, validation.companyName)) {
      return { ok: false, reason: "known_stale_pairing", removeEntry: true, validation };
    }

    const indexFolder = String(entry.companyFolderId || entry.companyId || "").trim();
    if (indexFolder && indexFolder !== validation.companyFolderId) {
      return { ok: false, reason: "index_folder_mismatch", removeEntry: true, validation };
    }

    return { ok: true, validation, rec };
  }

  /**
   * Drop index rows whose company folder or workbook no longer resolves in Drive.
   * Never use stale index companyName/folderId as login context when invalid.
   */
  async function invalidateAuthIndexEntryIfCompanyMissing(auth, deps, email) {
    const key = normalizeEmail(email);
    const entry = lookupByEmail(key);
    if (!auth || !key || !entry?.masterSheetId) {
      return { ok: false, removed: false, reason: "missing_context" };
    }
    const validation = await validateLiveCompanyContext(auth, deps, {
      masterSheetId: entry.masterSheetId,
      companyFolderId: entry.companyFolderId || entry.companyId,
      companyName: entry.companyName,
    }).catch(() => ({ companyContextValid: false }));
    if (validation.companyContextValid) {
      return { ok: true, removed: false, entry, validation };
    }
    removeEntry(key);
    return { ok: true, removed: true, reason: validation.reasonCode || "company_missing", validation };
  }

  /** Startup/rebuild hook — drop ghost rows whose folders are not under Live Companies. */
  async function pruneAuthIndexGhostEntries(auth, deps, options = {}) {
    return pruneStaleAuthIndexEntries(auth, deps, options);
  }

  /** Remove auth-index rows for deleted/non-live companies and stale Drive contexts. */
  async function pruneStaleAuthIndexEntries(auth, deps, { liveMasterSheetIds = null } = {}) {
    if (!auth) {
      return { authIndexEntriesRemoved: 0, removedEmails: [] };
    }
    const liveSheetSet = liveMasterSheetIds instanceof Set ? liveMasterSheetIds : null;
    const removedEmails = [];

    let store = readStore();
    for (const [email, entry] of Object.entries(store.byEmail || {})) {
      if (isKnownStaleAuthIndexPairing(email, entry?.companyName)) {
        delete store.byEmail[email];
        removedEmails.push(normalizeEmail(email));
      }
    }
    if (removedEmails.length) {
      store.rebuiltAt = Date.now();
      writeStore(store);
    }

    if (liveSheetSet) {
      store = readStore();
      for (const [email, entry] of Object.entries(store.byEmail || {})) {
        const entrySheet = String(entry?.masterSheetId || "").trim();
        if (entrySheet && !liveSheetSet.has(entrySheet)) {
          delete store.byEmail[email];
          removedEmails.push(normalizeEmail(email));
        }
      }
      store.rebuiltAt = Date.now();
      writeStore(store);
    }

    for (const email of Object.keys(readStore().byEmail || {})) {
      const invalidated = await invalidateAuthIndexEntryIfCompanyMissing(auth, deps, email);
      if (invalidated.removed) {
        removedEmails.push(normalizeEmail(email));
      }
    }
    return { authIndexEntriesRemoved: removedEmails.length, removedEmails: [...new Set(removedEmails)] };
  }

  return {
    lookupByEmail,
    lookupByEmailValidated,
    upsertEntry,
    removeEntry,
    isEntryStale,
    verifyPasswordForEntry,
    entryFromUsersTabRow,
    rebuildCompanyAuthIndexFromSheet,
    rebuildAuthIndex,
    verifyAuthIndexEntryFromSheet,
    verifyAuthIndexEntryMatchesUsersWorkbook,
    invalidateAuthIndexEntryIfCompanyMissing,
    invalidateAuthIndexEntry: invalidateAuthIndexEntryIfCompanyMissing,
    pruneStaleAuthIndexEntries,
    pruneAuthIndexGhostEntries,
    readAllEntries,
    clearCompanyAuthIndexEntries,
    removeAuthIndexEntriesForCompany: clearCompanyAuthIndexEntries,
    clearAllCompanyAuthIndexEntries,
    readStore,
    DEFAULT_STALE_MS,
  };
}

export async function syncAuthIndexAfterUsersRead(auth, deps, companyContext = {}) {
  const api = deps.authIndex;
  if (!api || typeof api.rebuildCompanyAuthIndexFromSheet !== "function") {
    return { ok: false, skipped: true };
  }
  return api.rebuildCompanyAuthIndexFromSheet(auth, deps, companyContext);
}
