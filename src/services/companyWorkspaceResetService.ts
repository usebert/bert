import { apiUrl } from "../config/apiBase";

export type CompanyWorkspaceResetMode = "clean_onboarding" | "keep_areas_templates" | "full_operational";

export const COMPANY_RESET_CONFIRM_PHRASE = "RESET COMPANY";

export type CompanyWorkspaceResetResult = {
  ok: boolean;
  companyFolderId?: string;
  masterSheetId?: string;
  companyName?: string;
  mode?: CompanyWorkspaceResetMode;
  clearedTabs?: string[];
  invitesRemoved?: number;
  keptAreasTemplates?: boolean;
  evidenceDriveFilesPreserved?: boolean;
  message?: string;
  error?: string;
  blocker?: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(String(data.error || `Request failed (${response.status})`));
  }
  return data;
}

export async function resetCompanyWorkspace(input: {
  companyFolderId: string;
  masterSheetId: string;
  mode: CompanyWorkspaceResetMode;
  confirmPhrase: string;
}): Promise<CompanyWorkspaceResetResult> {
  const response = await fetch(
    apiUrl(`/api/companies/${encodeURIComponent(input.companyFolderId)}/reset-workspace`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        masterSheetId: input.masterSheetId,
        mode: input.mode,
        confirmPhrase: input.confirmPhrase,
      }),
    },
  );
  return parseResponse<CompanyWorkspaceResetResult>(response);
}
