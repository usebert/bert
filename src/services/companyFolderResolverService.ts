import { apiUrl } from "../config/apiBase";

export type ResolveCompanyFromFolderResult = {
  ok: boolean;
  companyId: string;
  companyName: string;
  companyFolderId: string;
  masterSheetId: string;
  status: string;
  userMessage?: string;
  masterSheetLink?: string;
  tabsQueued?: boolean;
  backgroundJobs?: string[];
  error?: string;
  reasonCode?: string;
};

export const companyFolderResolverService = {
  async resolveFromFolder(input: {
    companyFolderId: string;
    companyName?: string;
    masterSheetId?: string;
  }): Promise<ResolveCompanyFromFolderResult> {
    const companyFolderId = String(input.companyFolderId || "").trim();
    const response = await fetch(apiUrl(`/api/godmode/companies/${encodeURIComponent(companyFolderId)}/resolve-from-folder`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyFolderId,
        companyName: input.companyName,
        masterSheetId: input.masterSheetId,
      }),
    });
    const payload = (await response.json()) as ResolveCompanyFromFolderResult;
    if (!response.ok && !payload.ok) {
      throw new Error(payload.userMessage || payload.error || "Unable to resolve company from folder.");
    }
    return payload;
  },
};
