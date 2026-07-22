/**
 * LOLER examination client service — company-scoped examination list / record.
 * Extracted from lolerService.ts; API paths and payload fields unchanged.
 */
import { logApiFetchFailure, normalizeApiFetchError, resolveApiRequestUrl } from "../utils/apiFetchDiagnostics";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type { LolerEquipment, LolerExamination, LolerExaminationInput } from "../types/loler";

export const LOLER_EXAMINATIONS_LOAD_USER_MESSAGE =
  "Equipment data could not be loaded. Check your connection and try again.";

export type LolerExaminationsResponse = {
  ok: boolean;
  companyFolderId?: string;
  examinations?: LolerExamination[];
  message?: string;
};

async function examinationRequest(path: string, init?: RequestInit, context: { companyFolderId?: string } = {}) {
  const method = String(init?.method || "GET").toUpperCase();
  const url = resolveApiRequestUrl(path);
  try {
    const response = await fetch(url, {
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
  } catch (error) {
    logApiFetchFailure({ url, method, companyFolderId: context.companyFolderId, error });
    throw normalizeApiFetchError(error, LOLER_EXAMINATIONS_LOAD_USER_MESSAGE);
  }
}

type CachedList<T> = { companyFolderId: string; data: T };

const examinationsCache = new Map<string, CachedList<LolerExaminationsResponse>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

/** Last successful examinations list for this company, or null. Never crosses companies. */
export function readCachedLolerExaminations(companyFolderId: string): LolerExaminationsResponse | null {
  const entry = examinationsCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function invalidateLolerExaminationsCache(companyFolderId?: string) {
  if (companyFolderId === undefined) {
    examinationsCache.clear();
    return;
  }
  examinationsCache.delete(cacheKey(companyFolderId));
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
    const payload = (await examinationRequest(path, { signal: options.signal }, { companyFolderId: folderId })) as LolerExaminationsResponse;
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
  const result = (await examinationRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/loler/examinations`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    { companyFolderId },
  )) as {
    ok: boolean;
    examination?: LolerExamination;
    equipment?: LolerEquipment;
    requiresAttention?: boolean;
    message?: string;
  };
  invalidateLolerExaminationsCache(companyFolderId);
  return result;
}
