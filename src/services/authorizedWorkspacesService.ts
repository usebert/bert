import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import type { CompanySessionResult } from "./authService";

export type AuthorizedCompanyWorkspace = {
  companyFolderId: string;
  companyName: string;
};

export async function fetchAuthorizedCompanyWorkspaces(): Promise<{
  ok: boolean;
  workspaces: AuthorizedCompanyWorkspace[];
  error?: string;
}> {
  const result = await fetchJson<{ ok?: boolean; workspaces?: AuthorizedCompanyWorkspace[]; error?: string }>(
    apiUrl("/api/auth/company/workspaces"),
    { credentials: "include" },
  );
  if (!result.ok) {
    return {
      ok: false,
      workspaces: [],
      error: result.message || "Unable to load authorized company workspaces.",
    };
  }
  const payload = result.data;
  if (!result.response.ok || payload.ok !== true) {
    return {
      ok: false,
      workspaces: [],
      error: payload.error || "Unable to load authorized company workspaces.",
    };
  }
  const workspaces = Array.isArray(payload.workspaces)
    ? payload.workspaces
        .map((workspace) => ({
          companyFolderId: String(workspace.companyFolderId || "").trim(),
          companyName: String(workspace.companyName || "").trim(),
        }))
        .filter((workspace) => workspace.companyFolderId && workspace.companyName)
    : [];
  return { ok: true, workspaces };
}

export async function selectAuthorizedCompanyWorkspace(companyFolderId: string): Promise<CompanySessionResult> {
  const trimmedId = String(companyFolderId || "").trim();
  const result = await fetchJson<CompanySessionResult & { code?: string }>(
    apiUrl("/api/auth/company/workspace-select"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyFolderId: trimmedId }),
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.message || "Unable to switch company workspace.",
    };
  }
  const payload = result.data;
  if (!result.response.ok || payload.ok !== true) {
    return {
      ok: false,
      error: payload.error || "Unable to switch company workspace.",
      code: payload.code,
    };
  }
  return payload;
}
