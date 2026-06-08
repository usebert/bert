import { apiUrl } from "../config/apiBase";

export type CompanyWorkspaceRegistryRecord = {
  companyId: string;
  companyName: string;
  status: string;
  rootFolderId: string;
  masterSheetId: string;
  workbookFolderId: string;
  companyFoldersMappingStatus: string;
  firstAdminStatus: string;
  lastSetupAt: string;
  lastHealthCheckAt: string;
  setupCompletedAt: string;
  liveAt: string;
  unlinkReason: string;
};

type PersistInput = {
  companyId: string;
  companyName?: string;
  rootFolderId?: string;
  masterSheetId?: string;
  workbookFolderId?: string;
  companyFoldersMappingStatus?: string;
  firstAdminStatus?: string;
  status?: string;
  markSetupComplete?: boolean;
  markLive?: boolean;
  touchSetup?: boolean;
  unlinkReason?: string;
};

async function parseJson<T extends { ok?: boolean; error?: string }>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Company workspace registry request failed.");
  }
  return payload;
}

export const companyWorkspaceRegistryService = {
  async getCompany(companyId: string) {
    return parseJson<{ ok: true; company: CompanyWorkspaceRegistryRecord; unlinkReason?: string }>(
      await fetch(apiUrl(`/api/godmode/company-workspace/${encodeURIComponent(companyId)}`), {
        credentials: "include",
      }),
    );
  },

  async persist(input: PersistInput) {
    return parseJson<{ ok: true; company: CompanyWorkspaceRegistryRecord }>(
      await fetch(apiUrl("/api/godmode/company-workspace/persist"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  },

  async repair(input: {
    companyId: string;
    companyName?: string;
    masterSheetId?: string;
    workbookFolderId?: string;
    rootFolderId?: string;
  }) {
    return parseJson<{ ok: boolean; resolved?: { masterSheetId?: string; rootFolderId?: string } }>(
      await fetch(apiUrl("/api/godmode/company-workspace/repair"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  },

  async markLiveIfReady(input: {
    companyId: string;
    companyName?: string;
    checks?: Record<string, boolean | string | undefined>;
  }) {
    return parseJson<{
      ok: true;
      promoted?: boolean;
      alreadyLive?: boolean;
      registryStatus: string;
      blockers?: string[];
      setupBlockers?: string[];
    }>(
      await fetch(apiUrl("/api/godmode/company-workspace/mark-live-if-ready"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  },
};
