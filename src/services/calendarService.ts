/**
 * Calendar client service — company-scoped reads with in-flight dedupe
 * and a small in-memory cache. Never preloaded at login.
 */
import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type { CalendarItem, CalendarItemInput, CalendarItemsSummary } from "../types/calendar";

export const CALENDAR_LOAD_USER_MESSAGE = "Could not load calendar items.";
export const CALENDAR_OFFLINE_WRITE_MESSAGE =
  "You appear to be offline. Calendar changes need a connection — please try again when you are back online.";

export type CalendarItemsListResponse = {
  ok: boolean;
  companyFolderId?: string;
  items?: CalendarItem[];
  summary?: CalendarItemsSummary;
  message?: string;
};

async function calendarRequest(path: string, init?: RequestInit) {
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

const itemsCache = new Map<string, CachedList<CalendarItemsListResponse>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

/** Last successful calendar list for this company, or null. Never crosses companies. */
export function readCachedCalendarItems(companyFolderId: string): CalendarItemsListResponse | null {
  const entry = itemsCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function invalidateCalendarCache(companyFolderId?: string) {
  if (companyFolderId === undefined) {
    itemsCache.clear();
    return;
  }
  itemsCache.delete(cacheKey(companyFolderId));
}

export async function fetchCalendarItems(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<CalendarItemsListResponse> {
  const folderId = cacheKey(companyFolderId);
  const path = `/api/companies/${encodeURIComponent(folderId)}/calendar/items`;
  const run = async () => {
    const payload = (await calendarRequest(path, { signal: options.signal })) as CalendarItemsListResponse;
    itemsCache.set(folderId, { companyFolderId: folderId, data: payload });
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<CalendarItemsListResponse>;
}

export async function createCalendarItem(companyFolderId: string, input: CalendarItemInput) {
  const result = (await calendarRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/calendar/items`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as { ok: boolean; item?: CalendarItem };
  invalidateCalendarCache(companyFolderId);
  return result;
}

export async function updateCalendarItem(
  companyFolderId: string,
  itemId: string,
  input: Partial<CalendarItemInput>,
) {
  const result = (await calendarRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/calendar/items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  )) as { ok: boolean; item?: CalendarItem };
  invalidateCalendarCache(companyFolderId);
  return result;
}

export async function completeCalendarItem(companyFolderId: string, itemId: string) {
  const result = (await calendarRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/calendar/items/${encodeURIComponent(itemId)}/complete`,
    { method: "POST", body: JSON.stringify({}) },
  )) as { ok: boolean; item?: CalendarItem };
  invalidateCalendarCache(companyFolderId);
  return result;
}

export async function archiveCalendarItem(companyFolderId: string, itemId: string) {
  const result = (await calendarRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/calendar/items/${encodeURIComponent(itemId)}/archive`,
    { method: "POST", body: JSON.stringify({}) },
  )) as { ok: boolean; item?: CalendarItem };
  invalidateCalendarCache(companyFolderId);
  return result;
}
