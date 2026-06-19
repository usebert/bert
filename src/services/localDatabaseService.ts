import { storageKeys, migrateLegacyStorageKeysOnce } from "../config/storageKeys";
import { CURRENT_SCHEMA_VERSION } from "../schema/companySchema";

export type LocalSyncLifecycle = "Pending" | "Syncing" | "Synced" | "Failed" | "Conflict";

export type LocalRecordMetadata = {
  id: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  syncStatus: LocalSyncLifecycle;
  syncAttempts: number;
  lastSyncError: string;
  remoteRowId?: string;
  schemaVersion: string;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
  lastSyncedAt?: string;
  versionNumber?: number;
};

type LocalDatabaseCollections = {
  workspaceState: Record<string, unknown>;
  folderLinks: Record<string, unknown>;
  offlineQueue: unknown[];
  syncQueue: unknown[];
  auditResults: unknown[];
  auditFindings: unknown[];
  evidence: unknown[];
  actionComments: unknown[];
  syncLogs: unknown[];
  auditLogs: unknown[];
  user: Record<string, unknown> | null;
  theme: string;
  previewOrientation: string;
};

type LocalDatabaseShape = {
  version: string;
  collections: LocalDatabaseCollections;
};

const EMPTY_DB: LocalDatabaseShape = {
  version: CURRENT_SCHEMA_VERSION,
  collections: {
    workspaceState: {},
    folderLinks: {},
    offlineQueue: [],
    syncQueue: [],
    auditResults: [],
    auditFindings: [],
    evidence: [],
    actionComments: [],
    syncLogs: [],
    auditLogs: [],
    user: null,
    theme: "light",
    previewOrientation: "portrait",
  },
};

export const localDbKeys = {
  user: storageKeys.currentUser,
  offlineQueue: storageKeys.offlineSubmissions,
  theme: storageKeys.theme,
  previewOrientation: storageKeys.previewOrientation,
  folderLinks: storageKeys.folderLinks,
  workspaceState: storageKeys.workspaceState,
} as const;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function cloneEmptyDb(): LocalDatabaseShape {
  return JSON.parse(JSON.stringify(EMPTY_DB)) as LocalDatabaseShape;
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readLegacySeed() {
  migrateLegacyStorageKeysOnce();
  if (!canUseStorage()) {
    return cloneEmptyDb();
  }

  const db = cloneEmptyDb();
  db.collections.user = safeParse(window.localStorage.getItem(localDbKeys.user), null);
  db.collections.offlineQueue = safeParse(window.localStorage.getItem(localDbKeys.offlineQueue), []);
  db.collections.theme = window.localStorage.getItem(localDbKeys.theme) || "light";
  db.collections.previewOrientation = window.localStorage.getItem(localDbKeys.previewOrientation) || "portrait";
  db.collections.folderLinks = safeParse(window.localStorage.getItem(localDbKeys.folderLinks), {});
  const workspaceState = safeParse<Record<string, unknown>>(window.localStorage.getItem(localDbKeys.workspaceState), {});
  db.collections.workspaceState = workspaceState;
  db.collections.syncQueue = Array.isArray(workspaceState.syncQueue) ? (workspaceState.syncQueue as unknown[]) : [];
  return db;
}

function readDb(): LocalDatabaseShape {
  migrateLegacyStorageKeysOnce();
  if (!canUseStorage()) {
    return cloneEmptyDb();
  }

  const existing = safeParse<LocalDatabaseShape | null>(window.localStorage.getItem(storageKeys.localDatabaseRoot), null);
  if (existing?.collections) {
    return {
      version: existing.version || CURRENT_SCHEMA_VERSION,
      collections: {
        ...cloneEmptyDb().collections,
        ...existing.collections,
      },
    };
  }

  const seeded = readLegacySeed();
  writeDb(seeded);
  return seeded;
}

function writeDb(db: LocalDatabaseShape) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    storageKeys.localDatabaseRoot,
    JSON.stringify({
      version: CURRENT_SCHEMA_VERSION,
      collections: db.collections,
    }),
  );
}

function updateDb(mutator: (db: LocalDatabaseShape) => LocalDatabaseShape) {
  const current = readDb();
  const next = mutator(current);
  writeDb(next);
  return next;
}

export const localDatabaseService = {
  loadWorkspaceState<T extends Record<string, unknown>>() {
    return readDb().collections.workspaceState as T;
  },
  saveWorkspaceState(value: Record<string, unknown>) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        workspaceState: value,
        syncQueue: Array.isArray(value.syncQueue) ? (value.syncQueue as unknown[]) : db.collections.syncQueue,
      },
    }));
  },
  loadFolderLinks<T extends Record<string, unknown>>() {
    return readDb().collections.folderLinks as T;
  },
  saveFolderLinks(value: Record<string, unknown>) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        folderLinks: value,
      },
    }));
  },
  loadOfflineQueue<T>() {
    return readDb().collections.offlineQueue as T[];
  },
  saveOfflineQueue<T>(value: T[]) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        offlineQueue: value,
      },
    }));
  },
  loadSyncQueue<T>() {
    return readDb().collections.syncQueue as T[];
  },
  saveSyncQueue<T>(value: T[]) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        syncQueue: value,
        workspaceState: {
          ...db.collections.workspaceState,
          syncQueue: value,
        },
      },
    }));
  },
  loadUser<T>() {
    return readDb().collections.user as T | null;
  },
  saveUser<T>(value: T | null) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        user: value as Record<string, unknown> | null,
      },
    }));
  },
  clearUser() {
    this.saveUser(null);
  },
  loadTheme() {
    return readDb().collections.theme || "light";
  },
  saveTheme(value: string) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        theme: value,
      },
    }));
  },
  loadPreviewOrientation() {
    return readDb().collections.previewOrientation || "portrait";
  },
  savePreviewOrientation(value: string) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        previewOrientation: value,
      },
    }));
  },
  loadCollection<T>(name: keyof LocalDatabaseCollections) {
    return readDb().collections[name] as T;
  },
  saveCollection<T>(name: keyof LocalDatabaseCollections, value: T) {
    updateDb((db) => ({
      ...db,
      collections: {
        ...db.collections,
        [name]: value,
      },
    }));
  },
  appendToCollection<T>(name: keyof LocalDatabaseCollections, item: T) {
    const current = readDb().collections[name];
    const next = Array.isArray(current) ? [item, ...current] : current;
    this.saveCollection(name, next);
  },
};

export function createLocalRecordMetadata(input: {
  id: string;
  companyId: string;
  actor: string;
  createdAt?: string;
  syncStatus?: LocalSyncLifecycle;
  versionNumber?: number;
}): LocalRecordMetadata {
  const createdAt = input.createdAt || new Date().toISOString();
  return {
    id: input.id,
    companyId: input.companyId,
    createdAt,
    updatedAt: createdAt,
    createdBy: input.actor,
    updatedBy: input.actor,
    syncStatus: input.syncStatus || "Pending",
    syncAttempts: 0,
    lastSyncError: "",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    localUpdatedAt: createdAt,
    lastSyncedAt: "",
    versionNumber: input.versionNumber || 1,
  };
}
