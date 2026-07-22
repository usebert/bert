/**
 * Risk Assessments client service — company-scoped reads with cache and dedupe.
 */
import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "../utils/requestDedupe";
import type {
  RiskAssessmentDetail,
  RiskAssessmentInput,
  RiskAssessmentRecord,
  RiskHazardInput,
  RiskHazardRecord,
  RiskLinkInput,
  RiskLinkRecord,
  RiskReviewInput,
  RiskReviewRecord,
} from "../types/riskAssessment";

export const RISK_ASSESSMENT_LOAD_USER_MESSAGE = "Could not load risk assessments.";
export const RISK_ASSESSMENT_OFFLINE_WRITE_MESSAGE =
  "You appear to be offline. Risk assessment changes need a connection — please try again when you are back online.";
export const RISK_ASSESSMENT_VALIDATION_USER_MESSAGE =
  "The assessment needs more information before it can be submitted.";
export const RISK_ASSESSMENT_TIMEOUT_USER_MESSAGE =
  "BERT could not finish saving this assessment in time. Your entered information is still available. Try saving the draft again.";
export const RISK_ASSESSMENT_CONNECTIVITY_USER_MESSAGE =
  "The assessment could not be saved because the service could not be reached.";

export type RiskAssessmentFieldError = {
  step: string;
  field: string;
  message: string;
};

export class RiskAssessmentRequestError extends Error {
  code?: string;
  fieldErrors: RiskAssessmentFieldError[];

  constructor(message: string, options: { code?: string; fieldErrors?: RiskAssessmentFieldError[] } = {}) {
    super(message);
    this.name = "RiskAssessmentRequestError";
    this.code = options.code;
    this.fieldErrors = options.fieldErrors || [];
  }
}

function mapRiskAssessmentError(payload: Record<string, unknown>, response: Response) {
  const code = String(payload?.code || "").trim();
  const baseMessage = String(payload?.error || payload?.message || "Request failed.");
  const details = String(payload?.details || "").trim();
  const combined = `${baseMessage} ${details}`.trim();

  if (code === "risk_assessment_validation_failed") {
    throw new RiskAssessmentRequestError(RISK_ASSESSMENT_VALIDATION_USER_MESSAGE, {
      code,
      fieldErrors: Array.isArray(payload?.fieldErrors) ? (payload.fieldErrors as RiskAssessmentFieldError[]) : [],
    });
  }
  if (/timed out|90000/i.test(combined)) {
    throw new Error(RISK_ASSESSMENT_TIMEOUT_USER_MESSAGE);
  }
  if (!response.ok && response.status >= 500) {
    throw new Error(RISK_ASSESSMENT_CONNECTIVITY_USER_MESSAGE);
  }
  throw new Error(details ? `${baseMessage} ${details}` : baseMessage);
}

async function riskAssessmentRequest(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      credentials: "include",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error(RISK_ASSESSMENT_CONNECTIVITY_USER_MESSAGE);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    mapRiskAssessmentError(payload, response);
  }
  return payload;
}

type CachedEntry<T> = { companyFolderId: string; data: T };

const listCache = new Map<string, CachedEntry<{ items: RiskAssessmentRecord[] }>>();
const detailCache = new Map<string, CachedEntry<RiskAssessmentDetail>>();

function cacheKey(companyFolderId: string) {
  return String(companyFolderId || "").trim();
}

function detailCacheKey(companyFolderId: string, riskAssessmentId: string) {
  return `${cacheKey(companyFolderId)}::${String(riskAssessmentId || "").trim()}`;
}

export function readCachedRiskAssessmentList(companyFolderId: string) {
  return listCache.get(cacheKey(companyFolderId))?.data || null;
}

export function readCachedRiskAssessmentDetail(companyFolderId: string, riskAssessmentId: string) {
  return detailCache.get(detailCacheKey(companyFolderId, riskAssessmentId))?.data || null;
}

export function invalidateRiskAssessmentCache(companyFolderId?: string, riskAssessmentId?: string) {
  if (!companyFolderId) {
    listCache.clear();
    detailCache.clear();
    return;
  }
  const folderId = cacheKey(companyFolderId);
  listCache.delete(folderId);
  if (riskAssessmentId) {
    detailCache.delete(detailCacheKey(folderId, riskAssessmentId));
  } else {
    for (const key of detailCache.keys()) {
      if (key.startsWith(`${folderId}::`)) detailCache.delete(key);
    }
  }
}

export async function fetchRiskAssessmentList(
  companyFolderId: string,
  options: { signal?: AbortSignal; refresh?: boolean; includeArchived?: boolean } = {},
) {
  const folderId = cacheKey(companyFolderId);
  const query = options.includeArchived ? "?includeArchived=true" : "";
  const path = `/api/companies/${encodeURIComponent(folderId)}/risk-assessments${query}`;
  const run = async () => {
    const payload = await riskAssessmentRequest(path, { signal: options.signal });
    listCache.set(folderId, { companyFolderId: folderId, data: { items: payload.items || [] } });
    return payload as { ok: boolean; items: RiskAssessmentRecord[] };
  };
  if (options.signal || options.refresh) return run();
  return dedupeInFlight(requestDedupeKey("GET", path), run);
}

