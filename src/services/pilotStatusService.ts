import { apiUrl, API_BASE_URL } from "../config/apiBase";
import { parseJsonApiResponse } from "../utils/parseJsonApiResponse";

export type ReadinessPayload = {
  ok?: boolean;
  ready?: boolean;
  googleConfigured?: boolean;
  checks?: {
    sessionStoreWritable?: boolean;
    googleConfigured?: boolean;
  };
};

export type HealthPayload = {
  ok?: boolean;
  googleConfigured?: boolean;
  sharedDriveConfigured?: boolean;
};

export type GoogleStatusPayload = {
  ok?: boolean;
  configured?: boolean;
  connected?: boolean;
  sharedDriveId?: string;
  sharedDriveConfigured?: boolean;
  sharedDriveVerified?: boolean;
  sharedDriveVerifyError?: string;
  companiesCount?: number;
  companies?: { id: string; name: string }[];
};

export type SmtpStatusPayload = {
  ok?: boolean;
};

export async function fetchPilotPlatformStatus(): Promise<{
  health: HealthPayload | null;
  readiness: ReadinessPayload | null;
  google: GoogleStatusPayload | null;
  smtp: SmtpStatusPayload | null;
  appApiConfigured: boolean;
}> {
  const appApiConfigured = Boolean(API_BASE_URL.trim());

  const fetchJson = async <T,>(path: string): Promise<T | null> => {
    try {
      const response = await fetch(apiUrl(path), { credentials: "include" });
      return await parseJsonApiResponse<T>(response);
    } catch {
      return null;
    }
  };

  const [health, readiness, google, smtp] = await Promise.all([
    fetchJson<HealthPayload>("/api/health"),
    fetchJson<ReadinessPayload>("/api/readiness"),
    fetchJson<GoogleStatusPayload>("/api/google/status"),
    fetchJson<SmtpStatusPayload>("/api/invites/smtp/status"),
  ]);

  return { health, readiness, google, smtp, appApiConfigured };
}
