/**
 * Health & Safety client service — company-scoped reads with in-flight dedupe
 * and a small in-memory cache preserved during background refresh.
 */
import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  CoshhAssessment,
  CoshhAssessmentInput,
  CoshhRecord,
  CoshhRecordInput,
  HealthSafetyOverview,
  RiddorAssessmentInput,
  RiddorEvaluation,
  RiddorRecord,
  RiddorRecordInput,
} from "../types/healthSafety";

export const HEALTH_SAFETY_LOAD_USER_MESSAGE = "Could not load Health & Safety data.";
export const HEALTH_SAFETY_OFFLINE_WRITE_MESSAGE =
  "You appear to be offline. Health & Safety changes need a connection — please try again when you are back online.";

export type CoshhListResponse = {
  ok: boolean;
  items?: CoshhRecord[];
  message?: string;
};

export type CoshhItemResponse = {
  ok: boolean;
  item?: CoshhRecord;
  message?: string;
};

export type CoshhAssessmentsResponse = {
  ok: boolean;
  items?: CoshhAssessment[];
  message?: string;
};

export type CoshhAssessmentResponse = {
  ok: boolean;
  item?: CoshhAssessment;
  message?: string;
};

export type RiddorListResponse = {
  ok: boolean;
  items?: RiddorRecord[];
  message?: string;
};

export type RiddorItemResponse = {
  ok: boolean;
  item?: RiddorRecord;
  message?: string;
};

export type HealthSafetyOverviewResponse = {
  ok: boolean;
  summary?: HealthSafetyOverview["summary"];
  attention?: HealthSafetyOverview["attention"];
  message?: string;
};

export type RiddorAssessmentResponse = {
  ok: boolean;
  item?: RiddorRecord;
  evaluation?: RiddorEvaluation;
  message?: string;
};

