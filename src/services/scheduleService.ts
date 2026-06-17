import { apiUrl } from "../config/apiBase";
import type { ResolvedCompanyContext } from "./companyContextService";
import type { ManagedSchedule } from "../types/reportsScreenProps";
import { formatScheduleSaveError } from "../utils/scheduleSave";
import { BACKGROUND_SCHEDULE_SAVED_MESSAGE } from "./backgroundJobsService";
import { getScheduleAssignedEmails } from "../utils/scheduleAssignment";
import type { ScheduleAssignedUser } from "../utils/scheduleSave";
import { fetchJson } from "../utils/fetchJson";
import type { Role } from "../permissions";
import type {
  ScheduleAssigneeDiagnostics,
  ScheduleAssigneeOption,
} from "../utils/scheduleAssignees";

export type CompanyScheduleContext = Pick<
  ResolvedCompanyContext,
  "companyId" | "companyFolderId" | "companyName" | "masterSheetId"
>;

export type ListCompanySchedulesResult = {
  ok: boolean;
  schedules: ManagedSchedule[];
  loadError?: string;
  companyId?: string;
  masterSheetId?: string;
};

export type SaveCompanyScheduleResult = {
  ok: boolean;
  userMessage?: string;
  error?: string;
};

export const COMPANY_SCHEDULES_LOAD_TIMEOUT_MS = 90_000;
export const SCHEDULE_ASSIGNEES_LOAD_TIMEOUT_MS = 90_000;
export const SCHEDULE_ASSIGNEES_LOADING_MESSAGE = "Loading assignable users…";
export const SCHEDULE_ASSIGNEES_USER_MESSAGE = "Could not load assignable users.";
export const SCHEDULE_ASSIGNEES_LOAD_TIMEOUT_MESSAGE =
  "Loading assignable users timed out before the server finished reading your company workbook. Try again — if it keeps failing, ask your operator to check the BERT Master Sheet.";

export type FetchScheduleAssigneesResult = {
  ok: boolean;
  assignees: ScheduleAssigneeOption[];
  loadError?: string;
  loadErrorDetail?: string;
  warning?: string;
  diagnostics?: ScheduleAssigneeDiagnostics;
};

function companyContextQuery(context: CompanyScheduleContext): URLSearchParams {
  const params = new URLSearchParams();
  const companyFolderId = String(context.companyFolderId || context.companyId || "").trim();
  if (companyFolderId) {
    params.set("companyFolderId", companyFolderId);
  }
  const masterSheetId = String(context.masterSheetId || "").trim();
  if (masterSheetId) {
    params.set("masterSheetId", masterSheetId);
  }
  const companyName = String(context.companyName || "").trim();
  if (companyName) {
    params.set("companyName", companyName);
  }
  return params;
}

export function mapListedSchedule(schedule: Record<string, unknown>): ManagedSchedule {
  const assignedUserEmails = getScheduleAssignedEmails(schedule);
  const assignedUsers = Array.isArray(schedule.assignedUsers)
    ? (schedule.assignedUsers as Array<Record<string, unknown>>).map((user) => ({
        email: String(user.email || "").trim().toLowerCase(),
        name: String(user.name || user.email || "").trim() || String(user.email || ""),
        role: String(user.role || "User"),
        accessLevel: String(user.accessLevel || "operational"),
      }))
    : undefined;
  const audits = Array.isArray(schedule.audits) ? schedule.audits : [];

  return {
    id: String(schedule.id || "").trim(),
    rootId: String(schedule.rootId || schedule.id || "").trim(),
    parentScheduleId: schedule.parentScheduleId ? String(schedule.parentScheduleId) : undefined,
    versionNumber: Number(schedule.versionNumber) || 1,
    versionLabel: String(schedule.versionLabel || "a"),
    lifecycle: (String(schedule.lifecycle || "Live") as ManagedSchedule["lifecycle"]),
    companyFolderId: String(schedule.companyFolderId || schedule.companyId || "").trim(),
    scheduleName: String(schedule.scheduleName || "Unnamed schedule"),
    audits: audits.map((audit) => {
      const row = audit as Record<string, unknown>;
      return {
        id: String(row.id || `${schedule.id}-${row.auditId}`),
        auditId: String(row.auditId || ""),
        auditName: String(row.auditName || ""),
        days: Array.isArray(row.days) ? (row.days as ManagedSchedule["audits"][number]["days"]) : [],
        frequency: String(row.frequency || "Weekly") as ManagedSchedule["audits"][number]["frequency"],
        liveTime: String(row.liveTime || "08:00"),
        completionHours: Number(row.completionHours) || 24,
      };
    }),
    auditors: assignedUserEmails,
    assignedUserEmails,
    assignedUsers,
    startDate: String(schedule.startDate || ""),
    endDate: String(schedule.endDate || ""),
    updatedAt: String(schedule.updatedAt || ""),
    archivedAt: schedule.archivedAt ? String(schedule.archivedAt) : undefined,
    reactivatedAt: schedule.reactivatedAt ? String(schedule.reactivatedAt) : undefined,
    missedAuditCount: Number(schedule.missedAuditCount) || 0,
    lastCompletedAt: schedule.lastCompletedAt ? String(schedule.lastCompletedAt) : undefined,
    nextDueAt: schedule.nextDueAt ? String(schedule.nextDueAt) : undefined,
    healthState: schedule.healthState as ManagedSchedule["healthState"],
    createdBy: String(schedule.createdBy || schedule.createdByEmail || ""),
    createdAt: String(schedule.createdAt || ""),
  };
}

