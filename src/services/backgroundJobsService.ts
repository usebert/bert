import { apiUrl } from "../config/apiBase";

export type BackgroundJobRecord = {
  jobId: string;
  type: string;
  companyId: string;
  requestedBy: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "NEEDS_ATTENTION";
  userMessage: string;
  technicalError: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  attempts: number;
  nextRetryAt: string | null;
  statusBadge: string;
};

export const BACKGROUND_SETUP_USER_MESSAGE =
  "Saved. BERT is finishing the background setup.";

export const BACKGROUND_INVITE_CREATED_MESSAGE = "Invite created. Email is being sent.";

export const BACKGROUND_SCHEDULE_SAVED_MESSAGE =
  "Schedule saved. BERT is syncing to the company workbook.";

async function parseJobsResponse(response: Response) {
  const payload = (await response.json()) as { ok?: boolean; jobs?: BackgroundJobRecord[]; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Unable to load background jobs.");
  }
  return payload.jobs || [];
}

export const backgroundJobsService = {
  async listAll(): Promise<BackgroundJobRecord[]> {
    const response = await fetch(apiUrl("/api/godmode/background-jobs"), { credentials: "include" });
    return parseJobsResponse(response);
  },

  async listForCompany(companyId: string): Promise<BackgroundJobRecord[]> {
    const id = String(companyId || "").trim();
    if (!id) {
      return [];
    }
    const response = await fetch(apiUrl(`/api/companies/${encodeURIComponent(id)}/background-jobs`), {
      credentials: "include",
    });
    return parseJobsResponse(response);
  },
};