async function healthSafetyRequest(path: string, init?: RequestInit) {
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

type CachedEntry<T> = { companyFolderId: string; data: T };

const overviewCache = new Map<string, CachedEntry<HealthSafetyOverviewResponse>>();
const coshhCache = new Map<string, CachedEntry<CoshhListResponse>>();
const riddorCache = new Map<string, CachedEntry<RiddorListResponse>>();
const assessmentsCache = new Map<string, CachedEntry<CoshhAssessmentsResponse>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

function assessmentsCacheKey(companyFolderId: string, coshhId: string) {
  return `${cacheKey(companyFolderId)}::${String(coshhId || "").trim()}`;
}

export function readCachedHealthSafetyOverview(companyFolderId: string): HealthSafetyOverviewResponse | null {
  const entry = overviewCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function readCachedCoshhList(companyFolderId: string): CoshhListResponse | null {
  const entry = coshhCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function readCachedRiddorList(companyFolderId: string): RiddorListResponse | null {
  const entry = riddorCache.get(cacheKey(companyFolderId));
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function readCachedCoshhAssessments(companyFolderId: string, coshhId: string): CoshhAssessmentsResponse | null {
  const key = assessmentsCacheKey(companyFolderId, coshhId);
  const entry = assessmentsCache.get(key);
  return entry && entry.companyFolderId === cacheKey(companyFolderId) ? entry.data : null;
}

export function invalidateHealthSafetyCache(companyFolderId?: string) {
  if (companyFolderId === undefined) {
    overviewCache.clear();
    coshhCache.clear();
    riddorCache.clear();
    assessmentsCache.clear();
    return;
  }
  const folderId = cacheKey(companyFolderId);
  overviewCache.delete(folderId);
  coshhCache.delete(folderId);
  riddorCache.delete(folderId);
  for (const key of assessmentsCache.keys()) {
    if (key.startsWith(`${folderId}::`)) {
      assessmentsCache.delete(key);
    }
  }
}

export async function fetchHealthSafetyOverview(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<HealthSafetyOverviewResponse> {
  const folderId = cacheKey(companyFolderId);
  const path = `/api/companies/${encodeURIComponent(folderId)}/health-safety/overview`;
  const run = async () => {
    const payload = (await healthSafetyRequest(path, { signal: options.signal })) as HealthSafetyOverviewResponse;
    overviewCache.set(folderId, { companyFolderId: folderId, data: payload });
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<HealthSafetyOverviewResponse>;
}

export async function fetchCoshhList(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean; includeArchived?: boolean } = {},
): Promise<CoshhListResponse> {
  const folderId = cacheKey(companyFolderId);
  const query = options.includeArchived ? "?includeArchived=true" : "";
  const path = `/api/companies/${encodeURIComponent(folderId)}/coshh${query}`;
  const run = async () => {
    const payload = (await healthSafetyRequest(path, { signal: options.signal })) as CoshhListResponse;
    if (!options.includeArchived) {
      coshhCache.set(folderId, { companyFolderId: folderId, data: payload });
    }
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<CoshhListResponse>;
}

export async function fetchCoshhRecord(companyFolderId: string, coshhId: string) {
  return healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}`,
  ) as Promise<CoshhItemResponse>;
}

export async function createCoshhRecord(companyFolderId: string, input: CoshhRecordInput) {
  const result = (await healthSafetyRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/coshh`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as CoshhItemResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function updateCoshhRecord(companyFolderId: string, coshhId: string, input: Partial<CoshhRecordInput>) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  )) as CoshhItemResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function archiveCoshhRecord(companyFolderId: string, coshhId: string) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}/archive`,
    { method: "POST", body: JSON.stringify({}) },
  )) as CoshhItemResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function restoreCoshhRecord(companyFolderId: string, coshhId: string) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}/restore`,
    { method: "POST", body: JSON.stringify({}) },
  )) as CoshhItemResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function fetchCoshhAssessments(
  companyFolderId: string,
  coshhId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<CoshhAssessmentsResponse> {
  const folderId = cacheKey(companyFolderId);
  const path = `/api/companies/${encodeURIComponent(folderId)}/coshh/${encodeURIComponent(coshhId)}/assessments`;
  const run = async () => {
    const payload = (await healthSafetyRequest(path, { signal: options.signal })) as CoshhAssessmentsResponse;
    assessmentsCache.set(assessmentsCacheKey(folderId, coshhId), { companyFolderId: folderId, data: payload });
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<CoshhAssessmentsResponse>;
}

export async function createCoshhAssessment(companyFolderId: string, coshhId: string, input: CoshhAssessmentInput) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh/${encodeURIComponent(coshhId)}/assessments`,
    { method: "POST", body: JSON.stringify(input) },
  )) as CoshhAssessmentResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function updateCoshhAssessment(
  companyFolderId: string,
  assessmentId: string,
  input: Partial<CoshhAssessmentInput>,
) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/coshh-assessments/${encodeURIComponent(assessmentId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  )) as CoshhAssessmentResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function fetchRiddorList(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean; includeArchived?: boolean } = {},
): Promise<RiddorListResponse> {
  const folderId = cacheKey(companyFolderId);
  const query = options.includeArchived ? "?includeArchived=true" : "";
  const path = `/api/companies/${encodeURIComponent(folderId)}/riddor${query}`;
  const run = async () => {
    const payload = (await healthSafetyRequest(path, { signal: options.signal })) as RiddorListResponse;
    if (!options.includeArchived) {
      riddorCache.set(folderId, { companyFolderId: folderId, data: payload });
    }
    return payload;
  };
  if (options.signal || options.refresh) {
    return run();
  }
  return dedupeInFlight(requestDedupeKey("GET", path), run) as Promise<RiddorListResponse>;
}

export async function fetchRiddorRecord(companyFolderId: string, riddorId: string) {
  return healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/riddor/${encodeURIComponent(riddorId)}`,
  ) as Promise<RiddorItemResponse>;
}

export async function createRiddorRecord(companyFolderId: string, input: RiddorRecordInput) {
  const result = (await healthSafetyRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/riddor`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as RiddorItemResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function updateRiddorRecord(companyFolderId: string, riddorId: string, input: Partial<RiddorRecordInput>) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/riddor/${encodeURIComponent(riddorId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  )) as RiddorItemResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}

export async function assessIncidentRiddor(
  companyFolderId: string,
  incidentId: string,
  input: RiddorAssessmentInput,
) {
  const result = (await healthSafetyRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/incidents/${encodeURIComponent(incidentId)}/riddor-assessment`,
    { method: "POST", body: JSON.stringify(input) },
  )) as RiddorAssessmentResponse;
  invalidateHealthSafetyCache(companyFolderId);
  return result;
}
