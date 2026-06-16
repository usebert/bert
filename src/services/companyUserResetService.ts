import { apiUrl } from "../config/apiBase";

export const RESET_USERS_CONFIRM_PHRASE = "RESET USERS";
export const RESET_ALL_COMPANY_USERS_CONFIRM_PHRASE = "RESET ALL COMPANY USERS";

export const USER_RESET_WARNING =
  "This will remove all company users, pending invites, stale user cache, auth-index entries, and active sessions for this company. It will not delete company folders, schedules, reports, checks, or evidence.";

export const USER_RESET_ALL_WARNING =
  "This will remove all company users, invites, user caches, auth-index entries, and company user sessions across every company. Platform Godmode login is preserved. Company folders, workbooks, schedules, reports, checks, and evidence are not deleted.";

export type CompanyUserResetReport = {
  ok: boolean;
  companyId?: string;
  companyFolderId?: string;
  companyName?: string;
  masterSheetId?: string;
  usersBackedUp?: number;
  usersRemoved?: number;
  invitesRemoved?: number;
  cacheEntriesRemoved?: number;
  authIndexEntriesRemoved?: number;
  sessionsInvalidated?: number;
  backupTabName?: string;
  preservedOperationalData?: boolean;
  godmodePreserved?: boolean;
  error?: string;
  blocker?: string;
  technicalError?: string;
};

export type ResetAllCompanyUsersReport = CompanyUserResetReport & {
  companiesProcessed?: number;
  companies?: Array<{
    companyFolderId: string;
    companyName?: string;
    ok: boolean;
    backupTabName?: string;
    usersRemoved?: number;
    error?: string;
  }>;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(String(data.error || `Request failed (${response.status})`));
  }
  return data;
}

export async function resetCompanyUsers(input: {
  companyFolderId: string;
  masterSheetId?: string;
  companyName?: string;
  confirmPhrase: string;
}): Promise<CompanyUserResetReport> {
  const response = await fetch(
    apiUrl(`/api/godmode/companies/${encodeURIComponent(input.companyFolderId)}/reset-users`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        masterSheetId: input.masterSheetId,
        companyName: input.companyName,
        confirmPhrase: input.confirmPhrase,
      }),
    },
  );
  return parseResponse<CompanyUserResetReport>(response);
}

export async function resetAllCompanyUsers(input: {
  confirmPhrase: string;
}): Promise<ResetAllCompanyUsersReport> {
  const response = await fetch(apiUrl("/api/godmode/reset-all-company-users"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmPhrase: input.confirmPhrase,
    }),
  });
  return parseResponse<ResetAllCompanyUsersReport>(response);
}
