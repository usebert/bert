import { apiUrl } from "../config/apiBase";
import { parseJsonApiResponse } from "../utils/parseJsonApiResponse";

export type SetupStatusPayload = {
  ok?: boolean;
  masterConfigured?: boolean;
  googleConfigured?: boolean;
  googleConnected?: boolean;
  sharedDriveConfigured?: boolean;
  sessionStoreWritable?: boolean;
  smtpConfigured?: boolean;
  readyForPilot?: boolean;
  googleEnvConfigured?: boolean;
  error?: string;
};

export async function fetchSetupStatus(): Promise<SetupStatusPayload | null> {
  try {
    const response = await fetch(apiUrl("/api/setup/status"), { credentials: "include" });
    return await parseJsonApiResponse<SetupStatusPayload>(response);
  } catch {
    return null;
  }
}
