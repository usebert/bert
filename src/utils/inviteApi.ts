import { apiUrl } from "../config/apiBase";

export type InviteApiErrorCode =
  | "INVITE_INVALID"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_USED"
  | "INVITE_WRONG_TYPE"
  | "PROVISIONING_FAILED"
  | "NETWORK_UNREACHABLE"
  | "SERVER_ERROR";

export type InviteApiPayload = {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  provisionError?: string;
};

export type InviteApiSuccess<T> = {
  ok: true;
  data: T;
  response: Response;
};

export type InviteApiFailure = {
  ok: false;
  code: InviteApiErrorCode;
  error?: string;
  message?: string;
  response?: Response;
};

export type InviteApiResult<T> = InviteApiSuccess<T> | InviteApiFailure;

function isNetworkFetchError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof DOMException && error.name === "NetworkError") {
    return true;
  }
  return false;
}

function normalizeInviteErrorCode(raw: string | undefined, httpStatus: number): InviteApiErrorCode {
  const code = String(raw || "").trim();
  switch (code) {
    case "INVITE_INVALID":
    case "INVITE_EXPIRED":
    case "INVITE_ALREADY_USED":
    case "INVITE_WRONG_TYPE":
    case "PROVISIONING_FAILED":
    case "NETWORK_UNREACHABLE":
    case "SERVER_ERROR":
      return code;
    case "invite_not_found":
    case "stale_invite_target":
    case "validation_error":
      return "INVITE_INVALID";
    case "invite_expired":
      return "INVITE_EXPIRED";
    case "invite_already_used":
      return "INVITE_ALREADY_USED";
    case "setup_failed":
      return "PROVISIONING_FAILED";
    default:
      break;
  }
  if (httpStatus === 410) {
    return "INVITE_EXPIRED";
  }
  if (httpStatus === 404) {
    return "INVITE_INVALID";
  }
  if (httpStatus >= 500) {
    return "SERVER_ERROR";
  }
  return "INVITE_INVALID";
}

async function readJsonBody<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/** Fetch invite/onboarding API routes; real transport failures become NETWORK_UNREACHABLE. */
export async function fetchInviteApi<T extends InviteApiPayload = InviteApiPayload>(
  path: string,
  init?: RequestInit,
): Promise<InviteApiResult<T>> {
  const url = path.startsWith("http") ? path : apiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      ...init,
    });
  } catch (error) {
    if (isNetworkFetchError(error)) {
      return { ok: false, code: "NETWORK_UNREACHABLE" };
    }
    return {
      ok: false,
      code: "SERVER_ERROR",
      error: error instanceof Error ? error.message : "Unexpected error.",
    };
  }

  const payload = await readJsonBody<T>(response);
  if (!response.ok) {
    const code = normalizeInviteErrorCode(payload?.code, response.status);
    return {
      ok: false,
      code,
      error: payload?.error,
      message: payload?.message || payload?.provisionError,
      response,
    };
  }

  if (!payload) {
    return {
      ok: false,
      code: response.status >= 500 ? "SERVER_ERROR" : "INVITE_INVALID",
      error: `No response body (${response.status}).`,
      response,
    };
  }

  if (payload.ok === false) {
    const code = normalizeInviteErrorCode(payload.code, response.status);
    return {
      ok: false,
      code,
      error: payload.error,
      message: payload.message || payload.provisionError,
      response,
    };
  }

  return { ok: true, data: payload, response };
}
