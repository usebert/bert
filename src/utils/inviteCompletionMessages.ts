import type { InviteApiErrorCode } from "./inviteApi";

export const INVITE_COMPLETION_PAGE_TITLE = "Create your BERT account";

export const COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE =
  "We couldn't finish creating your account. Your invite is still valid. Please try again or contact your manager.";

export const INVITE_NETWORK_UNAVAILABLE_MESSAGE =
  "BERT is temporarily unavailable. Please try again shortly.";

export const INVITE_NO_LONGER_VALID_MESSAGE =
  "This invite is no longer valid. Ask your administrator to send a fresh invite.";

export const INVITE_COMPANY_NOT_LIVE_MESSAGE =
  "This company is not ready for user invites yet. Ask your administrator to finish company setup first.";

export const INVITE_PROVISIONING_FAILED_MESSAGE =
  "Company setup could not finish because of an internal setup error.";

/** @deprecated Use COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE for company-user invites. */
export const INVITE_USER_SETUP_FAILED_MESSAGE = COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE;

export const INVITE_FALLBACK_MESSAGE = "BERT could not complete this request right now. Please try again shortly.";

export type InviteCompletionErrorCode =
  | InviteApiErrorCode
  | "stale_invite_target"
  | "INVITE_COMPANY_LINK_MISSING"
  | "COMPANY_MASTER_SHEET_UNAVAILABLE"
  | "invite_expired"
  | "invite_not_found"
  | "invite_already_used"
  | "company_not_live"
  | "google_not_connected"
  | "google_access_denied"
  | "google_api_error"
  | "invite_in_progress"
  | "setup_failed"
  | "USER_SETUP_FAILED"
  | "USER_ACCOUNT_CREATE_FAILED"
  | "validation_error";

type InviteErrorPayload = {
  code?: string;
  error?: string;
  message?: string;
  provisionError?: string;
};

const INVITE_INVALID_CODES = new Set<InviteCompletionErrorCode>([
  "INVITE_INVALID",
  "INVITE_EXPIRED",
  "INVITE_ALREADY_USED",
  "INVITE_WRONG_TYPE",
  "stale_invite_target",
  "INVITE_COMPANY_LINK_MISSING",
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
  if (normalized === "USER_SETUP_FAILED" || normalized === "USER_ACCOUNT_CREATE_FAILED") {
    return COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE;
  }
  if (normalized === "INVITE_COMPANY_LINK_MISSING") {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  if (normalized === "COMPANY_MASTER_SHEET_UNAVAILABLE") {
    return INVITE_NETWORK_UNAVAILABLE_MESSAGE;
  }
  if (normalized === "COMPANY_NOT_LIVE" || normalized === "company_not_live") {
    return INVITE_COMPANY_NOT_LIVE_MESSAGE;
  }
  if (INVITE_INVALID_CODES.has(normalized)) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }
  if (normalized === "SERVER_ERROR") {
    return INVITE_FALLBACK_MESSAGE;
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

  switch (code) {
    case "stale_invite_target":
    case "INVITE_COMPANY_LINK_MISSING":
    case "invite_expired":
    case "invite_not_found":
    case "invite_already_used":
      return INVITE_NO_LONGER_VALID_MESSAGE;
    case "company_not_live":
      return INVITE_COMPANY_NOT_LIVE_MESSAGE;
    case "COMPANY_MASTER_SHEET_UNAVAILABLE":
      return INVITE_NETWORK_UNAVAILABLE_MESSAGE;
    case "google_not_connected":
    case "google_access_denied":
    case "google_api_error":
      return INVITE_NETWORK_UNAVAILABLE_MESSAGE;
    case "invite_in_progress":
      return "Your account setup is already in progress. Keep this page open for a few minutes.";
    case "setup_failed":
    case "USER_SETUP_FAILED":
    case "USER_ACCOUNT_CREATE_FAILED":
      return COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE;
    case "validation_error":
      return "Check the form and try again.";
    default:
      break;
  }

  if (httpStatus === 401 || httpStatus >= 500) {
    return INVITE_FALLBACK_MESSAGE;
  }
  if (httpStatus === 410 || httpStatus === 404) {
    return INVITE_NO_LONGER_VALID_MESSAGE;
  }

  return INVITE_NO_LONGER_VALID_MESSAGE;
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

/** Maps real transport failures only — never surfaces parse/status error text from API responses. */
export function inviteCompletionNetworkError(): string {
  return INVITE_NETWORK_UNAVAILABLE_MESSAGE;
}

/** Company-user invite only — never surfaces workspace setup copy. */
export function mapCompanyUserInviteError(payload: InviteErrorPayload, httpStatus = 0): string {
  const code = String(payload.code || "").trim();
  if (code === "PROVISIONING_FAILED" || code === "setup_failed") {
    return COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE;
  }
  const mapped = mapInviteCompletionError(payload, httpStatus);
  if (
    mapped.includes("workspace") ||
    mapped.includes(INVITE_PROVISIONING_FAILED_MESSAGE) ||
    mapped === INVITE_USER_SETUP_FAILED_MESSAGE
  ) {
    return COMPANY_USER_ACCOUNT_CREATE_FAILED_MESSAGE;
  }
  return mapped;
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
  return mapInviteCompletionError(payload, httpStatus) || INVITE_FALLBACK_MESSAGE;
}
