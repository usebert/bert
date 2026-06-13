import { apiUrl } from "../config/apiBase";
import type { CompanyScheduleContext } from "./scheduleService";
import { listCompanySchedules } from "./scheduleService";
import { getScheduleAssignedEmails, isScheduleAssignedToUser } from "../utils/scheduleAssignment";
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

/** Schedules assigned to signed-in user (assignedUserEmails contract). */
export async function listAssignedChecks(
  companyContext: CompanyScheduleContext,
  userEmail: string,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; schedules: ManagedSchedule[]; loadError?: string }> {
  const listed = await listCompanySchedules(companyContext, options);
  if (!listed.ok) {
    return { ok: false, schedules: [], loadError: listed.loadError };
  }
  const email = userEmail.trim().toLowerCase();
  const schedules = listed.schedules.filter((schedule) => isScheduleAssignedToUser(schedule, email));
  return { ok: true, schedules };
}

export { listAssignedChecks as listAssignedSchedulesForUser };

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
