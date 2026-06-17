import type { Role } from "../permissions";
import type { UserInvite } from "../types/adminScreenProps";
import { fetchJson } from "../utils/fetchJson";
import { companyUserInvitePath } from "../utils/inviteRoutes";

export const COMPANY_INVITES_LOAD_TIMEOUT_MS = 30_000;
export const COMPANY_INVITES_LOADING_MESSAGE = "Loading pending invites…";
export const COMPANY_INVITES_USER_MESSAGE = "Could not load pending invites.";
export const COMPANY_INVITES_LOAD_TIMEOUT_MESSAGE =
  "Loading pending invites timed out. Refresh the page or try again in a moment.";

export type ServerCompanyUserInvite = {
  id?: string;
  tokenId?: string;
  email?: string;
  role?: string;
  invitedBy?: string;
  companyId?: string;
  companyFolderId?: string;
  status?: string;
  pending?: boolean;
  createdAt?: number | null;
  expiresAt?: number | null;
  consumedAt?: number | null;
  inviteUrl?: string;
};

function buildCompanyUserInviteUrl(tokenId: string): string | undefined {
  const trimmed = String(tokenId || "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${companyUserInvitePath(trimmed)}`;
  }
  return companyUserInvitePath(trimmed);
}

function formatInviteSentAt(createdAt: number | null | undefined): string {
  if (!createdAt || !Number.isFinite(createdAt)) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(createdAt));
  } catch {
    return "";
  }
}

function mapPendingInviteStatus(record: ServerCompanyUserInvite): UserInvite["status"] {
  const status = String(record.status || "").trim().toUpperCase();
  if (status === "PENDING" || record.pending === true) {
    return "Awaiting setup";
  }
  if (status === "SETUP_INCOMPLETE") {
    return "Stale invite";
  }
  return "Invite created";
}

export function mapServerInviteToUserInvite(record: ServerCompanyUserInvite): UserInvite | null {
  const email = String(record.email || "").trim().toLowerCase();
  if (!email) {
    return null;
  }
  const tokenId = String(record.tokenId || record.id || "").trim();
  const appOnboardingUrl = String(record.inviteUrl || "").trim() || buildCompanyUserInviteUrl(tokenId);
  return {
    id: tokenId || `invite-${email}`,
    tokenId: tokenId || undefined,
    email,
    role: (String(record.role || "User").trim() || "User") as Role,
    invitedBy: String(record.invitedBy || "Admin").trim() || "Admin",
    sentAt: formatInviteSentAt(record.createdAt),
    status: mapPendingInviteStatus(record),
    companyFolderId: String(record.companyFolderId || record.companyId || "").trim() || undefined,
    appOnboardingUrl: appOnboardingUrl || undefined,
    loginReady: false,
  };
}

export type FetchPendingCompanyInvitesResult = {
  ok: boolean;
  invites: UserInvite[];
  loadError?: string;
  reasonCode?: string;
};

export async function fetchPendingCompanyInvites(
  apiUrl: (path: string) => string,
  input?: { signal?: AbortSignal; companyFolderId?: string },
): Promise<FetchPendingCompanyInvitesResult> {
  const result = await fetchJson<{ ok?: boolean; invites?: ServerCompanyUserInvite[]; error?: string; code?: string }>(
    apiUrl("/api/onboarding/app-invites"),
    { signal: input?.signal },
  );

  if (!result.ok) {
    return {
      ok: false,
      invites: [],
      loadError: result.message || COMPANY_INVITES_USER_MESSAGE,
      reasonCode: result.code,
    };
  }

  const { data: payload, response } = result;
  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      invites: [],
      loadError: payload.error || COMPANY_INVITES_USER_MESSAGE,
      reasonCode: payload.code,
    };
  }

  const companyFolderId = String(input?.companyFolderId || "").trim();
  const invites: UserInvite[] = [];
  for (const record of Array.isArray(payload.invites) ? payload.invites : []) {
    if (companyFolderId) {
      const recordCompanyId = String(record.companyFolderId || record.companyId || "").trim();
      if (recordCompanyId && recordCompanyId !== companyFolderId) {
        continue;
      }
    }
    const mapped = mapServerInviteToUserInvite(record);
    if (mapped) {
      invites.push(mapped);
    }
  }

  return { ok: true, invites };
}
