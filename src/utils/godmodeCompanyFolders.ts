import {
  isArchiveOrNonLiveWorkspaceName,
  normalizeWorkspaceFolderLabel,
} from "./companyWorkspaceInvite";

export { normalizeWorkspaceFolderLabel };

/** Reserved platform folder labels — not valid Godmode company workspaces (mirrors invite-target.mjs). */
export function isReservedGodmodeCompanyFolderName(name: string | undefined): boolean {
  const normalized = normalizeWorkspaceFolderLabel(name || "");
  if (isArchiveOrNonLiveWorkspaceName(name)) {
    return true;
  }
  return (
    normalized === "live companies" ||
    normalized === "master control" ||
    normalized === "companies" ||
    normalized === "company" ||
    normalized === "shared drive" ||
    normalized === "shared drive root"
  );
}

/** Never treat the product brand label as a company workspace name. */
export function isDisallowedGodmodeCompanyDisplayName(name: string | undefined): boolean {
  const normalized = normalizeWorkspaceFolderLabel(name || "");
  return !normalized || normalized === "bert";
}

export function isSelectableGodmodeCompanyFolder(folder: { id: string; name: string }): boolean {
  return (
    Boolean(String(folder.id || "").trim()) &&
    !isReservedGodmodeCompanyFolderName(folder.name) &&
    !isDisallowedGodmodeCompanyDisplayName(folder.name)
  );
}

export function filterSelectableGodmodeCompanyFolders<T extends { id: string; name: string }>(
  folders: T[],
): T[] {
  return folders.filter((folder) => isSelectableGodmodeCompanyFolder(folder));
}

export type GodmodeCompanyContextInput = {
  companyFolderId?: string;
  companyName?: string;
  masterSheetId?: string;
  selectableFolderIds?: Set<string> | readonly string[];
};

export function assertGodmodeLiveCompanyWorkspace(
  input: GodmodeCompanyContextInput,
): { ok: true } | { ok: false } {
  const companyFolderId = String(input.companyFolderId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const companyName = String(input.companyName || "").trim();

  if (!companyFolderId || !masterSheetId) {
    return { ok: false };
  }
  if (isReservedGodmodeCompanyFolderName(companyName)) {
    return { ok: false };
  }
  if (isArchiveOrNonLiveWorkspaceName(companyName)) {
    return { ok: false };
  }
  if (isDisallowedGodmodeCompanyDisplayName(companyName)) {
    return { ok: false };
  }

  const ids = input.selectableFolderIds;
  if (ids) {
    const allowed = ids instanceof Set ? ids : new Set(ids);
    if (!allowed.has(companyFolderId)) {
      return { ok: false };
    }
  }

  return { ok: true };
}
