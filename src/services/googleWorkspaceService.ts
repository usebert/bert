import { apiUrl } from "../config/apiBase";

type JsonResponse = Record<string, unknown> & { ok?: boolean; error?: string };

async function parseResponse<T extends JsonResponse>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Google workspace request failed.");
  }
  return payload;
}

export const googleWorkspaceService = {
  async getStatus<T extends JsonResponse>() {
    return parseResponse<T>(await fetch(apiUrl("/api/google/status"), { credentials: "include" }));
  },
  async getOnboardingSubmissions<T extends JsonResponse>() {
    return parseResponse<T>(await fetch(apiUrl("/api/onboarding/submissions"), { credentials: "include" }));
  },
  async inspectCompanyFolder<T extends JsonResponse>(folderId: string) {
    return parseResponse<T>(
      await fetch(apiUrl(`/api/company-folder/${encodeURIComponent(folderId)}`), { credentials: "include" }),
    );
  },
  async getGoogleFile<T extends JsonResponse>(fileId: string) {
    return parseResponse<T>(
      await fetch(apiUrl(`/api/google-file/${encodeURIComponent(fileId)}`), { credentials: "include" }),
    );
  },
  async getGoogleFormsFolder<T extends JsonResponse>(folderId: string) {
    return parseResponse<T>(
      await fetch(apiUrl(`/api/google-forms-folder/${encodeURIComponent(folderId)}`), { credentials: "include" }),
    );
  },
  async getCompanySheet<T extends JsonResponse>(folderId: string) {
    return parseResponse<T>(
      await fetch(apiUrl(`/api/company-sheet/${encodeURIComponent(folderId)}`), { credentials: "include" }),
    );
  },
  async getCompanySheetById<T extends JsonResponse>(sheetId: string) {
    return parseResponse<T>(
      await fetch(apiUrl(`/api/google-sheet-by-id/${encodeURIComponent(sheetId)}`), { credentials: "include" }),
    );
  },
  startGoogleLogin() {
    window.location.href = apiUrl("/auth/google/login");
  },
  async disconnectGoogle() {
    const response = await fetch(apiUrl("/auth/google/disconnect"), {
      method: "POST",
      credentials: "include",
    });
    return parseResponse<JsonResponse>(response);
  },
  async verifySharedDrive<T extends JsonResponse>() {
    return parseResponse<T>(
      await fetch(apiUrl("/api/google/verify-shared-drive"), {
        method: "POST",
        credentials: "include",
      }),
    );
  },
};
