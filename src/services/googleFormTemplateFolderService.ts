import { apiUrl } from "../config/apiBase";

export type GoogleFormTemplateFolderStatus = "connected" | "missing" | "permission_issue";

export type GoogleFormTemplateFolderStatusPayload = {
  ok?: boolean;
  folderConfigured?: boolean;
  folderId?: string;
  folderName?: string;
  status?: GoogleFormTemplateFolderStatus;
  googleConnected?: boolean;
  formsScopeConnected?: boolean;
  canAccessFolder?: boolean;
  canEditFolder?: boolean;
  subfolderCount?: number;
  expectedSubfolderCount?: number;
  categoryFolders?: string[];
  verifyError?: string;
  verified?: boolean;
  repaired?: boolean;
  error?: string;
};

async function parseJson<T extends GoogleFormTemplateFolderStatusPayload>(
  response: Response,
): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok && payload.ok !== true) {
    throw new Error(payload.error || payload.verifyError || "Google Form template folder request failed.");
  }
  return payload;
}

export const googleFormTemplateFolderService = {
  async getStatus() {
    const response = await fetch(apiUrl("/api/google-form-templates/folder/status"), {
      credentials: "include",
    });
    return parseJson(response);
  },
  async verify() {
    const response = await fetch(apiUrl("/api/google-form-templates/folder/verify"), {
      method: "POST",
      credentials: "include",
    });
    return parseJson(response);
  },
  async ensureStructure() {
    const response = await fetch(apiUrl("/api/google-form-templates/folder/ensure-structure"), {
      method: "POST",
      credentials: "include",
    });
    return parseJson(response);
  },
};
