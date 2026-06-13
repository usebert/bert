import { storageKeys } from "../config/storageKeys";
import { clearCompanyLoginHintForEmail } from "../lib/companyLoginHint";
import { clearGodmodeSelectedCompanyFolderId } from "./godmodeCompanyContext";
import { clearedCompanyWorkspaceOperationalFields } from "./clearCompanyWorkspaceLocalState";

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
