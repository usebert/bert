import type { CompanyUsersTabRow } from "../utils/scheduleAssignees";
import { fetchJson } from "../utils/fetchJson";

export type CompanyMember = CompanyUsersTabRow & {
  companyFolderId?: string;
};

export type CompanyMembersCacheEntry = {
  companyId: string;
  members: CompanyMember[];
  cachedAt: number;
  warning?: string;
};

export const COMPANY_MEMBERS_LOAD_TIMEOUT_MS = 2000;
export const COMPANY_MEMBERS_USER_MESSAGE = "Could not load company users. Try again.";

function companyMembersCacheKey(companyId: string): string {
  return companyId.trim();
}

export function readCompanyMembersCache(storageKey: string, companyId: string): CompanyMembersCacheEntry | null {
  if (typeof window === "undefined" || !companyId.trim()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, CompanyMembersCacheEntry>;
    const entry = parsed[companyMembersCacheKey(companyId)];
    if (!entry || !Array.isArray(entry.members)) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeCompanyMembersCache(storageKey: string, entry: CompanyMembersCacheEntry): void {
  if (typeof window === "undefined" || !entry.companyId.trim()) {
    return;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, CompanyMembersCacheEntry>) : {};
    parsed[companyMembersCacheKey(entry.companyId)] = entry;
    window.localStorage.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    /* ignore quota / private mode */
  }
}

export type FetchCompanyMembersResult = {
  ok: boolean;
  members: CompanyMember[];
  warning?: string;
  loadError?: string;
  loadErrorDetail?: string;
};

function buildLoadErrorDetail(
  code: string | undefined,
  message: string | undefined,
  diagnostics?: { url?: string; contentType?: string; status?: number; rawSnippet?: string },
): string {
  const parts = [code, message].filter(Boolean);
  if (diagnostics?.url) {
    parts.push(`url=${diagnostics.url}`);
  }
  if (diagnostics?.status) {
    parts.push(`status=${diagnostics.status}`);
  }
  if (diagnostics?.contentType) {
    parts.push(`content-type=${diagnostics.contentType}`);
  }
  if (diagnostics?.rawSnippet) {
    parts.push(`body=${diagnostics.rawSnippet}`);
  }
  return parts.join(" — ") || COMPANY_MEMBERS_USER_MESSAGE;
}

export async function fetchCompanyMembers(
  apiUrl: (path: string) => string,
  input: {
    companyId: string;
    masterSheetId?: string;
    companyName?: string;
    signal?: AbortSignal;
  },
): Promise<FetchCompanyMembersResult> {
  const companyId = input.companyId.trim();
  if (!companyId) {
    return {
      ok: false,
      members: [],
      loadError: COMPANY_MEMBERS_USER_MESSAGE,
      loadErrorDetail: "Company workspace is not selected.",
    };
  }

  const params = new URLSearchParams();
  if (input.masterSheetId?.trim()) {
    params.set("masterSheetId", input.masterSheetId.trim());
  }
  if (input.companyName?.trim()) {
    params.set("companyName", input.companyName.trim());
  }

  const path = `/api/companies/${encodeURIComponent(companyId)}/users?${params.toString()}`;
  const result = await fetchJson<{
    ok?: boolean;
    users?: CompanyMember[];
    message?: string;
    error?: string;
    code?: string;
    technicalError?: string;
  }>(apiUrl(path), { signal: input.signal });

  if (!result.ok) {
    return {
      ok: false,
      members: [],
      loadError: COMPANY_MEMBERS_USER_MESSAGE,
      loadErrorDetail: buildLoadErrorDetail(result.code, result.message, result.diagnostics),
    };
  }

  const { data: payload, response } = result;
  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      members: [],
      loadError: COMPANY_MEMBERS_USER_MESSAGE,
      loadErrorDetail: buildLoadErrorDetail(
        payload.code,
        payload.message || payload.error || payload.technicalError,
        { status: response.status, url: apiUrl(path) },
      ),
    };
  }

  return {
    ok: true,
    members: Array.isArray(payload.users) ? payload.users : [],
  };
}
