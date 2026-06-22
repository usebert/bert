import { apiUrl } from "../config/apiBase";
import { mapListedSchedule } from "./scheduleService";
import type { CompanyScheduleContext } from "./scheduleService";
import { getScheduleAssignedEmails } from "../utils/scheduleAssignment";
import type { ManagedSchedule } from "../types/reportsScreenProps";
import { fetchJson, type FetchJsonDiagnostics } from "../utils/fetchJson";

export type SubmitCheckResultInput = {
  companyContext: CompanyScheduleContext;
  scheduleId: string;
  localSubmissionId?: string;
  auditId: string;
  auditName: string;
  completedBy: string;
  status?: string;
  answers?: Record<string, unknown>;
  findings?: unknown[];
  evidenceRefs?: unknown[];
};

export type CompleteCheckResult = {
  ok: boolean;
  resultId?: string;
  scheduleId?: string;
  error?: string;
  message?: string;
  code?: string;
};

export type FetchAssignedChecksResult = {
  ok: boolean;
  schedules: ManagedSchedule[];
  loadError?: string;
  loadErrorDetail?: string;
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
};

function formatAssignedChecksLoadErrorDetail(input: {
  message: string;
  diagnostics?: FetchJsonDiagnostics;
}): string {
  const url = String(input.diagnostics?.url || apiUrl("/api/me/assigned-checks")).trim();
  const status = input.diagnostics?.status;
  if (typeof status === "number") {
    return `GET ${url} → HTTP ${status}: ${input.message}`;
  }
  const fetchErrorName = String(input.diagnostics?.fetchErrorName || "").trim();
  const fetchErrorMessage = String(input.diagnostics?.fetchErrorMessage || input.message).trim();
  if (fetchErrorName === "AbortError") {
    return `GET ${url} → request aborted: ${fetchErrorMessage}`;
  }
  if (fetchErrorMessage.toLowerCase().includes("networkerror")) {
    return `GET ${url} → network blocked (check sign-in, API reachability, and CORS for ${url})`;
  }
  return `GET ${url} → ${fetchErrorName || "error"}: ${fetchErrorMessage}`;
}

export const ASSIGNED_CHECKS_LOAD_TIMEOUT_MS = 90_000;
export const ASSIGNED_CHECKS_LOADING_MESSAGE = "Loading your checks…";
export const ASSIGNED_CHECKS_USER_MESSAGE = "Could not load your assigned checks.";
export const ASSIGNED_CHECKS_LOAD_TIMEOUT_MESSAGE =
  "Loading your checks timed out before the server finished reading your company workbook. Try again — if it keeps failing, ask your operator to check the BERT Master Sheet.";

export const CHECK_COMPLETION_TIMEOUT_MS = 90_000;
export const CHECK_COMPLETION_SUBMITTING_MESSAGE = "Submitting your check…";
export const CHECK_COMPLETION_USER_MESSAGE = "Could not submit this check.";
export const CHECK_COMPLETION_TIMEOUT_MESSAGE =
  "Submitting your check timed out before the server finished saving. Try again — if it keeps failing, ask your operator to check the BERT Master Sheet.";
export const CHECK_COMPLETION_NOT_ASSIGNED_MESSAGE = "This check is not assigned to your account.";
export const CHECK_COMPLETION_WRONG_COMPANY_MESSAGE = "This check does not belong to your company workspace.";
export const CHECK_COMPLETION_FORBIDDEN_MESSAGE = "You do not have permission to submit this check.";

function completionErrorMessage(payload: { code?: string; message?: string; error?: string }): string {
  const code = String(payload.code || "").trim();
  if (code === "CHECK_NOT_ASSIGNED") {
    return CHECK_COMPLETION_NOT_ASSIGNED_MESSAGE;
  }
  if (code === "SCHEDULE_WRONG_COMPANY") {
    return CHECK_COMPLETION_WRONG_COMPANY_MESSAGE;
  }
  if (code === "CHECK_NOT_ACTIVE" || code === "AUTH_REQUIRED" || code === "SESSION_REQUIRED") {
    return CHECK_COMPLETION_FORBIDDEN_MESSAGE;
  }
  return payload.message || payload.error || CHECK_COMPLETION_USER_MESSAGE;
}

