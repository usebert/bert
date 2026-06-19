import { API_BASE_URL } from "../config/apiBase";
import type { FetchJsonDiagnostics } from "./fetchJson";

export const COMPANY_LOGIN_NETWORK_ERROR_MESSAGE =
  "BERT could not reach the sign-in service. Please try again.";

export type LoginFetchDiagnostics = {
  url?: string;
  fetchErrorName?: string;
  fetchErrorMessage?: string;
  apiBaseUrl?: string;
  online?: boolean;
};

export function companyLoginNetworkError(): string {
  return COMPANY_LOGIN_NETWORK_ERROR_MESSAGE;
}

export function buildLoginFetchDiagnostics(
  diagnostics?: FetchJsonDiagnostics,
): LoginFetchDiagnostics {
  return {
    url: diagnostics?.url,
    fetchErrorName: diagnostics?.fetchErrorName,
    fetchErrorMessage: diagnostics?.fetchErrorMessage,
    apiBaseUrl: API_BASE_URL || "(relative — same origin)",
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
  };
}

export function formatLoginNetworkDebugSuffix(diagnostics?: LoginFetchDiagnostics): string {
  if (!diagnostics) return "";
  const parts = [
    diagnostics.url ? `url=${diagnostics.url}` : "",
    diagnostics.fetchErrorName ? `error=${diagnostics.fetchErrorName}` : "",
    diagnostics.fetchErrorMessage ? `message=${diagnostics.fetchErrorMessage}` : "",
    diagnostics.apiBaseUrl ? `apiBase=${diagnostics.apiBaseUrl}` : "",
    diagnostics.online === false ? "offline=true" : diagnostics.online === true ? "online=true" : "",
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}
