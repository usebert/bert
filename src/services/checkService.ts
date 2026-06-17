import { apiUrl } from "../config/apiBase";
import { mapListedSchedule } from "./scheduleService";
import type { CompanyScheduleContext } from "./scheduleService";
import { getScheduleAssignedEmails } from "../utils/scheduleAssignment";
import type { ManagedSchedule } from "../types/reportsScreenProps";

export type SubmitCheckResultInput = {
  companyContext: CompanyScheduleContext;
  localSubmissionId?: string;
  auditId: string;
  auditName: string;
  completedBy: string;
  status?: string;
  answers?: Record<string, unknown>;
};

export type FetchAssignedChecksResult = {
  ok: boolean;
  schedules: ManagedSchedule[];
  loadError?: string;
  companyId?: string;
  companyFolderId?: string;
  masterSheetId?: string;
};

export const ASSIGNED_CHECKS_LOAD_TIMEOUT_MS = 90_000;
export const ASSIGNED_CHECKS_LOADING_MESSAGE = "Loading your checks…";
export const ASSIGNED_CHECKS_USER_MESSAGE = "Could not load your assigned checks.";
export const ASSIGNED_CHECKS_LOAD_TIMEOUT_MESSAGE =
  "Loading your checks timed out before the server finished reading your company workbook. Try again — if it keeps failing, ask your operator to check the BERT Master Sheet.";

/** Assigned schedules for signed-in user — company + identity from session only. */
export async function fetchAssignedChecks(
  options?: { signal?: AbortSignal },
): Promise<FetchAssignedChecksResult> {
  try {
    const response = await fetch(apiUrl("/api/me/assigned-checks"), {
      credentials: "include",
      signal: options?.signal,
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      schedules?: Record<string, unknown>[];
      message?: string;
      error?: string;
      companyId?: string;
      companyFolderId?: string;
      masterSheetId?: string;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        schedules: [],
        loadError: payload.message || payload.error || ASSIGNED_CHECKS_USER_MESSAGE,
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      schedules: [],
      loadError: error instanceof Error ? error.message : ASSIGNED_CHECKS_USER_MESSAGE,
    };
  }
}

export { fetchAssignedChecks as listAssignedChecks };
export { fetchAssignedChecks as listAssignedSchedulesForUser };

export function getAssignedEmailsForSchedule(schedule: ManagedSchedule | Record<string, unknown>): string[] {
  return getScheduleAssignedEmails(schedule);
}

/** Submit completed check to company workbook AuditResults tab. */
export async function submitCompletedCheck(input: SubmitCheckResultInput): Promise<{ ok: boolean; error?: string }> {
  const masterSheetId = String(input.companyContext.masterSheetId || "").trim();
  const companyFolderId = String(
    input.companyContext.companyFolderId || input.companyContext.companyId || "",
  ).trim();
  if (!masterSheetId || !companyFolderId) {
    return { ok: false, error: "Company workbook context is required." };
  }

  const completedAt = new Date().toISOString();
  const response = await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(masterSheetId)}/audits/sync`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyFolderId,
      localSubmissionId: input.localSubmissionId,
      results: [
        {
          "Result ID": input.localSubmissionId || `result-${Date.now()}`,
          "Local Submission ID": input.localSubmissionId || "",
          "Audit ID": input.auditId,
          "Company ID": companyFolderId,
          "Audit Name": input.auditName,
          "Completed By": input.completedBy,
          "Completed At": completedAt,
          Status: input.status || "completed",
          "Answers JSON": JSON.stringify(input.answers || {}),
          "Created At": completedAt,
          "Updated At": completedAt,
          "Sync Status": "synced",
        },
      ],
    }),
  });

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    return { ok: false, error: payload.error || "Could not submit check." };
  }
  return { ok: true };
}
