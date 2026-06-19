import type { Audit } from "../types/reportsScreenProps";

const DB_NAME = "bert-tablet-offline-v1";
const DB_VERSION = 1;
const SUBMISSION_STORE = "offlineSubmissions";
const BLOB_STORE = "offlineEvidenceBlobs";
const CACHE_STORE = "tabletAssignedWork";

export type TabletEvidenceRef = {
  evidenceId: string;
  questionId: string;
  name: string;
  mimeType: string;
  size: number;
  blobKey: string;
  addedAt: string;
};

export type TabletOfflineSubmission = {
  localSubmissionId: string;
  deviceId: string;
  userId: string;
  companyFolderId?: string;
  masterSheetId?: string;
  scheduleId?: string;
  checkId: string;
  templateId?: string;
  areaId?: string;
  siteId?: string;
  answers: Record<string, string>;
  failedAnswers: Record<string, string>;
  notes: Record<string, string>;
  evidenceRefs: TabletEvidenceRef[];
  signatureDataUrl: string;
  createdAt: string;
  syncStatus: "queued" | "syncing" | "synced" | "failed";
  retryCount: number;
  lastError: string;
  submittedBy: string;
  audit: Audit;
  lastSyncedAt?: string;
};

export type TabletAssignedWorkCache = {
  role: string;
  companyFolderId?: string;
  companyName?: string;
  defaultFormLanguage?: string;
  selectedSiteId?: string;
  audits: Audit[];
  schedules: unknown[];
  templates: Array<{ id?: string; language?: string; defaultLanguage?: string; translationStatus?: string }>;
  areas: unknown[];
  sites: unknown[];
  recentHistory: unknown[];
  updatedAt: string;
};

type StoreName = typeof SUBMISSION_STORE | typeof BLOB_STORE | typeof CACHE_STORE;

function canUseIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Unable to open tablet offline database."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SUBMISSION_STORE)) {
        db.createObjectStore(SUBMISSION_STORE, { keyPath: "localSubmissionId" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(storeName: StoreName, mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T>) {
  if (!canUseIndexedDb()) {
    throw new Error("IndexedDB is not available on this device.");
  }
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    handler(store)
      .then((result) => {
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
      })
      .catch((error) => {
        tx.abort();
        db.close();
        reject(error);
      });
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed."));
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

export const tabletOfflineService = {
  canUseIndexedDb,
  async upsertSubmission(submission: TabletOfflineSubmission) {
    await withStore(SUBMISSION_STORE, "readwrite", async (store) => {
      await requestToPromise(store.put(submission));
      return true;
    });
  },
  async listSubmissions() {
    return withStore(SUBMISSION_STORE, "readonly", async (store) => {
      const rows = (await requestToPromise(store.getAll())) as TabletOfflineSubmission[];
      return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    });
  },
  async deleteSubmission(localSubmissionId: string) {
    await withStore(SUBMISSION_STORE, "readwrite", async (store) => {
      await requestToPromise(store.delete(localSubmissionId));
      return true;
    });
  },
  async saveEvidenceBlob(blobKey: string, blob: Blob) {
    await withStore(BLOB_STORE, "readwrite", async (store) => {
      await requestToPromise(store.put(blob, blobKey));
      return true;
    });
  },
  async getEvidenceBlob(blobKey: string) {
    return withStore(BLOB_STORE, "readonly", async (store) => {
      const blob = (await requestToPromise(store.get(blobKey))) as Blob | undefined;
      return blob || null;
    });
  },
  async deleteEvidenceBlob(blobKey: string) {
    await withStore(BLOB_STORE, "readwrite", async (store) => {
      await requestToPromise(store.delete(blobKey));
      return true;
    });
  },
  async saveAssignedWorkCache(cache: TabletAssignedWorkCache) {
    await withStore(CACHE_STORE, "readwrite", async (store) => {
      await requestToPromise(store.put(cache, "latest"));
      return true;
    });
  },
  async readAssignedWorkCache() {
    return withStore(CACHE_STORE, "readonly", async (store) => {
      const cache = (await requestToPromise(store.get("latest"))) as TabletAssignedWorkCache | undefined;
      return cache || null;
    });
  },
};
