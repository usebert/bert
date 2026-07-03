import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  BriefingCreateInput,
  BriefingRecipientRecord,
  BriefingRecord,
} from "../types/briefings";

export const BRIEFINGS_USER_MESSAGE = "Could not load briefings.";
export const BRIEFINGS_SEND_USER_MESSAGE = "Could not send briefing.";

type BriefingMineResponse = {
  ok: boolean;
  items?: Array<BriefingRecipientRecord & { needsAction?: boolean; briefing?: BriefingRecord }>;
  message?: string;
};

type BriefingTrackerItem = BriefingRecord & {
  counts: {
    sent: number;
    openedCount: number;
    readCount: number;
    acknowledgedCount: number;
    signedCount: number;
    replyCount: number;
    overdueCount: number;
  };
  recipients: Array<BriefingRecipientRecord & { needsAction?: boolean }>;
};

async function briefingRequest(path: string, init?: RequestInit) {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const message = String(payload?.message || payload?.error || "Request failed.");
    throw new Error(message);
  }
  return payload;
}

export async function fetchMyBriefings(companyFolderId: string, options: { signal?: AbortSignal } = {}) {
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/mine`;
  const dedupeKey = requestDedupeKey("GET", path);
  if (options.signal) {
    return briefingRequest(path, { signal: options.signal }) as Promise<BriefingMineResponse>;
  }
  return dedupeInFlight(dedupeKey, () => briefingRequest(path)) as Promise<BriefingMineResponse>;
}

export async function fetchBriefingsTodoPreview(
  companyFolderId: string,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  const limit = options.limit ?? 5;
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/todo?limit=${limit}`;
  const dedupeKey = requestDedupeKey("GET", path);
  if (options.signal) {
    return briefingRequest(path, { signal: options.signal }) as Promise<BriefingMineResponse>;
  }
  return dedupeInFlight(dedupeKey, () => briefingRequest(path)) as Promise<BriefingMineResponse>;
}

export async function fetchBriefingsTracker(companyFolderId: string, options: { signal?: AbortSignal } = {}) {
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/tracker`;
  return briefingRequest(path, { signal: options.signal }) as Promise<{ ok: boolean; items?: BriefingTrackerItem[] }>;
}

export async function sendBriefing(companyFolderId: string, input: BriefingCreateInput) {
  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/briefings`;
  return briefingRequest(path, {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ ok: boolean; briefing?: BriefingRecord; recipientCount?: number }>;
}

export async function openBriefingItem(companyFolderId: string, briefingId: string) {
  return briefingRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/briefings/${encodeURIComponent(briefingId)}/open`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function readBriefingItem(companyFolderId: string, briefingId: string) {
  return briefingRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/briefings/${encodeURIComponent(briefingId)}/read`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function acknowledgeBriefingItem(companyFolderId: string, briefingId: string) {
  return briefingRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/briefings/${encodeURIComponent(briefingId)}/acknowledge`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function signBriefingItem(companyFolderId: string, briefingId: string, signatureName: string) {
  return briefingRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/briefings/${encodeURIComponent(briefingId)}/sign`, {
    method: "POST",
    body: JSON.stringify({ signatureName }),
  });
}

export async function replyToBriefingItem(companyFolderId: string, briefingId: string, replyText: string) {
  return briefingRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/briefings/${encodeURIComponent(briefingId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ replyText }),
  });
}