/** Assigned schedules for signed-in user — company + identity from session only. */
export async function fetchAssignedChecks(
  options?: { signal?: AbortSignal },
): Promise<FetchAssignedChecksResult> {
  const path = "/api/me/assigned-checks";
  const result = await fetchJson<{
    ok?: boolean;
    schedules?: Record<string, unknown>[];
    message?: string;
    error?: string;
    companyId?: string;
    companyFolderId?: string;
    masterSheetId?: string;
  }>(path, { signal: options?.signal });

  if (!result.ok) {
    if (result.code === "NETWORK_UNREACHABLE") {
      return {
        ok: false,
        schedules: [],
        loadError: ASSIGNED_CHECKS_USER_MESSAGE,
        loadErrorDetail: formatAssignedChecksLoadErrorDetail({
          message: result.message,
          diagnostics: result.diagnostics,
        }),
      };
    }
    return {
      ok: false,
      schedules: [],
      loadError: ASSIGNED_CHECKS_USER_MESSAGE,
      loadErrorDetail: formatAssignedChecksLoadErrorDetail({
        message: result.message,
        diagnostics: result.diagnostics,
      }),
    };
  }

  const { data: payload, response } = result;
  if (!response.ok || payload.ok === false) {
    const apiMessage = payload.message || payload.error || ASSIGNED_CHECKS_USER_MESSAGE;
    return {
      ok: false,
      schedules: [],
      loadError: ASSIGNED_CHECKS_USER_MESSAGE,
      loadErrorDetail: formatAssignedChecksLoadErrorDetail({
        message: apiMessage,
        diagnostics: { url: apiUrl(path), status: response.status },
      }),
    };
  }

  const schedules = Array.isArray(payload.schedules)
    ? payload.schedules.map((schedule) => mapListedSchedule(schedule))
    : [];

  return {
    ok: true,
    schedules,
    companyId: payload.companyId,
    companyFolderId: payload.companyFolderId,
    masterSheetId: payload.masterSheetId,
  };
}

export { fetchAssignedChecks as listAssignedChecks };
export { fetchAssignedChecks as listAssignedSchedulesForUser };

export function getAssignedEmailsForSchedule(schedule: ManagedSchedule | Record<string, unknown>): string[] {
  return getScheduleAssignedEmails(schedule);
}

/** Submit completed check to company workbook AuditResults tab via folder-first API. */
export async function completeCheck(
  input: SubmitCheckResultInput,
  options?: { signal?: AbortSignal },
): Promise<CompleteCheckResult> {
  const companyFolderId = String(
    input.companyContext.companyFolderId || input.companyContext.companyId || "",
  ).trim();
  const scheduleId = String(input.scheduleId || "").trim();
  if (!companyFolderId || !scheduleId) {
    return { ok: false, error: "Assigned check context is required." };
  }

  const response = await fetch(
    apiUrl(
      `/api/companies/${encodeURIComponent(companyFolderId)}/checks/${encodeURIComponent(scheduleId)}/complete`,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: options?.signal,
      body: JSON.stringify({
        auditId: input.auditId,
        auditName: input.auditName,
        status: input.status || "completed",
        answers: input.answers || {},
        findings: input.findings ?? [],
        evidenceRefs: input.evidenceRefs ?? [],
        localSubmissionId: input.localSubmissionId,
        completedByName: input.completedBy,
      }),
    },
  );

  const payload = (await response.json()) as {
    ok?: boolean;
    resultId?: string;
    scheduleId?: string;
    code?: string;
    error?: string;
    message?: string;
  };

  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      code: payload.code,
      error: completionErrorMessage(payload),
      message: payload.message,
    };
  }

  return {
    ok: true,
    resultId: payload.resultId,
    scheduleId: payload.scheduleId || scheduleId,
  };
}

/** @deprecated Use completeCheck — kept for contract scripts and legacy imports. */
export async function submitCompletedCheck(input: SubmitCheckResultInput): Promise<{ ok: boolean; error?: string }> {
  const result = await completeCheck(input);
  return { ok: result.ok, error: result.error };
}
