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
  totalRowsRead?: number;
  activeRowsFound?: number;
  totalSheetRows?: number;
  activeSheetUsers?: number;
  cacheUsersBefore?: number;
  cacheOnlyUsersRemoved?: number;
};

export const COMPANY_MEMBERS_LOAD_TIMEOUT_MS = 8000;
export const COMPANY_MEMBERS_LOADING_MESSAGE = "Loading company users…";
export const COMPANY_MEMBERS_USER_MESSAGE = "Could not load company users.";

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
  reasonCode?: string;
  failedStep?: string;
  diagnostics?: CompanyMembersDiagnostics;
};

/** Minimum viable assignee list when the Users tab API fails — signed-in user only. */
export function buildSignedInMemberFallback(input: {
  email: string;
  name?: string;
  role?: string;
  accessLevel?: string;
  companyAreas?: string[];
  companyId?: string;
  companyFolderId?: string;
  companyName?: string;
}): CompanyMember | null {
  const email = String(input.email || "").trim().toLowerCase();
  if (!email) {
    return null;
  }
  const companyFolderId = String(input.companyFolderId || input.companyId || "").trim();
  const companyAreas = Array.isArray(input.companyAreas) ? input.companyAreas : [];
  return {
    email,
    name: String(input.name || email.split("@")[0] || email).trim() || email,
    role: String(input.role || "User").trim() || "User",
    accessLevel: String(input.accessLevel || "").trim(),
    status: "ACTIVE",
    company: String(input.companyName || "").trim(),
    companyId: companyFolderId,
    companyFolderId,
    companyAreas,
    companyAreasRaw: companyAreas.join(", "),
  };
}

function buildLoadErrorDetail(
  reasonCode: string | undefined,
  diagnostics?: CompanyMembersDiagnostics,
  upstreamMessage?: string,
  failedStep?: string,
): string {
  const parts = [
    reasonCode,
    failedStep || diagnostics?.failedStep ? `failedStep=${failedStep || diagnostics?.failedStep}` : "",
    diagnostics?.companyId ? `companyId=${diagnostics.companyId}` : "",
    diagnostics?.companyFolderId ? `companyFolderId=${diagnostics.companyFolderId}` : "",
    diagnostics?.masterSheetId ? `masterSheetId=${diagnostics.masterSheetId}` : "",
    diagnostics?.signedInEmail ? `signedInEmail=${diagnostics.signedInEmail}` : "",
    diagnostics?.dataSource ? `dataSource=${diagnostics.dataSource}` : "",
    typeof diagnostics?.totalRowsRead === "number" ? `totalRowsRead=${diagnostics.totalRowsRead}` : "",
    typeof diagnostics?.activeRowsFound === "number" ? `activeRowsFound=${diagnostics.activeRowsFound}` : "",
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
      loadErrorDetail: "No company linked.",
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
    failedStep?: string;
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
      reasonCode: result.code,
      failedStep: "client_fetch",
      diagnostics: {
        companyId,
        companyFolderId: companyId,
        companyName: input.companyName?.trim() || undefined,
        masterSheetId: input.masterSheetId?.trim() || undefined,
        failedStep: "client_fetch",
        upstreamMessage: result.message,
        upstreamStatus: result.diagnostics?.status,
        dataSource: "users_tab",
      },
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
        payload.failedStep,
      ),
      reasonCode: payload.reasonCode || payload.code,
      failedStep: payload.failedStep || diagnostics?.failedStep,
      diagnostics,
    };
  }

  return {
    ok: true,
    members: Array.isArray(payload.users) ? payload.users : [],
    warning: payload.warning,
    reasonCode: payload.reasonCode,
    failedStep: payload.failedStep || payload.diagnostics?.failedStep,
    diagnostics: payload.diagnostics,
  };
}

/** Alias — listActiveUsers reads Users tab; never returns PasswordHash. */
export { fetchCompanyMembers as listActiveUsers };

/** Canonical client entry — same GET /api/companies/:companyId/users as page load and Re-sync. */
export { fetchCompanyMembers as syncAndListActiveUsers };

export type UpdateCompanyMemberInput = {
  companyId: string;
  email: string;
  masterSheetId: string;
  name?: string;
  role?: string;
  status?: string;
  companyAreas?: string[];
};

export async function updateCompanyMember(
  apiUrl: (path: string) => string,
  input: UpdateCompanyMemberInput,
): Promise<{ ok: boolean; user?: CompanyMember; error?: string }> {
  const companyId = input.companyId.trim();
  const email = input.email.trim().toLowerCase();
  const masterSheetId = input.masterSheetId.trim();
  if (!companyId || !email || !masterSheetId) {
    return { ok: false, error: "Company workspace and user email are required." };
  }

  const params = new URLSearchParams({ masterSheetId });
  const path = `/api/companies/${encodeURIComponent(companyId)}/users/${encodeURIComponent(email)}?${params.toString()}`;
  const result = await fetchJson<{ ok?: boolean; user?: CompanyMember; error?: string }>(apiUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      masterSheetId,
      name: input.name,
      role: input.role,
      status: input.status,
      companyAreas: input.companyAreas,
    }),
  });

  if (!result.ok) {
    return { ok: false, error: result.message || "Could not update user." };
  }

  const { data: payload, response } = result;
  if (!response.ok || payload.ok === false) {
    return { ok: false, error: payload.error || "Could not update user." };
  }

  return { ok: true, user: payload.user };
}
