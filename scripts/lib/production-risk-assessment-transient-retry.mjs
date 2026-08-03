/**
 * Transient retry helpers for production Risk Assessment workflow mutations.
 *
 * HTTP 502 with an empty body during long approve/review calls is emitted by the
 * upstream reverse proxy (Render) when the client connection is closed before the
 * Node process returns. Express route handlers return 500 on caught errors and
 * withOperationTimeout rejections — not 502.
 */

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

function trim(value) {
  return String(value ?? "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP_STATUSES.has(Number(status));
}

export function isTransientNetworkError(error) {
  if (!error) return false;
  if (error.code === "STAGE_TIMEOUT" || error.name === "StageTimeoutError") return true;
  if (error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed|socket hang up/i.test(message);
}

export function isTransientWorkflowFailure(response, error) {
  if (error) {
    return isTransientNetworkError(error);
  }
  return isTransientHttpStatus(response?.status);
}

export async function requestWithTransientRetries(request, method, path, body, options = {}) {
  const maxRetries = Number(options.maxRetries) || 2;
  const baseBackoffMs = Number(options.baseBackoffMs) || 2_000;
  const stageKey = options.stageKey || "mutation";
  const attempts = [];
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = baseBackoffMs * 2 ** (attempt - 1);
      attempts.push({ attempt, action: "backoff", backoffMs });
      await sleep(backoffMs);
    }
    try {
      lastResponse = await request(method, path, body, { ...options, stageKey });
      lastError = null;
      attempts.push({
        attempt: attempt + 1,
        action: "request",
        httpStatus: lastResponse.status,
        ok: lastResponse.json?.ok === true,
        transient: isTransientHttpStatus(lastResponse.status),
      });
      if (!isTransientHttpStatus(lastResponse.status) || attempt >= maxRetries) {
        return { response: lastResponse, attempts, retried: attempt > 0 };
      }
    } catch (error) {
      lastError = error;
      attempts.push({
        attempt: attempt + 1,
        action: "request-error",
        transient: isTransientNetworkError(error),
        error: error instanceof Error ? error.message : String(error),
      });
      if (!isTransientNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }
    }
  }

  return { response: lastResponse, attempts, retried: maxRetries > 0, error: lastError };
}

export function assessmentAlreadyApproved(detailResponse, expectedStatuses = ["Active", "Approved"]) {
  const status = trim(detailResponse?.json?.item?.status);
  if (!status || !expectedStatuses.includes(status)) {
    return false;
  }
  return Boolean(trim(detailResponse?.json?.item?.approvedAt) && trim(detailResponse?.json?.item?.approvedBy));
}

export function reviewAlreadyRecorded(detailResponse, reviewId) {
  const expectedId = trim(reviewId);
  if (!expectedId) return false;
  const reviews = Array.isArray(detailResponse?.json?.reviews) ? detailResponse.json.reviews : [];
  return reviews.some((entry) => trim(entry.id) === expectedId);
}