export async function fetchRiskAssessmentDetail(
  companyFolderId: string,
  riskAssessmentId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
) {
  const folderId = cacheKey(companyFolderId);
  const id = String(riskAssessmentId || "").trim();
  const path = `/api/companies/${encodeURIComponent(folderId)}/risk-assessments/${encodeURIComponent(id)}`;
  const run = async () => {
    const payload = await riskAssessmentRequest(path, { signal: options.signal });
    const detail: RiskAssessmentDetail = {
      item: payload.item,
      hazards: payload.hazards || [],
      links: payload.links || [],
      reviews: payload.reviews || [],
    };
    detailCache.set(detailCacheKey(folderId, id), { companyFolderId: folderId, data: detail });
    return payload as { ok: boolean } & RiskAssessmentDetail;
  };
  if (options.signal || options.refresh) return run();
  return dedupeInFlight(requestDedupeKey("GET", path), run);
}

export async function createRiskAssessment(companyFolderId: string, input: RiskAssessmentInput) {
  const payload = await riskAssessmentRequest(`/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  invalidateRiskAssessmentCache(companyFolderId);
  return payload;
}

export async function saveRiskAssessmentDraft(
  companyFolderId: string,
  riskAssessmentId: string | null | undefined,
  input: Partial<RiskAssessmentInput> & { hazards?: Array<RiskHazardInput & { id?: string }> },
) {
  const folderId = cacheKey(companyFolderId);
  const id = String(riskAssessmentId || "").trim();
  const path = id
    ? `/api/companies/${encodeURIComponent(folderId)}/risk-assessments/${encodeURIComponent(id)}/save-draft`
    : `/api/companies/${encodeURIComponent(folderId)}/risk-assessments/draft`;
  const payload = await riskAssessmentRequest(path, { method: "POST", body: JSON.stringify(input) });
  invalidateRiskAssessmentCache(companyFolderId, id || payload?.item?.id);
  return payload as { ok: boolean } & RiskAssessmentDetail;
}

export async function updateRiskAssessment(
  companyFolderId: string,
  riskAssessmentId: string,
  input: Partial<RiskAssessmentInput> & { createActions?: boolean; recalculateRisk?: boolean; hazards?: Array<RiskHazardInput & { id?: string }> },
) {
  if (Array.isArray(input.hazards)) {
    return saveRiskAssessmentDraft(companyFolderId, riskAssessmentId, input);
  }
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function submitRiskAssessment(companyFolderId: string, riskAssessmentId: string) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/submit`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function approveRiskAssessment(
  companyFolderId: string,
  riskAssessmentId: string,
  input: { activateNow?: boolean } = {},
) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/approve`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function rejectRiskAssessment(
  companyFolderId: string,
  riskAssessmentId: string,
  input: { rejectionReason: string },
) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/reject`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function archiveRiskAssessment(companyFolderId: string, riskAssessmentId: string) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/archive`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function restoreRiskAssessment(companyFolderId: string, riskAssessmentId: string) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/restore`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function reviewRiskAssessment(
  companyFolderId: string,
  riskAssessmentId: string,
  input: RiskReviewInput,
) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/review`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload;
}

export async function createRiskAssessmentVersion(companyFolderId: string, riskAssessmentId: string) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/new-version`,
    { method: "POST", body: JSON.stringify({}) },
  );
  invalidateRiskAssessmentCache(companyFolderId);
  return payload;
}

export async function createRiskHazard(companyFolderId: string, riskAssessmentId: string, input: RiskHazardInput) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/hazards`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload as { ok: boolean; item: RiskHazardRecord };
}

export async function updateRiskHazard(companyFolderId: string, hazardId: string, input: Partial<RiskHazardInput>) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessment-hazards/${encodeURIComponent(hazardId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId);
  return payload as { ok: boolean; item: RiskHazardRecord };
}

export async function archiveRiskHazard(companyFolderId: string, hazardId: string) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessment-hazards/${encodeURIComponent(hazardId)}`,
    { method: "DELETE" },
  );
  invalidateRiskAssessmentCache(companyFolderId);
  return payload;
}

export async function createRiskLink(companyFolderId: string, riskAssessmentId: string, input: RiskLinkInput) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/links`,
    { method: "POST", body: JSON.stringify(input) },
  );
  invalidateRiskAssessmentCache(companyFolderId, riskAssessmentId);
  return payload as { ok: boolean; item: RiskLinkRecord };
}

export async function archiveRiskLink(companyFolderId: string, linkId: string) {
  const payload = await riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessment-links/${encodeURIComponent(linkId)}`,
    { method: "DELETE" },
  );
  invalidateRiskAssessmentCache(companyFolderId);
  return payload;
}

export async function fetchRiskAssessmentReviews(companyFolderId: string, riskAssessmentId: string) {
  return riskAssessmentRequest(
    `/api/companies/${encodeURIComponent(companyFolderId)}/risk-assessments/${encodeURIComponent(riskAssessmentId)}/reviews`,
  ) as Promise<{ ok: boolean; items: RiskReviewRecord[] }>;
}

export function calculateClientRiskScore(likelihood: number, severity: number) {
  if (!Number.isInteger(likelihood) || !Number.isInteger(severity) || likelihood < 1 || likelihood > 5 || severity < 1 || severity > 5) {
    return 0;
  }
  return likelihood * severity;
}

export function getClientRiskBand(score: number) {
  if (score <= 0) return { band: "unknown", label: "Not assessed", level: "neutral" as const };
  if (score <= 4) return { band: "low", label: "Low", level: "success" as const };
  if (score <= 9) return { band: "moderate", label: "Moderate", level: "info" as const };
  if (score <= 16) return { band: "high", label: "High", level: "warning" as const };
  return { band: "very_high", label: "Very High", level: "danger" as const };
}
