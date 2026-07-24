import type { AuthorizedCompanyWorkspace } from "../services/authorizedWorkspacesService";
import { buildLinkedCompanyFolder, type LinkedCompanyFolder } from "./applyLinkedCompanyContext";

export function authorizedWorkspacesToCompanyFolders(workspaces: AuthorizedCompanyWorkspace[]): LinkedCompanyFolder[] {
  const folders: LinkedCompanyFolder[] = [];
  const seen = new Set<string>();
  for (const workspace of workspaces) {
    const folder = buildLinkedCompanyFolder({
      companyId: workspace.companyFolderId,
      companyName: workspace.companyName,
    });
    if (!folder || seen.has(folder.id)) {
      continue;
    }
    seen.add(folder.id);
    folders.push(folder);
  }
  return folders;
}

export function isAuthorizedCompanyFolderId(folders: Array<{ id: string }>, companyFolderId: string): boolean {
  const trimmedId = String(companyFolderId || "").trim();
  if (!trimmedId) {
    return false;
  }
  return folders.some((folder) => folder.id === trimmedId);
}
