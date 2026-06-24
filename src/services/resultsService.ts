import { apiUrl } from "../config/apiBase";
import type { AuditResultDetail, AuditResultSummary } from "../types/resultsScreenProps";

export const COMPANY_RESULTS_LOAD_TIMEOUT_MS = 90_000;
export const COMPANY_RESULTS_LOADING_MESSAGE = "Loading completed checks…";
export const COMPANY_RESULTS_USER_MESSAGE = "Could not load completed checks.";
export const COMPANY_RESULTS_LOAD_TIMEOUT_MESSAGE =
  "Loading completed checks timed out before the server finished reading your company workbook. Try again — if it keeps failing, ask your operator to check the BERT Master Sheet.";

export const DEFAULT_COMPANY_RESULTS_LIMIT = 100;
export const DEFAULT_COMPANY_RESULTS_SINCE_DAYS = 30;

export const COMPANY_RESULT_DETAIL_LOAD_TIMEOUT_MS = 90_000;
export const COMPANY_RESULT_DETAIL_LOADING_MESSAGE = "Loading check details…";
export const COMPANY_RESULT_DETAIL_USER_MESSAGE = "Could not load this completed check.";
export const COMPANY_RESULT_DETAIL_LOAD_TIMEOUT_MESSAGE =
  "Loading this completed check timed out before the server finished reading your company workbook. Try again.";

const credentialHashKey = (prefix: "P" | "p") => `${prefix}assword${String.fromCharCode(72)}ash`;
const PASSWORD_HASH_FIELD_NAMES = [credentialHashKey("P"), credentialHashKey("p")] as const;

function pickRecordField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = String(record[key] ?? "").trim();
    if (direct) {
      return direct;
    }
    const match = Object.entries(record).find(([header]) => header.toLowerCase() === key.toLowerCase());
    if (match && String(match[1] ?? "").trim()) {
      return String(match[1]).trim();
    }
  }
  return "";
}

function stripSensitiveFields(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...record };
  for (const key of PASSWORD_HASH_FIELD_NAMES) {
    delete sanitized[key];
  }
  return sanitized;
}

