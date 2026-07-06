import type { SubmissionQueueItem, SubmissionQueueMeta, SubmissionQueueStatus } from "../types/submissionQueue";
import type { SyncQueueItem } from "../types/sync";
import {
  offlineSubmissionToQueueItem,
  offlineSubmissionsFromQueue,
  queueItemToOfflineSubmission,
  syncQueueItemToSubmissionQueueItem,
  syncQueueItemsFromSubmissionQueue,
} from "../utils/submissionQueueBridge";
import { tabletOfflineService, type TabletEvidenceRef, type TabletOfflineSubmission } from "./tabletOfflineService";

const META_KEY = "bert-submission-queue-meta";
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 2_000;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMeta(): SubmissionQueueMeta {
  if (!canUseStorage()) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SubmissionQueueMeta) : {};
  } catch {
    return {};
  }
}

function writeMeta(meta: SubmissionQueueMeta) {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function computeSubmissionBackoffMs(attemptCount: number) {
  const cappedAttempt = Math.min(Math.max(attemptCount, 1), 8);
  return Math.min(BASE_BACKOFF_MS * 2 ** (cappedAttempt - 1), MAX_BACKOFF_MS);
}

export function buildSubmissionIdempotencyKey(input: {
  type: SubmissionQueueItem["type"];
  localId: string;
  companyFolderId?: string;
}) {
  const company = String(input.companyFolderId || "").trim();
  return `${input.type}::${company}::${input.localId}`;
}

type EnqueueInput = Omit<SubmissionQueueItem, "id" | "createdAt" | "updatedAt" | "status" | "attemptCount" | "lastError" | "nextRetryAt"> & {
  id?: string;
  createdAt?: string;
  status?: SubmissionQueueStatus;
  attemptCount?: number;
  lastError?: string;
};

export const submissionQueueService = {
  canUseIndexedDb: tabletOfflineService.canUseIndexedDb,

  readMeta,
  writeMeta(partial: Partial<SubmissionQueueMeta>) {
    writeMeta({ ...readMeta(), ...partial });
  },

  async listItems(): Promise<SubmissionQueueItem[]> {
    if (!tabletOfflineService.canUseIndexedDb()) {
      return [];
    }
    return tabletOfflineService.listQueueItems<SubmissionQueueItem>();
  },

  async listActiveItems() {
    const items = await this.listItems();
    return items.filter((item) => item.status !== "synced");
  },

  async enqueue(input: EnqueueInput): Promise<SubmissionQueueItem> {
    const now = input.createdAt || new Date().toISOString();
    const idempotencyKey = input.idempotencyKey || buildSubmissionIdempotencyKey(input);
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status !== "synced") {
      return existing;
    }

    const item: SubmissionQueueItem = {
      id: input.id || `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      companyFolderId: input.companyFolderId,
      userEmail: input.userEmail,
      createdAt: now,
      updatedAt: now,
      status: input.status || "queued",
      attemptCount: input.attemptCount ?? 0,
      lastError: input.lastError || "",
      payload: input.payload,
      evidenceRefs: input.evidenceRefs,
      idempotencyKey,
      localId: input.localId,
    };

    if (tabletOfflineService.canUseIndexedDb()) {
      await tabletOfflineService.upsertQueueItem(item);
    }
    return item;
  },

  async findByIdempotencyKey(idempotencyKey: string) {
    const items = await this.listItems();
    return items.find((item) => item.idempotencyKey === idempotencyKey) || null;
  },

  async updateItem(id: string, patch: Partial<SubmissionQueueItem>) {
    if (!tabletOfflineService.canUseIndexedDb()) {
      return null;
    }
    const current = await tabletOfflineService.getQueueItem<SubmissionQueueItem>(id);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };
    await tabletOfflineService.upsertQueueItem(next);
    return next;
  },

  async markSyncing(id: string) {
    return this.updateItem(id, { status: "syncing" });
  },

  async markSynced(id: string) {
    const updated = await this.updateItem(id, { status: "synced", lastError: "" });
    this.writeMeta({ lastSyncedAt: new Date().toISOString() });
    if (updated?.type === "auditCompletion") {
      const offline = queueItemToOfflineSubmission(updated);
      if (offline) {
        await tabletOfflineService.deleteSubmission(offline.localSubmissionId).catch(() => undefined);
        for (const ref of offline.evidenceRefs) {
          await tabletOfflineService.deleteEvidenceBlob(ref.blobKey).catch(() => undefined);
        }
      }
    }
    await tabletOfflineService.deleteQueueItem(id).catch(() => undefined);
    return updated;
  },

  async markFailed(id: string, lastError: string) {
    const current = await tabletOfflineService.getQueueItem<SubmissionQueueItem>(id);
    if (!current) {
      return null;
    }
    const attemptCount = current.attemptCount + 1;
    const nextRetryAt = new Date(Date.now() + computeSubmissionBackoffMs(attemptCount)).toISOString();
    const updated = await this.updateItem(id, {
      status: "failed",
      attemptCount,
      lastError,
      nextRetryAt,
    });
    if (updated?.type === "auditCompletion") {
      const offline = queueItemToOfflineSubmission(updated);
      if (offline) {
        await tabletOfflineService.upsertSubmission({
          ...offline,
          syncStatus: "failed",
          retryCount: attemptCount,
          lastError,
        });
      }
    }
    return updated;
  },

  async retryItem(id: string) {
    return this.updateItem(id, {
      status: "queued",
      lastError: "",
      nextRetryAt: undefined,
    });
  },

  async saveEvidenceBlob(blobKey: string, blob: Blob) {
    await tabletOfflineService.saveEvidenceBlob(blobKey, blob);
  },

  async getEvidenceBlob(blobKey: string) {
    return tabletOfflineService.getEvidenceBlob(blobKey);
  },

  async enqueueOfflineSubmission(submission: TabletOfflineSubmission) {
    const item = offlineSubmissionToQueueItem(submission);
    await tabletOfflineService.upsertSubmission(submission);
    return this.enqueue(item);
  },

  async migrateLegacyQueues(input: {
    legacySyncQueue?: SyncQueueItem[];
    legacyOfflineSubmissions?: TabletOfflineSubmission[];
    companyFolderId?: string;
    userEmail?: string;
  }) {
    if (!tabletOfflineService.canUseIndexedDb()) {
      return { migrated: 0 };
    }

    const existing = await this.listItems();
    const existingKeys = new Set(existing.map((item) => item.idempotencyKey));
    let migrated = 0;

    for (const legacy of input.legacySyncQueue || []) {
      const item = syncQueueItemToSubmissionQueueItem(legacy, {
        companyFolderId: input.companyFolderId,
        userEmail: input.userEmail,
      });
      if (existingKeys.has(item.idempotencyKey)) {
        continue;
      }
      await tabletOfflineService.upsertQueueItem(item);
      existingKeys.add(item.idempotencyKey);
      migrated += 1;
    }

    for (const legacy of input.legacyOfflineSubmissions || []) {
      const item = offlineSubmissionToQueueItem(legacy);
      if (existingKeys.has(item.idempotencyKey)) {
        continue;
      }
      await tabletOfflineService.upsertQueueItem(item);
      existingKeys.add(item.idempotencyKey);
      migrated += 1;
    }

    if (migrated > 0) {
      this.writeMeta({ lastHydratedAt: new Date().toISOString() });
    }
    return { migrated };
  },

  toSyncQueueView(items: SubmissionQueueItem[]) {
    return syncQueueItemsFromSubmissionQueue(items);
  },

  toOfflineQueueView(items: SubmissionQueueItem[]) {
    return offlineSubmissionsFromQueue(items);
  },

  countSummary(items: SubmissionQueueItem[]) {
    const active = items.filter((item) => item.status !== "synced");
    const waitingCount = active.filter((item) => item.status === "queued" || item.status === "syncing").length;
    const failedCount = active.filter((item) => item.status === "failed").length;
    return { waitingCount, failedCount, totalActive: active.length };
  },

  nextReadyItem(items: SubmissionQueueItem[], now = Date.now()) {
    return items
      .filter((item) => item.status === "queued" || item.status === "failed")
      .filter((item) => !item.nextRetryAt || Date.parse(item.nextRetryAt) <= now)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  },

  async storeEvidenceRefs(refs: TabletEvidenceRef[], blobs: Array<{ blobKey: string; blob: Blob }>) {
    for (const entry of blobs) {
      await this.saveEvidenceBlob(entry.blobKey, entry.blob);
    }
    return refs;
  },
};
