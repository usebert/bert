import { storageKeys } from "../config/storageKeys";
import { apiUrl } from "../config/apiBase";

export async function syncMasterCompanyContextToSession(input: {
  companyFolderId?: string;
  companyName?: string;
  masterSheetId?: string;
}) {
  try {
    await fetch(apiUrl("/api/auth/master/company-context"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyFolderId: String(input.companyFolderId || "").trim(),
        companyId: String(input.companyFolderId || "").trim(),
        companyName: String(input.companyName || "").trim(),
        selectedCompanyName: String(input.companyName || "").trim(),
        masterSheetId: String(input.masterSheetId || "").trim(),
      }),
    });
  } catch {
    /* best-effort session sync */
  }
}

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