function mapScheduleAssigneeOption(raw: Record<string, unknown>): ScheduleAssigneeOption {
  const email = String(raw.email || "").trim().toLowerCase();
  const role = String(raw.role || "User").trim() as Role | "User";
  return {
    id: String(raw.id || email).trim().toLowerCase(),
    name: String(raw.name || email.split("@")[0] || email).trim() || email,
    role,
    email,
    companyAreas: Array.isArray(raw.companyAreas)
      ? (raw.companyAreas as string[]).map((entry) => String(entry).trim()).filter(Boolean)
      : [],
    areaWarning: raw.areaWarning ? String(raw.areaWarning) : undefined,
  };
}

export async function fetchScheduleAssignees(
  companyContext: CompanyScheduleContext,
  options?: { selectedArea?: string; includeDiagnostics?: boolean; signal?: AbortSignal },
): Promise<FetchScheduleAssigneesResult> {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  if (!companyFolderId) {
    return {
      ok: false,
      assignees: [],
      loadError: SCHEDULE_ASSIGNEES_USER_MESSAGE,
      loadErrorDetail: "Company workspace id is required before loading assignees.",
    };
  }

  const params = companyContextQuery(companyContext);
  const selectedArea = String(options?.selectedArea || "").trim();
  if (selectedArea) {
    params.set("area", selectedArea);
  }
  if (options?.includeDiagnostics) {
    params.set("diagnostics", "1");
  }

  const path = `/api/companies/${encodeURIComponent(companyFolderId)}/schedule-assignees?${params.toString()}`;
  const result = await fetchJson<{
    ok?: boolean;
    assignees?: Record<string, unknown>[];
    auditors?: Record<string, unknown>[];
    message?: string;
    error?: string;
    code?: string;
    warning?: string;
    diagnostics?: ScheduleAssigneeDiagnostics;
  }>(apiUrl(path), { signal: options?.signal });

  if (!result.ok) {
    return {
      ok: false,
      assignees: [],
      loadError: SCHEDULE_ASSIGNEES_USER_MESSAGE,
      loadErrorDetail: result.message,
    };
  }

  const { data: payload, response } = result;
  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      assignees: [],
      loadError: payload.message || payload.error || SCHEDULE_ASSIGNEES_USER_MESSAGE,
      loadErrorDetail: payload.message || payload.error,
    };
  }

  const rawAssignees = Array.isArray(payload.assignees)
    ? payload.assignees
    : Array.isArray(payload.auditors)
      ? payload.auditors
      : [];

  return {
    ok: true,
    assignees: rawAssignees.map((row) => mapScheduleAssigneeOption(row)),
    warning: payload.warning,
    diagnostics: payload.diagnostics,
  };
}

