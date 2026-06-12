import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import { fetchCompanyMembers, type CompanyMember } from "./companyUserService";
import { listCompanySchedules, type CompanyScheduleContext } from "./scheduleService";
import type { ManagedSchedule } from "../types/reportsScreenProps";
import { resolveCompanyFromFolder, type ResolvedCompanyFromFolder } from "./companyService";

export type GodmodeLiveCompany = {
  id: string;
  name: string;
  folderId?: string;
  masterSheetId?: string;
  sheetId?: string;
};

export async function listGodmodeLiveCompanies(): Promise<{
  ok: boolean;
  companies: GodmodeLiveCompany[];
  error?: string;
}> {
  const result = await fetchJson<{ ok?: boolean; companies?: GodmodeLiveCompany[]; error?: string }>(
    apiUrl("/api/godmode/live-companies"),
    { credentials: "include" },
  );
  if (!result.ok) {
    return { ok: false, companies: [], error: result.message };
  }
  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return { ok: false, companies: [], error: payload.error || "Could not load companies." };
  }
  return { ok: true, companies: Array.isArray(payload.companies) ? payload.companies : [] };
}

export async function resolveGodmodeCompanyFromFolder(input: {
  companyFolderId: string;
  masterSheetId?: string;
  companyName?: string;
}): Promise<ResolvedCompanyFromFolder> {
  return resolveCompanyFromFolder(input);
}

/** Same Users tab as company admins — no PasswordHash. */
export async function listGodmodeCompanyUsers(input: {
  companyId: string;
  masterSheetId?: string;
  companyName?: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; members: CompanyMember[]; loadError?: string }> {
  const result = await fetchCompanyMembers(apiUrl, {
    companyId: input.companyId.trim(),
    masterSheetId: input.masterSheetId,
    companyName: input.companyName,
    signal: input.signal,
  });
  return {
    ok: result.ok,
    members: result.members,
    loadError: result.loadError,
  };
}

/** Same Schedules tab as company users. */
export async function listGodmodeCompanySchedules(
  context: CompanyScheduleContext,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; schedules: ManagedSchedule[]; loadError?: string }> {
  const result = await listCompanySchedules(context, options);
  return {
    ok: result.ok,
    schedules: result.schedules,
    loadError: result.loadError,
  };
}