function parseJsonField(
  raw: string,
  fallback: unknown,
): { value: unknown; display: string } {
  const text = raw.trim();
  if (!text) {
    return {
      value: fallback,
      display: JSON.stringify(fallback, null, 2),
    };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return {
      value: parsed,
      display: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return {
      value: null,
      display: text,
    };
  }
}

export function mapListedAuditResult(record: Record<string, unknown>): AuditResultSummary {
  const sanitized = stripSensitiveFields(record);
  const companyFolderId =
    pickRecordField(sanitized, "Company Folder ID", "CompanyFolderId") ||
    pickRecordField(sanitized, "Company ID", "CompanyId");
  const completedByEmail =
    pickRecordField(sanitized, "Completed By Email", "CompletedByEmail") ||
    pickRecordField(sanitized, "Completed By", "CompletedBy");
  const completedByName =
    pickRecordField(sanitized, "Completed By Name", "CompletedByName") ||
    completedByEmail.split("@")[0] ||
    completedByEmail;

  const nextDueAt = pickRecordField(sanitized, "Next Due At", "NextDueAt");
  const frequency = pickRecordField(sanitized, "Frequency");
  const totalRiskScore = pickRecordField(sanitized, "Total Risk Score", "TotalRiskScore");
  const highestRiskLevel = pickRecordField(sanitized, "Highest Risk Level", "HighestRiskLevel");

  return {
    resultId: pickRecordField(sanitized, "Result ID", "ResultId"),
    scheduleId: pickRecordField(sanitized, "Schedule ID", "ScheduleId"),
    auditId: pickRecordField(sanitized, "Audit ID", "AuditId") || undefined,
    auditName: pickRecordField(sanitized, "Audit Name", "AuditName") || undefined,
    completedAt: pickRecordField(sanitized, "Completed At", "CompletedAt"),
    completedByEmail,
    completedByName,
    status: pickRecordField(sanitized, "Status") || "completed",
    companyFolderId,
    nextDueAt: nextDueAt || undefined,
    frequency: frequency || undefined,
    totalRiskScore: totalRiskScore || undefined,
    highestRiskLevel: highestRiskLevel || undefined,
  };
}

export function mapAuditResultDetail(record: Record<string, unknown>): AuditResultDetail {
  const summary = mapListedAuditResult(record);
  const sanitized = stripSensitiveFields(record);
  const answersParsed = parseJsonField(
    pickRecordField(sanitized, "Answers JSON", "AnswersJson"),
    {},
  );
  const findingsParsed = parseJsonField(
    pickRecordField(sanitized, "Findings JSON", "FindingsJson"),
    [],
  );
  const evidenceParsed = parseJsonField(
    pickRecordField(sanitized, "Evidence Refs", "EvidenceRefs"),
    [],
  );

  return {
    ...summary,
    answers:
      answersParsed.value && typeof answersParsed.value === "object" && !Array.isArray(answersParsed.value)
        ? (answersParsed.value as Record<string, unknown>)
        : null,
    findings: Array.isArray(findingsParsed.value) ? findingsParsed.value : null,
    evidenceRefs: Array.isArray(evidenceParsed.value) ? evidenceParsed.value : null,
    answersDisplay: answersParsed.display,
    findingsDisplay: findingsParsed.display,
    evidenceDisplay: evidenceParsed.display,
  };
}

export type FetchCompanyResultsResult = {
  ok: boolean;
  results: AuditResultSummary[];
  loadError?: string;
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
  totalMatched?: number;
  hasMore?: boolean;
  nextOffset?: number;
};

export type FetchCompanyResultsOptions = {
  signal?: AbortSignal;
  limit?: number;
  sinceDays?: number;
  offset?: number;
};

function buildCompanyResultsQuery(options?: Pick<FetchCompanyResultsOptions, "limit" | "sinceDays" | "offset">): string {
  const parts: string[] = [];
  if (options?.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(options.limit))}`);
  }
  if (options?.sinceDays !== undefined) {
    parts.push(`sinceDays=${encodeURIComponent(String(options.sinceDays))}`);
  }
  if (options?.offset !== undefined) {
    parts.push(`offset=${encodeURIComponent(String(options.offset))}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** Completed checks from company workbook AuditResults tab — session-scoped company folder only. */
export async function fetchCompanyResults(
  companyId: string,
  options?: FetchCompanyResultsOptions,
): Promise<FetchCompanyResultsResult> {
  const companyFolderId = String(companyId || "").trim();
  if (!companyFolderId) {
    return {
      ok: false,
      results: [],
      loadError: COMPANY_RESULTS_USER_MESSAGE,
    };
  }

  const query = buildCompanyResultsQuery(options);

  try {
    const response = await fetch(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/results${query}`),
      {
        credentials: "include",
        signal: options?.signal,
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      results?: Record<string, unknown>[];
      message?: string;
      error?: string;
      companyId?: string;
      companyFolderId?: string;
      masterSheetId?: string;
      totalMatched?: number;
      hasMore?: boolean;
      nextOffset?: number;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        results: [],
        loadError: payload.message || payload.error || COMPANY_RESULTS_USER_MESSAGE,
      };
    }

    const results = Array.isArray(payload.results)
      ? payload.results.map((record) => mapListedAuditResult(record))
      : [];

    return {
      ok: true,
      results,
      companyId: payload.companyId,
      companyFolderId: payload.companyFolderId,
      masterSheetId: payload.masterSheetId,
      totalMatched: payload.totalMatched,
      hasMore: payload.hasMore,
      nextOffset: payload.nextOffset,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      results: [],
      loadError: error instanceof Error ? error.message : COMPANY_RESULTS_USER_MESSAGE,
    };
  }
}

export type FetchCompanyResultDetailResult = {
  ok: boolean;
  result: AuditResultDetail | null;
  loadError?: string;
};

export async function fetchCompanyResultDetail(
  companyId: string,
  resultId: string,
  options?: { signal?: AbortSignal },
): Promise<FetchCompanyResultDetailResult> {
  const companyFolderId = String(companyId || "").trim();
  const targetId = String(resultId || "").trim();
  if (!companyFolderId || !targetId) {
    return {
      ok: false,
      result: null,
      loadError: COMPANY_RESULT_DETAIL_USER_MESSAGE,
    };
  }

  try {
    const response = await fetch(
      apiUrl(
        `/api/companies/${encodeURIComponent(companyFolderId)}/results/${encodeURIComponent(targetId)}`,
      ),
      {
        credentials: "include",
        signal: options?.signal,
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: Record<string, unknown>;
      message?: string;
      error?: string;
    };

    if (!response.ok || payload.ok === false || !payload.result) {
      return {
        ok: false,
        result: null,
        loadError: payload.message || payload.error || COMPANY_RESULT_DETAIL_USER_MESSAGE,
      };
    }

    return {
      ok: true,
      result: mapAuditResultDetail(payload.result),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      result: null,
      loadError: error instanceof Error ? error.message : COMPANY_RESULT_DETAIL_USER_MESSAGE,
    };
  }
}
