/**
 * Safe client-side login timing diagnostics — console logs only.
 */
const LOGIN_TIMING_PREFIX = "[login-timing]";

const BLOCKED_META_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "secret",
  "cookie",
  "cookies",
  "authorization",
  "hash",
]);

function normalizeMetaKey(key: string): string {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function safeLoginTimingMeta(meta: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(meta)) {
    const normalized = normalizeMetaKey(key);
    if (!normalized || BLOCKED_META_KEYS.has(normalized)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

export type ClientLoginTimingTrace = {
  startedAt: number;
  mark: (phase: string, meta?: Record<string, unknown>) => void;
};

export function createClientLoginTimingTrace(): ClientLoginTimingTrace {
  const traceId = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  return {
    startedAt,
    mark(phase, meta = {}) {
      console.info(LOGIN_TIMING_PREFIX, phase, {
        traceId,
        elapsedMs: Date.now() - startedAt,
        ...safeLoginTimingMeta(meta),
      });
    },
  };
}

export function logClientLoginTiming(
  phase: string,
  loginStartedAt: number | undefined,
  meta: Record<string, unknown> = {},
): void {
  console.info(LOGIN_TIMING_PREFIX, phase, {
    ...(typeof loginStartedAt === "number" ? { elapsedMs: Date.now() - loginStartedAt } : {}),
    ...safeLoginTimingMeta(meta),
  });
}
