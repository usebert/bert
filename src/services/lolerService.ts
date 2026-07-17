/**
 * LOLER equipment client service — company-scoped reads with in-flight dedupe
 * and a small in-memory cache preserved during background refresh.
 */
import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  LolerEquipment,
  LolerEquipmentInput,
  LolerEquipmentSummary,
  LolerExamination,
  LolerExaminationInput,
  LolerSchedule,
} from "../types/loler";

export const LOLER_LOAD_USER_MESSAGE = "Could not load LOLER equipment.";
export const LOLER_OFFLINE_WRITE_MESSAGE =
  "You appear to be offline. LOLER changes need a connection — please try again when you are back online.";

export type LolerEquipmentListResponse = {
  ok: boolean;
  companyFolderId?: string;
  equipment?: LolerEquipment[];
  summary?: LolerEquipmentSummary;
  message?: string;
};

export type LolerSchedulesResponse = {
  ok: boolean;
  companyFolderId?: string;
  schedules?: LolerSchedule[];
  message?: string;
};

export type LolerExaminationsResponse = {
  ok: boolean;
  companyFolderId?: string;
  examinations?: LolerExamination[];
  message?: string;
};

async function lolerRequest(path: string, init?: RequestInit) {
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

const equipmentCache = new Map<string, CachedList<LolerEquipmentListResponse>>();
const schedulesCache = new Map<string, CachedList<LolerSchedulesResponse>>();
const examinationsCache = new Map<string, CachedList<LolerExaminationsResponse>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

/** Last successful equipment list for this company, or null. Never crosses companies. */
export function readCachedLolerEquipment(companyFolderId: string): LolerEquipmentListResponse | null {
  const entry = equipmentCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function readCachedLolerSchedules(companyFolderId: string): LolerSchedulesResponse | null {
  const entry = schedulesCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function readCachedLolerExaminations(companyFolderId: string): LolerExaminationsResponse | null {
  const entry = examinationsCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function invalidateLolerCache(companyFolderId?: string) {
  if (companyFolderId === undefined) {
    equipmentCache.clear();
    schedulesCache.clear();
    examinationsCache.clear();
    return;
  }
  equipmentCache.delete(cacheKey(companyFolderId));
  schedulesCache.delete(cacheKey(companyFolderId));
  examinationsCache.delete(cacheKey(companyFolderId));
}

export async function fetchLolerEquipment(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<LolerEquipmentListResponse> {
  const folderId = cacheKey(companyFolderId);
  const path = `/api/companies/${encodeURIComponent(folderId)}/loler/equipment`;
  const run = async () => {
    const payload = (await lolerRequest(path, { signal: options.signal })) as LolerEquipmentListResponse;
    equipmentCache.set(folderId, { companyFolderId: folderId, data: payload });
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<LolerEquipmentListResponse>;
}

export async function fetchLolerSchedules(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<LolerSchedulesResponse> {
  const folderId = cacheKey(companyFolderId);
  const path = `/api/companies/${encodeURIComponent(folderId)}/loler/schedules`;
  const run = async () => {
    const payload = (await lolerRequest(path, { signal: options.signal })) as LolerSchedulesResponse;
    schedulesCache.set(folderId, { companyFolderId: folderId, data: payload });
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<LolerSchedulesResponse>;
}

export async function fetchLolerExaminations(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean; equipmentId?: string } = {},
): Promise<LolerExaminationsResponse> {
  const folderId = cacheKey(companyFolderId);
  const query = options.equipmentId
    ? `?equipmentId=${encodeURIComponent(options.equipmentId)}`
    : "";
  const path = `/api/companies/${encodeURIComponent(folderId)}/loler/examinations${query}`;
  const run = async () => {
    const payload = (await lolerRequest(path, { signal: options.signal })) as LolerExaminationsResponse;
    if (!options.equipmentId) {
      examinationsCache.set(folderId, { companyFolderId: folderId, data: payload });
    }
    return payload;
  };
  if (options.signal || options.refresh || options.equipmentId) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<LolerExaminationsResponse>;
}

export async function recordLolerExamination(companyFolderId: string, input: LolerExaminationInput) {
  const result = (await lolerRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/loler/examinations`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as {
    ok: boolean;
    examination?: LolerExamination;
    equipment?: LolerEquipment;
    requiresAttention?: boolean;
    message?: string;
  };
  invalidateLolerCache(companyFolderId);
  return result;
}

export async function createLolerEquipment(companyFolderId: string, input: LolerEquipmentInput) {
  const result = (await lolerRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as { ok: boolean; equipment?: LolerEquipment };
  invalidateLolerCache(companyFolderId);
  return result;
}

export async function updateLolerEquipment(
  companyFolderId: string,
  equipmentId: string,
  input: Partial<LolerEquipmentInput>,
) {
  const result = (await lolerRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment/${encodeURIComponent(equipmentId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  )) as { ok: boolean; equipment?: LolerEquipment };
  invalidateLolerCache(companyFolderId);
  return result;
}

async function postLolerEquipmentAction(
  companyFolderId: string,
  equipmentId: string,
  action: "archive" | "out-of-service" | "return-to-service",
  body?: Record<string, unknown>,
) {
  const result = (await lolerRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/equipment/${encodeURIComponent(equipmentId)}/${action}`,
    { method: "POST", body: JSON.stringify(body || {}) },
  )) as { ok: boolean; equipment?: LolerEquipment };
  invalidateLolerCache(companyFolderId);
  return result;
}

export async function archiveLolerEquipment(companyFolderId: string, equipmentId: string) {
  return postLolerEquipmentAction(companyFolderId, equipmentId, "archive");
}

export async function markLolerEquipmentOutOfService(companyFolderId: string, equipmentId: string) {
  return postLolerEquipmentAction(companyFolderId, equipmentId, "out-of-service");
}

export async function returnLolerEquipmentToService(
  companyFolderId: string,
  equipmentId: string,
  input: { nextExaminationDueDate?: string; lastExaminationDate?: string },
) {
  return postLolerEquipmentAction(companyFolderId, equipmentId, "return-to-service", input);
}
