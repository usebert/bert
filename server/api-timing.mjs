/**
 * Safe post-login API timing diagnostics — console logs only; never emit secrets.
 */
import { safeLoginTimingMeta } from "./login-timing.mjs";

export const API_TIMING_PREFIX = "[api-timing]";

export function createApiTimingTrace(initialMeta = {}) {
  const traceId = `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const originMs = Date.now();
  const baseMeta = safeLoginTimingMeta(initialMeta);

  return {
    traceId,
    originMs,
    mark(phase, meta = {}) {
      console.info(API_TIMING_PREFIX, phase, {
        traceId,
        elapsedMs: Date.now() - originMs,
        ...baseMeta,
        ...safeLoginTimingMeta(meta),
      });
    },
    phase(phase, startMs, meta = {}) {
      const durationMs = Date.now() - startMs;
      console.info(API_TIMING_PREFIX, phase, {
        traceId,
        durationMs,
        elapsedMs: Date.now() - originMs,
        ...baseMeta,
        ...safeLoginTimingMeta(meta),
      });
      return durationMs;
    },
    total(phase, meta = {}) {
      const durationMs = Date.now() - originMs;
      console.info(API_TIMING_PREFIX, phase, {
        traceId,
        durationMs,
        ...baseMeta,
        ...safeLoginTimingMeta(meta),
      });
      return durationMs;
    },
    totalMs() {
      return Date.now() - originMs;
    },
  };
}

/** Attach response_sent + total_duration logs when the HTTP response finishes. */
export function attachApiRouteTimingFinish(res, trace, meta = {}) {
  if (!trace || res.headersSent && res.writableEnded) {
    return;
  }
  const responseStartedMs = Date.now();
  res.on("finish", () => {
    trace.phase("response_sent", responseStartedMs, meta);
    trace.total("total_duration", meta);
  });
}
