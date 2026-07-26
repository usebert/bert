/**
 * Google Sheets quota / rate-limit retry with exponential backoff and jitter.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isSheetsQuotaOrRateLimitError(err) {
  if (!err || typeof err !== "object") {
    return false;
  }
  const status = err.code ?? err.response?.status ?? err.status;
  if (status === 429) {
    return true;
  }
  const msg = String(err.message || (typeof err.toString === "function" ? err.toString() : "") || "");
  if (/quota|resource_exhausted|rate limit|429/i.test(msg)) {
    return true;
  }
  const apiStatus = err.response?.data?.error?.status;
  if (apiStatus === "RESOURCE_EXHAUSTED") {
    return true;
  }
  const reasons = err.errors || err.response?.data?.error?.errors;
  if (Array.isArray(reasons)) {
    for (const entry of reasons) {
      const reason = String(entry?.reason || "").toLowerCase();
      if (
        reason.includes("quota") ||
        reason.includes("ratelimit") ||
        reason === "userratelimitexceeded" ||
        reason === "ratelimitexceeded"
      ) {
        return true;
      }
    }
  }
  return false;
}

export function createSheetsQuotaRetry(options = {}) {
  const maxRetries = Math.max(
    1,
    Number(options.maxRetries ?? process.env.SHEETS_QUOTA_MAX_RETRIES ?? 8) || 8,
  );
  const label = String(options.label || "sheets").trim() || "sheets";
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs ?? 1000) || 1000);
  const maxDelayMs = Math.max(baseDelayMs, Number(options.maxDelayMs ?? 45_000) || 45_000);

  return async function withSheetsQuotaRetry(fn, meta = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (!isSheetsQuotaOrRateLimitError(err) || attempt === maxRetries) {
          throw err;
        }
        let delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        const retryAfter = err.response?.headers?.["retry-after"];
        if (retryAfter) {
          const secs = Number(retryAfter);
          if (Number.isFinite(secs) && secs > 0) {
            delayMs = Math.max(delayMs, Math.min(120_000, secs * 1000));
          }
        }
        const jitter = Math.floor(Math.random() * 500);
        delayMs += jitter;
        const operation = meta.operation ? ` (${meta.operation})` : "";
        console.log(
          `[${label}] quota retry attempt ${attempt + 1}/${maxRetries}${operation}, waiting ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }
    throw new Error("Sheets quota retry exhausted.");
  };
}
