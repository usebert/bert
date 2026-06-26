/**
 * Safe server-side performance timing — never log secrets, answers, or password hashes.
 */
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
  "hash",
  "secrethash",
]);

function normalizeMetaKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

export function safePerfMeta(meta = {}) {
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
    if (Array.isArray(value)) {
      safe[key] = value.length;
    }
  }
  return safe;
}

export function logPerfPhase(scope, phase, startMs, meta = {}) {
  const durationMs = Date.now() - startMs;
  console.info(`[${scope}]`, {
    phase,
    durationMs,
    ...safePerfMeta(meta),
  });
  return durationMs;
}

export function logPerfTotal(scope, startedAt, meta = {}) {
  const totalMs = Date.now() - startedAt;
  console.info(`[${scope}]`, {
    phase: "total",
    durationMs: totalMs,
    ...safePerfMeta(meta),
  });
  return totalMs;
}

export function createPerfTimer(scope, initialMeta = {}) {
  const startedAt = Date.now();
  console.info(`[${scope}]`, { phase: "start", ...safePerfMeta(initialMeta) });
  return {
    startedAt,
    mark(phase, meta = {}) {
      return logPerfPhase(scope, phase, startedAt, meta);
    },
    finish(meta = {}) {
      return logPerfTotal(scope, startedAt, meta);
    },
  };
}
