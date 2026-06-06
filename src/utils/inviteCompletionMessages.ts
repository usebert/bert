export const INVITE_COMPLETION_PAGE_TITLE = "Finish setting up your BERT account";

export type InviteCompletionErrorCode =
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
    return "This invite points to a company workspace that is no longer available. Ask your administrator to send a new invite.";
  }
  if (/terminal/i.test(text) && /api server/i.test(text)) {
    return "Account setup could not be completed. Ask your administrator to check BERT is ready, then send you a new invite if needed.";
  }
  if (/drive folder/i.test(text) || /provisioning stopped/i.test(text)) {
    return "Account setup could not be completed. Ask your administrator to send a new invite if you still cannot sign in.";
  }
  return text;
}

export function mapInviteCompletionLoadError(payload: InviteErrorPayload, httpStatus: number): string {
  const mapped = mapInviteCompletionError(payload, httpStatus);
  if (mapped) {
    return mapped;
  }
  if (httpStatus === 404) {
    return "This invite link is not valid. Ask your administrator to send a new invite.";
  }
  if (httpStatus === 410) {
    return "This invite has expired or was already used. Ask your administrator to send a new invite.";
  }
  return "This invite link is not valid. Ask your administrator to send a new invite.";
}

export function mapInviteCompletionError(payload: InviteErrorPayload, httpStatus: number): string {
  const code = String(payload.code || "").trim();
  const friendly = String(payload.message || payload.error || payload.provisionError || "").trim();

  switch (code) {
    case "stale_invite_target":
      return (
        sanitizeRawInviteMessage(friendly) ||
        "This invite is out of date. Please ask your administrator to send a fresh invite."
      );
    case "invite_expired":
      return "This invite has expired. Ask your administrator to send a new invite.";
    case "invite_not_found":
      return "This invite link is not valid. Ask your administrator to send a new invite.";
    case "invite_already_used":
      return "This invite has already been used. Sign in with your email and password, or ask for a new invite.";
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
      return (
        sanitizeRawInviteMessage(friendly) ||
        "Account setup could not be finished. Ask your administrator to send a new invite if you still cannot sign in."
      );
    case "validation_error":
      return sanitizeRawInviteMessage(friendly) || "Check the form and try again.";
    default:
      break;
  }

  if (httpStatus === 401) {
    return "Account setup is not available right now. Ask your administrator to reconnect Google on the server, then try again.";
  }
  if (httpStatus === 410) {
    return "This invite has expired or was already used. Ask your administrator to send a new invite.";
  }
  if (httpStatus === 404) {
    return "This invite link is not valid. Ask your administrator to send a new invite.";
  }
  if (httpStatus >= 500) {
    return (
      sanitizeRawInviteMessage(friendly) ||
      "Something went wrong while finishing your account. Ask your administrator to send a new invite if you still cannot sign in."
    );
  }

  const sanitized = sanitizeRawInviteMessage(friendly);
  return sanitized || "Something went wrong. Ask your administrator to send a new invite.";
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
  return (
    sanitized ||
    "We could not reach BERT to finish setup. Check your internet connection and try again."
  );
}
