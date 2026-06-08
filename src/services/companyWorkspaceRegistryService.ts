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

const REGISTRY_ACTION_TIMEOUT_MS = 30_000;

async function parseJson<T extends { ok?: boolean; error?: string }>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Company workspace registry request failed.");
  }
  return payload;
}

async function postRegistryAction<T extends { ok?: boolean; error?: string }>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REGISTRY_ACTION_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as T;
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Company workspace registry request failed.");
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Registry action timed out after 30 seconds.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
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

  async relinkRegistry(input: {
    workspaceId: string;
    companyFolderId: string;
    companyName?: string;
    masterSheetId?: string;
    companyId?: string;
  }) {
    const workspaceId = String(input.workspaceId || input.companyFolderId || "").trim();
    return postRegistryAction<{
      ok: true;
      companyId: string;
      companyName: string;
      companyFolderId: string;
      masterSheetId: string;
      registryStatus: string;
      matchedBy?: string;
      created?: boolean;
    }>(`/api/godmode/companies/${encodeURIComponent(workspaceId)}/relink-registry`, {
      workspaceId,
      companyFolderId: input.companyFolderId || workspaceId,
      companyId: input.companyId || workspaceId,
      companyName: input.companyName || "",
      masterSheetId: input.masterSheetId || "",
    });
  },

  async forceLiveIfReady(input: {
    companyId: string;
    companyFolderId?: string;
    companyName?: string;
    checks?: Record<string, boolean | string | undefined>;
  }) {
    const companyId = String(input.companyId || "").trim();
    return postRegistryAction<{
      ok: true;
      promoted?: boolean;
      alreadyLive?: boolean;
      registryStatus: string;
      companyId: string;
      blockers?: string[];
      setupBlockers?: string[];
    }>(`/api/godmode/companies/${encodeURIComponent(companyId)}/force-live-if-ready`, {
      companyId,
      companyFolderId: input.companyFolderId || companyId,
      companyName: input.companyName || "",
      checks: input.checks,
    });
  },
};
