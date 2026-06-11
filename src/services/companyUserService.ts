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

export type CompanyMembersDiagnostics = {
  companyId?: string;
  companyFolderId?: string;
  companyName?: string;
  masterSheetId?: string;
  signedInEmail?: string;
  signedInRole?: string;
  dataSource?: string;
  failedStep?: string;
  durationMs?: number;
  upstreamStatus?: number;
  upstreamMessage?: string;
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
  diagnostics?: CompanyMembersDiagnostics;
};

function buildLoadErrorDetail(
  reasonCode: string | undefined,
  diagnostics?: CompanyMembersDiagnostics,
  upstreamMessage?: string,
): string {
  const parts = [
    reasonCode,
    diagnostics?.companyId ? `companyId=${diagnostics.companyId}` : "",
    diagnostics?.companyFolderId ? `companyFolderId=${diagnostics.companyFolderId}` : "",
    diagnostics?.masterSheetId ? `masterSheetId=${diagnostics.masterSheetId}` : "",
    diagnostics?.failedStep ? `failedStep=${diagnostics.failedStep}` : "",
    diagnostics?.signedInEmail ? `signedInEmail=${diagnostics.signedInEmail}` : "",
    diagnostics?.dataSource ? `dataSource=${diagnostics.dataSource}` : "",
    upstreamMessage || diagnostics?.upstreamMessage
      ? `upstreamMessage=${upstreamMessage || diagnostics?.upstreamMessage}`
      : "",
  ].filter(Boolean);
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
    reasonCode?: string;
    warning?: string;
    technicalError?: string;
    diagnostics?: CompanyMembersDiagnostics;
  }>(apiUrl(path), { signal: input.signal });

  if (!result.ok) {
    const transportDetail = [
      result.code,
      result.message,
      result.diagnostics?.url ? `url=${result.diagnostics.url}` : "",
      result.diagnostics?.status ? `status=${result.diagnostics.status}` : "",
    ]
      .filter(Boolean)
      .join(" — ");
    return {
      ok: false,
      members: [],
      loadError: COMPANY_MEMBERS_USER_MESSAGE,
      loadErrorDetail: transportDetail || COMPANY_MEMBERS_USER_MESSAGE,
    };
  }

  const { data: payload, response } = result;
  if (!response.ok || payload.ok === false) {
    const diagnostics = payload.diagnostics;
    return {
      ok: false,
      members: [],
      loadError: COMPANY_MEMBERS_USER_MESSAGE,
      loadErrorDetail: buildLoadErrorDetail(
        payload.reasonCode || payload.code,
        diagnostics,
        payload.message || payload.error || payload.technicalError,
      ),
      diagnostics,
    };
  }

  return {
    ok: true,
    members: Array.isArray(payload.users) ? payload.users : [],
    warning: payload.warning,
    diagnostics: payload.diagnostics,
  };
}
