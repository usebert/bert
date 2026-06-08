import type { InviteApiErrorCode } from "./inviteApi";

export const INVITE_COMPLETION_PAGE_TITLE = "Finish setting up your BERT account";

export const INVITE_NETWORK_UNAVAILABLE_MESSAGE =
  "BERT is temporarily unavailable. Please try again shortly.";

export const INVITE_NO_LONGER_VALID_MESSAGE =
  "This invite is no longer valid. Ask your administrator to send a fresh invite.";

export const INVITE_PROVISIONING_FAILED_MESSAGE =
  "We couldn't finish setting up your workspace. Your details have been saved and the BERT team can finish setup.";

export type InviteCompletionErrorCode =
  | InviteApiErrorCode
  | "stale_invite_target"
  | "invite_expired"
  | "invite_not_found"
  | "invite_already_used"
  | "google_not_connected"
  | "google_access_denied"
  | "google_api_error"
  | "invite_in_progress"
  | "setup_failed"
  | "validation_error";

type InviteErrorPayload = {
  code?: string;
  error?: string;
  message?: string;
  provisionError?: string;
};

function sanitizeRawInviteMessage(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  if (/requested entity was not found/i.test(text)) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  if (/terminal/i.test(text) && /api server/i.test(text)) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  if (/drive folder/i.test(text) || /provisioning stopped/i.test(text)) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  return text;
}

const INVITE_INVALID_CODES = new Set<InviteCompletionErrorCode>([
  "INVITE_INVALID",
  "INVITE_EXPIRED",
  "INVITE_ALREADY_USED",
  "INVITE_WRONG_TYPE",
  "stale_invite_target",
  "invite_expired",
  "invite_not_found",
  "invite_already_used",
]);

export function mapInviteApiErrorCode(code: InviteCompletionErrorCode | string | undefined): string {
  const normalized = String(code || "").trim() as InviteCompletionErrorCode;
  if (normalized === "NETWORK_UNREACHABLE") {
    return INVITE_NETWORK_UNAVAILABLE_MESSAGE;
  }
  if (normalized === "PROVISIONING_FAILED" || normalized === "setup_failed") {
    return INVITE_PROVISIONING_FAILED_MESSAGE;
  }
  if (INVITE_INVALID_CODES.has(normalized)) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  if (normalized === "SERVER_ERROR") {
    return "Something went wrong on our side. Please try again shortly.";
  }
  return "";
}

export function mapInviteCompletionLoadError(payload: InviteErrorPayload, httpStatus: number): string {
  const mapped = mapInviteCompletionError(payload, httpStatus);
  if (mapped) {
    return mapped;
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  return INVITE_NO_LONGER_VALID_MESSAGE;
}

export function mapInviteCompletionError(payload: InviteErrorPayload, httpStatus: number): string {
  const code = String(payload.code || "").trim();
  const apiMapped = mapInviteApiErrorCode(code);
  if (apiMapped) {
    return apiMapped;
  }
  const friendly = String(payload.message || payload.error || payload.provisionError || "").trim();

  switch (code) {
    case "stale_invite_target":
    case "invite_expired":
    case "invite_not_found":
    case "invite_already_used":
      return INVITE_NO_LONGER_VALID_MESSAGE;
    case "google_not_connected":
      return "Account setup is not available right now because Google Workspace is not connected on the server. Ask your administrator to reconnect Google, then try again.";
    case "google_access_denied":
      return "Account setup is not available right now because BERT cannot access the company master sheet. Ask your administrator to repair the workspace link, then send a fresh invite if needed.";
    case "google_api_error":
      return (
        sanitizeRawInviteMessage(friendly) ||
        "We could not reach Google to finish setup. Wait a few minutes and try again, or ask your administrator for a new invite."
      );
    case "invite_in_progress":
      return "Your account setup is already in progress. Keep this page open for a few minutes.";
    case "setup_failed":
      return sanitizeRawInviteMessage(friendly) || INVITE_PROVISIONING_FAILED_MESSAGE;
    case "validation_error":
      return sanitizeRawInviteMessage(friendly) || "Check the form and try again.";
    default:
      break;
  }

  if (httpStatus === 401) {
    return "Account setup is not available right now. Ask your administrator to reconnect Google on the server, then try again.";
  }
  if (httpStatus === 410 || httpStatus === 404) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  if (httpStatus >= 500) {
    return (
      sanitizeRawInviteMessage(friendly) ||
      "Something went wrong while finishing your account. Ask your administrator to send a new invite if you still cannot sign in."
    );
  }

  const sanitized = sanitizeRawInviteMessage(friendly);
  return sanitized || INVITE_NO_LONGER_VALID_MESSAGE;
}

export function mapInviteCompletionPollError(payload: InviteErrorPayload): string {
  const mapped = mapInviteCompletionError(payload, 500);
  if (mapped.includes("try again")) {
    return mapped;
  }
  return `${mapped} You can try again below if your administrator has fixed the issue.`;
}

export function inviteCompletionTimeoutMessage(minutes: number): string {
  return `Setup is taking longer than expected (${minutes} minutes). Keep this page open a little longer, or ask your administrator to send a new invite if nothing changes.`;
}

export function inviteCompletionNetworkError(detail?: string): string {
  const sanitized = sanitizeRawInviteMessage(detail || "");
  if (sanitized && sanitized !== INVITE_NO_LONGER_VALID_MESSAGE) {
    return sanitized;
  }
  return INVITE_NETWORK_UNAVAILABLE_MESSAGE;
}

export function mapCompanyOnboardingInviteError(
  payload: InviteErrorPayload,
  code: InviteApiErrorCode | string | undefined,
  httpStatus = 0,
): string {
  const apiMapped = mapInviteApiErrorCode(code || payload.code);
  if (apiMapped) {
    return apiMapped;
  }
  return mapInviteCompletionError(payload, httpStatus);
}
