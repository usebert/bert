import { storageKeys } from "../config/storageKeys";
import { invalidateAppDataCache } from "../services/appDataCacheService";
import { clearCompanyLoginHintForEmail } from "../lib/companyLoginHint";
import { clearGodmodeSelectedCompanyFolderId } from "./godmodeCompanyContext";
import { clearedCompanyWorkspaceOperationalFields } from "./clearCompanyWorkspaceLocalState";

/** Bump to force a one-time wipe of stale company identity keys after deploy. */
export const APP_CONTEXT_VERSION = "7";
export const BERT_CONTEXT_SCHEMA_VERSION = 7;
const APP_CONTEXT_VERSION_KEY = "bert_app_context_version";
const BERT_CONTEXT_SCHEMA_VERSION_KEY = "bert_context_schema_version";

/** Legacy keys that must never act as company source of truth. */
const LEGACY_STALE_COMPANY_KEYS = [
  "companyName",
  "currentCompany",
  "selectedCompany",
  "companyContext",
  "workspaceName",
  "authUser",
  "bertUser",
] as const;

function removeLocalStorageKey(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Wipe stale company hints/caches — call on logout, invalid session, and company switch. */
export function clearStaleCompanyLocalStorage(email?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedEmail) {
    clearCompanyLoginHintForEmail(normalizedEmail);
  } else {
    removeLocalStorageKey("bert_company_login_hint_v1");
  }

  clearGodmodeSelectedCompanyFolderId();

  for (const key of LEGACY_STALE_COMPANY_KEYS) {
    removeLocalStorageKey(key);
  }

  removeLocalStorageKey(storageKeys.companyMembersCache);
  removeLocalStorageKey(storageKeys.reportsDashboardCache);
  removeLocalStorageKey(storageKeys.scheduleAssigneesCache);
  removeLocalStorageKey(storageKeys.appDataCache);
  invalidateAppDataCache({ all: true });
  clearStoredFolderLinkCompanyFields();

  try {
    const raw = window.localStorage.getItem(storageKeys.workspaceState);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    window.localStorage.setItem(
      storageKeys.workspaceState,
      JSON.stringify({
        ...parsed,
        selectedFolderId: "",
        folders: [],
        ...clearedCompanyWorkspaceOperationalFields(),
      }),
    );
  } catch {
    /* ignore */
  }
}

function clearStoredFolderLinkCompanyFields() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.folderLinks);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    window.localStorage.setItem(
      storageKeys.folderLinks,
      JSON.stringify({
        ...parsed,
        folderNameInput: "",
        folderIdInput: "",
        masterSheetInput: "",
      }),
    );
  } catch {
    removeLocalStorageKey(storageKeys.folderLinks);
  }
}

/**
 * Run synchronously before React mounts — strips untrusted company identity from localStorage.
 * Validated session/login restores company context afterward.
 */
export function runAppContextBootstrap() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const storedVersion = window.localStorage.getItem(APP_CONTEXT_VERSION_KEY);
    const schemaVersion = Number(window.localStorage.getItem(BERT_CONTEXT_SCHEMA_VERSION_KEY) || "0");
    if (storedVersion !== APP_CONTEXT_VERSION || schemaVersion < BERT_CONTEXT_SCHEMA_VERSION) {
      clearStaleCompanyLocalStorage();
      window.localStorage.setItem(APP_CONTEXT_VERSION_KEY, APP_CONTEXT_VERSION);
      window.localStorage.setItem(BERT_CONTEXT_SCHEMA_VERSION_KEY, String(BERT_CONTEXT_SCHEMA_VERSION));
      return;
    }
  } catch {
    clearStaleCompanyLocalStorage();
  }
}
