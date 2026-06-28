/**
 * Safe login timing diagnostics — console logs only; never emit secrets.
 */
export const LOGIN_TIMING_PREFIX = "[login-timing]";

const BLOCKED_META_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "answers",
  "answersjson",
  "answers_json",
  "findings",
  "findingsjson",
  "findings_json",
  "evidence",
  "evidencerefs",
  "evidence_refs",
  "token",
  "secret",
  "secrethash",
  "cookie",
  "cookies",
  "setcookie",
  "authorization",
  "hash",
]);

function normalizeMetaKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

/** Strip keys/values that must never appear in login timing logs. */
export function safeLoginTimingMeta(meta = {}) {
  if (!meta || typeof meta !== "object") {
    return {};
  }
  const safe = {};
  for (const [key, value] of Object.entries(meta)) {
    const normalized = normalizeMetaKey(key);
    if (!normalized || BLOCKED_META_KEYS.has(normalized)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
      continue;
    }
    if (value == null) {
      continue;
    }
    if (Array.isArray(value)) {
      safe[key] = value.length;
    }
  }
  return safe;
}

/** Mask email for timing logs when full address is not required. */
export function maskLoginEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized.includes("@")) {
    return "(redacted)";
  }
  const [local, domain] = normalized.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible || "*"}***@${domain}`;
}

/** Safe email meta — full email is OK (existing company-auth logs already include email). */
export function loginTimingEmailMeta(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized.includes("@")) {
    return {};
  }
  return { email: normalized };
}

export function logLoginTimingPhase(phase, startMs, meta = {}) {
  const durationMs = Date.now() - startMs;
  console.info(LOGIN_TIMING_PREFIX, phase, {
    durationMs,
    ...safeLoginTimingMeta(meta),
  });
  return durationMs;
}

export function logLoginTimingMark(phase, meta = {}) {
  console.info(LOGIN_TIMING_PREFIX, phase, safeLoginTimingMeta(meta));
}

export function createLoginTimingTrace(initialMeta = {}) {
  const traceId = `login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const originMs = Date.now();
  const baseMeta = safeLoginTimingMeta(initialMeta);

  return {
    traceId,
    originMs,
    mark(phase, meta = {}) {
      console.info(LOGIN_TIMING_PREFIX, phase, {
        traceId,
        elapsedMs: Date.now() - originMs,
        ...baseMeta,
        ...safeLoginTimingMeta(meta),
      });
    },
    logMark(phase, meta = {}) {
      this.mark(phase, meta);
    },
    phase(phase, startMs, meta = {}) {
      const durationMs = Date.now() - startMs;
      console.info(LOGIN_TIMING_PREFIX, phase, {
        traceId,
        durationMs,
        elapsedMs: Date.now() - originMs,
        ...baseMeta,
        ...safeLoginTimingMeta(meta),
      });
      return durationMs;
    },
    logPhase(phase, startMs, meta = {}) {
      return this.phase(phase, startMs, meta);
    },
    total(phase, meta = {}) {
      const durationMs = Date.now() - originMs;
      console.info(LOGIN_TIMING_PREFIX, phase, {
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
