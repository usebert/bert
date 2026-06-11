import type { CompanyUsersTabRow } from "../utils/scheduleAssignees";

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
};

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
    return { ok: false, members: [], loadError: "Company workspace is not selected." };
  }

  const params = new URLSearchParams();
  if (input.masterSheetId?.trim()) {
    params.set("masterSheetId", input.masterSheetId.trim());
  }
  if (input.companyName?.trim()) {
    params.set("companyName", input.companyName.trim());
  }

  const response = await fetch(
    apiUrl(`/api/companies/${encodeURIComponent(companyId)}/users?${params.toString()}`),
    { credentials: "include", signal: input.signal },
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    users?: CompanyMember[];
    message?: string;
    error?: string;
    code?: string;
  };

  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      members: [],
      loadError: payload.message || payload.error || "Could not load users from the company workbook.",
    };
  }

  return {
    ok: true,
    members: Array.isArray(payload.users) ? payload.users : [],
  };
}
