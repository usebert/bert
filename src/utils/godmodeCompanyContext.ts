import { storageKeys } from "../config/storageKeys";

export function readGodmodeSelectedCompanyFolderId(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    return String(window.localStorage.getItem(storageKeys.godmodeSelectedCompanyFolderId) || "").trim();
  } catch {
    return "";
  }
}

export function writeGodmodeSelectedCompanyFolderId(folderId: string) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const trimmed = String(folderId || "").trim();
  try {
    if (!trimmed) {
      window.localStorage.removeItem(storageKeys.godmodeSelectedCompanyFolderId);
      return;
    }
    window.localStorage.setItem(storageKeys.godmodeSelectedCompanyFolderId, trimmed);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearGodmodeSelectedCompanyFolderId() {
  writeGodmodeSelectedCompanyFolderId("");
}
