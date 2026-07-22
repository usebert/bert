import { API_BASE_URL, apiUrl } from "../config/apiBase";

export type ApiFetchDiagnosticContext = {
  url: string;
  method: string;
  companyFolderId?: string;
  error: unknown;
};

export function logApiFetchFailure(context: ApiFetchDiagnosticContext) {
  if (!import.meta.env.DEV) {
    return;
  }
  const online = typeof navigator !== "undefined" ? navigator.onLine : undefined;
  const message = context.error instanceof Error ? context.error.message : String(context.error);
  const beforeResponse =
    context.error instanceof TypeError ||
    message.includes("NetworkError") ||
    message.includes("Failed to fetch") ||
    message.includes("Load failed");

  console.warn("[bert:api-fetch]", {
    url: context.url,
    method: context.method,
    apiBaseUrl: API_BASE_URL || "(same-origin)",
    companyFolderId: context.companyFolderId || "",
    online,
    beforeHttpResponse: beforeResponse,
    error: message,
  });
}

export function normalizeApiFetchError(error: unknown, userMessage: string): Error {
  if (error instanceof Error) {
    const message = error.message || "";
    if (
      error instanceof TypeError ||
      message.includes("NetworkError") ||
      message.includes("Failed to fetch") ||
      message.includes("Load failed")
    ) {
      return new Error(userMessage);
    }
  }
  return error instanceof Error ? error : new Error(userMessage);
}

export function resolveApiRequestUrl(path: string): string {
  return apiUrl(path);
}
