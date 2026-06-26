/**
 * Durable pending check-completion queue — saved before HTTP response; Google sync in background.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { syncPendingCompletionToWorkbook } from "./completion-service.mjs";

export const PENDING_SYNC_STATUSES = {
  PENDING: "pending",
  SYNCING: "syncing",
  SYNCED: "synced",
  FAILED: "failed",
};

const PROCESS_INTERVAL_MS = 2_000;
const MAX_SYNC_ATTEMPTS = 5;
const INITIAL_RETRY_MS = 5_000;

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function safeErrorSummary(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || error || "").trim();
  if (code === "GOOGLE_TIMEOUT") {
    return "workbook_sync_timeout";
  }
  if (message.toLowerCase().includes("not connected")) {
    return "google_not_connected";
  }
  if (message.length > 120) {
    return message.slice(0, 117) + "...";
  }
  return message || "workbook_sync_failed";
}

function computeNextRetryAt(retryCount) {
  const delayMs = INITIAL_RETRY_MS * Math.pow(2, Math.max(0, retryCount - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

function isRetryableSyncError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    code === "GOOGLE_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("rate limit") ||
    message.includes("quota")
  );
}

export function createPendingCompletionQueue(sessionDir, deps = {}) {
  const storePath = path.join(sessionDir, "pending-completions.json");
  let processorTimer = null;
  let processing = false;

  function readStore() {
    const store = readJsonFile(storePath, { entries: {} });
    if (!store.entries || typeof store.entries !== "object") {
      store.entries = {};
    }
    return store;
  }

  function writeStore(store) {
    writeJsonFile(storePath, store);
  }

  function publicEntry(entry) {
    if (!entry) {
      return null;
    }
    return {
      resultId: entry.resultId,
      companyFolderId: entry.companyFolderId,
      scheduleId: entry.scheduleId,
      submittedBy: entry.submittedBy,
      submittedAt: entry.submittedAt,
      syncStatus: entry.syncStatus,
      retryCount: entry.retryCount,
      lastError: entry.lastError,
      updatedAt: entry.updatedAt,
      syncedAt: entry.syncedAt,
    };
  }

  function getEntry(resultId) {
    const store = readStore();
    return publicEntry(store.entries[String(resultId || "").trim()]);
  }

  function listEntries(filters = {}) {
    const store = readStore();
    const companyFolderId = String(filters.companyFolderId || "").trim();
    const syncStatus = String(filters.syncStatus || "").trim();
    const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 200;

    let entries = Object.values(store.entries);
    if (companyFolderId) {
      entries = entries.filter((entry) => String(entry.companyFolderId || "").trim() === companyFolderId);
    }
    if (syncStatus) {
      entries = entries.filter((entry) => entry.syncStatus === syncStatus);
    }
    entries.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return entries.slice(0, limit).map(publicEntry);
  }

  function enqueuePendingCompletion(input = {}) {
    const resultId = String(input.resultId || "").trim() || `result-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
    const scheduleId = String(input.scheduleId || "").trim();
    const submittedBy = String(input.submittedBy || input.completedByEmail || input.email || "").trim().toLowerCase();
    const submittedAt = String(input.submittedAt || input.completedAt || nowIso()).trim() || nowIso();

    if (!companyFolderId || !scheduleId || !submittedBy) {
      throw new Error("Pending completion requires companyFolderId, scheduleId, and submittedBy.");
    }

    const store = readStore();
    const timestamp = nowIso();
    const entry = {
      resultId,
      companyFolderId,
      scheduleId,
      submittedBy,
      submittedAt,
      syncStatus: PENDING_SYNC_STATUSES.PENDING,
      retryCount: 0,
      lastError: "",
      masterSheetId: String(input.masterSheetId || "").trim(),
      auditResultRow:
        input.auditResultRow && typeof input.auditResultRow === "object"
          ? input.auditResultRow
          : input.row && typeof input.row === "object"
            ? input.row
            : null,
      updatedAt: timestamp,
      syncedAt: null,
      nextRetryAt: null,
    };
    store.entries[resultId] = entry;
    writeStore(store);
    return publicEntry(entry);
  }

  function updateEntry(resultId, patch = {}) {
    const store = readStore();
    const existing = store.entries[String(resultId || "").trim()];
    if (!existing) {
      return null;
    }
    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    store.entries[existing.resultId] = next;
    writeStore(store);
    return next;
  }

  async function syncEntryToWorkbook(entry) {
    const auth = deps.getAuthedClient?.();
    if (!auth) {
      throw Object.assign(new Error("Google Workspace is not connected."), { code: "GOOGLE_NOT_CONNECTED" });
    }

    const outcome = await syncPendingCompletionToWorkbook(auth, deps, {
      masterSheetId: entry.masterSheetId,
      row: entry.auditResultRow,
    });
    if (!outcome.ok) {
      const error = new Error(outcome.error || outcome.message || "workbook_sync_failed");
      if (outcome.reasonCode === "GOOGLE_TIMEOUT" || outcome.code === "CHECK_SUBMIT_TIMEOUT") {
        error.code = "GOOGLE_TIMEOUT";
      }
      throw error;
    }
    return outcome;
  }

  async function syncPendingCompletionById(resultId) {
    const id = String(resultId || "").trim();
    if (!id) {
      return { ok: false, lastError: "result_id_required", retryable: false };
    }
    const store = readStore();
    const entry = store.entries[id];
    if (!entry) {
      return { ok: false, lastError: "pending_entry_not_found", retryable: false };
    }
    if (entry.syncStatus === PENDING_SYNC_STATUSES.SYNCED) {
      return { ok: true, resultId: id, alreadySynced: true };
    }

    updateEntry(id, {
      syncStatus: PENDING_SYNC_STATUSES.SYNCING,
      retryCount: Number(entry.retryCount || 0) + 1,
    });

    try {
      await syncEntryToWorkbook(entry);
      updateEntry(id, {
        syncStatus: PENDING_SYNC_STATUSES.SYNCED,
        lastError: "",
        syncedAt: nowIso(),
        nextRetryAt: null,
      });
      console.info("[pending-completion]", {
        phase: "synced",
        resultId: id,
        companyId: entry.companyFolderId,
        scheduleId: entry.scheduleId,
      });
      return { ok: true, resultId: id };
    } catch (error) {
      const retryCount = Number(entry.retryCount || 0) + 1;
      const lastError = safeErrorSummary(error);
      const retryable = isRetryableSyncError(error) && retryCount < MAX_SYNC_ATTEMPTS;
      if (retryable) {
        updateEntry(id, {
          syncStatus: PENDING_SYNC_STATUSES.PENDING,
          lastError,
          retryCount,
          nextRetryAt: computeNextRetryAt(retryCount),
        });
        return { ok: false, lastError, retryable: true };
      }
      updateEntry(id, {
        syncStatus: PENDING_SYNC_STATUSES.FAILED,
        lastError,
        retryCount,
        nextRetryAt: null,
      });
      return { ok: false, lastError, retryable: false };
    }
  }

  async function processNextPending() {
    if (processing) {
      return;
    }
    processing = true;
    try {
      const store = readStore();
      const now = Date.now();
      const candidates = Object.values(store.entries)
        .filter(
          (entry) =>
            entry.syncStatus === PENDING_SYNC_STATUSES.PENDING ||
            entry.syncStatus === PENDING_SYNC_STATUSES.FAILED,
        )
        .filter((entry) => {
          if (!entry.nextRetryAt) {
            return true;
          }
          const retryAt = Date.parse(entry.nextRetryAt);
          return !Number.isFinite(retryAt) || retryAt <= now;
        })
        .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));

      const entry = candidates[0];
      if (!entry) {
        return;
      }

      await syncPendingCompletionById(entry.resultId);
    } finally {
      processing = false;
    }
  }

  function startProcessor() {
    if (processorTimer) {
      return;
    }
    processorTimer = setInterval(() => {
      void processNextPending();
    }, PROCESS_INTERVAL_MS);
    if (typeof processorTimer.unref === "function") {
      processorTimer.unref();
    }
    void processNextPending();
  }

  function stopProcessor() {
    if (processorTimer) {
      clearInterval(processorTimer);
      processorTimer = null;
    }
  }

  function installRoutes(app, routeDeps = {}) {
    const requireMasterOnlyActor = routeDeps.requireMasterOnlyActor;
    if (typeof requireMasterOnlyActor !== "function") {
      return;
    }

    app.get("/api/godmode/pending-completions", requireMasterOnlyActor, (req, res) => {
      const companyFolderId = String(req.query?.companyFolderId || req.query?.companyId || "").trim();
      const syncStatus = String(req.query?.syncStatus || "").trim();
      const entries = listEntries({ companyFolderId, syncStatus });
      return res.json({ ok: true, entries });
    });
  }

  return {
    enqueuePendingCompletion,
    getEntry,
    listEntries,
    updateEntry,
    processNextPending,
    syncPendingCompletionById,
    startProcessor,
    stopProcessor,
    installRoutes,
  };
}
