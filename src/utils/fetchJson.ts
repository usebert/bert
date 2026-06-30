import { apiUrl } from "../config/apiBase";
import { dedupeInFlight, requestDedupeKey } from "./requestDedupe";

export type FetchJsonErrorCode =
  | "NON_JSON_RESPONSE"
  | "INVALID_JSON_RESPONSE"
  | "EMPTY_RESPONSE"
  | "NETWORK_UNREACHABLE";

export type FetchJsonDiagnostics = {
  contentType?: string;
  status?: number;
  url?: string;
  rawSnippet?: string;
  fetchErrorName?: string;
  fetchErrorMessage?: string;
};

export type FetchJsonSuccess<T> = {
  ok: true;
  data: T;
  response: Response;
};

export type FetchJsonFailure = {
  ok: false;
  code: FetchJsonErrorCode;
  message: string;
  response?: Response;
  diagnostics?: FetchJsonDiagnostics;
};

export type FetchJsonResult<T> = FetchJsonSuccess<T> | FetchJsonFailure;

function resolveFetchUrl(path: string): string {
  return path.startsWith("http") ? path : apiUrl(path);
}

function isJsonContentType(contentType: string): boolean {
  const lowered = contentType.toLowerCase();
  return lowered.includes("application/json") || lowered.includes("+json");
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

async function fetchJsonOnce<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<FetchJsonResult<T>> {
  const url = resolveFetchUrl(path);
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    const fetchErrorName =
      error instanceof DOMException ? error.name : error instanceof Error ? error.name : "Error";
    const fetchErrorMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "NETWORK_UNREACHABLE",
      message: fetchErrorMessage,
      diagnostics: { url, fetchErrorName, fetchErrorMessage },
    };
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      ok: false,
      code: "EMPTY_RESPONSE",
      message: `No response body (${response.status}).`,
      response,
      diagnostics: { contentType, status: response.status, url },
    };
  }

  if (!isJsonContentType(contentType) && looksLikeHtml(trimmed)) {
    return {
      ok: false,
      code: "NON_JSON_RESPONSE",
      message: `Server returned HTML instead of JSON (${response.status}).`,
      response,
      diagnostics: {
        contentType,
        status: response.status,
        url,
        rawSnippet: trimmed.slice(0, 120),
      },
    };
  }

  try {
    return { ok: true, data: JSON.parse(trimmed) as T, response };
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON_RESPONSE",
      message: `Server returned invalid JSON (${response.status}).`,
      response,
      diagnostics: {
        contentType,
        status: response.status,
        url,
        rawSnippet: trimmed.slice(0, 120),
      },
    };
  }
}

/** Safe JSON fetch — checks Content-Type and never throws on HTML or invalid JSON bodies. */
export async function fetchJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<FetchJsonResult<T>> {
  const url = resolveFetchUrl(path);
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET" && !init?.body) {
    return dedupeInFlight(requestDedupeKey(method, url), () => fetchJsonOnce<T>(path, init));
  }
  return fetchJsonOnce<T>(path, init);
}
