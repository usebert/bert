/**
 * Authorized company workspace helpers — dedupe by canonical folder + master sheet ids.
 */

export function workspaceAccessKey(input = {}) {
  const companyFolderId = String(input.companyFolderId || input.companyId || input.id || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  if (!companyFolderId || !masterSheetId) {
    return "";
  }
  return `${companyFolderId}::${masterSheetId}`;
}

export function dedupeAuthorizedWorkspaces(workspaces = []) {
  const map = new Map();
  for (const workspace of workspaces) {
    const key = workspaceAccessKey(workspace);
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, {
      ...workspace,
      companyFolderId: String(workspace.companyFolderId || workspace.companyId || "").trim(),
      companyId: String(workspace.companyId || workspace.companyFolderId || "").trim(),
      masterSheetId: String(workspace.masterSheetId || "").trim(),
      companyName: String(workspace.companyName || "").trim(),
    });
  }
  return [...map.values()];
}

export function toCompanySwitcherWorkspace(workspace = {}) {
  const companyFolderId = String(workspace.companyFolderId || workspace.companyId || workspace.id || "").trim();
  const companyName = String(workspace.companyName || workspace.name || "").trim();
  if (!companyFolderId || !companyName) {
    return null;
  }
  return { companyFolderId, companyName };
}

export function filterSwitcherWorkspacesForSession(workspaces = [], sessionCompanyFolderId = "") {
  const deduped = dedupeAuthorizedWorkspaces(workspaces)
    .map((workspace) => toCompanySwitcherWorkspace(workspace))
    .filter(Boolean);
  const currentId = String(sessionCompanyFolderId || "").trim();
  if (!currentId) {
    return deduped;
  }
  const hasCurrent = deduped.some((workspace) => workspace.companyFolderId === currentId);
  if (hasCurrent) {
    return deduped;
  }
  return deduped;
}
