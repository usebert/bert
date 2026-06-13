/**
 * Fast auth index — login reads this only; Users tab remains source of truth.
 * Rebuilt asynchronously on invite, user edit, users refresh, and godmode rebuild.
 */
import fs from "node:fs";
import { verifyPassword } from "./master-auth.mjs";
import {
  defaultAccessLevelForRole,
  isPasswordHash,
  normalizeUsersTabRowObject,
  parseCompanyAreas,
  parseRoleFromUsersSheet,
  normalizeUserStatus,
} from "./company-users.mjs";
import { rowEmailCandidates } from "./users-tab-schema.mjs";

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
    return { ...entry, email: key };
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
    const companyFolderId = String(meta.companyFolderId || row.companyId || meta.companyId || "").trim();
    const roleRaw = String(row.roleRaw || row.role || "").trim();
    const role = parseRoleFromUsersSheet(roleRaw) || roleRaw || "User";
    return {
      email,
      name: String(row.name || email).trim() || email,
      role,
      accessLevel: String(row.accessLevel || defaultAccessLevelForRole(role)).trim(),
      companyId: companyFolderId,
      companyFolderId,
      companyName: String(meta.companyName || "").trim(),
      masterSheetId: String(meta.masterSheetId || "").trim(),
      status: normalizeUserStatus(row.status || "ACTIVE"),
      passwordHash: String(row.passwordHash || "").trim(),
      updatedAt: safeIso(row.updatedAt || row.updatedAtVal),
      companyAreas: Array.isArray(row.companyAreas) ? row.companyAreas : parseCompanyAreas(row.companyAreasRaw || ""),
    };
  }

  async function rebuildCompanyAuthIndexFromSheet(auth, deps, companyContext = {}) {
    const masterSheetId = String(companyContext.masterSheetId || "").trim();
    const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
    const companyName = String(companyContext.companyName || "").trim();
    if (!auth || !masterSheetId) {
      return { ok: false, reason: "missing_context", upserted: 0, removed: 0 };
    }

    const userDeps = typeof deps.getCompanyUsersDeps === "function" ? deps.getCompanyUsersDeps() : deps;
    if (typeof userDeps.migrateUsersTabColumns === "function") {
      await userDeps.migrateUsersTabColumns(auth, masterSheetId, userDeps).catch(() => null);
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
    let upserted = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = String(rows[i][idx] || "").trim();
      });
      const obj = normalizeUsersTabRowObject(rowObj);
      const candidates = rowEmailCandidates(rowObj);
      const email = normalizeEmail(pickField(obj, "Email", "email") || candidates[0] || "");
      if (!email) {
        continue;
      }
      const roleRaw = pickField(obj, "Role", "role");
      const fullName = pickField(obj, "Name", "name", "Full Name", "Full name") || email;
      const status = normalizeUserStatus(pickField(obj, "Status", "status"));
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
        companyId: pickField(obj, "Company ID", "CompanyId", "companyId"),
        status,
        accessLevel,
        companyAreasRaw,
        companyAreas: parseCompanyAreas(companyAreasRaw),
        passwordHash,
        updatedAt: pickField(obj, "UpdatedAt", "Updated At"),
      };
      const entry = entryFromUsersTabRow(match, { companyFolderId, companyName, masterSheetId });
      if (!entry?.passwordHash) {
        continue;
      }
      store.byEmail[email] = {
        ...entry,
        indexedAt: Date.now(),
      };
      seenEmails.add(email);
      upserted += 1;
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
    writeStore(store);
    return { ok: true, upserted, removed, masterSheetId, companyFolderId, activeEmails: [...seenEmails] };
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

  return {
    lookupByEmail,
    upsertEntry,
    removeEntry,
    isEntryStale,
    verifyPasswordForEntry,
    entryFromUsersTabRow,
    rebuildCompanyAuthIndexFromSheet,
    verifyAuthIndexEntryFromSheet,
    readAllEntries,
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
