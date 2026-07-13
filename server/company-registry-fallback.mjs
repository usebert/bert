/**
 * Persistent fallback company registry when the main Companies sheet write fails.
 * Stored under BERT_SESSIONS_DIR (same root as google-oauth-token, audit-builder).
 */
import fs from "node:fs";
import path from "node:path";
import { COMPANY_REGISTRY_STATUS_LIVE } from "../shared/company-invite-permissions.mjs";

export const FALLBACK_REGISTRY_BASENAME = "company-registry-fallback.json";
export const FALLBACK_REGISTRY_WARNING =
  "Main registry unavailable. Company saved in fallback registry.";
export const FALLBACK_REGISTRY_DIAGNOSTIC_PREFIX =
  "Using fallback registry because main Companies registry write failed.";

function nowIso() {
  return new Date().toISOString();
}

export function resolveCompanyRegistryFallbackPath(sessionDir) {
  const root = String(sessionDir || "").trim();
  if (!root) {
    return "";
  }
  return path.join(root, FALLBACK_REGISTRY_BASENAME);
}

function ensureSessionDir(sessionDir) {
  const root = String(sessionDir || "").trim();
  if (!root) {
    return false;
  }
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return true;
}

function emptyStore() {
  return { version: 1, companies: {} };
}

export function readFallbackRegistryStore(sessionDir) {
  const filePath = resolveCompanyRegistryFallbackPath(sessionDir);
  if (!filePath) {
    return emptyStore();
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return emptyStore();
    }
    return {
      version: 1,
      companies: data.companies && typeof data.companies === "object" ? data.companies : {},
    };
  } catch {
    return emptyStore();
  }
}

export function writeFallbackRegistryStore(sessionDir, store) {
  if (!ensureSessionDir(sessionDir)) {
    return { synced: false, reason: "missing_session_dir" };
  }
  const filePath = resolveCompanyRegistryFallbackPath(sessionDir);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  return { synced: true, filePath };
}

export function normalizeFallbackRegistryRecord(record = {}) {
  const companyId = String(record.companyId || record.companyFolderId || "").trim();
  const companyFolderId = String(record.companyFolderId || record.rootFolderId || companyId).trim();
  const rootFolderId = String(record.rootFolderId || companyFolderId || companyId).trim();
  const masterSheetId = String(record.masterSheetId || record.workbookId || "").trim();
  const workbookId = String(record.workbookId || masterSheetId).trim();
  const companyName = String(record.companyName || "").trim();
  const status = String(record.status || record.Status || COMPANY_REGISTRY_STATUS_LIVE).trim() || COMPANY_REGISTRY_STATUS_LIVE;
  const liveAt = String(record.liveAt || "").trim();
  const updatedAt = String(record.updatedAt || liveAt || "").trim();
  const isLive =
    record.isLive === true ||
    String(record.isLive || "").trim().toLowerCase() === "true" ||
    status.toLowerCase() === "live";
  const active =
    record.active === true ||
    String(record.active || "").trim().toLowerCase() === "true" ||
    isLive;
  const lifecycleStatus = String(record.lifecycleStatus || (isLive ? "LIVE" : status)).trim() || (isLive ? "LIVE" : status);
  return {
    companyId,
    companyName,
    status,
    Status: status,
    lifecycleStatus,
    isLive,
    active,
    rootFolderId,
    companyFolderId,
    masterSheetId,
    workbookId,
    registryStatus: status,
    liveAt,
    updatedAt,
    registrySource: "fallback",
    fallbackRegistry: true,
  };
}

export function readFallbackRegistryMap(sessionDir) {
  const store = readFallbackRegistryStore(sessionDir);
  const map = new Map();
  for (const [key, raw] of Object.entries(store.companies || {})) {
    const normalized = normalizeFallbackRegistryRecord({ ...raw, companyId: raw?.companyId || key });
    const id = String(normalized.companyId || key).trim();
    if (!id) {
      continue;
    }
    map.set(id, normalized);
  }
  return map;
}

export function getFallbackRegistryRecord(sessionDir, companyId) {
  const id = String(companyId || "").trim();
  if (!id) {
    return null;
  }
  const map = readFallbackRegistryMap(sessionDir);
  if (map.has(id)) {
    return map.get(id) || null;
  }
  for (const record of map.values()) {
    if (record.rootFolderId === id || record.companyFolderId === id) {
      return record;
    }
  }
  return null;
}

/**
 * Persist status=Live in the fallback JSON registry.
 */
export function persistFallbackCompanyLive(sessionDir, input = {}) {
  const companyId = String(input.companyId || input.companyFolderId || input.rootFolderId || "").trim();
  const companyFolderId = String(input.companyFolderId || input.rootFolderId || companyId).trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const companyName = String(input.companyName || "").trim();
  if (!companyId || !companyFolderId || !masterSheetId) {
    return { synced: false, reason: "missing_required_fields", record: null };
  }
  if (!ensureSessionDir(sessionDir)) {
    return { synced: false, reason: "missing_session_dir", record: null };
  }

  const now = nowIso();
  const store = readFallbackRegistryStore(sessionDir);
  const record = {
    companyId,
    companyName,
    companyFolderId,
    rootFolderId: companyFolderId,
    masterSheetId,
    workbookId: masterSheetId,
    status: COMPANY_REGISTRY_STATUS_LIVE,
    Status: COMPANY_REGISTRY_STATUS_LIVE,
    lifecycleStatus: "LIVE",
    isLive: true,
    active: true,
    registryStatus: COMPANY_REGISTRY_STATUS_LIVE,
    liveAt: now,
    updatedAt: now,
  };
  store.companies[companyId] = record;
  const writeResult = writeFallbackRegistryStore(sessionDir, store);
  if (!writeResult.synced) {
    return { synced: false, reason: writeResult.reason || "write_failed", record: null };
  }

  const fresh = getFallbackRegistryRecord(sessionDir, companyId);
  return {
    synced: Boolean(fresh),
    filePath: writeResult.filePath,
    record: fresh,
  };
}

export function buildFallbackRegistryDiagnostic(technicalError = "") {
  const detail = String(technicalError || "").trim();
  return detail
    ? `${FALLBACK_REGISTRY_DIAGNOSTIC_PREFIX} ${detail}`
    : FALLBACK_REGISTRY_DIAGNOSTIC_PREFIX;
}
