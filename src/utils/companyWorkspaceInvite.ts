/** Strip numeric prefixes so "99 Archive" matches archive containers. */
export function normalizeWorkspaceFolderLabel(name = ""): string {
  return String(name || "")
    .toLowerCase()
    .replace(/^\d+\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isArchiveOrNonLiveWorkspaceName(name: string | undefined): boolean {
  const normalized = normalizeWorkspaceFolderLabel(name || "");
  return normalized === "archive" || normalized === "archived";
}

export const LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE =
  "Select a live company workspace before inviting users.";

export const GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE =
  "Select a live company workspace first.";

export const INVITE_ROLE_FORBIDDEN_MESSAGE = "Only Company Admins can invite users.";

export const INVITE_COMPANY_MISMATCH_MESSAGE =
  "Your account is not linked to this company workspace.";

export function assertLiveCompanyWorkspaceForInvite(input: {
  selectedFolder: { name: string } | null | undefined;
  masterSheetId: string;
}): { ok: true } | { ok: false; message: string } {
  const sheetId = String(input.masterSheetId || "").trim();
  const folder = input.selectedFolder;
  if (!folder || !sheetId) {
    return { ok: false, message: LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE };
  }
  if (isArchiveOrNonLiveWorkspaceName(folder.name)) {
    return { ok: false, message: LIVE_WORKSPACE_INVITE_REQUIRED_MESSAGE };
  }
  return { ok: true };
}
