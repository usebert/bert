/**
 * Operational messages client — company-scoped inbox. Never preloaded at login.
 */
import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  OperationalMessage,
  OperationalMessageInput,
  OperationalMessagesSummary,
} from "../types/operationalMessages";

export const MESSAGES_LOAD_USER_MESSAGE = "Could not load messages.";
export const MESSAGES_OFFLINE_WRITE_MESSAGE =
  "You appear to be offline. Messages need a connection — please try again when you are back online.";

export type OperationalMessagesListResponse = {
  ok: boolean;
  companyFolderId?: string;
  messages?: OperationalMessage[];
  summary?: OperationalMessagesSummary;
  message?: string;
};

async function messagesRequest(path: string, init?: RequestInit) {
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
    const baseMessage = String(payload?.error || payload?.message || "Request failed.");
    const details = String(payload?.details || "").trim();
    throw new Error(details ? `${baseMessage} ${details}` : baseMessage);
  }
  return payload;
}

type CachedList<T> = { companyFolderId: string; data: T };
const messagesCache = new Map<string, CachedList<OperationalMessagesListResponse>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

export function readCachedOperationalMessages(companyFolderId: string): OperationalMessagesListResponse | null {
  const entry = messagesCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function invalidateOperationalMessagesCache(companyFolderId?: string) {
  if (companyFolderId === undefined) {
    messagesCache.clear();
    return;
  }
  messagesCache.delete(cacheKey(companyFolderId));
}

export async function fetchOperationalMessages(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean; includeArchived?: boolean } = {},
): Promise<OperationalMessagesListResponse> {
  const folderId = cacheKey(companyFolderId);
  const query = options.includeArchived ? "?includeArchived=1" : "";
  const path = `/api/companies/${encodeURIComponent(folderId)}/messages${query}`;
  const run = async () => {
    const payload = (await messagesRequest(path, { signal: options.signal })) as OperationalMessagesListResponse;
    if (!options.includeArchived) {
      messagesCache.set(folderId, { companyFolderId: folderId, data: payload });
    }
    return payload;
  };
  if (options.signal || options.refresh || options.includeArchived) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<OperationalMessagesListResponse>;
}

export async function createOperationalMessage(companyFolderId: string, input: OperationalMessageInput) {
  const result = await messagesRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  invalidateOperationalMessagesCache(companyFolderId);
  return result as { ok: boolean; message?: OperationalMessage };
}

export async function markOperationalMessageRead(companyFolderId: string, messageId: string) {
  const result = await messagesRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/messages/${encodeURIComponent(messageId)}/read`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateOperationalMessagesCache(companyFolderId);
  return result as { ok: boolean; message?: OperationalMessage };
}

export async function archiveOperationalMessage(companyFolderId: string, messageId: string) {
  const result = await messagesRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/messages/${encodeURIComponent(messageId)}/archive`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateOperationalMessagesCache(companyFolderId);
  return result as { ok: boolean; message?: OperationalMessage };
}
