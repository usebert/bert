/**
 * In-memory simulator for the SPA offline stores (IndexedDB + localStorage schema).
 * Used by unit tests — mirrors bert-tablet-offline-v1 and bert-workspace-state shapes.
 */
import {
  buildVerificationOfflineDraft,
  buildVerificationOfflineSubmission,
  isVerificationOfflineDraft,
  isVerificationOfflineQueueItem,
  PRODUCTION_OFFLINE_DRAFT_MARKER,
  SUBMISSION_QUEUE_META_KEY,
  WORKSPACE_STATE_KEY,
} from "../../shared/production-verification-offline-sync.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

export function createOfflineSyncStorageSimulator(options = {}) {
  const config = options.config || {};
  const request = options.request;
  const runId = options.runId ?? Date.now();
  const offlineRunId = trim(options.offlineRunId) || `bert-smoke-offline-${runId}`;

  let offline = false;
  let serverWriteCount = 0;
  let completeRequestCount = 0;
  let syncAttempts = 0;
  let capabilityAvailable = options.capabilityAvailable !== false;
  let assignedCheckLoaded = false;
  let templateCached = options.templateCached !== false;
  let serviceWorkerRegistered = options.serviceWorkerRegistered !== false;
  let onlineListenerRegistered = options.onlineListenerRegistered !== false;

  const drafts = new Map();
  const queueItems = new Map();
  const submissions = new Map();
  let workspaceState = { drafts: {} };
  let queueMeta = {};
  let assignedWorkCache = null;
  let syncedResultId = "";
  let duplicateProtectionMode = false;
  let transientSyncFailureOnce = false;
  let transientSyncFailuresRemaining = 0;
  let manualSyncRequired = false;
  let cleanupRejectsNonVerification = false;

  function countVerificationQueueItems() {
    return [...queueItems.values()].filter((item) => isVerificationOfflineQueueItem(item)).length;
  }

  function countVerificationDrafts() {
    return [...drafts.values()].filter((draft) => isVerificationOfflineDraft(draft)).length;
  }

  function getBaseline() {
    return {
      queueCount: queueItems.size,
      verificationQueueCount: countVerificationQueueItems(),
      draftCount: drafts.size,
      verificationDraftCount: countVerificationDrafts(),
      assignedCheckCount: assignedCheckLoaded ? 1 : 0,
      pendingSyncIndicator: countVerificationQueueItems() > 0,
    };
  }

  async function staleCleanupVerification() {
    for (const [key, draft] of [...drafts.entries()]) {
      if (isVerificationOfflineDraft(draft)) {
        drafts.delete(key);
      }
    }
    for (const [key, item] of [...queueItems.entries()]) {
      if (isVerificationOfflineQueueItem(item)) {
        queueItems.delete(key);
        submissions.delete(item.localId);
      }
    }
    workspaceState = {
      ...workspaceState,
      drafts: Object.fromEntries(
        Object.entries(workspaceState.drafts || {}).filter(([, draft]) => !isVerificationOfflineDraft(draft)),
      ),
    };
    return { cleanedQueue: true, cleanedDrafts: true };
  }

  async function loadAssignedCheckOnline() {
    if (!templateCached) {
      throw new Error("TEMPLATE_NOT_CACHED");
    }
    assignedCheckLoaded = true;
    assignedWorkCache = {
      role: "Admin",
      companyFolderId: config.companyFolderId,
      companyName: "Dovecote Demo",
      audits: [buildVerificationOfflineSubmission({ runId, offlineRunId, companyFolderId: config.companyFolderId }).submission.audit],
      schedules: [{ id: config.verificationScheduleId, scheduleName: "BERT Verification Audit" }],
      templates: [{ id: config.verificationAuditId }],
      updatedAt: new Date().toISOString(),
    };
    return assignedWorkCache;
  }

  function setOffline(value = true) {
    offline = value;
  }

  function isOffline() {
    return offline;
  }

  async function startAuditOffline() {
    if (!offline) {
      throw new Error("Expected offline mode before starting audit.");
    }
    if (!assignedCheckLoaded) {
      throw new Error("Assigned check was not cached.");
    }
    return { offlineRunId, scheduleId: config.verificationScheduleId, auditId: config.verificationAuditId };
  }

  async function saveDraftOffline(answers = {}) {
    if (!offline) {
      throw new Error("Draft save requires offline mode.");
    }
    const draft = buildVerificationOfflineDraft({
      runId,
      offlineRunId,
      companyFolderId: config.companyFolderId,
      answers,
    });
    drafts.set(draft.auditId, draft);
    workspaceState = {
      ...workspaceState,
      drafts: {
        ...(workspaceState.drafts || {}),
        [draft.auditId]: draft,
      },
    };
    if (serverWriteCount > 0 && offline) {
      throw new Error("Server write occurred while offline.");
    }
    return draft;
  }

  async function resumeDraftOffline() {
    const draft = drafts.get(config.verificationAuditId);
    if (!draft) {
      throw new Error("Draft not found after reload.");
    }
    return draft;
  }

  async function editDraftOffline(patch = {}) {
    const existing = drafts.get(config.verificationAuditId);
    if (!existing) {
      throw new Error("Draft missing for edit.");
    }
    const updated = {
      ...existing,
      answers: { ...existing.answers, ...patch.answers },
      notes: { ...existing.notes, ...(patch.notes || {}) },
      updatedAt: new Date().toISOString(),
    };
    drafts.set(config.verificationAuditId, updated);
    workspaceState = {
      ...workspaceState,
      drafts: {
        ...(workspaceState.drafts || {}),
        [config.verificationAuditId]: updated,
      },
    };
    return updated;
  }

  async function submitOffline() {
    if (!offline) {
      throw new Error("Offline submit requires offline mode.");
    }
    const draft = drafts.get(config.verificationAuditId);
    const built = buildVerificationOfflineSubmission({
      runId,
      offlineRunId,
      companyFolderId: config.companyFolderId,
      masterSheetId: config.masterSheetId,
      userEmail: config.expectedEmail,
      answers: draft?.answers,
      notes: draft?.notes,
    });
    if (queueItems.has(built.queueItem.id)) {
      throw new Error("Duplicate queue item.");
    }
    queueItems.set(built.queueItem.id, built.queueItem);
    submissions.set(built.submission.localSubmissionId, built.submission);
    return built;
  }

  async function reloadWhileOffline() {
    const item = queueItems.get(offlineRunId);
    if (!item) {
      throw new Error("Queue item missing after reload.");
    }
    return { queueItem: item, draft: drafts.get(config.verificationAuditId) || null };
  }

  async function restoreConnectivity() {
    offline = false;
    return { online: true };
  }

  async function syncQueue(manual = false) {
    if (offline) {
      throw new Error("Cannot sync while offline.");
    }
    if (manualSyncRequired && !manual) {
      return { skipped: true, reason: "manual_sync_required" };
    }
    const item = queueItems.get(offlineRunId);
    if (!item) {
      return { ok: true, alreadySynced: true };
    }
    syncAttempts += 1;
    if (transientSyncFailureOnce && syncAttempts === 1) {
      transientSyncFailureOnce = false;
      throw new Error("Transient sync failure");
    }
    if (transientSyncFailuresRemaining > 0) {
      transientSyncFailuresRemaining -= 1;
      throw new Error("Transient sync failure");
    }
    if (!request) {
      throw new Error("Transport request function is required for sync.");
    }
    const submission = submissions.get(offlineRunId);
    const completeBody = {
      companyFolderId: config.companyFolderId,
      masterSheetId: config.masterSheetId,
      auditId: config.verificationAuditId,
      auditName: "BERT Verification Audit",
      status: "completed",
      answers: submission?.answers || {},
      findings: [],
      evidenceRefs: [],
      localSubmissionId: offlineRunId,
      completedByName: config.expectedEmail,
    };
    completeRequestCount += 1;
    const response = await request(
      "POST",
      `/api/companies/${encodeURIComponent(config.companyFolderId)}/checks/${encodeURIComponent(config.verificationScheduleId)}/complete`,
      completeBody,
    );
    serverWriteCount += 1;
    if (duplicateProtectionMode && completeRequestCount > 1) {
      if (response.status === 200 && (response.json?.alreadyExists || response.json?.duplicate)) {
        queueItems.delete(offlineRunId);
        submissions.delete(offlineRunId);
        return { ok: true, duplicateRecovered: true, response };
      }
    }
    if (response.status !== 200 || response.json?.ok !== true) {
      throw new Error(`Sync failed with HTTP ${response.status}`);
    }
    syncedResultId = trim(response.json?.resultId);
    queueItems.delete(offlineRunId);
    submissions.delete(offlineRunId);
    drafts.delete(config.verificationAuditId);
    workspaceState = {
      ...workspaceState,
      drafts: Object.fromEntries(
        Object.entries(workspaceState.drafts || {}).filter(([auditId]) => auditId !== config.verificationAuditId),
      ),
    };
    return { ok: true, resultId: syncedResultId, response };
  }

  async function duplicateProtectionRetry() {
    duplicateProtectionMode = true;
    const first = await syncQueue(true);
    queueItems.set(offlineRunId, buildVerificationOfflineSubmission({
      runId,
      offlineRunId,
      companyFolderId: config.companyFolderId,
      masterSheetId: config.masterSheetId,
    }).queueItem);
    submissions.set(offlineRunId, buildVerificationOfflineSubmission({
      runId,
      offlineRunId,
      companyFolderId: config.companyFolderId,
      masterSheetId: config.masterSheetId,
    }).submission);
    const second = await syncQueue(true);
    return { first, second };
  }

  async function cleanupLocalVerification() {
    await staleCleanupVerification();
    return { ok: true };
  }

  async function cleanupNonVerificationQueueItem() {
    if (cleanupRejectsNonVerification) {
      return { ok: false, code: "CLEANUP_NOT_VERIFICATION_QUEUE_ITEM" };
    }
    return { ok: true };
  }

  function getQueueState() {
    return {
      items: [...queueItems.values()],
      submissions: [...submissions.values()],
      offline,
      serverWriteCount,
      completeRequestCount,
      syncedResultId,
      workspaceState,
      queueMeta,
      storageKeys: {
        workspace: WORKSPACE_STATE_KEY,
        queueMeta: SUBMISSION_QUEUE_META_KEY,
      },
    };
  }

  return {
    runId,
    offlineRunId,
    getBaseline,
    staleCleanupVerification,
    loadAssignedCheckOnline,
    setOffline,
    isOffline,
    startAuditOffline,
    saveDraftOffline,
    resumeDraftOffline,
    editDraftOffline,
    submitOffline,
    reloadWhileOffline,
    restoreConnectivity,
    syncQueue,
    duplicateProtectionRetry,
    cleanupLocalVerification,
    cleanupNonVerificationQueueItem,
    getQueueState,
    get capabilityAvailable() {
      return capabilityAvailable;
    },
    set capabilityAvailable(value) {
      capabilityAvailable = value;
    },
    get templateCached() {
      return templateCached;
    },
    set templateCached(value) {
      templateCached = value;
    },
    get serviceWorkerRegistered() {
      return serviceWorkerRegistered;
    },
    get onlineListenerRegistered() {
      return onlineListenerRegistered;
    },
    get assignedCheckLoaded() {
      return assignedCheckLoaded;
    },
    set assignedCheckLoaded(value) {
      assignedCheckLoaded = value;
    },
    get serverWriteCount() {
      return serverWriteCount;
    },
    get completeRequestCount() {
      return completeRequestCount;
    },
    get syncAttempts() {
      return syncAttempts;
    },
    set manualSyncRequired(value) {
      manualSyncRequired = value;
    },
    set transientSyncFailureOnce(value) {
      transientSyncFailureOnce = value;
    },
    set transientSyncFailuresRemaining(value) {
      transientSyncFailuresRemaining = value;
    },
    set cleanupRejectsNonVerification(value) {
      cleanupRejectsNonVerification = value;
    },
    set duplicateProtectionMode(value) {
      duplicateProtectionMode = value;
    },
    markServerWrite() {
      if (offline) {
        serverWriteCount += 1;
      }
    },
  };
}
