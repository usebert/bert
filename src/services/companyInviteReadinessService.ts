import { apiUrl } from "../config/apiBase";

export type CompanyInviteReadiness = {
  ok: boolean;
  canInvite: boolean;
  companyStatus: string;
  source: string;
  userMessage: string;
  reasonCode?: string;
  nextAction?: string;
};

export async function fetchCompanyInviteReadiness(input: {
  companyId: string;
  companyFolderId?: string;
  masterSheetId?: string;
  registryStatus?: string;
  workspaceSetupComplete?: boolean;
  godmodeUsersTabWritable?: boolean;
}): Promise<CompanyInviteReadiness | null> {
  const companyId = String(input.companyId || input.companyFolderId || "").trim();
  if (!companyId) {
    return null;
  }
  const params = new URLSearchParams();
  const folderId = String(input.companyFolderId || companyId).trim();
  if (folderId) {
    params.set("companyFolderId", folderId);
  }
  const masterSheetId = String(input.masterSheetId || "").trim();
  if (masterSheetId) {
    params.set("masterSheetId", masterSheetId);
  }
  const registryStatus = String(input.registryStatus || "").trim();
  if (registryStatus) {
    params.set("registryStatus", registryStatus);
  }
  if (input.workspaceSetupComplete === true) {
    params.set("workspaceSetupComplete", "true");
  } else if (input.workspaceSetupComplete === false) {
    params.set("workspaceSetupComplete", "false");
  }
  if (input.godmodeUsersTabWritable === true) {
    params.set("godmodeUsersTabWritable", "true");
  }

  const query = params.toString();
  const response = await fetch(
    apiUrl(`/api/companies/${encodeURIComponent(companyId)}/invite-readiness${query ? `?${query}` : ""}`),
    { credentials: "include" },
  );
  const payload = (await response.json()) as CompanyInviteReadiness;
  if (!response.ok || payload.ok === false) {
    return payload.ok === false
      ? payload
      : {
          ok: false,
          canInvite: false,
          companyStatus: "",
          source: "",
          userMessage: "Unable to check whether this company can accept invites.",
        };
  }
  return payload;
}
