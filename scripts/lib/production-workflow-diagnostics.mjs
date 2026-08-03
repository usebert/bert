/**
 * Operational diagnostics for production workflow verifiers — stage progress,
 * per-request timeouts, total budget, and safe request metadata.
 */

export const TOTAL_VERIFIER_BUDGET_MS = 8 * 60 * 1000;

export const DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS = {
  authentication: 90_000,
  actionsApi: 60_000,
  baseline: 60_000,
  staleCleanup: 60_000,
  createAction: 60_000,
  openAction: 60_000,
  startAction: 60_000,
  progressUpdate: 60_000,
  awaitingVerification: 60_000,
  verifyClose: 120_000,
  dashboard: 60_000,
  search: 5_000,
  cleanup: 60_000,
};

function trim(value) {
  return String(value ?? "").trim();
}

export function formatSafeRequestUrl(apiBase, path) {
  const base = trim(apiBase).replace(/\/$/, "");
  const rawPath = trim(path);
  if (!rawPath) {
    return base || "(unknown)";
  }
  if (/^https?:\/\//i.test(rawPath)) {
    try {
      const url = new URL(rawPath);
      return `${url.origin}${url.pathname}`;
    } catch {
      return rawPath.split("?")[0];
    }
  }
  const [pathname, query] = rawPath.split("?");
  const safePath = `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  if (!query) {
    return safePath;
  }
  const params = new URLSearchParams(query);
  const safeParts = [];
  for (const [key, value] of params.entries()) {
    if (/password|token|secret|cookie|hash/i.test(key)) {
      safeParts.push(`${key}=***`);
      continue;
    }
    safeParts.push(`${key}=${value}`);
  }
  return safeParts.length > 0 ? `${safePath}?${safeParts.join("&")}` : safePath;
}

export function isStageTimeoutError(error) {
  return Boolean(error && (error.code === "STAGE_TIMEOUT" || error.name === "StageTimeoutError"));
}

export function createWorkflowDiagnostics(options = {}) {
  const log = typeof options.log === "function" ? options.log : console.log;
  const prefix = trim(options.prefix) || "[actions-workflow]";
  const startedAt = Number(options.startedAt) || Date.now();
  const totalBudgetMs = Number(options.totalBudgetMs) || TOTAL_VERIFIER_BUDGET_MS;
  const stageTimeouts =
    options.stageTimeouts && typeof options.stageTimeouts === "object"
      ? options.stageTimeouts
      : DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS;
  const stageStartedAt = new Map();

  function elapsedMs() {
    return Date.now() - startedAt;
  }

  function getStageTimeout(stageKey) {
    return Number(stageTimeouts[stageKey]) || 60_000;
  }

  function checkTotalBudget() {
    const elapsed = elapsedMs();
    if (elapsed > totalBudgetMs) {
      const error = new Error(`Verifier total budget exceeded after ${elapsed}ms (limit ${totalBudgetMs}ms).`);
      error.code = "VERIFIER_BUDGET_EXCEEDED";
      error.elapsedMs = elapsed;
      error.totalBudgetMs = totalBudgetMs;
      throw error;
    }
  }

  function beginStage(stageKey, label = stageKey) {
    checkTotalBudget();
    stageStartedAt.set(stageKey, Date.now());
    log(`${prefix} → ${label}`);
  }

  function endStage(stageKey, status = "PASS", durationMs) {
    const started = stageStartedAt.get(stageKey) || Date.now();
    const duration = Number.isFinite(durationMs) ? durationMs : Date.now() - started;
    log(`${prefix} ✓ ${CHECK_LABEL_FROM_KEY(stageKey, labelFromOptions(stageKey, options))} (${duration}ms) — ${status}`);
    stageStartedAt.delete(stageKey);
    return duration;
  }

  function failStage(stageKey, status = "FAIL", durationMs) {
    const started = stageStartedAt.get(stageKey) || Date.now();
    const duration = Number.isFinite(durationMs) ? durationMs : Date.now() - started;
    const label = labelFromOptions(stageKey, options);
    log(`${prefix} ✗ ${label} (${duration}ms) — ${status}`);
    stageStartedAt.delete(stageKey);
    return duration;
  }

  return {
    beginStage,
    endStage,
    failStage,
    checkTotalBudget,
    getStageTimeout,
    elapsedMs,
    totalBudgetMs,
    prefix,
  };
}

function labelFromOptions(stageKey, options) {
  const labels = options.stageLabels || {};
  return labels[stageKey] || stageKey;
}

function CHECK_LABEL_FROM_KEY(stageKey, label) {
  return label || stageKey;
}

export function wrapTransportWithTimeouts(transport, options = {}) {
  const apiBase = trim(options.apiBase);
  const getStageKey = typeof options.getStageKey === "function" ? options.getStageKey : () => "authentication";
  const getTimeout =
    typeof options.getTimeout === "function"
      ? options.getTimeout
      : (stageKey) => DEFAULT_ACTIONS_STAGE_TIMEOUTS_MS[stageKey] || 60_000;
  const baseRequest = transport.request.bind(transport);

  async function request(method, path, body, requestOptions = {}) {
    const stageKey = trim(requestOptions.stageKey) || getStageKey();
    const timeoutMs = Number(requestOptions.timeoutMs) || getTimeout(stageKey);
    const safeUrl = formatSafeRequestUrl(apiBase, path);
    const started = Date.now();
    try {
      return await baseRequest(method, path, body, { ...requestOptions, timeoutMs });
    } catch (error) {
      if (error?.name === "AbortError" || /aborted/i.test(String(error?.message || ""))) {
        const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutError.name = "StageTimeoutError";
        timeoutError.code = "STAGE_TIMEOUT";
        timeoutError.stageKey = stageKey;
        timeoutError.method = String(method || "GET").toUpperCase();
        timeoutError.safeUrl = safeUrl;
        timeoutError.elapsedMs = Date.now() - started;
        timeoutError.timeoutMs = timeoutMs;
        throw timeoutError;
      }
      throw error;
    }
  }

  return {
    ...transport,
    request,
  };
}

export function buildTimeoutFailureResult({
  stageKey,
  stageLabel,
  method,
  safeUrl,
  elapsedMs,
  timeoutMs,
  totalElapsedMs,
}) {
  return {
    failedKey: stageKey,
    failedStage: stageLabel || stageKey,
    failureReason: `Stage timed out after ${timeoutMs}ms.`,
    remediation: "Inspect API latency, Google Sheets quota, and server logs for the timed-out route.",
    httpStatus: 408,
    safeResponseBody: JSON.stringify({
      timeout: true,
      stage: stageLabel || stageKey,
      method: method || "GET",
      safeUrl: safeUrl || "(unknown)",
      elapsedMs: elapsedMs || 0,
      timeoutMs: timeoutMs || 0,
      totalElapsedMs: totalElapsedMs || 0,
    }),
    timedOut: true,
    timeoutMethod: method,
    timeoutSafeUrl: safeUrl,
    timeoutElapsedMs: elapsedMs,
    timeoutMs,
  };
}