export async function listCompanySchedules(
  companyContext: CompanyScheduleContext,
  options?: { signal?: AbortSignal },
): Promise<ListCompanySchedulesResult> {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  if (!companyFolderId) {
    return { ok: false, schedules: [], loadError: "Company context is required before loading schedules." };
  }

  const params = companyContextQuery(companyContext);
  try {
    const response = await fetch(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/schedules?${params.toString()}`),
      { credentials: "include", signal: options?.signal },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      schedules?: Record<string, unknown>[];
      message?: string;
      error?: string;
      companyId?: string;
      masterSheetId?: string;
    };

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        schedules: [],
        loadError: payload.message || payload.error || "Could not load schedules for this company.",
      };
    }

    const schedules = Array.isArray(payload.schedules)
      ? payload.schedules.map((schedule) => mapListedSchedule(schedule))
      : [];

    return {
      ok: true,
      schedules,
      companyId: payload.companyId,
      masterSheetId: payload.masterSheetId,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      schedules: [],
      loadError: error instanceof Error ? error.message : "Could not load schedules for this company.",
    };
  }
}

export async function getCompanySchedule(
  companyContext: CompanyScheduleContext,
  scheduleId: string,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; schedule?: ManagedSchedule; loadError?: string }> {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  if (!companyFolderId || !scheduleId.trim()) {
    return { ok: false, loadError: "Company context and schedule id are required." };
  }

  const params = companyContextQuery(companyContext);
  params.set("scheduleId", scheduleId.trim());

  try {
    const response = await fetch(
      apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/schedules?${params.toString()}`),
      { credentials: "include", signal: options?.signal },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      schedule?: Record<string, unknown>;
      message?: string;
      error?: string;
    };
    if (!response.ok || payload.ok === false || !payload.schedule) {
      return {
        ok: false,
        loadError: payload.message || payload.error || "Schedule not found for this company.",
      };
    }
    return { ok: true, schedule: mapListedSchedule(payload.schedule) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      loadError: error instanceof Error ? error.message : "Could not load schedule for this company.",
    };
  }
}

export async function saveCompanySchedule(
  companyContext: CompanyScheduleContext,
  schedules: ManagedSchedule[],
  options?: { createdBy?: string; createdByRole?: string },
): Promise<SaveCompanyScheduleResult> {
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const masterSheetId = String(companyContext.masterSheetId || "").trim();
  if (!companyFolderId || !masterSheetId) {
    return { ok: false, error: "Company master sheet is not configured." };
  }

  const schedulesPayload = schedules.map((schedule) => {
    const assignedUsers =
      Array.isArray(schedule.assignedUsers) && schedule.assignedUsers.length > 0
        ? schedule.assignedUsers
        : (schedule.assignedUserEmails || schedule.auditors || []).map((email) => ({
            email,
            name: email.split("@")[0] || email,
            role: "User",
            accessLevel: "operational",
          }));
    const assignedUserEmails = getScheduleAssignedEmails({ ...schedule, assignedUsers });
    return {
      ...schedule,
      companyId: schedule.companyFolderId || companyFolderId,
      companyFolderId: schedule.companyFolderId || companyFolderId,
      assignedUsers,
      assignedUserEmails,
      assignedUsersJson: JSON.stringify(assignedUsers),
      auditors: assignedUserEmails,
      createdBy: (schedule as { createdBy?: string }).createdBy || options?.createdBy,
      createdByEmail: (schedule as { createdByEmail?: string }).createdByEmail || options?.createdBy,
      createdByRole: (schedule as { createdByRole?: string }).createdByRole || options?.createdByRole,
      status: schedule.lifecycle === "Archived" ? "Archived" : "ACTIVE",
    };
  });

  const response = await fetch(apiUrl(`/api/companies/${encodeURIComponent(companyFolderId)}/schedules`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyFolderId,
      masterSheetId,
      schedules: schedulesPayload,
    }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    userMessage?: string;
    message?: string;
    error?: string;
    technicalError?: string;
    code?: string;
  };

  if (!response.ok || !payload.ok) {
    return { ok: false, error: formatScheduleSaveError(payload) };
  }

  return {
    ok: true,
    userMessage: payload.userMessage || BACKGROUND_SCHEDULE_SAVED_MESSAGE,
  };
}

export { getScheduleAssignedEmails };
export { saveCompanySchedule as saveSchedule };
